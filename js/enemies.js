// Enemy waves, AI behaviours, bosses, hazards (mines, missiles, beams).
import { ENEMIES, BOSSES, PHYS, ECONOMY, ORES, FLAVOR } from './data.js';
import { TAU, rand, clamp, angleDiff, pick, segDist2, weightedPick, hexA, money, fmt } from './util.js';
import { P_GLOW, P_SPARK, P_SMOKE, P_DEBRIS } from './particles.js';
import { toast } from './ui/dom.js';

const C = PHYS.CELL;
const WAVE_COST = { gnat: 1, lancer: 1.5, gunboat: 3, leech: 2, minelayer: 4, warden: 6 };
const MISSILE = { name: 'Complaint Missile', ai: 'missile', hp: 8, radius: 6, color: '#ff8fab', bounty: 0 };

// ------------------------------------------------------------- sprites
const spriteCache = new Map();
function enemySprite(type, def, boss) {
  const key = type;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const R = def.radius;
  const S = Math.ceil(R * 2.8);
  const cv = document.createElement('canvas');
  cv.width = cv.height = S * 2;
  const g = cv.getContext('2d');
  g.scale(2, 2);
  g.translate(S / 2, S / 2);
  const col = def.color;
  g.lineJoin = 'round';
  const poly = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x * R, y * R) : g.moveTo(x * R, y * R))); g.closePath(); };
  const body = () => { g.fillStyle = '#1a1020'; g.fill(); g.shadowColor = col; g.shadowBlur = 10; g.strokeStyle = col; g.lineWidth = 2; g.stroke(); g.shadowBlur = 0; };
  // all sprites face "up" (-y)
  if (boss) {
    const sides = { grudge: 6, auditor: 8, matriarch: 5, mildred: 10 }[type] || 7;
    const pts = [];
    for (let i = 0; i < sides * 2; i++) {
      const a = (i / (sides * 2)) * TAU - Math.PI / 2;
      const r = i % 2 ? 0.78 : 1;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    poly(pts); body();
    g.strokeStyle = hexA(col, 0.6); g.lineWidth = 1.5;
    g.beginPath(); g.arc(0, 0, R * 0.55, 0, TAU); g.stroke();
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * TAU;
      g.beginPath(); g.moveTo(Math.cos(a) * R * 0.55, Math.sin(a) * R * 0.55); g.lineTo(Math.cos(a) * R * 0.85, Math.sin(a) * R * 0.85); g.stroke();
    }
    g.fillStyle = col;
    poly([[0, -1.15], [0.12, -0.8], [-0.12, -0.8]]); g.fill();
  } else {
    switch (def.ai) {
      case 'orbit': poly([[0, -1], [0.8, 0.8], [0, 0.4], [-0.8, 0.8]]); body(); break;
      case 'ram': poly([[0, -1.2], [0.45, 0.2], [0.25, 1], [-0.25, 1], [-0.45, 0.2]]); body(); g.fillStyle = col; poly([[0, -1.2], [0.2, -0.5], [-0.2, -0.5]]); g.fill(); break;
      case 'standoff': poly([[-0.5, -0.9], [0.5, -0.9], [1, 0], [0.5, 0.9], [-0.5, 0.9], [-1, 0]]); body(); g.fillStyle = col; g.fillRect(-R * 0.55, -R * 1.2, R * 0.2, R * 0.5); g.fillRect(R * 0.35, -R * 1.2, R * 0.2, R * 0.5); break;
      case 'leech': g.beginPath(); g.arc(0, 0, R * 0.85, 0, TAU); body(); g.fillStyle = col; g.beginPath(); g.arc(0, -R * 0.35, R * 0.3, 0, TAU); g.fill(); break;
      case 'mines': poly([[-0.8, -0.8], [0.8, -0.8], [1, 0.6], [0.6, 1], [-0.6, 1], [-1, 0.6]]); body(); g.strokeStyle = col; g.strokeRect(-R * 0.4, R * 0.1, R * 0.8, R * 0.6); break;
      case 'missiles': poly([[0, -1], [0.95, -0.3], [0.7, 0.9], [-0.7, 0.9], [-0.95, -0.3]]); body(); g.fillStyle = hexA(col, 0.5); g.beginPath(); g.arc(0, 0, R * 0.4, 0, TAU); g.fill(); break;
      case 'missile': poly([[0, -1.3], [0.6, 0.9], [-0.6, 0.9]]); g.fillStyle = col; g.fill(); break;
      default: g.beginPath(); g.arc(0, 0, R, 0, TAU); body();
    }
  }
  const out = { cv, size: S };
  spriteCache.set(key, out);
  return out;
}

