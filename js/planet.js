// Endgame: the planet, the Planet Cracker charge, and the destruction cinematic.
import { PLANETS, PHYS, ORES, ENEMIES } from './data.js';
import { TAU, rng, rand, clamp, angleDiff, money, hexA, easeOutBack, smoothstep } from './util.js';
import { P_GLOW, P_SPARK, P_SMOKE, P_DEBRIS } from './particles.js';
import { planetReward } from './economy.js';
import { el, modal } from './ui/dom.js';

const C = PHYS.CELL;

function planetSprite(r, seed) {
  const R = rng(seed);
  const pad = 4;
  const cv = document.createElement('canvas');
  cv.width = cv.height = Math.ceil(r * 2 + pad * 2);
  const g = cv.getContext('2d');
  const c = cv.width / 2;
  g.save();
  g.beginPath(); g.arc(c, c, r, 0, TAU); g.clip();
  const hue = R.range(0, 360);
  const base = g.createLinearGradient(0, 0, 0, cv.height);
  base.addColorStop(0, `hsl(${hue},45%,38%)`); base.addColorStop(0.5, `hsl(${(hue + 30) % 360},50%,30%)`); base.addColorStop(1, `hsl(${(hue + 60) % 360},40%,24%)`);
  g.fillStyle = base; g.fillRect(0, 0, cv.width, cv.height);
  // bands
  for (let i = 0; i < 26; i++) {
    const y = R() * cv.height, h = R.range(6, 40);
    g.fillStyle = `hsla(${(hue + R.range(-40, 40) + 360) % 360},55%,${R.range(25, 60)}%,${R.range(0.08, 0.25)})`;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= cv.width; x += 40) g.lineTo(x, y + Math.sin(x * 0.01 + i) * h * 0.6);
    g.lineTo(cv.width, y + h); g.lineTo(0, y + h); g.closePath(); g.fill();
  }
  // continents
  for (let i = 0; i < 18; i++) {
    const x = R() * cv.width, y = R() * cv.height, rr = R.range(30, 130);
    g.fillStyle = `hsla(${(hue + 150) % 360},35%,${R.range(20, 34)}%,0.55)`;
    g.beginPath();
    for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU; const q = rr * R.range(0.6, 1.2); g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); }
    g.closePath(); g.fill();
  }
  // craters
  for (let i = 0; i < 40; i++) {
    const x = R() * cv.width, y = R() * cv.height, rr = R.range(4, 26);
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.arc(x - 1, y - 1, rr, Math.PI, TAU * 0.9); g.stroke();
  }
  // city lights on the night side, for guilt
  for (let i = 0; i < 260; i++) {
    const a = R.range(0.2, 1.4) + Math.PI * 0.25, d = Math.sqrt(R()) * r * 0.95;
    g.fillStyle = `rgba(255,${R.int(180, 240)},120,${R.range(0.3, 0.9)})`;
    g.fillRect(c + Math.cos(a) * d, c + Math.sin(a) * d, 2, 2);
  }
  // day/night terminator
  const sh = g.createRadialGradient(c - r * 0.45, c - r * 0.45, r * 0.2, c, c, r * 1.15);
  sh.addColorStop(0, 'rgba(255,255,255,0.12)'); sh.addColorStop(0.55, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,10,0.75)');
  g.fillStyle = sh; g.fillRect(0, 0, cv.width, cv.height);
  g.restore();
  return { cv, hue };
}

