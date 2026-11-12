// A sector: asteroids, ore pickups, projectiles, the outpost, enemies.
import { PHYS, ASTEROIDS, ORES, SECTORS, ECONOMY, PARTS } from './data.js';
import { TAU, rng, rand, clamp, weightedPick, rayCircle, pick, hexA } from './util.js';
import { SpatialHash } from './spatial.js';
import { Particles, Floaters, P_GLOW, P_SPARK, P_SMOKE, P_DEBRIS } from './particles.js';
import { makeAsteroidShape, asteroidSprite, drawShip, partColor, CAT_COLORS } from './render.js';
import { oreFromDamage } from './economy.js';

const C = PHYS.CELL;

export class World {
  // opts.arena: the fighter's defense post (no asteroids, no outpost)
  constructor(sectorIndex, game, seed = 1234, opts = {}) {
    this.arena = !!opts.arena;
    this.sector = SECTORS[sectorIndex];
    this.sectorIndex = sectorIndex;
    this.game = game;
    this.seed = seed;
    this.time = 0;
    this.rocks = [];
    this.pickups = [];
    this.bullets = [];
    this.enemies = [];
    this.hazards = [];      // mines, missiles, beams (enemy-owned)
    this.hash = new SpatialHash(160);
    this.particles = new Particles(5000);
    this.floaters = new Floaters();
    this.station = { x: 0, y: 0, r: 120, angle: 0 };
    this.respawnTimer = 0;
    this.bulletPool = [];
    this._sparkT = 0;
    this._fullMsgT = 0;
    this.ship = null;
    if (!this.arena) this.genRocks();
  }

  // -------------------------------------------------------------- rocks
  genRocks() {
    const R = rng(this.seed + this.sectorIndex * 101);
    const clusters = [];
    for (let i = 0; i < 9; i++) {
      const a = R() * TAU, d = R.range(ASTEROIDS.innerClear + 300, this.sector.radius * 0.85);
      clusters.push([Math.cos(a) * d, Math.sin(a) * d, R.range(300, 700)]);
    }
    this.clusters = clusters;
    for (let i = 0; i < this.sector.asteroids; i++) this.spawnRock(R, null, i < this.sector.asteroids * 0.75);
  }

  rockPosition(R, clustered) {
    for (let tries = 0; tries < 20; tries++) {
      let x, y;
      if (clustered) {
        const [cx, cy, cr] = R.pick(this.clusters);
        const a = R() * TAU, d = Math.sqrt(R()) * cr;
        x = cx + Math.cos(a) * d; y = cy + Math.sin(a) * d;
      } else {
        const a = R() * TAU, d = R.range(ASTEROIDS.innerClear, this.sector.radius * 0.95);
        x = Math.cos(a) * d; y = Math.sin(a) * d;
      }
      if (Math.hypot(x, y) < ASTEROIDS.innerClear) continue;
      if (this.ship && Math.hypot(x - this.ship.x, y - this.ship.y) < 900 && this.time > 1) continue;
      return [x, y];
    }
    const a = R() * TAU; const d = this.sector.radius * 0.8;
    return [Math.cos(a) * d, Math.sin(a) * d];
  }

  spawnRock(R = rng((Math.random() * 1e9) | 0), at = null, clustered = true, r = null, ore = null) {
    const [x, y] = at || this.rockPosition(R, clustered);
    r = r || R.range(ASTEROIDS.minRadius, ASTEROIDS.maxRadius) * (R() < 0.15 ? 1.25 : 1);
    ore = ore || weightedPick(this.sector.ores, R());
    const seed = (R() * 1e9) | 0;
    const hp = Math.PI * r * r * ASTEROIDS.hpPerArea * this.sector.hardness;
    const rock = {
      x, y, vx: R.range(-8, 8), vy: R.range(-8, 8), r, radius: r, hp, maxHp: hp, ore, seed, angle: R() * TAU,
      av: R.range(-0.25, 0.25), mass: r * r * 0.025, oreAcc: 0, kind: 'rock', hitT: 0,
    };
    rock.shape = makeAsteroidShape(r, seed);
    rock.sprite = asteroidSprite(rock);
    this.rocks.push(rock);
    return rock;
  }