export class EnemySystem {
  constructor(game) {
    this.game = game;
    this.waveT = 0;
    this.waveN = 0;
    this.banner = null;
    this.boss = null;
    this.zaps = [];
    this.beams = [];
    this.mines = [];
  }

  get world() { return this.game.world; }
  get sector() { return this.game.world.sector; }
  get save() { return this.game.save; }

  onLaunch() {
    // the wave clock keeps running across docks within a sector (with a short grace period)
    if (this.sectorId !== this.sector.id) { this.sectorId = this.sector.id; this.waveT = this.sector.firstWave; this.waveN = 0; }
    else this.waveT = Math.max(this.waveT, 20);
    this.world.enemies.length = 0;
    this.mines.length = 0; this.beams.length = 0; this.zaps.length = 0;
    this.boss = null;
  }
  onDock() {
    // walking away from a boss lets the tension cool off a little
    if (this.boss) this.threat = 60;
    this.world.enemies.length = 0;
    this.mines.length = 0; this.beams.length = 0;
    this.boss = null;
    this.banner = null;
  }

  get threat() { return this.save.threat[this.sector.id] || 0; }
  set threat(v) { this.save.threat[this.sector.id] = clamp(v, 0, 100); }

  onOre(type, n) {
    if (!this.sector.boss || this.boss) return;
    this.addThreat(this.sector.threatPerOre * n);
  }
  addThreat(v) {
    if (!this.sector.boss || this.boss || this.game.state !== 'flight') return;
    const before = this.threat;
    this.threat = before + v;
    if (before < 75 && this.threat >= 75) toast(`${BOSSES[this.sector.boss].name} has noticed you.`, 'bad', 3000);
    if (this.threat >= 100) this.spawnBoss();
  }

  // ----------------------------------------------------------- spawning
  makeEnemy(type, x, y, scale = this.sector.enemyScale) {
    const def = type === 'missile' ? MISSILE : ENEMIES[type];
    const e = {
      kind: 'enemy', type, def, x, y, vx: 0, vy: 0, angle: rand(0, TAU), hp: def.hp * scale, maxHp: def.hp * scale,
      radius: def.radius, cool: rand(0.5, 2), t: rand(0, 10), state: 'hunt', stateT: 0, dead: false, flash: 0,
      dmgScale: 1 + (scale - 1) * 0.6, bounty: Math.round((def.bounty || 0) * (1 + (scale - 1) * 0.8)), burst: 0, mineT: rand(0, 2), stolen: 0,
    };
    this.world.enemies.push(e);
    return e;
  }

  spawnWave() {
    const ship = this.game.ship;
    this.waveN++;
    let budget = Math.min(this.sector.maxWaveBudget, this.sector.waveBudget + this.sector.waveGrowth * (this.waveN - 1));
    const pool = this.sector.enemies;
    const counts = {};
    let guard = 0;
    while (budget > 0.5 && guard++ < 60) {
      const affordable = pool.filter((t) => WAVE_COST[t] <= budget + 0.01);
      if (!affordable.length) break;
      const t = pick(affordable);
      counts[t] = (counts[t] || 0) + 1;
      budget -= WAVE_COST[t];
    }
    const a = rand(0, TAU), dist = rand(950, 1250);
    const gx = ship.x + Math.cos(a) * dist, gy = ship.y + Math.sin(a) * dist;
    for (const t in counts) for (let i = 0; i < counts[t]; i++) {
      if (this.world.enemies.length > 34) break;
      const e = this.makeEnemy(t, gx + rand(-140, 140), gy + rand(-140, 140));
      e.vx = -Math.cos(a) * 120; e.vy = -Math.sin(a) * 120;
      this.world.particles.spawn(P_GLOW, e.x, e.y, 0, 0, 0.5, 30, e.def.color);
    }
    const desc = Object.entries(counts).map(([t, n]) => `${n}× ${ENEMIES[t].name}`).join(', ');
    this.banner = { title: `WAVE ${this.waveN}`, text: desc, t: 3.5, col: '#ff5d73', angle: a };
    this.game.sfx('warning');
  }