function makeFragments(sprite, r, seed) {
  const R = rng(seed);
  const n = 16;
  const c = sprite.cv.width / 2;
  const frags = [];
  let a0 = R() * TAU;
  const cuts = [];
  for (let i = 0; i < n; i++) cuts.push(a0 + (i / n) * TAU + R.range(-0.12, 0.12));
  for (let i = 0; i < n; i++) {
    const s0 = cuts[i], s1 = cuts[(i + 1) % n] + (i === n - 1 ? TAU : 0);
    const pts = [[R.range(-30, 30), R.range(-30, 30)]];
    // jagged edge from center outward along s0
    for (let k = 1; k <= 4; k++) { const d = (k / 4) * r * 0.75; pts.push([Math.cos(s0) * d + R.range(-18, 18), Math.sin(s0) * d + R.range(-18, 18)]); }
    for (let k = 0; k <= 8; k++) { const a = s0 + ((s1 - s0) * k) / 8; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    for (let k = 4; k >= 1; k--) { const d = (k / 4) * r * 0.75; pts.push([Math.cos(s1) * d + R.range(-18, 18), Math.sin(s1) * d + R.range(-18, 18)]); }
    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    for (const [x, y] of pts) { minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y); }
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(maxx - minx + 4); cv.height = Math.ceil(maxy - miny + 4);
    const g = cv.getContext('2d');
    g.translate(-minx + 2, -miny + 2);
    g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
    g.save(); g.clip(); g.drawImage(sprite.cv, -c, -c); g.restore();
    g.strokeStyle = '#ff8c42'; g.lineWidth = 5; g.shadowColor = '#ffd27a'; g.shadowBlur = 12; g.stroke();
    const mid = (s0 + s1) / 2;
    frags.push({ cv, ox: minx - 2, oy: miny - 2, x: 0, y: 0, vx: Math.cos(mid) * R.range(60, 170), vy: Math.sin(mid) * R.range(60, 170), a: 0, va: R.range(-0.25, 0.25) });
  }
  return frags;
}

export class PlanetSystem {
  constructor(game) {
    this.game = game;
    this.p = null;
    this.cine = null;
  }
  get world() { return this.game.world; }

  onLaunch() {
    const sec = this.world.sector;
    if (!sec.planet) { this.p = null; this.game.planet = null; return; }
    if (!this.p || this.p.destroyed || this.p.world !== this.world) this.spawn();
    this.game.planet = this;
    this.defenseT = PLANETS.defenseWaveEvery;
  }
  onDock() { if (this.p && this.p.destroyed) this.p = null; }

  spawn() {
    const n = this.game.save.planetsDestroyed;
    const base = PLANETS.names[n % PLANETS.names.length];
    const name = n >= PLANETS.names.length ? `${base} ${Math.floor(n / PLANETS.names.length) + 1}` : base;
    const a = -Math.PI / 4 + n * 1.3;
    const r = PLANETS.radius;
    const spr = planetSprite(r, 4242 + n * 17);
    // a fighter post sits just inside Cracker range of the planet
    const dist = PLANETS.radius + PLANETS.postGap;
    this.p = { name, x: Math.cos(a) * dist, y: Math.sin(a) * dist, r, sprite: spr, rot: 0, destroyed: false, world: this.world, shake: 0, cracks: null, frags: null };
    // clear rocks out of the planet
    this.world.rocks = this.world.rocks.filter((k) => Math.hypot(k.x - this.p.x, k.y - this.p.y) > r + k.r + 120);
  }

  // where the cracker muzzle is and whether it's lined up
  aim(ship, part) {
    const p = this.p;
    const [mx, my] = ship.toWorld(part.lx + part.dir[0] * C * 1.5, part.ly + part.dir[1] * C * 1.5);
    const [dx, dy] = ship.dirWorld(part.dir[0], part.dir[1]);
    const tx = p.x - mx, ty = p.y - my, d = Math.hypot(tx, ty);
    const align = (dx * tx + dy * ty) / (d || 1);
    return { mx, my, dist: d - p.r, align };
  }

  inRange(ship, range) {
    if (!this.p || this.p.destroyed || this.cine) return false;
    const part = ship.parts.find((q) => q.alive && q.def.cracker);
    if (!part) return false;
    const a = this.aim(ship, part);
    this.status = { inRange: a.dist < range, aligned: a.align > 0.94 };
    return this.status.inRange && this.status.aligned;
  }

