// Runtime ship: a 2D rigid body assembled from builder parts.
// Mass, center of mass and moment of inertia are recomputed whenever
// fuel burns, cargo loads, or parts get shot off.
import { PARTS, PHYS, ORES } from './data.js';
import { DIRS, clamp, angleDiff, rand } from './util.js';
import { entryCenter, footprint, massProps, thrusterActivation, Design, edgeCells, entryCells } from './shipdesign.js';
import { upgradeEffects } from './economy.js';

const C = PHYS.CELL;
const key = (x, y) => x + ',' + y;

export class Ship {
  constructor(design, levels = {}) {
    this.levels = levels;
    this.fx = upgradeEffects(levels);
    this.design = design.clone();
    const conn = this.design.connected();
    this.parts = [];
    this.cellMap = new Map();
    this.design.entries.forEach((e, i) => {
      if (!conn.has(i)) return;
      const def = PARTS[e.part];
      const c = entryCenter(e);
      const f = footprint(e.part, e.rot);
      const maxHp = def.hp * this.fx.hpMult;
      const p = {
        id: e.part, def, entry: e, gx: c.x, gy: c.y, w: f.w, h: f.h, rot: e.rot,
        dir: DIRS[e.rot], maxHp, hp: maxHp * (e.hp == null ? 1 : e.hp),
        alive: true, act: 0, cool: rand(0, 0.3), aim: -Math.PI / 2, firing: 0, lx: 0, ly: 0, flash: 0,
      };
      this.parts.push(p);
    });
    for (const p of this.parts) if (p.hp <= 0) p.alive = false;
    this.markBlocked();
    this.rebuildCells();
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.angle = 0; this.av = 0;
    this.comX = 0; this.comY = 0;
    this.cargo = {};
    this.cargoUnits = 0;
    this.capacities();
    this.fuel = this.fuelMax;
    this.energy = this.energyMax;
    this.shield = this.shieldMax;
    this.shieldDelay = 0;
    this.powerFactor = 1;
    this.assist = true;
    this.dead = false;
    this.version = 1;          // bumps when the sprite needs a redraw
    this.hitFlash = 0;
    this.crackCharge = 0;
    this.input = { thrust: 0, strafe: 0, turn: 0, fire: false, crack: false };
    this.stats = { thrustTorque: 0, gyroTorque: 0, gyroUse: 0, burn: 0 };
    this.recomputeMass(true);
    if (this.parts.some((p) => !p.alive)) { this.afterStructureChange(null); this.recomputeMass(true); }
  }

  markBlocked() {
    // Block thrusters/muzzles using the live layout
    const occ = new Set();
    for (const p of this.parts) if (p.alive) for (const [x, y] of entryCells(p.entry)) occ.add(key(x, y));
    for (const p of this.parts) {
      p.blocked = false;
      if (p.def.exhaust) p.blocked = edgeCells(p.entry, -1).some(([x, y]) => occ.has(key(x, y)));
      if (p.def.muzzle) p.blocked = edgeCells(p.entry, 1).some(([x, y]) => occ.has(key(x, y)));
    }
  }

  rebuildCells() {
    this.cellMap.clear();
    this.parts.forEach((p, i) => { if (p.alive) for (const [x, y] of entryCells(p.entry)) this.cellMap.set(key(x, y), i); });
    let r = 0;
    for (const p of this.parts) if (p.alive) r = Math.max(r, Math.hypot(Math.abs(p.gx) + p.w / 2, Math.abs(p.gy) + p.h / 2));
    this.gridRadius = r;
  }

  capacities() {
    let fuel = 0, bat = 0, cargo = 0, gen = 0, shield = 0, regen = 0, gyro = 0, magnet = 0, rcs = 0;
    this.core = null;
    for (const p of this.parts) {
      if (!p.alive) continue;
      const d = p.def;
      if (d.core) this.core = p;
      fuel += d.fuel || 0; bat += d.battery || 0; cargo += d.cargo || 0; gen += d.gen || 0;
      if (d.shield) { shield += d.shield * this.fx.shieldMult; regen += d.shieldRegen * this.fx.shieldMult; }
      if (d.torque) gyro += d.torque;
      if (d.magnet) magnet = Math.max(magnet, d.magnet);
      if (d.rcsThrust) rcs += d.rcsThrust;
    }
    this.fuelMax = fuel; this.energyMax = bat; this.cargoMax = cargo; this.gen = gen;
    this.shieldMax = shield; this.shieldRegen = regen; this.gyroMax = gyro; this.magnet = magnet; this.rcs = rcs;
    this.fuel = Math.min(this.fuel ?? fuel, fuel);
    this.energy = Math.min(this.energy ?? bat, bat);
    this.shield = Math.min(this.shield ?? shield, shield);
  }