  destroyRock(rock, ship) {
    const i = this.rocks.indexOf(rock);
    if (i < 0) return;
    this.rocks.splice(i, 1);
    const ore = ORES[rock.ore];
    this.particles.burst(rock.x, rock.y, 26, ore.glow, 260, 0.8, 2.5, P_SPARK);
    this.particles.burst(rock.x, rock.y, 14, '#5d5a63', 140, 1.4, 5, P_DEBRIS);
    this.particles.burst(rock.x, rock.y, 8, '#3a3644', 60, 1.6, rock.r * 0.35, P_SMOKE);
    this.particles.ring(rock.x, rock.y, rock.r * 2, ore.glow, 0.45, 3);
    this.game.shake(Math.min(10, rock.r / 8));
    this.game.sfx('rockBreak', rock.r);
    // leftover ore bonus burst
    const bonus = Math.max(1, Math.round(rock.r / 25));
    for (let k = 0; k < bonus; k++) this.spawnPickup(rock.x, rock.y, rock.ore, rand(60, 160));
    if (rock.r > ASTEROIDS.splitMinRadius) {
      const R = rng(rock.seed);
      for (let k = 0; k < 2; k++) {
        const a = R() * TAU;
        const nr = rock.r * R.range(0.45, 0.6);
        const child = this.spawnRock(R, [rock.x + Math.cos(a) * nr, rock.y + Math.sin(a) * nr], true, nr, rock.ore);
        child.vx = rock.vx + Math.cos(a) * 40; child.vy = rock.vy + Math.sin(a) * 40;
      }
    }
    this.game.onRockDestroyed && this.game.onRockDestroyed(rock);
  }

