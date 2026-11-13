// The planet's defense swarm: endless enemy ships that escalate the longer a
// shift lasts, plus capital-ship elites on a schedule. They hunt your fighter.
import { ENEMIES, BOSSES, PHYS, SWARM, FLAVOR } from './data.js';
import { TAU, rand, clamp, angleDiff, pick, segDist2, hexA, money } from './util.js';
import { P_GLOW, P_SPARK, P_SMOKE, P_DEBRIS } from './particles.js';

const C = PHYS.CELL;
const MISSILE = { name: 'Missile', ai: 'missile', hp: 8, radius: 6, color: '#ff8fab', bounty: 0 };

// ------------------------------------------------------------- ship art
// Real hull silhouettes (pointing up), metal plating, panel lines, cockpit glass,
// coloured faction stripes. Rendered once per type and cached.
const HULLS = {
  interceptor: [[0, -1.1], [0.15, -0.5], [0.85, 0.55], [0.8, 0.75], [0.25, 0.55], [0.2, 0.9], [-0.2, 0.9], [-0.25, 0.55], [-0.8, 0.75], [-0.85, 0.55], [-0.15, -0.5]],
  raider: [[0, -1.25], [0.3, -0.6], [0.35, 0.2], [0.7, -0.1], [0.75, 0.5], [0.35, 0.95], [-0.35, 0.95], [-0.75, 0.5], [-0.7, -0.1], [-0.35, 0.2], [-0.3, -0.6]],
  gunship: [[-0.45, -0.9], [0.45, -0.9], [0.6, -0.2], [1, 0.1], [1, 0.6], [0.5, 0.9], [-0.5, 0.9], [-1, 0.6], [-1, 0.1], [-0.6, -0.2]],
  minelayer: [[-0.5, -1], [0.5, -1], [0.7, -0.4], [0.7, 0.8], [0.4, 1], [-0.4, 1], [-0.7, 0.8], [-0.7, -0.4]],
  frigate: [[0, -1.2], [0.3, -0.8], [0.35, 0.3], [0.85, 0.5], [0.85, 0.8], [0.3, 0.75], [0.25, 1], [-0.25, 1], [-0.3, 0.75], [-0.85, 0.8], [-0.85, 0.5], [-0.35, 0.3], [-0.3, -0.8]],
  missile: [[0, -1.3], [0.35, 0.6], [0.6, 1], [-0.6, 1], [-0.35, 0.6]],
  capital: [[0, -1.12], [0.22, -0.88], [0.3, -0.35], [0.5, -0.15], [0.55, 0.55], [0.38, 1], [-0.38, 1], [-0.55, 0.55], [-0.5, -0.15], [-0.3, -0.35], [-0.22, -0.88]],
};
const spriteCache = new Map();
function enemySprite(type, def, boss) {
  if (spriteCache.has(type)) return spriteCache.get(type);
  const R = def.radius;
  const S = Math.ceil(R * 2.8);
  const cv = document.createElement('canvas');
  cv.width = cv.height = S * 2;
  const g = cv.getContext('2d');
  g.scale(2, 2);
  g.translate(S / 2, S / 2);
  const pts = HULLS[boss ? 'capital' : type] || HULLS.interceptor;
  const path = () => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x * R, y * R) : g.moveTo(x * R, y * R))); g.closePath(); };
  const col = def.color;
  // plating
  const metal = g.createLinearGradient(-R, -R, R, R);
  metal.addColorStop(0, '#7b8496'); metal.addColorStop(0.45, '#4a5163'); metal.addColorStop(1, '#1e222c');
  path(); g.fillStyle = metal; g.fill();
  g.save(); path(); g.clip();
  // panel lines
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = Math.max(0.6, R / 18);
  for (let y = -R; y < R; y += R / 3.2) { g.beginPath(); g.moveTo(-R, y); g.lineTo(R, y); g.stroke(); }
  g.beginPath(); g.moveTo(0, -R); g.lineTo(0, R); g.stroke();
  // faction stripes
  g.fillStyle = hexA(col, 0.85);
  g.fillRect(-R, R * 0.28, R * 2, R * 0.1);
  g.fillRect(-R * 0.08, -R * 0.9, R * 0.16, R * 0.5);
  // top light / underside shade
  const shade = g.createLinearGradient(0, -R, 0, R);
  shade.addColorStop(0, 'rgba(255,255,255,0.12)'); shade.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = shade; g.fillRect(-R, -R, R * 2, R * 2);
  g.restore();
  path(); g.strokeStyle = '#11141b'; g.lineWidth = Math.max(1, R / 12); g.stroke();
  g.strokeStyle = hexA(col, 0.5); g.lineWidth = 0.8; g.stroke();
  // cockpit glass
  if (type !== 'missile') {
    const cy = boss ? -R * 0.55 : -R * 0.35;
    const gl = g.createLinearGradient(0, cy - R * 0.15, 0, cy + R * 0.15);
    gl.addColorStop(0, '#d6f6ff'); gl.addColorStop(1, '#2a6c8a');
    g.fillStyle = gl; g.beginPath(); g.ellipse(0, cy, R * (boss ? 0.09 : 0.13), R * (boss ? 0.14 : 0.2), 0, 0, TAU); g.fill();
  }
  // weapons & details
  g.fillStyle = '#20242f';
  if (type === 'gunship') { g.fillRect(-R * 0.82, -R * 0.75, R * 0.14, R * 0.7); g.fillRect(R * 0.68, -R * 0.75, R * 0.14, R * 0.7); }
  if (type === 'frigate') for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) { g.fillStyle = '#ff8fab'; g.fillRect(sx * R * 0.62 - R * 0.06, R * 0.5 + k * R * 0.09, R * 0.12, R * 0.05); }
  if (type === 'minelayer') { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(-R * 0.35, R * 0.55, R * 0.7, R * 0.35); }
  if (boss) {
    g.fillStyle = '#2c3242'; g.fillRect(-R * 0.16, -R * 0.2, R * 0.32, R * 0.45); // bridge tower
    g.fillStyle = '#9fe8ff'; for (let k = 0; k < 3; k++) g.fillRect(-R * 0.1 + k * R * 0.07, -R * 0.12, R * 0.04, R * 0.03);
    g.fillStyle = '#1a1e28'; for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(0, -R * 0.75 + k * R * 0.32, R * 0.07, 0, TAU); g.fill(); }
  }
  const out = { cv, size: S };
  spriteCache.set(type, out);
  return out;
}

