// Ship blueprint model: grid placement, validation, connectivity and the
// physical analysis the builder shows. Pure (no DOM) so the bot can use it.
import { PARTS, PHYS, GRID, ORES } from './data.js';
import { DIRS } from './util.js';
import { upgradeEffects } from './economy.js';

const HALF = (GRID.size - 1) / 2;

export function footprint(partId, rot) {
  const p = PARTS[partId];
  return rot % 2 ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}

// world-ish grid center of an entry (in cell units, relative to grid center)
export function entryCenter(e) {
  const f = footprint(e.part, e.rot);
  return { x: e.x + (f.w - 1) / 2, y: e.y + (f.h - 1) / 2 };
}

export function entryCells(e) {
  const f = footprint(e.part, e.rot);
  const out = [];
  for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) out.push([e.x + i, e.y + j]);
  return out;
}

const key = (x, y) => x + ',' + y;

export function inFrame(x, y, frame) {
  const h = (frame - 1) / 2;
  return x >= -h && x <= h && y >= -h && y <= h;
}

// Cells immediately "in front" (dir) or "behind" (-dir) of an entry footprint
export function edgeCells(e, sgn) {
  const [dx, dy] = DIRS[e.rot];
  const cells = entryCells(e);
  const own = new Set(cells.map(([x, y]) => key(x, y)));
  const out = [];
  for (const [x, y] of cells) {
    const nx = x + dx * sgn, ny = y + dy * sgn;
    if (!own.has(key(nx, ny))) out.push([nx, ny]);
  }
  return out;
}

export class Design {
  constructor(entries = []) {
    this.entries = [];
    this.occ = new Map();
    for (const e of entries) this.add({ ...e });
  }
  static fromPreset(preset) {
    return new Design(preset.cells.map(([part, x, y, rot]) => ({ part, x, y, rot })));
  }
  static fromJSON(data) {
    const d = new Design();
    if (!data || !Array.isArray(data.cells)) return d;
    for (const c of data.cells) {
      const [part, x, y, rot] = c;
      if (!PARTS[part]) continue;
      if (d.check(part, x, y, rot, GRID.size).ok) d.add({ part, x, y, rot });
    }
    return d;
  }
  toJSON() { return { cells: this.entries.map((e) => [e.part, e.x, e.y, e.rot]) }; }
  clone() { return new Design(this.entries); }

  rebuild() {
    this.occ.clear();
    this.entries.forEach((e, i) => { for (const [x, y] of entryCells(e)) this.occ.set(key(x, y), i); });
  }
  add(e) {
    this.entries.push(e);
    const i = this.entries.length - 1;
    for (const [x, y] of entryCells(e)) this.occ.set(key(x, y), i);
    return i;
  }
  at(x, y) { const i = this.occ.get(key(x, y)); return i === undefined ? -1 : i; }
  removeIndex(i) {
    const [e] = this.entries.splice(i, 1);
    this.rebuild();
    return e;
  }
  hasCore() { return this.entries.some((e) => PARTS[e.part].core); }
  count(partId) { return this.entries.filter((e) => e.part === partId).length; }

  check(partId, x, y, rot, frame) {
    const p = PARTS[partId];
    if (!p) return { ok: false, reason: 'Unknown part' };
    if (p.unique && this.count(partId) > 0) return { ok: false, reason: 'Only one ' + p.name + ' allowed' };
    for (const [cx, cy] of entryCells({ part: partId, x, y, rot })) {
      if (!inFrame(cx, cy, frame)) return { ok: false, reason: 'Outside the frame' };
      if (this.at(cx, cy) >= 0) return { ok: false, reason: 'Cell occupied' };
    }
    return { ok: true, reason: '' };
  }
  value() { return this.entries.reduce((s, e) => s + PARTS[e.part].cost, 0); }

  // indices of entries connected to the core (4-neighbour adjacency)
  connected() {
    const coreIdx = this.entries.findIndex((e) => PARTS[e.part].core);
    const seen = new Set();
    if (coreIdx < 0) return seen;
    const stack = [coreIdx];
    seen.add(coreIdx);
    while (stack.length) {
      const i = stack.pop();
      for (const [x, y] of entryCells(this.entries[i])) {
        for (const [dx, dy] of DIRS) {
          const j = this.at(x + dx, y + dy);
          if (j >= 0 && !seen.has(j)) { seen.add(j); stack.push(j); }
        }
      }
    }
    return seen;
  }
  blockedExhaust(i) {
    const e = this.entries[i];
    if (!PARTS[e.part].exhaust) return false;
    return edgeCells(e, -1).some(([x, y]) => this.at(x, y) >= 0);
  }
  blockedMuzzle(i) {
    const e = this.entries[i];
    if (!PARTS[e.part].muzzle) return false;
    return edgeCells(e, 1).some(([x, y]) => this.at(x, y) >= 0);
  }
}