  // Distribute fuel & cargo mass over their containers, then rebuild COM/inertia.
  recomputeMass(snap = false) {
    const items = [];
    const fuelFrac = this.fuelMax > 0 ? this.fuel / this.fuelMax : 0;
    const cargoMass = this.cargoMass();
    const cargoFrac = this.cargoMax > 0 ? cargoMass / this.cargoMax : 0;
    for (const p of this.parts) {
      if (!p.alive) continue;
      let m = p.def.mass;
      if (p.def.fuel) m += p.def.fuel * fuelFrac * PHYS.fuelMassPerUnit;
      if (p.def.cargo) m += p.def.cargo * cargoFrac;
      items.push({ x: p.gx, y: p.gy, m, w: p.w, h: p.h });
    }
    const mp = massProps(items);
    if (!snap) {
      // keep the hull fixed in the world while the COM slides around inside it
      const dx = (mp.cx - this.comX) * C, dy = (mp.cy - this.comY) * C;
      const c = Math.cos(this.angle), s = Math.sin(this.angle);
      this.x += dx * c - dy * s;
      this.y += dx * s + dy * c;
    }
    this.comX = mp.cx; this.comY = mp.cy;
    this.mass = mp.mass; this.inertia = mp.inertia;
    for (const p of this.parts) { p.lx = (p.gx - this.comX) * C; p.ly = (p.gy - this.comY) * C; }
    this.radius = 0;
    for (const p of this.parts) if (p.alive) this.radius = Math.max(this.radius, Math.hypot(p.lx, p.ly) + C * 0.75 * Math.max(p.w, p.h));
  }

  cargoMass() { let m = 0; for (const k in this.cargo) m += this.cargo[k] * ORES[k].mass; return m; }

  addOre(type, units) {
    const room = this.cargoMax - this.cargoUnits;
    const add = Math.min(room, units);
    if (add <= 0) return 0;
    this.cargo[type] = (this.cargo[type] || 0) + add;
    this.cargoUnits += add;
    return add;
  }
  removeOre(units) {
    // remove from the most plentiful ore (used by leeches)
    let taken = {};
    while (units > 0.0001 && this.cargoUnits > 0.0001) {
      let best = null;
      for (const k in this.cargo) if (!best || this.cargo[k] > this.cargo[best]) best = k;
      const n = Math.min(units, this.cargo[best]);
      this.cargo[best] -= n; this.cargoUnits -= n; units -= n;
      taken[best] = (taken[best] || 0) + n;
      if (this.cargo[best] <= 0.0001) delete this.cargo[best];
    }
    return taken;
  }
  clearCargo() { this.cargo = {}; this.cargoUnits = 0; }

  toWorld(lx, ly) {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    return [this.x + lx * c - ly * s, this.y + lx * s + ly * c];
  }
  toLocal(wx, wy) {
    const dx = wx - this.x, dy = wy - this.y;
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    return [dx * c + dy * s, -dx * s + dy * c];
  }
  dirWorld(dx, dy) {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    return [dx * c - dy * s, dx * s + dy * c];
  }
  partAtWorld(wx, wy) {
    const [lx, ly] = this.toLocal(wx, wy);
    const gx = Math.round(lx / C + this.comX), gy = Math.round(ly / C + this.comY);
    const i = this.cellMap.get(key(gx, gy));
    return i === undefined ? -1 : i;
  }
  // velocity of a world point on the body
  pointVel(wx, wy) {
    const rx = wx - this.x, ry = wy - this.y;
    return [this.vx - this.av * ry, this.vy + this.av * rx];
  }
  applyImpulse(ix, iy, wx, wy) {
    this.vx += ix / this.mass; this.vy += iy / this.mass;
    const rx = wx - this.x, ry = wy - this.y;
    this.av += (rx * iy - ry * ix) / this.inertia;
  }

