// The mining site: one huge planet made of cubes, your starship in orbit,
// ore pickups, projectiles, enemies, and all the effects in between.
import { PHYS, ORES, ECONOMY, PLANETGEN } from './data.js';
import { TAU, rand, clamp, rayCircle, hexA } from './util.js';
import { SpatialHash } from './spatial.js';
import { Particles, Floaters, P_GLOW, P_SPARK, P_SMOKE, P_DEBRIS } from './particles.js';
import { CAT_COLORS } from './render.js';
import { PlanetGrid } from './planetgrid.js';

const C = PHYS.CELL;

export class World {
  // planetState: { index, seed, removed }
  constructor(game, planetState = { index: 0, seed: 1 }) {
    this.game = game;
    this.time = 0;
    this.pickups = [];
    this.bullets = [];
    this.enemies = [];
    this.hash = new SpatialHash(160);
    this.particles = new Particles(5000);
    this.floaters = new Floaters();
    this.planet = new PlanetGrid({ index: planetState.index || 0, seed: planetState.seed || 1 });
    this.planet.importRemoved(planetState.removed);
    const R = this.planet.R;
    // your starship hangs in orbit above the north pole
    this.station = { x: 0, y: -(R + PLANETGEN.starshipGap), r: 150, angle: 0 };
    this.radius = R + PLANETGEN.starshipGap + 1600; // soft edge of the play area
    this.bulletPool = [];
    this._sparkT = 0;
    this._fullMsgT = 0;
    this._hardT = 0;
    this.ship = null;
  }