export class EnemySystem {
  constructor(game) {
    this.game = game;
    this.banner = null;
    this.boss = null;
    this.beams = [];
    this.mines = [];
    this.reset();
  }

  get world() { return this.game.world; }
  get save() { return this.game.save; }
  target() { const s = this.game.escort && this.game.escort.ship; return s && !s.dead ? s : null; }

  // a shift starts when you launch and ends when you dock or the fighter falls
  reset() {
    if (this.game.world) this.game.world.enemies.length = 0;
    this.mines = []; this.beams = [];
    this.boss = null;
    this.shiftT = 0; this.pool = 0; this.spawnT = 2; this.eliteN = 0; this.nextElite = SWARM.eliteFirst;
    this.banner = null;
  }

  // planet number and how deep you've dug make everything tougher
  mult() {
    const pl = this.game.world ? this.game.world.planet : null;
    const depth = pl ? pl.percent / 100 : 0;
    return Math.pow(SWARM.planetScale, this.save.planet.index) * (1 + (SWARM.depthScale - 1) * depth);
  }
  scale() { return this.mult() * (1 + SWARM.scaleGrowth * this.shiftT / 60); }
  ratePerMin() { return (SWARM.baseRate + SWARM.growth * this.shiftT / 60) * this.mult() * (this.game.survival ? 3 : 1); }
  // how the swarm reads to the player
  threatLabel() {
    const m = this.shiftT / 60;
    return m < 2 ? 'Light' : m < 4 ? 'Moderate' : m < 7 ? 'Heavy' : m < 10 ? 'Severe' : 'Overwhelming';
  }

  // ----------------------------------------------------------- spawning
  makeEnemy(type, x, y, scale = this.scale()) {
    const def = type === 'missile' ? MISSILE : ENEMIES[type];
    const e = {
      kind: 'enemy', type, def, x, y, vx: 0, vy: 0, angle: rand(0, TAU), hp: def.hp * scale, maxHp: def.hp * scale,
      radius: def.radius, cool: rand(0.5, 2), t: rand(0, 10), state: 'hunt', stateT: 0, dead: false, flash: 0,
      dmgScale: 1 + (scale - 1) * 0.6, bounty: Math.round((def.bounty || 0) * (1 + (scale - 1) * 0.8)), burst: 0, mineT: rand(0, 2), stolen: 0,
    };
    this.world.enemies.push(e);
    return e;
  }

  spawnGroup() {
    const tgt = this.target();
    if (!tgt) return;
    const min = this.shiftT / 60;
    const types = Object.keys(ENEMIES).filter((t) => ENEMIES[t].unlockMin <= min);
    const alive = this.world.enemies.filter((e) => !e.dead).length;
    const counts = {};
    let n = 0;
    for (let guard = 0; guard < 30 && alive + n < SWARM.maxAlive; guard++) {
      const ok = types.filter((t) => ENEMIES[t].cost <= this.pool);
      if (!ok.length) break;
      const t = pick(ok);
      counts[t] = (counts[t] || 0) + 1; n++;
      this.pool -= ENEMIES[t].cost;
    }
    if (!n) return;
    // they come in from space, not through the planet
    const d0 = Math.hypot(tgt.x, tgt.y) || 1;
    const a = Math.atan2(tgt.y / d0, tgt.x / d0) + rand(-1.3, 1.3);
    const dist = rand(...SWARM.spawnDist);
    const gx = tgt.x + Math.cos(a) * dist, gy = tgt.y + Math.sin(a) * dist;
    for (const t in counts) for (let i = 0; i < counts[t]; i++) {
      const e = this.makeEnemy(t, gx + rand(-160, 160), gy + rand(-160, 160));
      e.vx = -Math.cos(a) * 140; e.vy = -Math.sin(a) * 140;
    }
  }