  // ------------------------------------------------------------------
  update(dt, world) {
    if (this.dead) return;
    const inp = this.input;
    const fx = this.fx;
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    // local velocity
    const lvx = this.vx * c + this.vy * s, lvy = -this.vx * s + this.vy * c;

    // ---- desired local thrust direction
    let ux = inp.strafe, uy = -inp.thrust;
    const im = Math.hypot(ux, uy);
    if (im > 1) { ux /= im; uy /= im; }
    if (this.assist) {
      const sp = Math.hypot(lvx, lvy);
      if (im < 0.05) {
        if (sp > 4) { const k = Math.min(1, sp / 80) * PHYS.dampGain; ux = (-lvx / sp) * Math.min(1, k); uy = (-lvy / sp) * Math.min(1, k); }
      } else if (sp > 4) {
        // kill sideways drift relative to where you're pushing
        const nx = ux / Math.max(1e-4, Math.hypot(ux, uy)), ny = uy / Math.max(1e-4, Math.hypot(ux, uy));
        const along = lvx * nx + lvy * ny;
        const px = lvx - nx * along, py = lvy - ny * along;
        const ps = Math.hypot(px, py);
        if (ps > 4) { const k = Math.min(0.8, ps / 120); ux -= (px / ps) * k; uy -= (py / ps) * k; }
      }
    }

    // ---- thrusters
    let Fx = 0, Fy = 0, T = 0, burn = 0;
    const hasFuel = this.fuel > 0;
    for (const p of this.parts) {
      if (!p.alive || !p.def.thrust || p.blocked) { p.act = 0; continue; }
      let a = hasFuel ? thrusterActivation(p.dir[0], p.dir[1], ux, uy) : 0;
      p.act += (a - p.act) * Math.min(1, dt * 18); // spool
      if (p.act < 0.01) continue;
      const f = p.def.thrust * p.act;
      const fx_ = p.dir[0] * f, fy_ = p.dir[1] * f;
      Fx += fx_; Fy += fy_;
      T += p.lx * fy_ - p.ly * fx_;
      burn += p.def.fuelUse * fx.fuelEff * p.act;
    }
    // core RCS: weak omni thrust from the core position (fuel-free emergency jets)
    if (this.core && (ux || uy)) {
      const m = Math.min(1, Math.hypot(ux, uy));
      const n = Math.hypot(ux, uy) || 1;
      const f = this.rcs * m;
      const fx_ = (ux / n) * f, fy_ = (uy / n) * f;
      Fx += fx_; Fy += fy_;
      T += this.core.lx * fy_ - this.core.ly * fx_;
    }
    this.fuel = Math.max(0, this.fuel - burn * dt);
    this.stats.burn = burn;
    this.stats.thrustTorque = T;

    // ---- power budget
    let demand = 0;
    const pf = this.powerFactor;

    // ---- gyros (flight computer)
    let gyroAvail = 0, gyroPower = 0;
    for (const p of this.parts) if (p.alive && p.def.torque) {
      if (p.def.powerUse) { gyroAvail += p.def.torque * pf; gyroPower += p.def.powerUse; } else gyroAvail += p.def.torque;
    }
    let Tg = 0;
    if (Math.abs(inp.turn) > 0.05 || this.assist) {
      const target = inp.turn * PHYS.maxTurnRate;
      // feed-forward against thrust torque, plus P-control toward target spin
      const want = (target - this.av) * this.inertia * PHYS.assistGain - (this.assist ? T : 0);
      Tg = clamp(want, -gyroAvail, gyroAvail);
    }
    const gyroLoad = gyroAvail > 0 ? Math.abs(Tg) / gyroAvail : 0;
    demand += gyroPower * gyroLoad;
    this.stats.gyroTorque = Tg; this.stats.gyroUse = gyroLoad;

    // ---- integrate
    const wx = Fx * c - Fy * s, wy = Fx * s + Fy * c;
    this.vx += (wx / this.mass) * dt;
    this.vy += (wy / this.mass) * dt;
    this.av += ((T + Tg) / this.inertia) * dt;
    const ld = Math.max(0, 1 - PHYS.linearDrag * dt), ad = Math.max(0, 1 - PHYS.angularDrag * dt);
    this.vx *= ld; this.vy *= ld; this.av *= ad;
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > PHYS.maxSpeed) { this.vx *= PHYS.maxSpeed / sp; this.vy *= PHYS.maxSpeed / sp; }
    this.av = clamp(this.av, -14, 14);
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.angle += this.av * dt;

    // ---- systems (need a world)
    if (world) demand += this.updateSystems(dt, world);