  spawnBoss() {
    const ship = this.game.ship;
    const id = this.sector.boss;
    const def = BOSSES[id];
    const a = rand(0, TAU);
    const scale = 1;
    const b = {
      kind: 'enemy', type: id, def, boss: true, x: ship.x + Math.cos(a) * 1100, y: ship.y + Math.sin(a) * 1100, vx: 0, vy: 0, angle: 0,
      hp: def.hp * scale, maxHp: def.hp * scale, radius: def.radius, t: 0, dead: false, flash: 0, dmgScale: 1, bounty: def.bounty,
      timers: [], phase: -1, charge: 0, state: 'hunt',
    };
    this.world.enemies.push(b);
    this.boss = b;
    this.banner = { title: 'WARNING', text: `${def.name} — ${def.title}`, t: 4.5, col: '#ff3cac', boss: true };
    this.game.sfx('bossWarn');
    this.game.shake(10);
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
    w.particles.burst(e.x, e.y, Math.floor(18 * big), e.def.color, 320 * Math.sqrt(big), 0.7, 2.5, P_SPARK, e.vx * 0.3, e.vy * 0.3);
    w.particles.burst(e.x, e.y, Math.floor(8 * big), '#9a8fa8', 200, 1.6, 5, P_DEBRIS, e.vx * 0.3, e.vy * 0.3);
    w.particles.burst(e.x, e.y, Math.floor(4 * big), '#3a3048', 50, 1.4, e.radius * 0.8, P_SMOKE);
    w.particles.spawn(P_GLOW, e.x, e.y, 0, 0, 0.35, e.radius * 3, '#fff1d0');
    w.particles.ring(e.x, e.y, e.radius * 4, e.def.color, 0.45, 3);
    if (e.type === 'missile') { this.game.sfx('pop'); return; }
    this.game.shake(e.boss ? 35 : Math.min(9, 2 + e.radius / 6));
    this.game.sfx(e.boss ? 'bigBoom' : 'explode', e.radius);
    if (e.bounty) {
      this.game.save.credits += e.bounty;
      this.game.save.stats.earned += e.bounty;
      this.game.trip.bounty += e.bounty;
      w.floaters.add(e.x, e.y - e.radius, '+' + money(e.bounty), '#ffd60a', e.boss ? 26 : 15, -45, 1.4);
    }
    this.game.save.stats.kills++;
    this.game.trip.kills++;
    // salvage
    if (Math.random() < ECONOMY.waveDropChance || e.boss) {
      const n = e.boss ? 30 : 1 + Math.floor(e.radius / 12);
      for (let i = 0; i < n; i++) w.spawnPickup(e.x, e.y, weightedPick(this.sector.ores), rand(60, 220));
    }
    if (e.boss) this.bossDefeated(e);
    else this.addThreat(this.sector.threatPerKill);
  }

  bossDefeated(b) {
    const s = this.save;
    const first = !s.bossKills[b.type];
    s.bossKills[b.type] = (s.bossKills[b.type] || 0) + 1;
    s.stats.bosses++;
    this.threat = 0;
    this.boss = null;
    // the rest of the wave loses heart
    for (const e of this.world.enemies) if (!e.dead && e.type !== 'missile') { e.state = 'flee'; e.stateT = 0; }
    this.beams.length = 0;
    this.game.slowmo = 1.2;
    this.banner = { title: `${b.def.name.toUpperCase()} DEFEATED`, text: `${pick(FLAVOR.bossKills)}  +${money(b.bounty)}${first ? ' · new jump license available in Research' : ''}`, t: 5, col: '#ffd60a' };
    this.game.sfx('victory');
    this.game.onBossDefeated && this.game.onBossDefeated(b, first);
    this.game.persist();
  }