  crack(ship, part) {
    const p = this.p;
    const a = this.aim(ship, part);
    this.cine = { t: 0, ship, part, mx: a.mx, my: a.my, boomed: false, done: false, damageTaken: ship.damageFraction() };
    // cracks radiate from the impact side
    const R = rng(99 + this.game.save.planetsDestroyed);
    const ia = Math.atan2(a.my - p.y, a.mx - p.x);
    p.cracks = [];
    for (let i = 0; i < 22; i++) {
      let x = Math.cos(ia) * p.r * 0.98, y = Math.sin(ia) * p.r * 0.98;
      let dir = ia + Math.PI + R.range(-1.2, 1.2);
      const pts = [[x, y]];
      for (let k = 0; k < 12; k++) {
        dir += R.range(-0.5, 0.5);
        x += Math.cos(dir) * R.range(30, 80); y += Math.sin(dir) * R.range(30, 80);
        if (x * x + y * y > p.r * p.r) break;
        pts.push([x, y]);
      }
      p.cracks.push({ pts, delay: R.range(0, 1.2) });
    }
    this.game.state = 'cinematic';
    this.game.sfx('crackerFire');
    this.game.audio && this.game.audio.duckMusic(true);
  }

  update(dt) {
    const g = this.game, p = this.p;
    if (!p) return;
    p.rot += dt * 0.01;
    const ship = g.ship;
    if (!p.destroyed && ship && !ship.dead) {
      // solid planet
      const dx = ship.x - p.x, dy = ship.y - p.y, d = Math.hypot(dx, dy);
      const rr = p.r + ship.radius * 0.6;
      if (d < rr) {
        const nx = dx / d, ny = dy / d;
        ship.x = p.x + nx * rr; ship.y = p.y + ny * rr;
        const vn = ship.vx * nx + ship.vy * ny;
        if (vn < 0) {
          ship.vx -= vn * nx * 1.4; ship.vy -= vn * ny * 1.4;
          if (-vn > 120) { ship.damageAt(ship.x - nx * ship.radius * 0.5, ship.y - ny * ship.radius * 0.5, (-vn - 120) * 0.2, this.world); g.shake(8); }
        }
      }
      for (const b of this.world.bullets) if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 < p.r * p.r) b.life = 0;
      // defenders respond while the cracker charges
      if (ship.crackCharge > 0.02 && g.state === 'flight') {
        this.defenseT -= dt;
        if (this.defenseT <= 0) { this.defenseT = PLANETS.defenseWaveEvery; this.defenders(); }
      }
    }
    if (this.cine) this.updateCine(dt);
    if (p.frags) for (const f of p.frags) { f.x += f.vx * dt; f.y += f.vy * dt; f.a += f.va * dt; f.vx *= 1 - dt * 0.03; f.vy *= 1 - dt * 0.03; }
  }

  defenders() {
    const es = this.game.enemySystem, p = this.p;
    const types = ['gunboat', 'gnat', 'warden', 'lancer'];
    let budget = PLANETS.defenseBudget;
    while (budget > 0) {
      const t = types[Math.floor(Math.random() * types.length)];
      budget -= t === 'warden' ? 4 : t === 'gunboat' ? 2 : 1;
      const a = rand(0, TAU);
      const e = es.makeEnemy(t, p.x + Math.cos(a) * (p.r + 60), p.y + Math.sin(a) * (p.r + 60));
      e.vx = Math.cos(a) * 250; e.vy = Math.sin(a) * 250;
    }
    es.banner = { title: '', text: `${p.name} Planetary Defense is objecting`, t: 2.2, col: '#ff3cac', small: true };
    this.game.sfx('warning');
  }

  updateCine(dt) {
    const c = this.cine, g = this.game, p = this.p, w = this.world;
    c.t += dt;
    const ship = c.ship;
    ship.input = { thrust: 0, strafe: 0, turn: 0, fire: false, crack: false };
    const [mx, my] = ship.toWorld(c.part.lx + c.part.dir[0] * C * 1.5, c.part.ly + c.part.dir[1] * C * 1.5);
    c.mx = mx; c.my = my;
    // camera frames ship + planet, then pulls back for the blast
    const midx = (mx + p.x) / 2, midy = (my + p.y) / 2;
    const span = Math.hypot(mx - p.x, my - p.y) + p.r * 2;
    const fit = Math.min(g.W, g.H) / span * 0.9;
    const zoom = c.t < 3.6 ? fit : fit * (0.75 - 0.15 * smoothstep(clamp((c.t - 3.6) / 3, 0, 1)));
    g.cam.override = { x: c.t < 3.6 ? midx : p.x * 0.7 + midx * 0.3, y: c.t < 3.6 ? midy : p.y * 0.7 + midy * 0.3, zoom };
    if (c.t < 3.6) {
      p.shake = c.t / 3.6;
      g.shake(1.5 + c.t * 1.2);
      // energy sparks racing along the beam
      for (let k = 0; k < 3; k++) {
        const t = Math.random();
        w.particles.spawn(P_GLOW, mx + (p.x - mx) * t, my + (p.y - my) * t, rand(-60, 60), rand(-60, 60), 0.4, 10, '#ff3cac');
      }
      const ia = Math.atan2(my - p.y, mx - p.x);
      w.particles.spawn(P_SPARK, p.x + Math.cos(ia) * p.r, p.y + Math.sin(ia) * p.r, Math.cos(ia + rand(-1, 1)) * 400, Math.sin(ia + rand(-1, 1)) * 400, 0.6, 3, '#ffd27a', 1);
    }
    if (c.t >= 3.6 && !c.boomed) this.boom();
    if (c.t > 9 && !c.done) {
      c.done = true;
      g.cam.override = null;
      g.state = 'flight';
      this.cine = null;
      g.audio && g.audio.duckMusic(false);
      this.reward(c);
    }
  }

  boom() {
    const c = this.cine, g = this.game, p = this.p, w = this.world;
    c.boomed = true;
    p.destroyed = true;
    p.frags = makeFragments(p.sprite, p.r, 7 + g.save.planetsDestroyed);
    this.flash = 1.4;
    g.shake(45);
    g.slowmo = 0.6;
    g.sfx('planetBoom');
    for (let k = 0; k < 5; k++) w.particles.ring(p.x, p.y, p.r * (2.5 + k * 1.4), k % 2 ? '#ff3cac' : '#ffd27a', 2 + k * 0.5, 14 - k * 2);
    w.particles.burst(p.x, p.y, 220, '#ffd27a', 1100, 2.5, 6, P_SPARK);
    w.particles.burst(p.x, p.y, 90, '#7a5a48', 500, 6, 16, P_DEBRIS);
    w.particles.burst(p.x, p.y, 40, '#40303a', 200, 5, 90, P_SMOKE);
    w.particles.spawn(P_GLOW, p.x, p.y, 0, 0, 2.5, p.r * 2.2, '#fff1d0');
    // planet-core loot: flung everywhere, then hauled in by salvage crews (paid in reward())
    for (let i = 0; i < 60; i++) {
      const a = rand(0, TAU);
      w.particles.spawn(P_GLOW, p.x + Math.cos(a) * p.r * 0.5, p.y + Math.sin(a) * p.r * 0.5, Math.cos(a) * rand(80, 260), Math.sin(a) * rand(80, 260), 3, 6, ORES.core.glow, 0.3);
    }
    // the shockwave settles every argument in the sector
    for (const e of w.enemies) if (!e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 5000) g.enemySystem.damage(e, 1e9, e.x, e.y, true);
    for (const r of w.rocks) {
      const dx = r.x - p.x, dy = r.y - p.y, d = Math.hypot(dx, dy) || 1;
      if (d < 4000) { r.vx += (dx / d) * 260 * (1 - d / 4000); r.vy += (dy / d) * 260 * (1 - d / 4000); }
    }
    const ship = c.ship, dx = ship.x - p.x, dy = ship.y - p.y, d = Math.hypot(dx, dy) || 1;
    ship.vx += (dx / d) * 260; ship.vy += (dy / d) * 260; ship.av += rand(-1.5, 1.5);
  }

  reward(c) {
    const g = this.game, s = g.save;
    const salvage = Math.round(PLANETS.coreDrops * ORES.core.value * PLANETS.coreSalvage);
    const amount = planetReward(s.planetsDestroyed, s.upgrades) + salvage;
    const name = this.p.name;
    s.planetsDestroyed++;
    s.credits += amount;
    s.stats.earned += amount;
    g.persist();
    const next = planetReward(s.planetsDestroyed, s.upgrades);
    const lines = [
      `${name} has been reclassified as an asteroid belt.`,
      'Local property values have stabilised at zero.',
      'A strongly worded letter is already en route. It will take 400 years to arrive.',
    ];
    g.sfx('victory');
    modal('PLANET DESTROYED', el('div', { class: 'reward' },
      el('div', { class: 'reward-big' }, name),
      el('p', {}, lines[s.planetsDestroyed % lines.length]),
      el('div', { class: 'kv' },
        el('div', {}, el('span', { class: 'dim' }, 'Demolition fee'), el('span', { class: 'money' }, money(amount - salvage))),
        el('div', {}, el('span', { class: 'dim' }, 'Planet Core salvage'), el('span', { class: 'money' }, money(salvage))),
        el('div', {}, el('span', { class: 'dim' }, 'Hull damage sustained'), el('span', {}, Math.round(c.damageTaken * 100) + '%')),
        el('div', {}, el('span', { class: 'dim' }, 'Planets destroyed'), el('span', {}, s.planetsDestroyed)),
        el('div', {}, el('span', { class: 'dim' }, 'Next target pays'), el('span', { class: 'money' }, money(next)))),
      el('p', { class: 'dim small' }, 'Another planet will be along shortly. Gorvox has a supply problem, in that it has a supply.')),
      [{ label: 'Excellent', cls: 'gold' }]);
  }

  // ------------------------------------------------------------- render
  drawBack(ctx, cam) {
    const p = this.p;
    if (!p) return;
    const S = p.sprite.cv.width;
    if (!p.destroyed) {
      const sx = (Math.random() - 0.5) * p.shake * 14, sy = (Math.random() - 0.5) * p.shake * 14;
      // atmosphere
      const grd = ctx.createRadialGradient(p.x, p.y, p.r * 0.9, p.x, p.y, p.r * 1.25);
      grd.addColorStop(0, `hsla(${p.sprite.hue},80%,65%,0.35)`); grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 1.25, 0, TAU); ctx.fill();
      ctx.drawImage(p.sprite.cv, p.x - S / 2 + sx, p.y - S / 2 + sy);
      if (p.cracks && this.cine) {
        const t = this.cine.t;
        ctx.save(); ctx.translate(p.x + sx, p.y + sy);
        ctx.globalCompositeOperation = 'lighter';
        for (const cr of p.cracks) {
          const k = clamp((t - 0.8 - cr.delay) / 1.6, 0, 1);
          if (k <= 0) continue;
          const n = Math.max(2, Math.floor(cr.pts.length * k));
          ctx.strokeStyle = `rgba(255,${120 + k * 100},60,${0.5 + k * 0.5})`;
          ctx.lineWidth = 3 + k * 6;
          ctx.shadowColor = '#ffd27a'; ctx.shadowBlur = 20;
          ctx.beginPath(); for (let i = 0; i < n; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, cr.pts[i][0], cr.pts[i][1]); ctx.stroke();
        }
        ctx.shadowBlur = 0;
        const glow = clamp((t - 2) / 1.6, 0, 1);
        if (glow > 0) { ctx.fillStyle = `rgba(255,210,140,${glow * 0.5})`; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill(); }
        ctx.restore();
      }
    } else if (p.frags) {
      for (const f of p.frags) {
        ctx.save(); ctx.translate(p.x + f.x, p.y + f.y); ctx.rotate(f.a);
        ctx.drawImage(f.cv, f.ox, f.oy);
        ctx.restore();
      }
    }
    // the cracker beam
    if (this.cine && this.cine.t < 3.9) {
      const c = this.cine, t = c.t;
      const w = (t < 0.3 ? t / 0.3 : 1) * (18 + Math.sin(t * 50) * 5 + t * 6);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255,60,172,0.45)'; ctx.lineWidth = w * 2.4;
      ctx.beginPath(); ctx.moveTo(c.mx, c.my); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = w * 0.5;
      ctx.beginPath(); ctx.moveTo(c.mx, c.my); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  draw(ctx) {
    // charging effect at the muzzle
    const g = this.game, ship = g.ship;
    if (!ship || ship.dead || !this.p || ship.crackCharge <= 0 || this.cine) return;
    const part = ship.parts.find((q) => q.alive && q.def.cracker);
    if (!part) return;
    const a = this.aim(ship, part);
    const k = ship.crackCharge;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,60,172,${0.2 + k * 0.5})`;
    ctx.beginPath(); ctx.arc(a.mx, a.my, 8 + k * 26 + Math.sin(g.time * 30) * 3, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    if (Math.random() < 0.7) {
      const ang = rand(0, TAU), d = rand(60, 140);
      g.world.particles.spawn(P_GLOW, a.mx + Math.cos(ang) * d, a.my + Math.sin(ang) * d, -Math.cos(ang) * d * 3, -Math.sin(ang) * d * 3, 0.3, 4, '#ff3cac');
    }
  }

  hud(ctx, W, H) {
    const g = this.game, ship = g.ship, p = this.p;
    if (this.flash > 0) {
      this.flash -= 1 / 60;
      ctx.fillStyle = `rgba(255,250,235,${clamp(this.flash, 0, 1)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.cine) {
      // letterbox
      const k = clamp(this.cine.t / 0.6, 0, 1) * (this.cine.t > 8.4 ? clamp((9 - this.cine.t) / 0.6, 0, 1) : 1);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H * 0.09 * k); ctx.fillRect(0, H - H * 0.09 * k, W, H * 0.09 * k);
      if (this.cine.t > 4.5 && this.cine.t < 8.5) {
        ctx.globalAlpha = clamp((this.cine.t - 4.5) * 2, 0, 1) * clamp((8.5 - this.cine.t) * 2, 0, 1);
        ctx.textAlign = 'center'; ctx.fillStyle = '#ffd27a'; ctx.font = '900 44px "Trebuchet MS", sans-serif';
        ctx.shadowColor = '#ff3cac'; ctx.shadowBlur = 24;
        ctx.fillText(`${p.name.toUpperCase()} — DELETED`, W / 2, H * 0.2);
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      }
      return;
    }
    if (!p || p.destroyed || !ship || ship.dead || g.state !== 'flight') return;
    const part = ship.parts.find((q) => q.alive && q.def.cracker);
    ctx.textAlign = 'center';
    ctx.font = '700 13px "Trebuchet MS", sans-serif';
    if (!part) {
      ctx.fillStyle = '#ff3cac';
      ctx.fillText(`${p.name}: install a Planet Cracker to do something about it`, W / 2, H - 70);
      return;
    }
    const a = this.aim(ship, part);
    const inRange = a.dist < part.def.cracker.range, aligned = a.align > 0.94;
    const k = ship.crackCharge;
    if (k > 0) {
      const R = 46, cx = W / 2, cy = H / 2;
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(255,60,172,0.2)';
      ctx.beginPath(); ctx.arc(cx, cy, R + 60, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#ff3cac'; ctx.shadowColor = '#ff3cac'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(cx, cy, R + 60, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#ff3cac'; ctx.font = '900 16px "Trebuchet MS", sans-serif';
      ctx.fillText(`CRACKER ${Math.floor(k * 100)}%`, cx, cy + R + 86);
      if (ship.powerFactor < 0.95) { ctx.fillStyle = '#ffcf5a'; ctx.font = '700 12px "Trebuchet MS", sans-serif'; ctx.fillText('Power-starved: charge slowed', cx, cy + R + 104); }
    }
    ctx.font = '700 13px "Trebuchet MS", sans-serif';
    ctx.fillStyle = inRange && aligned ? '#2ee6a6' : '#ff3cac';
    const msg = !inRange ? `Fly within ${part.def.cracker.range}px of ${p.name} (${Math.max(0, Math.round(a.dist))}px)` : !aligned ? `Point the Cracker at ${p.name}` : `In position — HOLD ${g.touch ? 'CRACK' : '[C]'} to charge`;
    ctx.fillText(msg, W / 2, H - 70);
  }
}