  // ------------------------------------------------------------ pickups
  spawnPickup(x, y, ore, speed = 90, dirx = null, diry = null) {
    if (this.pickups.length >= PLANETGEN.maxPickups) {
      // too much loose ore: hand it straight to the freighter if it has room
      const s = this.game.ship;
      if (s && !s.dead && s.addOre(ore, 1)) { this.game.onOreCollected && this.game.onOreCollected(ore, 1); return; }
      this.pickups.shift();
    }
    let a = rand(0, TAU);
    if (dirx !== null) a = Math.atan2(diry, dirx) + rand(-0.6, 0.6);
    this.pickups.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, ore, amount: 1, life: 45, radius: 6, kind: 'pickup', spin: rand(0, TAU), vs: rand(-6, 6) });
  }

  spillOre(ship, taken) {
    for (const k in taken) for (let n = 0; n < Math.ceil(taken[k]); n++) this.spawnPickup(ship.x, ship.y, k, rand(80, 200));
  }

  attractPickups(ship, radius, dt) {
    const r2 = radius * radius;
    const grab = Math.max(18, ship.radius * 0.55);
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      const dx = ship.x - p.x, dy = ship.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2 + grab * grab) continue;
      const d = Math.sqrt(d2) || 1;
      if (ship.cargoUnits >= ship.cargoMax - 0.001) {
        if (d < grab && this.time > this._fullMsgT) {
          this._fullMsgT = this.time + 2.5;
          this.floaters.add(ship.x, ship.y - ship.radius - 10, 'Cargo full — head home', '#ffcf5a', 15, -30, 1.6);
          this.game.sfx('denied');
          this.game.onCargoFull && this.game.onCargoFull();
        }
        continue;
      }
      if (d < grab) {
        const got = ship.addOre(p.ore, p.amount);
        if (got > 0) {
          this.pickups.splice(i, 1);
          const ore = ORES[p.ore];
          this.particles.spawn(P_GLOW, p.x, p.y, ship.vx, ship.vy, 0.25, 4, ore.glow);
          this.game.onOreCollected && this.game.onOreCollected(p.ore, got);
          this.game.sfx('pickup', ore.value);
        }
        continue;
      }
      const pull = 900 * (1 - d / (radius + grab)) + 200;
      p.vx += (dx / d) * pull * dt; p.vy += (dy / d) * pull * dt;
      p.vx += (ship.vx - p.vx) * dt * 3; p.vy += (ship.vy - p.vy) * dt * 3;
    }
  }

  // ------------------------------------------------------- projectiles
  spawnBullet(b) {
    const o = this.bulletPool.pop() || {};
    o.x = b.x; o.y = b.y; o.vx = b.vx; o.vy = b.vy; o.damage = b.damage; o.owner = b.owner;
    o.life = b.life; o.pierce = b.pierce || 1; o.kind = b.kind || 'shell'; o.hit = o.hit || new Set(); o.hit.clear();
    o.color = b.color || (o.owner === 'player' ? (o.kind === 'rail' ? '#b8f3ff' : '#ffe08a') : '#ff4d6d');
    o.radius = b.radius || (o.kind === 'rail' ? 4 : 3);
    o.target = b.target || null;
    this.bullets.push(o);
    return o;
  }

  // first thing a beam hits: a planet cube or an enemy
  raycast(ox, oy, dx, dy, range) {
    let best = null;
    const ph = this.planet.raycast(ox, oy, dx, dy, range);
    if (ph) best = { t: ph.t, obj: { kind: 'planet', i: ph.i, j: ph.j } };
    const cx = ox + dx * range * 0.5, cy = oy + dy * range * 0.5;
    this.hash.query(cx, cy, range * 0.5 + 10, (o) => {
      if (o.kind !== 'enemy') return;
      const t = rayCircle(ox, oy, dx, dy, o.x, o.y, o.radius);
      if (t >= 0 && t <= range && (!best || t < best.t)) best = { t, obj: o };
    });
    return best;
  }

  laserHit(hit, mineDmg, enemyDmg, x, y, ship, tier = 1) {
    const o = hit.obj;
    if (o.kind === 'planet') {
      const pl = this.planet;
      const mat = pl.matAt(o.i, o.j);
      if (this.time > this._sparkT) {
        this._sparkT = this.time + 0.03;
        const name = mat ? pl.matName(mat) : 'regolith';
        const col = ORES[name].glow;
        this.particles.spawn(P_SPARK, x, y, rand(-160, 160), rand(-160, 160), rand(0.2, 0.45), 2, col, 2);
        this.particles.spawn(P_GLOW, x, y, 0, 0, 0.12, 6, col);
        if (mat && ORES[name].tier > tier && this.time > this._hardT) {
          this._hardT = this.time + 3;
          this.floaters.add(x, y - 12, ORES[name].tier === 2 ? 'Too hard — needs a Plasma Cutter' : 'Too hard — needs a Deep Bore', '#ffcf5a', 13, -30, 1.6);
        }
      }
      const got = pl.damage(o.i, o.j, mineDmg, tier);
      if (got) {
        const [cx, cy] = pl.centerOf(o.i, o.j);
        const [nx, ny] = pl.normalAt(cx, cy);
        // the cube rips loose and tumbles toward space (and your magnet)
        this.spawnPickup(cx, cy, got, rand(70, 140), nx + (ship.x - cx) * 0.002, ny + (ship.y - cy) * 0.002);
        this.particles.burst(cx, cy, 5, ORES[got].glow, 120, 0.35, 2, P_SPARK);
        this.particles.spawn(P_DEBRIS, cx, cy, nx * 60, ny * 60, 0.6, 5, ORES[got].color);
        this.game.sfx('chunk');
        this.game.onCubeMined && this.game.onCubeMined(got);
      }
    } else if (o.kind === 'enemy') {
      this.damageEnemy(o, enemyDmg, x, y, true);
    }
  }

  findTarget(x, y, range) {
    let best = null, bd = range * range;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  damageEnemy(e, dmg, x, y, quiet = false) {
    if (this.game.enemySystem) this.game.enemySystem.damage(e, dmg, x, y, quiet);
  }

  onRailFire(x, y, dx, dy) {
    for (let k = 0; k < 10; k++) this.particles.spawn(P_SPARK, x, y, dx * rand(200, 700) + rand(-80, 80), dy * rand(200, 700) + rand(-80, 80), 0.3, 2, '#b8f3ff', 3);
    this.particles.spawn(P_GLOW, x, y, 0, 0, 0.18, 14, '#b8f3ff');
    this.game.shake(5);
    this.game.sfx('rail');
  }
  onTurretFire(x, y) {
    this.particles.spawn(P_GLOW, x, y, 0, 0, 0.07, 5, '#ffd27a');
    this.game.sfx('shoot');
  }
  onShieldHit(ship, x, y) {
    this.particles.spawn(P_GLOW, x, y, 0, 0, 0.2, 8, '#6aa8ff');
    this.game.sfx('shield');
  }
  onPartHit(ship, p, dmg) {
    const [x, y] = ship.toWorld(p.lx, p.ly);
    this.floaters.add(x, y, '-' + Math.round(dmg), '#ff6b6b', 13, -40, 0.8);
    this.particles.burst(x, y, 4, '#ffb36b', 140, 0.35, 2, P_SPARK);
  }
  onPartDestroyed(ship, p, x, y) {
    const col = CAT_COLORS[p.def.cat];
    this.particles.burst(x, y, 18, col, 240, 0.7, 2.5, P_SPARK, ship.vx, ship.vy);
    this.particles.burst(x, y, 8, '#8a8f9e', 160, 1.5, 4, P_DEBRIS, ship.vx, ship.vy);
    this.particles.burst(x, y, 5, '#40404a', 40, 1.2, 10, P_SMOKE, ship.vx, ship.vy);
    this.particles.spawn(P_GLOW, x, y, ship.vx, ship.vy, 0.3, 24, col);
    if (p.def.explode) { this.particles.ring(x, y, p.def.explode.radius * C * 2, '#ffd60a', 0.5, 4); this.game.shake(12); }
    this.floaters.add(x, y - 10, `${p.def.name} lost!`, '#ff6b6b', 14, -30, 1.4);
    this.game.shake(6);
    this.game.sfx('partLost');
  }
  onPartDetached(ship, p, x, y) {
    this.particles.burst(x, y, 6, '#8a8f9e', 220, 2, 6, P_DEBRIS, ship.vx, ship.vy);
  }
  onShipDestroyed(ship) {
    this.particles.burst(ship.x, ship.y, 80, '#ffd27a', 420, 1.2, 3, P_SPARK);
    this.particles.burst(ship.x, ship.y, 30, '#8a8f9e', 260, 2.4, 7, P_DEBRIS);
    this.particles.ring(ship.x, ship.y, 260, '#ffd27a', 0.8, 6);
    this.game.shake(20);
    this.game.sfx('bigBoom');
    this.game.onShipDestroyed && this.game.onShipDestroyed(ship);
  }
  crackerTarget() { return false; }
  fireCracker() {}

  // -------------------------------------------------------------- update
  update(dt, ship) {
    this.time += dt;
    this.ship = ship;
    this.station.angle += dt * 0.05;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 - 1.0 * dt; p.vy *= 1 - 1.0 * dt;
      p.spin += p.vs * dt;
      p.life -= dt;
      if (p.life <= 0) this.pickups.splice(i, 1);
    }
    this.hash.clear();
    for (const e of this.enemies) if (!e.dead) this.hash.insert(e);
    if (ship && !ship.dead) {
      this.collidePlanet(ship);
      const d = Math.hypot(ship.x, ship.y);
      if (d > this.radius) { ship.vx -= (ship.x / d) * PHYS.boundaryPush * dt; ship.vy -= (ship.y / d) * PHYS.boundaryPush * dt; }
    }
    this.updateBullets(dt);
    this.particles.update(dt);
    this.floaters.update(dt);
  }

  // ship cells vs planet cubes: push out along the surface normal, bounce,
  // and spin the ship from the contact point (the freighter itself never takes damage)
  collidePlanet(ship) {
    const pl = this.planet;
    if (Math.hypot(ship.x, ship.y) > pl.R * 1.06 + ship.radius) return;
    const c = Math.cos(ship.angle), s = Math.sin(ship.angle);
    let best = null;
    for (const [k] of ship.cellMap) {
      const [gx, gy] = k.split(',').map(Number);
      const lx = (gx - ship.comX) * C, ly = (gy - ship.comY) * C;
      const wx = ship.x + lx * c - ly * s, wy = ship.y + lx * s + ly * c;
      if (!pl.solidAt(wx, wy)) continue;
      const d = Math.hypot(wx, wy);
      if (!best || d < best.d) best = { wx, wy, d };
    }
    if (!best) return;
    const [nx, ny] = pl.normalAt(best.wx, best.wy);
    // push out until that cell is clear (bounded)
    for (let n = 0; n < 6; n++) {
      ship.x += nx * 3; ship.y += ny * 3;
      const px = best.wx + nx * 3 * (n + 1), py = best.wy + ny * 3 * (n + 1);
      if (!pl.solidAt(px, py)) break;
    }
    const [pvx, pvy] = ship.pointVel(best.wx, best.wy);
    const vn = pvx * nx + pvy * ny;
    if (vn >= 0) return;
    const rx = best.wx - ship.x, ry = best.wy - ship.y;
    const rn = rx * ny - ry * nx;
    const j = (-(1 + PHYS.restitution) * vn) / (1 / ship.mass + (rn * rn) / ship.inertia);
    ship.applyImpulse(nx * j, ny * j, best.wx, best.wy);
    if (-vn > 40) {
      this.particles.burst(best.wx, best.wy, Math.min(12, 2 + -vn / 25), '#d9d2c5', -vn * 0.8, 0.35, 2, P_SPARK);
      this.game.sfx('bump', -vn);
      if (-vn > 120) this.game.shake(Math.min(10, -vn / 40));
    }
  }

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      let dead = b.life <= 0;
      if (!dead && b.owner === 'player') {
        this.hash.query(b.x, b.y, b.radius + 2, (o) => {
          if (o.kind !== 'enemy' || b.hit.has(o)) return;
          if ((o.x - b.x) ** 2 + (o.y - b.y) ** 2 > (o.radius + b.radius) ** 2) return;
          b.hit.add(o);
          this.damageEnemy(o, b.damage, b.x, b.y);
          if (--b.pierce <= 0) { dead = true; return false; }
        });
      } else if (!dead && b.target && !b.target.dead) {
        // enemy fire only hurts the ship it was aimed at (the freighter is untouchable)
        const t = b.target;
        const dx = b.x - t.x, dy = b.y - t.y;
        const shR = t.shield > 0 ? t.radius + 6 : t.radius;
        if (dx * dx + dy * dy < shR * shR && (t.shield > 0 || t.partAtWorld(b.x, b.y) >= 0)) { t.damageAt(b.x, b.y, b.damage, this); dead = true; }
      }
      if (dead) {
        if (b.life > 0) this.particles.spawn(P_GLOW, b.x, b.y, 0, 0, 0.12, 6, b.color);
        this.bulletPool.push(b);
        this.bullets[i] = this.bullets[this.bullets.length - 1];
        this.bullets.pop();
      }
    }
  }

  // --------------------------------------------------------------- draw
  draw(ctx, cam, time) {
    const v = cam.view(80);
    this.planet.draw(ctx, cam, time);
    this.drawStarship(ctx, time);
    // pickups: little tumbling cubes in their material's colour
    for (const p of this.pickups) {
      if (p.x < v.x0 || p.x > v.x1 || p.y < v.y0 || p.y > v.y1) continue;
      const ore = ORES[p.ore];
      const blink = p.life < 6 ? (Math.sin(p.life * 12) > 0 ? 1 : 0.3) : 1;
      ctx.globalAlpha = blink;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.spin);
      ctx.fillStyle = ore.color; ctx.fillRect(-5, -5, 10, 10);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-5, -5, 10, 2); ctx.fillRect(-5, -5, 2, 10);
      ctx.strokeStyle = hexA(ore.glow, 0.8); ctx.lineWidth = 1; ctx.strokeRect(-5, -5, 10, 10);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  drawBullets(ctx, cam) {
    const v = cam.view(40);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const b of this.bullets) {
      if (b.x < v.x0 || b.x > v.x1 || b.y < v.y0 || b.y > v.y1) continue;
      const L = b.kind === 'rail' ? 0.05 : 0.025;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.kind === 'rail' ? 5 : 3;
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * L * 1.6, b.y - b.vy * L * 1.6); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = b.kind === 'rail' ? 2.5 : 1.6;
      ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * L, b.y - b.vy * L); ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.globalCompositeOperation = 'source-over';
  }

  drawLasers(ctx, ship, time) {
    if (!ship || ship.dead) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of ship.parts) {
      if (!p.alive || !p.def.mining || !p.firing || !p.beam) continue;
      const [ox, oy, dx, dy] = p.beam;
      const L = p.firing;
      const w = 1 + Math.sin(time * 40) * 0.3;
      const col = p.def.beam || '46,230,166';
      ctx.strokeStyle = `rgba(${col},0.25)`; ctx.lineWidth = (p.def.beamWidth || 9) * w;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + dx * L, oy + dy * L); ctx.stroke();
      ctx.strokeStyle = 'rgba(230,255,245,0.9)'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + dx * L, oy + dy * L); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawMagnet(ctx, ship, time) {
    if (!ship || ship.dead || !ship.magnet) return;
    const R = ship.magnet + Math.max(18, ship.radius * 0.55);
    let near = false;
    for (const p of this.pickups) if ((p.x - ship.x) ** 2 + (p.y - ship.y) ** 2 < R * R) { near = true; break; }
    this._magA = (this._magA || 0) + ((near ? 1 : 0) - (this._magA || 0)) * 0.08;
    if (this._magA < 0.02) return;
    ctx.strokeStyle = `rgba(201,162,122,${0.28 * this._magA})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 10]);
    ctx.lineDashOffset = -time * 30;
    ctx.beginPath(); ctx.arc(ship.x, ship.y, R, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
  }

  drawShield(ctx, ship) {
    if (!ship || ship.dead || ship.shieldMax <= 0 || ship.shield <= 0) return;
    const k = ship.shield / ship.shieldMax;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(106,168,255,${0.15 + k * 0.3 + ship.hitFlash * 0.4})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ship.x, ship.y, ship.radius + 6, 0, TAU); ctx.stroke();
    ctx.fillStyle = `rgba(106,168,255,${0.04 + ship.hitFlash * 0.12})`;
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // Your starship: a long-hulled carrier holding orbit, hangar bay facing the planet
  drawStarship(ctx, time) {
    const st = this.station;
    ctx.save();
    ctx.translate(st.x, st.y);
    ctx.strokeStyle = 'rgba(125,249,255,0.16)'; ctx.setLineDash([8, 10]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, ECONOMY.dockRadius, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    const L = 520, H = 120;
    const body = ctx.createLinearGradient(0, -H, 0, H);
    body.addColorStop(0, '#3a4560'); body.addColorStop(0.5, '#222a3d'); body.addColorStop(1, '#131826');
    // hull silhouette
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-L * 0.5, -H * 0.25); ctx.lineTo(-L * 0.38, -H * 0.55); ctx.lineTo(L * 0.25, -H * 0.55); ctx.lineTo(L * 0.5, -H * 0.12);
    ctx.lineTo(L * 0.5, H * 0.12); ctx.lineTo(L * 0.25, H * 0.42); ctx.lineTo(L * 0.08, H * 0.42); ctx.lineTo(L * 0.04, H * 0.62);
    ctx.lineTo(-L * 0.04, H * 0.62); ctx.lineTo(-L * 0.08, H * 0.42); ctx.lineTo(-L * 0.38, H * 0.42); ctx.lineTo(-L * 0.5, H * 0.2);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#7df9ff'; ctx.lineWidth = 2; ctx.shadowColor = '#7df9ff'; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;
    // panel lines
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1.5;
    for (let x = -L * 0.4; x < L * 0.45; x += 40) { ctx.beginPath(); ctx.moveTo(x, -H * 0.5); ctx.lineTo(x, H * 0.38); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(-L * 0.45, 0); ctx.lineTo(L * 0.45, 0); ctx.stroke();
    // bridge tower
    ctx.fillStyle = '#2c3550'; ctx.fillRect(-L * 0.18, -H * 0.85, L * 0.16, H * 0.32);
    ctx.fillStyle = '#9fe8ff';
    for (let k = 0; k < 5; k++) ctx.fillRect(-L * 0.165 + k * 15, -H * 0.76, 9, 5);
    // running lights
    for (let k = 0; k < 8; k++) { ctx.fillStyle = (Math.floor(time * 2 + k) % 3 === 0) ? '#ffd60a' : '#2ee6a6'; ctx.fillRect(-L * 0.42 + k * 60, -H * 0.5, 5, 4); }
    // hangar mouth (faces the planet)
    const grd = ctx.createLinearGradient(0, H * 0.4, 0, H * 0.65);
    grd.addColorStop(0, 'rgba(125,249,255,0.7)'); grd.addColorStop(1, 'rgba(125,249,255,0)');
    ctx.fillStyle = grd; ctx.fillRect(-L * 0.04, H * 0.42, L * 0.08, H * 0.25);
    // engines at the stern
    ctx.globalCompositeOperation = 'lighter';
    for (const y of [-H * 0.25, H * 0.15]) {
      const g2 = ctx.createRadialGradient(-L * 0.52, y, 0, -L * 0.52, y, 40 + Math.sin(time * 9) * 4);
      g2.addColorStop(0, 'rgba(160,220,255,0.9)'); g2.addColorStop(1, 'rgba(80,140,255,0)');
      ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(-L * 0.52, y, 44, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }
}
