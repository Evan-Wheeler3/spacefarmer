// Freighter autopilot. Flies the real ship with the real physics: picks a spot
// on the planet's surface near the starship, mines it evenly so the dig widens
// into a bowl, heads home when the hold is full, and comes back.
import { ECONOMY, ORES } from './data.js';
import { angleDiff, clamp, TAU } from './util.js';

export class Autopilot {
  constructor(game) {
    this.game = game;
    this.mode = 'mine';
    this.theta = null;      // mining angle around the planet
    this.target = null;
  }
  reset() { this.mode = 'mine'; this.target = null; }

  steer(ship, tx, ty, stop, face = null) {
    const dx = tx - ship.x, dy = ty - ship.y;
    const dist = Math.hypot(dx, dy);
    const fwd = ship.parts.reduce((a, p) => a + (p.alive && p.def.thrust && p.dir[1] < 0 ? p.def.thrust : 0), 0);
    const accel = Math.max(30, (fwd / ship.mass) * 0.55);
    const vmax = Math.min(460, Math.sqrt(2 * accel * Math.max(0, dist - stop)));
    const vdx = (dx / (dist || 1)) * vmax, vdy = (dy / (dist || 1)) * vmax;
    const ex = vdx - ship.vx, ey = vdy - ship.vy;
    const c = Math.cos(ship.angle), s = Math.sin(ship.angle);
    const lx = ex * c + ey * s, ly = -ex * s + ey * c;
    const fx = face ? face[0] - ship.x : dx, fy = face ? face[1] - ship.y : dy;
    const want = Math.atan2(fx, -fy);
    const err = angleDiff(ship.angle, want);
    return {
      thrust: clamp(-ly / 40, -1, 1) * (Math.abs(err) < 0.6 ? 1 : 0.2),
      strafe: clamp(lx / 40, -1, 1),
      turn: clamp(err * 2.5 - ship.av * 0.6, -1, 1),
      fire: false, crack: false, brake: false, dist, err,
    };
  }

  bestTier(ship) {
    let t = 0;
    for (const p of ship.parts) if (p.alive && p.def.mining && !p.blocked) t = Math.max(t, p.def.tier || 1);
    return t;
  }

  // choose where to dig: shallowest reachable surface near the current angle,
  // gently biased toward the starship so trips stay short
  pickTarget(ship, world) {
    const pl = world.planet;
    const home = Math.atan2(world.station.y, world.station.x);
    if (this.theta == null) this.theta = home;
    const tier = this.bestTier(ship);
    const step = (pl.cell * 1.5) / pl.R;
    let best = null, bs = -1e18;
    for (let k = -6; k <= 6; k++) {
      const a = this.theta + k * step;
      const sfc = pl.surfaceAt(a);
      if (!sfc) continue;
      const m = pl.matName(pl.matAt(sfc.i, sfc.j));
      const r = Math.hypot(sfc.x, sfc.y);
      let score = r - Math.abs(angleDiff(home, a)) * pl.R * 0.08 - Math.abs(k) * 2;
      if (ORES[m].tier > tier) score -= pl.R * 0.5; // can't cut it properly yet
      if (score > bs) { bs = score; best = { ...sfc, a }; }
    }
    if (!best) {
      // our arc is dug out: sweep around to the nearest remaining surface
      for (let k = 1; k < 720; k++) {
        for (const sg of [1, -1]) {
          const a = this.theta + sg * k * step * 4;
          const sfc = pl.surfaceAt(a);
          if (sfc) { this.theta = a; return { ...sfc, a }; }
        }
      }
      return null;
    }
    this.theta = best.a;
    return best;
  }

  // returns ship input
  drive(ship, world) {
    const g = this.game;
    const laser = ship.parts.find((p) => p.alive && p.def.mining && !p.blocked);
    const full = ship.cargoUnits >= ship.cargoMax * 0.95;
    if (this.mode === 'mine' && (full || ship.fuel < ship.fuelMax * 0.15 || !laser || g.idleLeft <= 0)) this.mode = 'home';
    if (this.mode === 'home') {
      const st = world.station;
      const r = this.steer(ship, st.x, st.y, ECONOMY.dockRadius * 0.4);
      if (g.canDock) g.autoDock();
      return r;
    }
    const pl = world.planet;
    if (!this.target || !pl.matAt(this.target.i, this.target.j)) this.target = this.pickTarget(ship, world);
    const t = this.target;
    if (!t) { this.mode = 'home'; return { thrust: 0, strafe: 0, turn: 0, fire: false }; }
    const [nx, ny] = pl.normalAt(t.x, t.y);
    const range = Math.max(...ship.parts.filter((p) => p.alive && p.def.mining && !p.blocked).map((p) => p.def.laserRange));
    const standoff = range * 0.55 + ship.radius * 0.45;
    const px = t.x + nx * standoff, py = t.y + ny * standoff;
    const r = this.steer(ship, px, py, 6, [t.x, t.y]);
    const d = Math.hypot(ship.x - t.x, ship.y - t.y);
    r.fire = d < range + ship.radius && Math.abs(r.err) < 0.2;
    return r;
  }
}