// Mass properties from a list of {x,y (cell center), m, w, h} in cell units.
export function massProps(items) {
  let M = 0, cx = 0, cy = 0;
  for (const it of items) { M += it.m; cx += it.x * it.m; cy += it.y * it.m; }
  if (M <= 0) return { mass: 0, cx: 0, cy: 0, inertia: 1 };
  cx /= M; cy /= M;
  const C = PHYS.CELL;
  let I = 0;
  for (const it of items) {
    const dx = (it.x - cx) * C, dy = (it.y - cy) * C;
    I += it.m * (dx * dx + dy * dy) + (it.m * (it.w * it.w + it.h * it.h) * C * C) / 12;
  }
  return { mass: M, cx, cy, inertia: Math.max(1, I) };
}

// Thruster activation for a desired local direction (ux,uy) of magnitude <= 1
export function thrusterActivation(dirx, diry, ux, uy) {
  const m = Math.hypot(ux, uy);
  if (m < 1e-4) return 0;
  const d = (dirx * ux + diry * uy) / m;
  return d > 0.3 ? Math.min(1, ((d - 0.3) / 0.7) * 1.4) * Math.min(1, m) : 0;
}

// Full analysis used by the builder panel, warnings, and the bot.
export function analyze(design, levels = {}, opts = {}) {
  const fx = upgradeEffects(levels);
  const C = PHYS.CELL;
  const conn = design.connected();
  const items = [];
  let gen = 0, battery = 0, fuel = 0, cargo = 0, gyroTorque = 0, hp = 0, shield = 0, shieldRegen = 0;
  let mining = 0, dps = 0, magnet = 0, peakDraw = 0, value = 0, rcs = 0, crackers = 0;
  const thrusters = [];
  const warnings = [];
  const bad = new Set();
  let blockedEx = 0, blockedMz = 0;

  design.entries.forEach((e, i) => {
    const p = PARTS[e.part];
    value += p.cost;
    if (!conn.has(i)) { bad.add(i); return; }
    const c = entryCenter(e);
    const f = footprint(e.part, e.rot);
    items.push({ x: c.x, y: c.y, m: p.mass, w: f.w, h: f.h });
    hp += p.hp * fx.hpMult;
    if (p.gen) gen += p.gen;
    if (p.battery) battery += p.battery;
    if (p.fuel) fuel += p.fuel;
    if (p.cargo) cargo += p.cargo;
    if (p.torque) { gyroTorque += p.torque; if (p.powerUse) peakDraw += p.powerUse; }
    if (p.magnet) magnet = Math.max(magnet, p.magnet);
    if (p.rcsThrust) rcs += p.rcsThrust;
    if (p.cracker) crackers++;
    if (p.thrust) {
      if (design.blockedExhaust(i)) { blockedEx++; bad.add(i); return; }
      thrusters.push({ i, x: c.x, y: c.y, dx: DIRS[e.rot][0], dy: DIRS[e.rot][1], thrust: p.thrust, fuelUse: p.fuelUse * fx.fuelEff });
    }
    const blocked = p.muzzle && design.blockedMuzzle(i);
    if (blocked) { blockedMz++; bad.add(i); }
    if (p.mining && !blocked) { mining += p.mining * fx.miningMult; dps += p.enemyDps * fx.damageMult; peakDraw += p.powerUse; }
    if (p.weapon && !blocked) {
      dps += p.weapon.damage * fx.damageMult * p.weapon.rate * fx.rateMult;
      peakDraw += p.weapon.energy * p.weapon.rate * fx.rateMult;
    }
    if (p.shield) { shield += p.shield * fx.shieldMult; shieldRegen += p.shieldRegen * fx.shieldMult; peakDraw += p.powerUse; }
    if (p.tractor || (p.magnet && p.powerUse)) peakDraw += p.powerUse || 0;
  });

  const fuelMass = fuel * PHYS.fuelMassPerUnit;
  const dry = massProps(items);
  // full mass: fuel + full cargo (approx ore mass of ferrite) spread over the hull's com
  const fullCargoMass = cargo * ORES.ferrite.mass;
  const mass = dry.mass + fuelMass;
  const loaded = dry.mass + fuelMass + fullCargoMass;
  const inertia = dry.inertia * (mass / Math.max(0.01, dry.mass));

  // thrust in each local direction
  const dirThrust = (ux, uy) => {
    let F = 0, T = 0, burn = 0;
    for (const t of thrusters) {
      const a = thrusterActivation(t.dx, t.dy, ux, uy);
      if (!a) continue;
      const fx_ = t.dx * t.thrust * a, fy_ = t.dy * t.thrust * a;
      F += fx_ * ux + fy_ * uy;
      const rx = (t.x - dry.cx) * C, ry = (t.y - dry.cy) * C;
      T += rx * fy_ - ry * fx_;
      burn += t.fuelUse * a;
    }
    return { F: F + rcs, T, burn };
  };
  const fwd = dirThrust(0, -1), back = dirThrust(0, 1), left = dirThrust(-1, 0), right = dirThrust(1, 0);
  const accel = fwd.F / Math.max(0.1, mass);
  const accelLoaded = fwd.F / Math.max(0.1, loaded);
  const twr = accel / 100; // "g" = 100 px/s^2 for display
  const angAccel = gyroTorque / inertia;
  const turnRate = Math.min(PHYS.maxTurnRate, Math.sqrt(angAccel * Math.PI / 2));
  const turn90 = angAccel > 0 ? 2 * Math.sqrt((Math.PI / 2) / angAccel) : Infinity;
  const imbalance = Math.max(Math.abs(fwd.T), Math.abs(back.T));
  const endurance = fwd.burn > 0 ? fuel / fwd.burn : Infinity;

  const hasCore = design.hasCore();
  if (!hasCore) warnings.push({ lvl: 'err', text: 'No Command Core. Someone has to sit somewhere.' });
  const disconnected = design.entries.length - conn.size - (hasCore ? 0 : 0);
  if (hasCore && conn.size < design.entries.length) warnings.push({ lvl: 'err', text: `${design.entries.length - conn.size} part(s) not attached to the core. They will stay behind.` });
  if (blockedEx) warnings.push({ lvl: 'err', text: `${blockedEx} thruster(s) have blocked exhaust and won't fire.` });
  if (blockedMz) warnings.push({ lvl: 'warn', text: `${blockedMz} laser/railgun(s) are firing into your own hull. Disabled.` });
  if (hasCore && fwd.F - rcs <= 0) warnings.push({ lvl: 'err', text: 'No forward-facing thrusters. You will drift with great dignity.' });
  if (hasCore && imbalance > gyroTorque * 0.95) warnings.push({ lvl: 'err', text: 'Thrust is off-center beyond gyro control. The ship WILL spin.' });
  else if (hasCore && imbalance > gyroTorque * 0.45) warnings.push({ lvl: 'warn', text: 'Thrust is off-center. Gyros will be busy fighting it.' });
  if (hasCore && peakDraw > gen && battery / Math.max(0.01, peakDraw - gen) < 12) warnings.push({ lvl: 'warn', text: `Power deficit at full load (${(peakDraw).toFixed(1)} draw vs ${gen.toFixed(1)} gen). Batteries last ${(battery / Math.max(0.01, peakDraw - gen)).toFixed(0)}s.` });
  if (hasCore && mining <= 0) warnings.push({ lvl: 'warn', text: 'No working mining laser. Rocks will remain unmined and smug.' });
  if (hasCore && accelLoaded < 45) warnings.push({ lvl: 'warn', text: 'Very sluggish when loaded. Consider more thrust or less mass.' });
  if (hasCore && back.F - rcs <= 0) warnings.push({ lvl: 'info', text: 'No reverse thrusters: braking uses the weak core RCS.' });
  if (crackers && gen < 20 && battery < 200) warnings.push({ lvl: 'warn', text: 'The Planet Cracker needs serious power: reactors and batteries.' });

  return {
    mass, dryMass: dry.mass, loadedMass: loaded, com: { x: dry.cx, y: dry.cy }, inertia,
    thrustFwd: fwd.F, thrustBack: back.F, thrustLeft: left.F, thrustRight: right.F,
    accel, accelLoaded, twr, turnRate, turn90, angAccel, gyroTorque, imbalance, fwdTorque: fwd.T,
    gen, peakDraw, battery, fuel, burn: fwd.burn, endurance, cargo, mining, dps, shield, shieldRegen,
    magnet, hp, value, crackers, warnings, bad, conn, thrusters, disconnected,
    launchable: hasCore && fwd.F - rcs > 0,
  };
}