  spawnBoss(id) {
    const tgt = this.target();
    if (!tgt) return;
    const def = BOSSES[id];
    const sc = this.mult() * (1 + SWARM.eliteScaleGrowth * Math.floor(this.eliteN / SWARM.eliteOrder.length));
    const d0 = Math.hypot(tgt.x, tgt.y) || 1;
    const a = Math.atan2(tgt.y / d0, tgt.x / d0) + rand(-0.8, 0.8);
    const b = {
      kind: 'enemy', type: id, def, boss: true, x: tgt.x + Math.cos(a) * 1300, y: tgt.y + Math.sin(a) * 1300, vx: 0, vy: 0, angle: 0,
      hp: def.hp * sc, maxHp: def.hp * sc, radius: def.radius, t: 0, dead: false, flash: 0, dmgScale: 1 + (sc - 1) * 0.6, bounty: Math.round(def.bounty * sc),
      timers: [], phase: -1, charge: 0, state: 'hunt',
    };
    this.world.enemies.push(b);
    this.boss = b;
    this.eliteN++;
    this.banner = { title: 'CAPITAL SHIP', text: `${def.name} — ${def.title}`, t: 4.5, col: '#ff3cac', boss: true };
    this.game.sfx('bossWarn');
    this.game.shake(8);
  }

  // ------------------------------------------------------------- damage
  damage(e, dmg, x, y, quiet = false) {
    if (e.dead) return;
    e.hp -= dmg;
    e.flash = 1;
    if (!quiet || Math.random() < 0.15) this.world.floaters.add(x, y - 6, String(Math.max(1, Math.round(dmg))), e.boss ? '#ffb3e6' : '#fff2b3', e.boss ? 15 : 13, -55, 0.7);
    if (!quiet) { this.world.particles.burst(x, y, 3, e.def.color, 160, 0.3, 2, P_SPARK); this.game.sfx('hit'); }
    if (e.hp <= 0) this.kill(e);
  }

  kill(e) {
    e.dead = true;
    const w = this.world;
    const big = e.boss ? 4 : e.radius / 14;
    w.particles.burst(e.x, e.y, Math.floor(18 * big), '#ffd27a', 320 * Math.sqrt(big), 0.7, 2.5, P_SPARK, e.vx * 0.3, e.vy * 0.3);
    w.particles.burst(e.x, e.y, Math.floor(10 * big), '#6b7385', 200, 1.6, 5, P_DEBRIS, e.vx * 0.3, e.vy * 0.3);
    w.particles.burst(e.x, e.y, Math.floor(4 * big), '#3a3048', 50, 1.4, e.radius * 0.8, P_SMOKE);
    w.particles.spawn(P_GLOW, e.x, e.y, 0, 0, 0.35, e.radius * 3, '#fff1d0');
    w.particles.ring(e.x, e.y, e.radius * 4, e.def.color, 0.45, 3);
    if (e.type === 'missile') { this.game.sfx('pop'); return; }
    this.game.shake(e.boss ? 30 : Math.min(6, 1 + e.radius / 8));
    this.game.sfx(e.boss ? 'bigBoom' : 'explode', e.radius);
    if (this.game.survival) this.game.survival.kills++;
    if (e.bounty && !this.game.survival) {
      this.save.credits += e.bounty;
      this.save.stats.earned += e.bounty;
      w.floaters.add(e.x, e.y - e.radius, '+' + money(e.bounty), '#ffd60a', e.boss ? 26 : 13, -45, 1.2);
    }
    this.save.stats.kills++;
    if (e.boss) {
      this.boss = null;
      this.save.stats.elites++;
      for (const o of w.enemies) if (!o.dead && o.type !== 'missile' && Math.random() < 0.5) { o.state = 'flee'; o.stateT = 0; }
      this.beams.length = 0;
      this.game.slowmo = 1;
      this.banner = { title: `${e.def.name.toUpperCase()} DESTROYED`, text: `${pick(FLAVOR.bossKills)}  +${money(e.bounty)}`, t: 4, col: '#ffd60a' };
      this.game.sfx('victory');
    }
  }