  // ------------------------------------------------------------ pickups
  spawnPickup(x, y, ore, speed = 90, dirx = null, diry = null) {
    let a = rand(0, TAU);
    if (dirx !== null) a = Math.atan2(diry, dirx) + rand(-0.7, 0.7);
    this.pickups.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, ore, amount: 1, life: ASTEROIDS.pickupLife, radius: 6, kind: 'pickup', spin: rand(0, TAU) });
  }

  spillOre(ship, taken) {
    for (const k in taken) for (let n = 0; n < Math.ceil(taken[k]); n++) this.spawnPickup(ship.x, ship.y, k, rand(80, 200));
  }

  attractPickups(ship, radius, dt) {
    const r2 = radius * radius;
    const grab = Math.max(18, ship.radius * 0.55);
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      if (p.stolen) continue;
      const dx = ship.x - p.x, dy = ship.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2 + grab * grab) continue;
      const d = Math.sqrt(d2) || 1;
      if (ship.cargoUnits >= ship.cargoMax - 0.001) {
        if (d < grab && this.time > this._fullMsgT) {
          this._fullMsgT = this.time + 2.5;
          this.floaters.add(ship.x, ship.y - ship.radius - 10, 'Cargo full — head home', '#ffcf5a', 15, -30, 1.6);
          this.game.sfx('denied');
        }
        continue;
      }
      if (d < grab) {
        const got = ship.addOre(p.ore, p.amount);
        if (got > 0) {
          this.pickups.splice(i, 1);
          const ore = ORES[p.ore];
          this.particles.spawn(P_GLOW, p.x, p.y, ship.vx, ship.vy, 0.25, 4, ore.glow);
          this.floaters.add(ship.x + rand(-10, 10), ship.y - ship.radius * 0.6, `+${got} ${ore.name}`, ore.glow, 13, -60, 0.9);
          this.game.onOreCollected && this.game.onOreCollected(p.ore, got);
          this.game.sfx('pickup', ore.value);
        }
        continue;
      }
      const pull = 900 * (1 - d / (radius + grab)) + 200;
      p.vx += (dx / d) * pull * dt; p.vy += (dy / d) * pull * dt;
      // align with ship velocity so it never orbits
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
    this.bullets.push(o);
    return o;
  }

  raycast(ox, oy, dx, dy, range) {
    let best = null;
    const cx = ox + dx * range * 0.5, cy = oy + dy * range * 0.5;
    this.hash.query(cx, cy, range * 0.5 + 10, (o) => {
      if (o.kind !== 'rock' && o.kind !== 'enemy') return;
      const t = rayCircle(ox, oy, dx, dy, o.x, o.y, o.kind === 'rock' ? o.r * 0.92 : o.radius);
      if (t >= 0 && t <= range && (!best || t < best.t)) best = { t, obj: o };
    });
    return best;
  }

  laserHit(hit, mineDmg, enemyDmg, x, y, ship) {
    const o = hit.obj;
    if (this.time > this._sparkT) {
      this._sparkT = this.time + 0.03;
      const col = o.kind === 'rock' ? ORES[o.ore].glow : '#ff9db0';
      this.particles.spawn(P_SPARK, x, y, rand(-160, 160), rand(-160, 160), rand(0.2, 0.45), 2, col, 2);
      this.particles.spawn(P_GLOW, x, y, 0, 0, 0.12, 6, col);
    }
    if (o.kind === 'rock') {
      o.hp -= mineDmg;
      o.hitT = 0.12;
      o.seenT = 2;
      o.oreAcc += oreFromDamage(mineDmg, this.sector.hardness, this.game.levels);
      while (o.oreAcc >= ASTEROIDS.chunkEvery) {
        o.oreAcc -= ASTEROIDS.chunkEvery;
        this.spawnPickup(x, y, o.ore, rand(50, 110), x - o.x, y - o.y);
        this.game.sfx('chunk');
      }
      if (o.hp <= 0) this.destroyRock(o, ship);
    } else if (o.kind === 'enemy') {
      this.damageEnemy(o, enemyDmg, x, y, true);
    }
  }

  // enemies hook (filled in by the enemy system when present)
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
  onTurretFire(x, y, a) {
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
    this.game.onPlayerHit && this.game.onPlayerHit(dmg);
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
    this.particles.burst(ship.x, ship.y, 14, '#3a3644', 80, 2.2, 22, P_SMOKE);
    this.particles.ring(ship.x, ship.y, 260, '#ffd27a', 0.8, 6);
    this.game.shake(30);
    this.game.sfx('bigBoom');
    this.spillOre(ship, ship.cargo);
    this.game.onShipDestroyed && this.game.onShipDestroyed();
  }

  crackerTarget(ship, part, range) { return this.game.planet ? this.game.planet.inRange(ship, range) : false; }
  fireCracker(ship, part) { if (this.game.planet) this.game.planet.crack(ship, part); }

  // -------------------------------------------------------------- update
  update(dt, ship) {
    this.time += dt;
    this.ship = ship;
    this.station.angle += dt * 0.1;
    // rocks
    for (const r of this.rocks) {
      r.x += r.vx * dt; r.y += r.vy * dt; r.angle += r.av * dt;
      r.vx *= 1 - 0.05 * dt; r.vy *= 1 - 0.05 * dt;
      if (r.hitT > 0) r.hitT -= dt;
      if (r.seenT > 0) r.seenT -= dt;
      const d = Math.hypot(r.x, r.y);
      if (d > this.sector.radius) { r.vx -= (r.x / d) * 20 * dt; r.vy -= (r.y / d) * 20 * dt; }
      if (d < ASTEROIDS.innerClear * 0.6) { r.vx += (r.x / d) * 30 * dt; r.vy += (r.y / d) * 30 * dt; }
    }
    // respawn
    this.respawnTimer -= dt;
    if (!this.arena && this.rocks.length < this.sector.asteroids && this.respawnTimer <= 0) {
      this.respawnTimer = ASTEROIDS.respawnDelay;
      this.spawnRock(undefined, null, Math.random() < 0.75);
    }
    // pickups
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 - 1.2 * dt; p.vy *= 1 - 1.2 * dt;
      p.spin += dt * 3;
      p.life -= dt;
      if (p.life <= 0 || p.stolen) this.pickups.splice(i, 1);
    }
    // spatial hash
    this.hash.clear();
    for (const r of this.rocks) this.hash.insert(r);
    for (const e of this.enemies) if (!e.dead) this.hash.insert(e);
    // rock vs rock (cheap, keeps fields from overlapping)
    for (const a of this.rocks) {
      this.hash.query(a.x, a.y, a.r, (b) => {
        if (b === a || b.kind !== 'rock' || b.seed < a.seed) return;
        const dx = b.x - a.x, dy = b.y - a.y, rr = (a.r + b.r) * 0.85;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 === 0) return;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, pen = rr - d;
        const tm = a.mass + b.mass;
        a.x -= nx * pen * (b.mass / tm); a.y -= ny * pen * (b.mass / tm);
        b.x += nx * pen * (a.mass / tm); b.y += ny * pen * (a.mass / tm);
        const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vn < 0) {
          const j = (-(1.5) * vn) / (1 / a.mass + 1 / b.mass);
          a.vx -= (j * nx) / a.mass; a.vy -= (j * ny) / a.mass;
          b.vx += (j * nx) / b.mass; b.vy += (j * ny) / b.mass;
        }
      });
    }
    if (ship && !ship.dead) {
      this.collideShip(ship);
      // sector boundary
      const d = Math.hypot(ship.x, ship.y);
      if (d > this.sector.radius) {
        ship.vx -= (ship.x / d) * PHYS.boundaryPush * dt;
        ship.vy -= (ship.y / d) * PHYS.boundaryPush * dt;
      }
    }
    this.updateBullets(dt, ship);
    this.particles.update(dt);
    this.floaters.update(dt);
  }

  collideShip(ship) {
    const cells = [];
    const c = Math.cos(ship.angle), s = Math.sin(ship.angle);
    const getCells = () => {
      if (cells.length) return cells;
      for (const [k, i] of ship.cellMap) {
        const [gx, gy] = k.split(',').map(Number);
        const lx = (gx - ship.comX) * C, ly = (gy - ship.comY) * C;
        cells.push({ x: ship.x + lx * c - ly * s, y: ship.y + lx * s + ly * c, i });
      }
      return cells;
    };
    this.hash.query(ship.x, ship.y, ship.radius, (rock) => {
      if (rock.kind !== 'rock') return;
      if (Math.hypot(rock.x - ship.x, rock.y - ship.y) > ship.radius + rock.r) return;
      let best = null, bestPen = 0;
      const rr = rock.r * 0.9 + C * 0.5;
      for (const cell of getCells()) {
        const dx = cell.x - rock.x, dy = cell.y - rock.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2) || 0.01;
          const pen = rr - d;
          if (pen > bestPen) { bestPen = pen; best = { cell, nx: dx / d, ny: dy / d }; }
        }
      }
      if (!best) return;
      const { cell, nx, ny } = best;
      const tm = ship.mass + rock.mass;
      ship.x += nx * bestPen * (rock.mass / tm); ship.y += ny * bestPen * (rock.mass / tm);
      rock.x -= nx * bestPen * (ship.mass / tm); rock.y -= ny * bestPen * (ship.mass / tm);
      const [pvx, pvy] = ship.pointVel(cell.x, cell.y);
      const vn = (pvx - rock.vx) * nx + (pvy - rock.vy) * ny;
      if (vn >= 0) return;
      const rx = cell.x - ship.x, ry = cell.y - ship.y;
      const rn = rx * ny - ry * nx;
      const j = (-(1 + PHYS.restitution) * vn) / (1 / ship.mass + (rn * rn) / ship.inertia + 1 / rock.mass);
      ship.applyImpulse(nx * j, ny * j, cell.x, cell.y);
      rock.vx -= (nx * j) / rock.mass; rock.vy -= (ny * j) / rock.mass;
      const impact = -vn;
      this.particles.burst(cell.x - nx * C * 0.5, cell.y - ny * C * 0.5, Math.min(14, 2 + impact / 20), '#d9d2c5', impact * 0.8, 0.35, 2, P_SPARK);
      if (impact > PHYS.collisionDamageSpeed) {
        const dmg = (impact - PHYS.collisionDamageSpeed) * PHYS.collisionDamageScale * Math.min(2, rock.mass / ship.mass + 0.3);
        ship.damagePart(cell.i, dmg, this);
        rock.hp -= dmg * 0.6;
        this.game.shake(Math.min(14, impact / 25));
        this.game.sfx('bump', impact);
        if (rock.hp <= 0) this.destroyRock(rock, ship);
      } else if (impact > 25) this.game.sfx('bump', impact * 0.5);
    });
  }

  updateBullets(dt, ship) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      let dead = b.life <= 0;
      if (!dead) {
        // vs rocks/enemies
        this.hash.query(b.x, b.y, b.radius + 2, (o) => {
          if (b.hit.has(o)) return;
          if (o.kind === 'rock') {
            if ((o.x - b.x) ** 2 + (o.y - b.y) ** 2 > (o.r * 0.9) ** 2) return;
            this.particles.burst(b.x, b.y, 3, '#d9d2c5', 120, 0.25, 1.5, P_SPARK);
            if (b.owner === 'player') { o.hp -= b.damage * 0.25; o.hitT = 0.1; if (o.hp <= 0) this.destroyRock(o, ship); }
            dead = true; return false;
          }
          if (o.kind === 'enemy' && b.owner === 'player') {
            if ((o.x - b.x) ** 2 + (o.y - b.y) ** 2 > (o.radius + b.radius) ** 2) return;
            b.hit.add(o);
            this.damageEnemy(o, b.damage, b.x, b.y);
            if (--b.pierce <= 0) { dead = true; return false; }
          }
        });
        if (!dead && b.owner !== 'player' && ship && !ship.dead) {
          const dx = b.x - ship.x, dy = b.y - ship.y;
          const shR = ship.shield > 0 ? ship.radius + 6 : ship.radius;
          if (dx * dx + dy * dy < shR * shR) {
            if (ship.shield > 0) { ship.damageAt(b.x, b.y, b.damage, this); dead = true; }
            else if (ship.partAtWorld(b.x, b.y) >= 0) { ship.damageAt(b.x, b.y, b.damage, this); dead = true; }
          }
        }
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
    const v = cam.view(120);
    if (this.arena) this.drawPost(ctx, time);
    else this.drawStation(ctx, time);
    // sector edge
    if (!this.arena) {
    ctx.strokeStyle = 'rgba(255,80,120,0.25)';
    ctx.setLineDash([30, 30]);
    ctx.lineWidth = 3 / cam.zoom;
    ctx.beginPath(); ctx.arc(0, 0, this.sector.radius, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    }
    // rocks
    for (const r of this.rocks) {
      if (r.x + r.r < v.x0 || r.x - r.r > v.x1 || r.y + r.r < v.y0 || r.y - r.r > v.y1) continue;
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.angle);
      const S = r.sprite.width;
      ctx.drawImage(r.sprite, -S / 2, -S / 2);
      if (r.hitT > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = r.hitT * 3;
        ctx.drawImage(r.sprite, -S / 2, -S / 2);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      if (r.seenT > 0) {
        const k = Math.max(0, r.hp / r.maxHp);
        ctx.globalAlpha = Math.min(1, r.seenT);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath(); ctx.arc(r.x, r.y, r.r + 8, 0, TAU); ctx.stroke();
        ctx.strokeStyle = ORES[r.ore].glow;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.r + 8, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    // pickups
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.pickups) {
      if (p.x < v.x0 || p.x > v.x1 || p.y < v.y0 || p.y > v.y1) continue;
      const ore = ORES[p.ore];
      const blink = p.life < 6 ? (Math.sin(p.life * 12) > 0 ? 1 : 0.3) : 1;
      ctx.globalAlpha = blink;
      ctx.fillStyle = hexA(ore.glow, 0.25);
      ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, TAU); ctx.fill();
      ctx.fillStyle = ore.color;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.spin);
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(4, 0); ctx.lineTo(0, 5); ctx.lineTo(-4, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
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
      ctx.strokeStyle = 'rgba(46,230,166,0.25)'; ctx.lineWidth = 9 * w;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + dx * L, oy + dy * L); ctx.stroke();
      ctx.strokeStyle = 'rgba(180,255,230,0.9)'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + dx * L, oy + dy * L); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // faint ring showing the ore magnet's reach whenever ore is inside it
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

  drawShield(ctx, ship, time) {
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

  // the fighter's anchor: a glowing pad and range rings
  drawPost(ctx, time) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,77,109,0.10)'; ctx.lineWidth = 2;
    for (const r of [480, 900]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke(); }
    ctx.rotate(time * 0.15);
    ctx.strokeStyle = 'rgba(255,77,109,0.35)'; ctx.setLineDash([14, 18]); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 150, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
  }

  drawStation(ctx, time) {
    const st = this.station;
    ctx.save();
    ctx.translate(st.x, st.y);
    // safe zone
    ctx.strokeStyle = 'rgba(125,249,255,0.08)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, ECONOMY.stationSafeRadius, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(125,249,255,0.18)'; ctx.setLineDash([8, 10]);
    ctx.beginPath(); ctx.arc(0, 0, ECONOMY.dockRadius, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.rotate(st.angle);
    ctx.shadowColor = '#7df9ff'; ctx.shadowBlur = 18;
    ctx.strokeStyle = '#7df9ff'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(0, 0, st.r, 0, TAU); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#121a30';
    for (let i = 0; i < 6; i++) {
      ctx.save(); ctx.rotate((i * TAU) / 6);
      ctx.fillRect(-7, -st.r, 14, st.r - 30);
      ctx.fillStyle = '#1d2a48'; ctx.fillRect(-20, -st.r - 14, 40, 22);
      ctx.fillStyle = (Math.floor(time * 2 + i) % 3 === 0) ? '#ffd60a' : '#2ee6a6';
      ctx.fillRect(-4, -st.r - 8, 8, 8);
      ctx.fillStyle = '#121a30';
      ctx.restore();
    }
    ctx.rotate(-st.angle * 2.5);
    ctx.fillStyle = '#18213a'; ctx.strokeStyle = '#ffd60a'; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) { const a = (k * TAU) / 8; ctx.lineTo(Math.cos(a) * 42, Math.sin(a) * 42); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, 26);
    grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.4, '#7df9ff'); grd.addColorStop(1, 'rgba(125,249,255,0)');
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.fill();
    ctx.restore();
  }
}