  // ------------------------------------------------------------- update
  update(dt) {
    const g = this.game, ship = g.ship, w = this.world;
    if (!ship || g.state !== 'flight') return;
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
    const st = w.station;
    const inSafe = Math.hypot(ship.x - st.x, ship.y - st.y) < ECONOMY.stationSafeRadius;
    if (!ship.dead && !inSafe && !this.boss) {
      this.waveT -= dt;
      if (this.waveT <= 0) { this.spawnWave(); this.waveT = this.sector.waveInterval; }
    }
    for (const e of w.enemies) {
      if (e.dead) continue;
      e.t += dt;
      if (e.flash > 0) e.flash -= dt * 5;
      if (e.boss) this.bossAI(e, dt, ship);
      else this.ai(e, dt, ship);
      // integrate
      e.x += e.vx * dt; e.y += e.vy * dt;
      // shove out of rocks
      w.hash.query(e.x, e.y, e.radius, (r) => {
        if (r.kind !== 'rock') return;
        const dx = e.x - r.x, dy = e.y - r.y, d = Math.hypot(dx, dy) || 1, rr = r.r * 0.9 + e.radius;
        if (d < rr) { e.x += (dx / d) * (rr - d); e.y += (dy / d) * (rr - d); const vn = e.vx * dx / d + e.vy * dy / d; if (vn < 0) { e.vx -= vn * dx / d * 1.5; e.vy -= vn * dy / d * 1.5; } }
      });
      // body contact with the ship
      if (!ship.dead) this.contact(e, ship, dt);
      // the outpost defends its customers
      if (Math.hypot(e.x - st.x, e.y - st.y) < ECONOMY.stationSafeRadius && !e.boss) {
        e.zapT = (e.zapT || 0) - dt;
        if (e.zapT <= 0) { e.zapT = 0.45; this.zaps.push({ x: e.x, y: e.y, t: 0.15 }); this.damage(e, 35, e.x, e.y, true); g.sfx('zap'); }
      }
      // leash: despawn stragglers far away
      if (Math.hypot(e.x - ship.x, e.y - ship.y) > 3200 && !e.boss) e.dead = true;
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
            // hit the part nearest the beam
            let best = null, bd = 1e9;
            for (const p of ship.parts) {
              if (!p.alive) continue;
              const [px, py] = ship.toWorld(p.lx, p.ly);
              const d2 = segDist2(px, py, x0, y0, x1, y1);
              if (d2 < bd) { bd = d2; best = [px, py]; }
            }
            if (best && bd < (C * 1.2) ** 2) ship.damageAt(best[0], best[1], b.damage * 0.1, w);
          }
        }
      }
    }
    for (let i = this.zaps.length - 1; i >= 0; i--) { this.zaps[i].t -= dt; if (this.zaps[i].t <= 0) this.zaps.splice(i, 1); }
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
        damage: spec.damage * (e.dmgScale || 1), owner: 'enemy', life: (spec.range || 900) / spec.speed + 0.3, color: e.def.color, radius: 3.5 });
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
          this.world.spawnBullet({ x: b.x + Math.cos(a) * b.radius, y: b.y + Math.sin(a) * b.radius, vx: Math.cos(a) * atk.speed, vy: Math.sin(a) * atk.speed, damage: atk.damage, owner: 'enemy', life: 3.5, color: b.def.color, radius: 4 });
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
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = hexA(e.def.color, 0.35 + Math.random() * 0.2);
        ctx.beginPath(); ctx.arc(0, e.radius * 0.95, e.radius * 0.35, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
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
    // outpost zaps
    ctx.globalCompositeOperation = 'lighter';
    for (const z of this.zaps) {
      ctx.strokeStyle = `rgba(125,249,255,${z.t * 6})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(w.station.x, w.station.y); ctx.lineTo(z.x + rand(-6, 6), z.y + rand(-6, 6)); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  hud(ctx, W, H) {
    const g = this.game;
    if (g.state !== 'flight' || !g.ship) return;
    ctx.textAlign = 'center';
    // wave timer + threat
    const cx = W / 2;
    ctx.font = '700 12px "Trebuchet MS", sans-serif';
    if (!this.boss) {
      const inSafe = Math.hypot(g.ship.x, g.ship.y) < ECONOMY.stationSafeRadius;
      ctx.fillStyle = this.waveT < 10 ? '#ff5d73' : '#8796bd';
      ctx.fillText(inSafe ? 'OUTPOST SAFE ZONE — waves paused' : `NEXT WAVE ${Math.ceil(this.waveT)}s`, cx, 22);
    }
    if (this.sector.boss && !this.boss) {
      const k = this.threat / 100;
      const bw = 260;
      ctx.fillStyle = 'rgba(10,14,30,0.8)'; ctx.fillRect(cx - bw / 2, 30, bw, 10);
      ctx.fillStyle = k > 0.75 ? '#ff3cac' : '#c77dff'; ctx.fillRect(cx - bw / 2 + 1, 31, (bw - 2) * k, 8);
      ctx.fillStyle = '#8796bd'; ctx.font = '700 10px "Trebuchet MS", sans-serif';
      ctx.fillText(`THREAT ${Math.floor(this.threat)}% — mining and fighting attract ${BOSSES[this.sector.boss].name}`, cx, 54);
    }
    const b = this.boss;
    if (b) {
      const bw = Math.min(560, W * 0.6);
      ctx.fillStyle = 'rgba(10,14,30,0.85)'; ctx.fillRect(cx - bw / 2, 26, bw, 16);
      ctx.fillStyle = b.def.color; ctx.fillRect(cx - bw / 2 + 2, 28, (bw - 4) * Math.max(0, b.hp / b.maxHp), 12);
      for (const p of b.def.phases) if (p.until > 0) { ctx.fillStyle = '#000'; ctx.fillRect(cx - bw / 2 + bw * p.until - 1, 26, 2, 16); }
      ctx.fillStyle = '#fff'; ctx.font = '900 15px "Trebuchet MS", sans-serif';
      ctx.fillText(b.def.name.toUpperCase(), cx, 20);
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
    for (const e of g.world.enemies) {
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