  // ------------------------------------------------------------- update
  update(dt) {
    const g = this.game, ship = this.target(), w = this.world;
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
    if (!ship || g.state === 'title' || g.state === 'hangar') return;
    this.shiftT += dt;
    const calm = this.save.dev && this.save.dev.peaceful;
    if (!calm) this.pool += (this.ratePerMin() / 60) * dt;
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnT = SWARM.spawnEvery; this.spawnGroup(); }
    if (!calm && !this.boss && this.shiftT >= this.nextElite) { this.nextElite += SWARM.eliteEvery; this.spawnBoss(SWARM.eliteOrder[this.eliteN % SWARM.eliteOrder.length]); }
    for (const e of w.enemies) {
      if (e.dead) continue;
      e.t += dt;
      if (e.flash > 0) e.flash -= dt * 5;
      if (e.boss) this.bossAI(e, dt, ship);
      else this.ai(e, dt, ship);
      e.x += e.vx * dt; e.y += e.vy * dt;
      this.contact(e, ship, dt);
      if (Math.hypot(e.x - ship.x, e.y - ship.y) > 3600 && !e.boss) e.dead = true;
    }
    for (let i = w.enemies.length - 1; i >= 0; i--) if (w.enemies[i].dead) w.enemies.splice(i, 1);
    // mines
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.life -= dt; m.arm -= dt;
      const d = Math.hypot(m.x - ship.x, m.y - ship.y);
      if (m.arm <= 0 && !ship.dead && d < m.radius * 0.6 + ship.radius * 0.5) m.life = 0, this.blast(m.x, m.y, m.radius, m.damage);
      if (m.life <= 0) this.mines.splice(i, 1);
    }
    // beams
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t += dt;
      if (b.owner.dead) { this.beams.splice(i, 1); continue; }
      const k = b.t < b.warn ? 0 : (b.t - b.warn) / b.duration;
      b.angle = b.a0 + b.sweep * (k - 0.5) * 2 * b.dir;
      if (b.t >= b.warn + b.duration) { this.beams.splice(i, 1); continue; }
      if (b.t > b.warn && !ship.dead) {
        const x0 = b.owner.x, y0 = b.owner.y, x1 = x0 + Math.cos(b.angle) * b.length, y1 = y0 + Math.sin(b.angle) * b.length;
        if (segDist2(ship.x, ship.y, x0, y0, x1, y1) < (ship.radius + 10) ** 2) {
          b.tick = (b.tick || 0) - dt;
          if (b.tick <= 0) {
            b.tick = 0.1;
            let best = null, bd = 1e9;
            for (const p of ship.parts) {
              if (!p.alive) continue;
              const [px, py] = ship.toWorld(p.lx, p.ly);
              const d2 = segDist2(px, py, x0, y0, x1, y1);
              if (d2 < bd) { bd = d2; best = [px, py]; }
            }
            if (best && bd < (C * 1.2) ** 2) ship.damageAt(best[0], best[1], b.damage * 0.1 * (b.owner.dmgScale || 1), w);
          }
        }
      }
    }
  }

  steer(e, tx, ty, speed, dt) {
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy) || 1;
    const vx = (dx / d) * speed, vy = (dy / d) * speed;
    this.accel(e, vx, vy, dt);
  }
  accel(e, vx, vy, dt) {
    const ax = vx - e.vx, ay = vy - e.vy, a = Math.hypot(ax, ay) || 1;
    const lim = (e.def.accel || 300) * dt;
    const k = Math.min(1, lim / a);
    e.vx += ax * k; e.vy += ay * k;
  }
  face(e, ang, dt) { e.angle += clamp(angleDiff(e.angle, ang), -(e.def.turn || 3) * dt, (e.def.turn || 3) * dt); }
  aimAngle(e, ship) { return Math.atan2(ship.y - e.y, ship.x - e.x); }

  shoot(e, ship, spec, spreadArc = 0, count = 1) {
    const base = this.aimAngle(e, ship);
    // lead a little
    const t = Math.hypot(ship.x - e.x, ship.y - e.y) / spec.speed;
    const lead = Math.atan2(ship.y + ship.vy * t * 0.6 - e.y, ship.x + ship.vx * t * 0.6 - e.x);
    const a0 = Math.abs(angleDiff(base, lead)) < 0.6 ? lead : base;
    for (let i = 0; i < count; i++) {
      const a = a0 + (count > 1 ? (i / (count - 1) - 0.5) * spreadArc : rand(-0.05, 0.05));
      this.world.spawnBullet({ x: e.x + Math.cos(a) * e.radius, y: e.y + Math.sin(a) * e.radius, vx: Math.cos(a) * spec.speed + e.vx * 0.3, vy: Math.sin(a) * spec.speed + e.vy * 0.3,
        damage: spec.damage * (e.dmgScale || 1), owner: 'enemy', life: (spec.range || 900) / spec.speed + 0.3, color: e.def.color, radius: 3.5, target: ship });
    }
    this.game.sfx('enemyShoot');
  }

  ai(e, dt, ship) {
    const d = e.def;
    const dx = ship.x - e.x, dy = ship.y - e.y, dist = Math.hypot(dx, dy) || 1;
    const toShip = Math.atan2(dy, dx);
    if (ship.dead || e.state === 'flee') {
      this.steer(e, e.x - dx, e.y - dy, d.speed || 300, dt);
      this.face(e, Math.atan2(e.vy, e.vx), dt);
      e.stateT = (e.stateT || 0) + dt;
      if (e.stateT > 6) e.dead = true;
      return;
    }
    switch (d.ai) {
      case 'orbit': {
        const dir = e.t % 10 < 5 ? 1 : -1;
        const tang = toShip + Math.PI / 2 * dir;
        const radial = (dist - d.orbit) / 100;
        const vx = Math.cos(tang) * d.speed + Math.cos(toShip) * radial * d.speed, vy = Math.sin(tang) * d.speed + Math.sin(toShip) * radial * d.speed;
        this.accel(e, vx, vy, dt);
        this.face(e, toShip, dt);
        e.cool -= dt;
        if (e.cool <= 0 && dist < d.weapon.range) { e.cool = 1 / d.weapon.rate * rand(0.8, 1.2); this.shoot(e, ship, d.weapon); }
        break;
      }
      case 'ram': {
        e.stateT -= dt;
        if (e.state === 'retreat') {
          this.steer(e, e.x - dx, e.y - dy, d.speed * 0.6, dt);
          if (e.stateT <= 0) e.state = 'hunt';
        } else if (e.state === 'windup') {
          this.accel(e, 0, 0, dt);
          this.face(e, toShip, dt * 2);
          if (e.stateT <= 0) { e.state = 'charge'; e.stateT = 1.6; }
        } else if (e.state === 'charge') {
          const t = dist / (d.speed * 1.4);
          this.steer(e, ship.x + ship.vx * t, ship.y + ship.vy * t, d.speed * 1.4, dt);
          this.face(e, Math.atan2(e.vy, e.vx), dt * 2);
          if (e.stateT <= 0) { e.state = 'retreat'; e.stateT = 1; }
        } else {
          if (dist > 380) this.steer(e, ship.x, ship.y, d.speed * 0.7, dt);
          else { e.state = 'windup'; e.stateT = 0.6; }
          this.face(e, toShip, dt);
        }
        break;
      }
      case 'standoff':
      case 'missiles': {
        const want = d.standoff;
        const radial = clamp((dist - want) / 150, -1, 1);
        const tang = toShip + Math.PI / 2;
        this.accel(e, Math.cos(toShip) * radial * d.speed + Math.cos(tang) * d.speed * 0.35, Math.sin(toShip) * radial * d.speed + Math.sin(tang) * d.speed * 0.35, dt);
        this.face(e, toShip, dt);
        e.cool -= dt;
        if (d.ai === 'standoff') {
          if (e.burst > 0) { e.burstT -= dt; if (e.burstT <= 0) { e.burst--; e.burstT = d.weapon.burstGap; this.shoot(e, ship, d.weapon); } }
          else if (e.cool <= 0 && dist < d.weapon.range) { e.cool = 1 / d.weapon.rate; e.burst = d.weapon.burst; e.burstT = 0; }
        } else if (e.cool <= 0 && dist < 900) {
          e.cool = d.missile.every;
          this.launchMissile(e, toShip + rand(-0.5, 0.5), d.missile);
        }
        break;
      }
      case 'leech': {
        let target = null, td = 900 * 900;
        if (e.stolen < 12) for (const p of this.world.pickups) { const dd = (p.x - e.x) ** 2 + (p.y - e.y) ** 2; if (dd < td) { td = dd; target = p; } }
        if (e.hp < e.maxHp * 0.4 || e.stolen >= 12) { e.state = 'flee'; e.stateT = 0; break; }
        if (target) {
          this.steer(e, target.x, target.y, d.speed, dt);
          if (td < (e.radius + 8) ** 2) { target.stolen = true; e.stolen++; this.world.floaters.add(e.x, e.y - 14, 'nom', '#7bd389', 12, -30, 0.6); }
        } else {
          this.steer(e, ship.x, ship.y, d.speed, dt);
          if (dist < ship.radius + e.radius + 20 && ship.cargoUnits > 0) {
            e.suck = (e.suck || 0) + dt;
            if (e.suck > 0.5) {
              e.suck = 0;
              const taken = ship.removeOre(d.steal);
              let n = 0; for (const k in taken) n += taken[k];
              if (n > 0) { e.stolen += n; this.world.floaters.add(ship.x, ship.y - ship.radius, `-${Math.round(n)} ore (Leech!)`, '#7bd389', 14, -40, 1); this.game.sfx('steal'); }
            }
          }
        }
        this.face(e, Math.atan2(e.vy, e.vx), dt);
        break;
      }
      case 'mines': {
        const ang = e.t * 0.4;
        this.steer(e, ship.x + Math.cos(ang) * 320, ship.y + Math.sin(ang) * 320, d.speed, dt);
        this.face(e, Math.atan2(e.vy, e.vx), dt);
        e.mineT -= dt;
        if (e.mineT <= 0 && this.mines.length < 30) {
          e.mineT = d.mine.every;
          this.mines.push({ x: e.x, y: e.y, radius: d.mine.radius, damage: d.mine.damage * e.dmgScale, life: d.mine.life, arm: 1, t: rand(0, 6) });
        }
        break;
      }
      case 'missile': {
        const want = toShip;
        const cur = Math.atan2(e.vy, e.vx);
        const na = cur + clamp(angleDiff(cur, want), -e.turn * dt, e.turn * dt);
        e.vx = Math.cos(na) * e.speed; e.vy = Math.sin(na) * e.speed;
        e.angle = na;
        e.life -= dt;
        if (Math.random() < 0.5) this.world.particles.spawn(P_GLOW, e.x - e.vx * 0.02, e.y - e.vy * 0.02, 0, 0, 0.3, 3, '#ff8fab');
        if (e.life <= 0) this.kill(e);
        break;
      }
    }
  }

  launchMissile(e, a, spec) {
    const m = this.makeEnemy('missile', e.x + Math.cos(a) * e.radius, e.y + Math.sin(a) * e.radius, 1);
    m.speed = spec.speed; m.turn = spec.turn; m.life = spec.life || 6; m.damage = spec.damage * (e.dmgScale || 1);
    m.vx = Math.cos(a) * spec.speed; m.vy = Math.sin(a) * spec.speed;
    this.game.sfx('missile');
  }

  contact(e, ship, dt) {
    const dx = e.x - ship.x, dy = e.y - ship.y;
    if (dx * dx + dy * dy > (ship.radius + e.radius) ** 2) return;
    // nearest live cell
    let best = null, bd = 1e9;
    for (const p of ship.parts) {
      if (!p.alive) continue;
      const [px, py] = ship.toWorld(p.lx, p.ly);
      const d2 = (px - e.x) ** 2 + (py - e.y) ** 2;
      if (d2 < bd) { bd = d2; best = [px, py]; }
    }
    if (!best) return;
    const rr = e.radius + C * 0.6;
    if (bd > rr * rr) return;
    const d = Math.sqrt(bd) || 1;
    const nx = (e.x - best[0]) / d, ny = (e.y - best[1]) / d;
    e.x += nx * (rr - d); e.y += ny * (rr - d);
    const [pvx, pvy] = ship.pointVel(best[0], best[1]);
    const vn = (e.vx - pvx) * nx + (e.vy - pvy) * ny;
    if (e.type === 'missile') { this.blast(e.x, e.y, 50, e.damage); this.kill(e); return; }
    if (vn < 0) {
      const em = e.boss ? 80 : (e.radius * e.radius) / 25;
      const j = -1.6 * vn / (1 / em + 1 / ship.mass);
      e.vx += (j * nx) / em; e.vy += (j * ny) / em;
      ship.applyImpulse((-j * nx), (-j * ny), best[0], best[1]);
      let dmg = 0;
      if (e.def.ram || (e.boss && e.state === 'charge')) dmg = (e.boss ? e.chargeDmg : e.def.ram * e.dmgScale) * Math.min(1.5, -vn / 250 + 0.4);
      else if (-vn > 120) dmg = (-vn - 120) * 0.05;
      if (dmg > 0) {
        ship.damageAt(best[0], best[1], dmg, this.world);
        this.game.shake(Math.min(14, dmg / 3));
        this.game.sfx('bump', -vn);
        if (e.def.ai === 'ram') { e.state = 'retreat'; e.stateT = 1.2; }
      }
      if (!e.boss) this.damage(e, Math.max(2, -vn * 0.04), e.x, e.y, true);
    }
  }

  blast(x, y, radius, damage) {
    const w = this.world, ship = this.game.ship;
    w.particles.burst(x, y, 24, '#ffb36b', 300, 0.6, 3, P_SPARK);
    w.particles.ring(x, y, radius * 1.4, '#ff8c42', 0.4, 4);
    w.particles.spawn(P_GLOW, x, y, 0, 0, 0.3, radius, '#ffd27a');
    this.game.shake(10);
    this.game.sfx('explode', 20);
    if (ship.dead) return;
    if (ship.shield > 0) { ship.damageAt(x, y, damage, w); return; }
    for (let i = 0; i < ship.parts.length; i++) {
      const p = ship.parts[i];
      if (!p.alive) continue;
      const [px, py] = ship.toWorld(p.lx, p.ly);
      const d = Math.hypot(px - x, py - y);
      if (d < radius) ship.damagePart(i, damage * (1 - d / radius) * 0.6, w);
      if (ship.dead) return;
    }
    const d = Math.hypot(ship.x - x, ship.y - y) || 1;
    ship.applyImpulse(((ship.x - x) / d) * damage * 30, ((ship.y - y) / d) * damage * 30, x, y);
  }

  // ---------------------------------------------------------------- boss
  bossAI(b, dt, ship) {
    const def = b.def;
    const frac = b.hp / b.maxHp;
    const phase = def.phases.findIndex((p) => frac > p.until);
    const ph = phase < 0 ? def.phases.length - 1 : phase;
    if (ph !== b.phase) {
      b.phase = ph;
      b.timers = def.phases[ph].attacks.map((a, i) => 1.5 + i * 0.8);
      if (ph > 0) { this.banner = { title: 'PHASE ' + (ph + 1), text: `${def.name} is getting serious.`, t: 2.5, col: '#ff3cac' }; this.game.sfx('bossWarn'); this.world.particles.ring(b.x, b.y, b.radius * 4, def.color, 0.6, 5); }
    }
    const dx = ship.x - b.x, dy = ship.y - b.y, dist = Math.hypot(dx, dy) || 1, toShip = Math.atan2(dy, dx);
    if (b.state === 'charge') {
      b.stateT -= dt;
      this.accel(b, Math.cos(b.chargeA) * b.chargeSpeed, Math.sin(b.chargeA) * b.chargeSpeed, dt * 8);
      if (Math.random() < 0.6) this.world.particles.spawn(P_GLOW, b.x, b.y, 0, 0, 0.4, b.radius, def.color);
      if (b.stateT <= 0) b.state = 'hunt';
    } else if (b.state === 'windup') {
      b.stateT -= dt;
      this.accel(b, 0, 0, dt);
      if (b.stateT <= 0) { b.state = 'charge'; b.stateT = 1.1; b.chargeA = toShip; }
    } else {
      const radial = clamp((dist - def.standoff) / 200, -1, 1);
      const tang = toShip + Math.PI / 2;
      this.accel(b, Math.cos(toShip) * radial * def.speed + Math.cos(tang) * def.speed * 0.4, Math.sin(toShip) * radial * def.speed + Math.sin(tang) * def.speed * 0.4, dt);
    }
    b.angle += clamp(angleDiff(b.angle, toShip), -def.turn * dt, def.turn * dt);
    if (ship.dead) return;
    const attacks = def.phases[ph].attacks;
    attacks.forEach((atk, i) => {
      b.timers[i] -= dt;
      if (b.timers[i] > 0 || b.state !== 'hunt') return;
      b.timers[i] = atk.every * rand(0.85, 1.15);
      this.bossAttack(b, atk, ship, toShip);
    });
  }

  bossAttack(b, atk, ship, toShip) {
    switch (atk.type) {
      case 'spread': this.shoot(b, ship, { damage: atk.damage, speed: atk.speed, range: 1200 }, atk.arc, atk.count); break;
      case 'ring': {
        const off = rand(0, TAU);
        for (let i = 0; i < atk.count; i++) {
          const a = off + (i / atk.count) * TAU;
          this.world.spawnBullet({ x: b.x + Math.cos(a) * b.radius, y: b.y + Math.sin(a) * b.radius, vx: Math.cos(a) * atk.speed, vy: Math.sin(a) * atk.speed, damage: atk.damage * (b.dmgScale || 1), owner: 'enemy', life: 3.5, color: b.def.color, radius: 4, target: ship });
        }
        this.game.sfx('enemyShoot');
        break;
      }
      case 'spawn': {
        const alive = this.world.enemies.filter((e) => !e.dead && !e.boss && e.type !== 'missile').length;
        if (alive > 12) break;
        for (let i = 0; i < atk.count; i++) { const a = rand(0, TAU); const e = this.makeEnemy(atk.enemy, b.x + Math.cos(a) * b.radius * 1.3, b.y + Math.sin(a) * b.radius * 1.3); e.vx = Math.cos(a) * 200; e.vy = Math.sin(a) * 200; e.bounty = Math.round(e.bounty * 0.5); }
        this.world.particles.ring(b.x, b.y, b.radius * 2, b.def.color, 0.4, 3);
        break;
      }
      case 'charge': b.state = 'windup'; b.stateT = 0.8; b.chargeSpeed = atk.speed; b.chargeDmg = atk.damage; this.banner = { title: '', text: `${b.def.name} is winding up a charge!`, t: 1.2, col: '#ff3cac', small: true }; break;
      case 'beam': this.beams.push({ owner: b, a0: toShip, sweep: atk.sweep / 2, dir: Math.random() < 0.5 ? 1 : -1, length: atk.length, damage: atk.damage, duration: atk.duration, warn: 0.9, t: 0, angle: toShip }); this.game.sfx('charge'); break;
      case 'missiles': for (let i = 0; i < atk.count; i++) this.launchMissile(b, toShip + (i / Math.max(1, atk.count - 1) - 0.5) * 2.2, atk); break;
    }
  }

  // ---------------------------------------------------------------- draw
  draw(ctx, cam) {
    const v = cam.view(80);
    const w = this.world;
    // mines
    for (const m of this.mines) {
      if (m.x < v.x0 || m.x > v.x1 || m.y < v.y0 || m.y > v.y1) continue;
      const blink = Math.sin((m.t + w.time) * (m.arm > 0 ? 20 : 6)) > 0;
      ctx.fillStyle = '#2a1430'; ctx.strokeStyle = '#c77dff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(m.x, m.y, 7, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = blink ? '#ff5d73' : '#5a1020'; ctx.beginPath(); ctx.arc(m.x, m.y, 3, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(199,125,255,0.12)'; ctx.beginPath(); ctx.arc(m.x, m.y, m.radius * 0.6, 0, TAU); ctx.stroke();
    }
    // beams
    for (const b of this.beams) {
      const x0 = b.owner.x, y0 = b.owner.y, x1 = x0 + Math.cos(b.angle) * b.length, y1 = y0 + Math.sin(b.angle) * b.length;
      ctx.globalCompositeOperation = 'lighter';
      if (b.t < b.warn) {
        ctx.strokeStyle = `rgba(255,60,172,${0.2 + 0.3 * Math.sin(b.t * 30)})`; ctx.lineWidth = 2; ctx.setLineDash([12, 10]);
        for (const s of [-1, 1]) { const a = b.a0 + b.sweep * s * b.dir; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + Math.cos(a) * b.length, y0 + Math.sin(a) * b.length); ctx.stroke(); }
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = hexA(b.owner.def.color, 0.35); ctx.lineWidth = 26;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    for (const e of w.enemies) {
      if (e.dead) continue;
      if (e.x + e.radius * 2 < v.x0 || e.x - e.radius * 2 > v.x1 || e.y + e.radius * 2 < v.y0 || e.y - e.radius * 2 > v.y1) continue;
      const spr = enemySprite(e.type, e.def, e.boss);
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.angle + Math.PI / 2);
      // engine glow
      if (e.type !== 'missile') {
        ctx.globalAlpha = 0.35 + Math.random() * 0.2;
        ctx.fillStyle = e.def.color;
        ctx.beginPath(); ctx.arc(0, e.radius * 0.95, e.radius * 0.35, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (e.boss) { const pulse = 1 + Math.sin(w.time * 3) * 0.03; ctx.scale(pulse, pulse); }
      ctx.drawImage(spr.cv, -spr.size / 2, -spr.size / 2, spr.size, spr.size);
      if (e.flash > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = e.flash; ctx.drawImage(spr.cv, -spr.size / 2, -spr.size / 2, spr.size, spr.size); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
      if (e.state === 'windup') { ctx.strokeStyle = '#ff5d73'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, e.radius * 1.4 + Math.sin(w.time * 30) * 3, 0, TAU); ctx.stroke(); }
      ctx.restore();
      if (e.type === 'leech') {
        ctx.strokeStyle = hexA(e.def.color, 0.7); ctx.lineWidth = 2;
        for (let k = 0; k < 4; k++) {
          const a = e.angle + Math.PI + (k - 1.5) * 0.45;
          ctx.beginPath(); ctx.moveTo(e.x + Math.cos(a) * e.radius * 0.7, e.y + Math.sin(a) * e.radius * 0.7);
          ctx.quadraticCurveTo(e.x + Math.cos(a + Math.sin(w.time * 8 + k)) * e.radius * 1.4, e.y + Math.sin(a + Math.sin(w.time * 8 + k)) * e.radius * 1.4, e.x + Math.cos(a) * e.radius * 1.9, e.y + Math.sin(a) * e.radius * 1.9);
          ctx.stroke();
        }
      }
      if (!e.boss && e.hp < e.maxHp && e.type !== 'missile') {
        const W = e.radius * 2;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(e.x - W / 2, e.y - e.radius - 10, W, 4);
        ctx.fillStyle = e.def.color; ctx.fillRect(e.x - W / 2, e.y - e.radius - 10, W * Math.max(0, e.hp / e.maxHp), 4);
      }
    }
  }

  hud(ctx, W, H) {
    const g = this.game;
    if (g.state !== 'flight' && g.state !== 'watch') return;
    ctx.textAlign = 'center';
    const cx = W / 2;
    const far = g.state === 'flight'; // freighter view: the battle is off-screen, the chip and pointer cover it
    const b = far ? null : this.boss;
    if (b) {
      const bw = Math.min(560, W * 0.6);
      ctx.fillStyle = 'rgba(10,14,30,0.85)'; ctx.fillRect(cx - bw / 2, 66, bw, 16);
      ctx.fillStyle = b.def.color; ctx.fillRect(cx - bw / 2 + 2, 68, (bw - 4) * Math.max(0, b.hp / b.maxHp), 12);
      for (const p of b.def.phases) if (p.until > 0) { ctx.fillStyle = '#000'; ctx.fillRect(cx - bw / 2 + bw * p.until - 1, 66, 2, 16); }
      ctx.fillStyle = '#fff'; ctx.font = '900 15px "Trebuchet MS", sans-serif';
      ctx.fillText(b.def.name.toUpperCase(), cx, 60);
    }
    if (this.banner) {
      const bn = this.banner;
      if (bn.maxT == null) bn.maxT = bn.t;
      ctx.globalAlpha = Math.max(0, Math.min(1, bn.t * 2, (bn.maxT - bn.t) * 4 + 0.05));
      if (bn.title) {
        ctx.font = `900 ${bn.boss ? 46 : 34}px "Trebuchet MS", sans-serif`;
        ctx.fillStyle = bn.col; ctx.shadowColor = bn.col; ctx.shadowBlur = 20;
        ctx.fillText(bn.title, cx, H * 0.26);
        ctx.shadowBlur = 0;
      }
      ctx.font = `700 ${bn.small ? 15 : 17}px "Trebuchet MS", sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.fillText(bn.text, cx, H * 0.26 + (bn.title ? 32 : 0));
      ctx.globalAlpha = 1;
    }
    // off-screen enemy pointers
    if (!far) for (const e of g.world.enemies) {
      if (e.dead || e.type === 'missile') continue;
      const [sx, sy] = g.cam.toScreen(e.x, e.y);
      if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
      const a = Math.atan2(sy - H / 2, sx - W / 2);
      const r = Math.min(W, H) / 2 - 30;
      const x = W / 2 + Math.cos(a) * r, y = H / 2 + Math.sin(a) * r;
      ctx.fillStyle = e.boss ? '#ff3cac' : 'rgba(255,93,115,0.8)';
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      const s = e.boss ? 1.8 : 1;
      ctx.beginPath(); ctx.moveTo(8 * s, 0); ctx.lineTo(-5 * s, -6 * s); ctx.lineTo(-5 * s, 6 * s); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
}
