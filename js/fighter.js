// Your fighter: a defense platform that escorts the freighter, holding station
// on the space side of it and taking on the planet's swarm. If it falls below
// its retreat line, both ships warp home and mining stops until it's repaired.
import { FIGHTER, PARTS, PLANETGEN } from './data.js';
import { Ship } from './ship.js';
import { Design, analyze } from './shipdesign.js';
import { Input } from './input.js';
import { angleDiff, clamp, money, rand } from './util.js';
import { P_GLOW } from './particles.js';
import { upgradeEffects } from './economy.js';

export class Escort {
  constructor(game) {
    this.game = game;
    this.ship = null;
    this.manual = false;
    this.side = 1;   // which flank it favours
  }
  get fs() { return this.game.save.fighter; }
  design() { return Design.fromJSON(this.fs.design); }
  analysis() { return analyze(this.design(), this.game.levels, { role: 'fighter' }); }
  get repairing() { return (this.fs.repairT || 0) > 0; }
  get ready() { return !this.repairing && this.analysis().launchable; }

  // launch alongside the freighter
  deploy(freighter) {
    const ship = new Ship(this.design(), this.game.levels, 'fighter');
    ship.x = freighter.x + 80; ship.y = freighter.y - 40; ship.angle = freighter.angle;
    ship.recomputeMass(true);
    this.ship = ship;
    this.manual = false;
    this.game.world.particles.ring(ship.x, ship.y, 140, '#ff4d6d', 0.5, 3);
  }
  stow() { this.stash(); this.ship = null; this.manual = false; }
  stash() { if (this.ship && !this.ship.dead) this.fs.design = this.ship.writeBack(this.design()).toJSON(); }

  hull() { return this.ship ? 1 - this.ship.damageFraction() : 1; }

  // where to hold station: on the space side of the freighter, a little ahead of it
  station(fr, world) {
    const d = Math.hypot(fr.x, fr.y) || 1;
    const ox = fr.x / d, oy = fr.y / d; // away from the planet
    const px = -oy * this.side, py = ox * this.side;
    const D = FIGHTER.escortDist + fr.radius;
    return [fr.x + ox * D * 0.85 + px * D * 0.5, fr.y + oy * D * 0.85 + py * D * 0.5];
  }

  update(dt, fr, world) {
    const s = this.ship;
    if (!s) return;
    // fly to station (kinematic hover: it doesn't need engines of its own)
    const [tx, ty] = this.station(fr, world);
    const dx = tx - s.x, dy = ty - s.y;
    const k = 1 - Math.exp(-3 * dt);
    const nvx = dx * 3 + fr.vx * 0.8, nvy = dy * 3 + fr.vy * 0.8;
    s.vx += (nvx - s.vx) * k; s.vy += (nvy - s.vy) * k;
    const sp = Math.hypot(s.vx, s.vy);
    if (sp > 650) { s.vx *= 650 / sp; s.vy *= 650 / sp; }
    s.input = s.dead ? { thrust: 0, strafe: 0, turn: 0 } : this.manual ? this.manualInput() : this.ai(world);
    const keepVx = s.vx, keepVy = s.vy;
    s.update(dt, world);
    s.vx = keepVx; s.vy = keepVy;  // its own thrusters don't push it around
    // retreat before total destruction
    if (!s.dead) {
      const core = s.core;
      if (this.hull() < this.fs.retreat || (core && core.hp / core.maxHp < FIGHTER.coreRetreat)) this.game.fighterDown(false);
    }
  }

  // turrets aim themselves; this swings the hull so fixed railguns bear
  ai(world) {
    const s = this.ship;
    const out = { thrust: 0, strafe: 0, turn: 0, fire: false, crack: false, brake: false };
    const guns = s.parts.filter((p) => p.alive && !p.blocked && p.def.weapon && p.def.directional);
    let best = null, bd = 1e18;
    for (const e of world.enemies) {
      if (e.dead || e.type === 'missile') continue;
      const d = (e.x - s.x) ** 2 + (e.y - s.y) ** 2 - (e.boss ? 1e6 : 0);
      if (d < bd) { bd = d; best = e; }
    }
    if (!guns.length || !best) { out.turn = clamp(-s.av * 0.5, -1, 1); return out; }
    const g = guns[0];
    const dist = Math.hypot(best.x - s.x, best.y - s.y);
    const t = dist / g.def.weapon.speed;
    const tx = best.x + (best.vx || 0) * t - s.x, ty = best.y + (best.vy || 0) * t - s.y;
    const offset = Math.atan2(g.dir[0], -g.dir[1]);
    const err = angleDiff(s.angle, Math.atan2(tx, -ty) - offset);
    out.turn = clamp(err * 3 - s.av * 0.6, -1, 1);
    out.fire = Math.abs(err) < 0.07 && dist < g.def.weapon.range;
    return out;
  }

  manualInput() {
    const i = Input.flight();
    return { thrust: 0, strafe: 0, turn: i.turn, fire: i.fire, crack: false, brake: i.brake };
  }

  // after a fall: price and time the repairs, rebuild the core for free
  startRepairs(destroyed) {
    const d = this.ship ? this.ship.writeBack(this.design()) : this.design();
    for (const e of d.entries) if (PARTS[e.part].core && e.hp === 0) e.hp = 0.5;
    const dmgFrac = this.ship ? this.ship.damageFraction() : 0.5;
    const cost = this.game.repairCost(d, FIGHTER.repairDiscount).total;
    const pay = Math.min(cost, Math.max(0, this.game.save.credits));
    this.game.save.credits -= pay;
    for (const e of d.entries) e.hp = 1; // repairs restore everything; the clock is the real price
    this.fs.design = d.toJSON();
    const fx = upgradeEffects(this.game.levels);
    this.fs.repairT = Math.round((FIGHTER.repairBase + FIGHTER.repairPerDamage * Math.min(1, dmgFrac + (destroyed ? 0.3 : 0))) * fx.repairEff);
    this.fs.repairMax = this.fs.repairT;
    this.ship = null;
    this.manual = false;
    return { pay, time: this.fs.repairT };
  }

  rushCost() { return Math.ceil((this.fs.repairT || 0) * FIGHTER.rushPerSecond * Math.pow(PLANETGEN.valueGrowth, this.game.save.planet.index)); }
  rush() {
    const c = this.rushCost();
    if (!this.repairing || this.game.save.credits < c) return false;
    this.game.save.credits -= c;
    this.fs.repairT = 0;
    return true;
  }

  // repairs tick on whatever screen you're on
  tick(dt) { if (this.fs.repairT > 0) this.fs.repairT = Math.max(0, this.fs.repairT - dt); }
}