    // resolve power
    const avail = this.energy + this.gen * dt;
    const need = demand * dt;
    this.powerFactor = need > 0 ? clamp(avail / need, 0, 1) : 1;
    this.energy = clamp(avail - need * this.powerFactor, 0, this.energyMax);

    // fuel/cargo mass shifts
    this._massTimer = (this._massTimer || 0) + dt;
    if (this._massTimer > 0.2) { this._massTimer = 0; this.recomputeMass(); }
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    for (const p of this.parts) if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 5);
  }

  updateSystems(dt, world) {
    const inp = this.input, fx = this.fx, pf = this.powerFactor;
    let demand = 0;
    for (const p of this.parts) {
      if (!p.alive) continue;
      const d = p.def;
      // mining lasers: fire while holding fire
      if (d.mining) {
        p.firing = 0;
        if (inp.fire && !p.blocked && pf > 0.05) {
          demand += d.powerUse;
          const [ox, oy] = this.toWorld(p.lx + p.dir[0] * C * 0.5, p.ly + p.dir[1] * C * 0.5);
          const [dx, dy] = this.dirWorld(p.dir[0], p.dir[1]);
          const hit = world.raycast(ox, oy, dx, dy, d.laserRange);
          p.firing = hit ? hit.t : d.laserRange;
          p.beam = [ox, oy, dx, dy];
          if (hit) world.laserHit(hit, d.mining * fx.miningMult * pf * dt, d.enemyDps * fx.damageMult * pf * dt, ox + dx * hit.t, oy + dy * hit.t, this);
        }
      }
      if (d.weapon) {
        p.cool -= dt * fx.rateMult;
        const w = d.weapon;
        if (d.directional) {
          // railgun: fixed forward, manual fire
          if (inp.fire && p.cool <= 0 && !p.blocked && this.energy >= w.energy) {
            p.cool = 1 / w.rate;
            this.energy -= w.energy;
            const [ox, oy] = this.toWorld(p.lx + p.dir[0] * C * p.h * 0.6, p.ly + p.dir[1] * C * p.h * 0.6);
            const [dx, dy] = this.dirWorld(p.dir[0], p.dir[1]);
            world.spawnBullet({ x: ox, y: oy, vx: dx * w.speed + this.vx, vy: dy * w.speed + this.vy, damage: w.damage * fx.damageMult,
              owner: 'player', life: w.range / w.speed, pierce: w.pierce || 1, kind: 'rail' });
            this.applyImpulse(-dx * w.recoil, -dy * w.recoil, ox, oy);
            p.flash = 1;
            world.onRailFire(ox, oy, dx, dy);
          }
        } else {
          // turret: auto-target
          const [tx, ty] = this.toWorld(p.lx, p.ly);
          const target = world.findTarget(tx, ty, w.range);
          if (target) {
            // lead the target
            const ddx = target.x - tx, ddy = target.y - ty;
            const tt = Math.hypot(ddx, ddy) / w.speed;
            const ax = target.x + (target.vx || 0) * tt - tx, ay = target.y + (target.vy || 0) * tt - ty;
            const want = Math.atan2(ay, ax);
            p.aim += clamp(angleDiff(p.aim, want), -10 * dt, 10 * dt);
            if (p.cool <= 0 && this.energy >= w.energy && Math.abs(angleDiff(p.aim, want)) < 0.25) {
              p.cool = 1 / w.rate;
              this.energy -= w.energy;
              const a = p.aim + rand(-w.spread, w.spread);
              const ca = Math.cos(a), sa = Math.sin(a);
              world.spawnBullet({ x: tx + ca * 10, y: ty + sa * 10, vx: ca * w.speed + this.vx, vy: sa * w.speed + this.vy,
                damage: w.damage * fx.damageMult, owner: 'player', life: w.range / w.speed * 1.1, pierce: 1, kind: 'shell' });
              p.flash = 1;
              world.onTurretFire(tx + ca * 10, ty + sa * 10, a);
            }
          } else {
            p.aim += angleDiff(p.aim, this.angle - Math.PI / 2) * Math.min(1, dt * 2);
          }
        }
      }
      if (d.powerUse && d.magnet) demand += d.powerUse;
    }
    // shields
    if (this.shieldMax > 0) {
      if (this.shieldDelay > 0) this.shieldDelay -= dt;
      else if (this.shield < this.shieldMax) {
        let use = 0;
        for (const p of this.parts) if (p.alive && p.def.shield) use += p.def.powerUse;
        demand += use;
        this.shield = Math.min(this.shieldMax, this.shield + this.shieldRegen * pf * dt);
      }
    }
    // planet cracker
    const cr = this.parts.find((p) => p.alive && p.def.cracker);
    if (cr) {
      const spec = cr.def.cracker;
      if (inp.crack && !cr.blocked && world.crackerTarget(this, cr, spec.range)) {
        demand += spec.power;
        this.crackCharge = Math.min(1, this.crackCharge + (dt * pf) / (spec.chargeTime * fx.chargeEff));
        if (this.crackCharge >= 1) { world.fireCracker(this, cr); this.crackCharge = 0; }
      } else this.crackCharge = Math.max(0, this.crackCharge - dt * 0.25);
    }
    // magnet (ore pickup)
    if (this.magnet > 0) world.attractPickups(this, this.magnet, dt);
    return demand;
  }

  // ------------------------------------------------------------------
  // Damage. Returns true if the part was destroyed.
  damageAt(wx, wy, dmg, world) {
    if (this.dead) return;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, dmg);
      this.shield -= absorbed;
      dmg -= absorbed;
      this.shieldDelay = 2;
      world && world.onShieldHit(this, wx, wy);
      if (dmg <= 0) return;
    }
    let i = this.partAtWorld(wx, wy);
    if (i < 0) {
      // nearest live part
      let best = 1e9;
      const [lx, ly] = this.toLocal(wx, wy);
      this.parts.forEach((p, j) => { if (!p.alive) return; const d = (p.lx - lx) ** 2 + (p.ly - ly) ** 2; if (d < best) { best = d; i = j; } });
    }
    if (i >= 0) this.damagePart(i, dmg, world);
  }

  damagePart(i, dmg, world) {
    const p = this.parts[i];
    if (!p || !p.alive) return false;
    if (this.god) { p.flash = 1; return false; } // dev sandbox
    dmg = Math.max(dmg * 0.25, dmg - (p.def.armor || 0));
    p.hp -= dmg;
    p.flash = 1;
    this.hitFlash = 1;
    this.version++;
    if (world) world.onPartHit(this, p, dmg);
    if (p.hp <= 0) { this.destroyPart(i, world); return true; }
    return false;
  }

  destroyPart(i, world) {
    const p = this.parts[i];
    if (!p.alive) return;
    p.alive = false; p.hp = 0;
    const [wx, wy] = this.toWorld(p.lx, p.ly);
    if (world) world.onPartDestroyed(this, p, wx, wy);
    if (p.def.core) { this.dead = true; if (world) world.onShipDestroyed(this); return; }
    // reactor chain explosion
    if (p.def.explode) {
      const R = p.def.explode.radius;
      this.parts.forEach((q, j) => {
        if (!q.alive) return;
        const d = Math.hypot(q.gx - p.gx, q.gy - p.gy);
        if (d <= R && d > 0) this.damagePart(j, p.def.explode.damage * (1 - d / (R + 1)), world);
      });
      if (this.dead) return;
    }
    this.afterStructureChange(world);
  }

  afterStructureChange(world) {
    // detach anything no longer connected to the core
    const live = this.parts.filter((q) => q.alive);
    const d = new Design(live.map((q) => q.entry));
    const conn = d.connected();
    live.forEach((q, j) => {
      if (!conn.has(j)) {
        q.alive = false; q.hp = 0;
        const [wx, wy] = this.toWorld(q.lx, q.ly);
        if (world) world.onPartDetached(this, q, wx, wy);
      }
    });
    this.rebuildCells();
    this.markBlocked();
    const prevCargo = this.cargoUnits;
    this.capacities();
    // spill cargo that no longer fits
    if (prevCargo > this.cargoMax) {
      const spilled = this.removeOre(prevCargo - this.cargoMax);
      if (world) world.spillOre(this, spilled);
    }
    this.recomputeMass();
    this.version++;
  }

  // Copy part condition back into the blueprint after a flight.
  writeBack(design) {
    const d = design.clone();
    for (const p of this.parts) {
      const e = d.entries.find((q) => q.x === p.entry.x && q.y === p.entry.y && q.part === p.entry.part);
      if (e) e.hp = p.alive ? Math.max(0.01, Math.min(1, p.hp / p.maxHp)) : 0;
    }
    return d;
  }

  damageFraction() {
    let lost = 0, tot = 0;
    for (const p of this.parts) { tot += p.maxHp; lost += p.maxHp - Math.max(0, p.hp); }
    return tot ? lost / tot : 0;
  }
}
