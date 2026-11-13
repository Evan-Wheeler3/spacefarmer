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
    this.banned = new Map();  // cube -> time it was given up on (couldn't reach it)
    this.targetT = 0;
  }
  reset() { this.mode = 'mine'; this.target = null; this.banned.clear(); }

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

  // choose where to dig. Near rock: cast a fan of rays from the ship; whatever
  // they hit is in plain view, so the ship can always fly straight at it.
  // Prefer shallow cubes near home that our tools can cut, so the dig widens
  // into a bowl and peels the planet layer by layer. Far from rock (or when
  // somewhere else is clearly better), use a coarse scan of the whole surface.
  pickTarget(ship, world) {
    const pl = world.planet;
    const home = Math.atan2(world.station.y, world.station.x);
    const tier = this.bestTier(ship);
    const value = (x, y, m) => {
      let sc = Math.hypot(x, y) - Math.abs(angleDiff(home, Math.atan2(y, x))) * pl.R * 0.2;
      if (ORES[m].tier > tier) sc -= pl.R * 4; // can't cut it properly yet: anything cuttable, anywhere, comes first
      return sc;
    };
    let best = null, bs = -1e18;
    const reach = 520, N = 56;
    for (let q = 0; q < N; q++) {
      const a = (q / N) * TAU, dx = Math.cos(a), dy = Math.sin(a);
      const hit = pl.raycast(ship.x, ship.y, dx, dy, reach);
      if (!hit || hit.t === 0 || this.banned.has(hit.i * 65536 + hit.j)) continue;
      const [x, y] = pl.centerOf(hit.i, hit.j);
      const sc = value(x, y, pl.matName(pl.matAt(hit.i, hit.j))) - hit.t * 0.15;
      if (sc > bs) { bs = sc; best = { i: hit.i, j: hit.j, x, y, dir: [dx, dy] }; }
    }
    const now = world.time;
    if (!this.scan || now - this.scanT > 4 || this.scanTier !== tier || bs < -pl.R * 2) {
      this.scanT = now; this.scanTier = tier; this.scan = null;
      let sb = -1e18;
      const n = 120;
      for (let q = 0; q < n; q++) {
        const a = home + (q / n) * TAU;
        const sfc = pl.surfaceAt(a);
        if (!sfc || this.banned.has(sfc.i * 65536 + sfc.j)) continue;
        const sc = value(sfc.x, sfc.y, pl.matName(pl.matAt(sfc.i, sfc.j)));
        if (sc > sb) { sb = sc; this.scan = { i: sfc.i, j: sfc.j, x: sfc.x, y: sfc.y, dir: null, sc }; }
      }
    }
    if (this.scan && pl.matAt(this.scan.i, this.scan.j) && (!best || this.scan.sc > bs + pl.cell * 10)) { best = this.scan; this.scan = null; }
    this.targetT = 0;
    return best;
  }

  // returns ship input
  drive(ship, world, depth = 0) {
    const g = this.game;
    const laser = ship.parts.find((p) => p.alive && p.def.mining && !p.blocked);
    const full = ship.cargoUnits >= ship.cargoMax * 0.95;
    if (ship.fuel < ship.fuelMax * 0.02 && g.towHome) { g.towHome(); return { thrust: 0, strafe: 0, turn: 0, fire: false }; }
    // watchdog: wedged somewhere? mining with nothing to show for it, or a trip home going nowhere
    const now = world.time, mined = g.save ? g.save.stats.oreMined : 0;
    if (mined !== this.wdMined || this.mode !== this.wdMode) { this.wdMined = mined; this.wdMode = this.mode; this.wdT = now; this.wdDist = 1e9; }
    if (this.mode === 'home') {
      const d = Math.hypot(ship.x - world.station.x, ship.y - world.station.y);
      if (d < this.wdDist - 40) { this.wdDist = d; this.wdT = now; }
      if (now - this.wdT > 30 && g.towHome) { g.towHome(); this.wdT = now; return { thrust: 0, strafe: 0, turn: 0, fire: false }; }
    } else if (now - this.wdT > 40) {
      if (this.target) this.banned.set(this.target.i * 65536 + this.target.j, now);
      this.target = null; this.scan = null; this.mode = 'home'; this.wdT = now;
    }
    if (this.mode === 'mine' && (full || ship.fuel < ship.fuelMax * 0.22 || !laser || g.idleLeft <= 0)) this.mode = 'home';
    if (this.mode === 'home') {
      const st = world.station;
      const r = this.steer(ship, st.x, st.y, ECONOMY.dockRadius * 0.4);
      if (g.canDock) g.autoDock();
      return r;
    }
    const pl = world.planet;
    // give up on a target that's taking forever (wedged, or around a corner)
    this.targetT += 1 / 60;
    if (this.target && this.targetT > 25) {
      this.banned.set(this.target.i * 65536 + this.target.j, world.time);
      this.target = null; this.scan = null;
    }
    if (this.banned.size) for (const [k, t] of this.banned) if (world.time - t > 90) this.banned.delete(k);
    if (!this.target || !pl.matAt(this.target.i, this.target.j)) this.target = this.pickTarget(ship, world);
    const t = this.target;
    if (!t) { this.mode = 'home'; return { thrust: 0, strafe: 0, turn: 0, fire: false }; }
    // approach back along the ray that found it, or from straight above
    const [nx, ny] = t.dir ? [-t.dir[0], -t.dir[1]] : pl.normalAt(t.x, t.y);
    const range = Math.max(...ship.parts.filter((p) => p.alive && p.def.mining && !p.blocked).map((p) => p.def.laserRange));
    const standoff = range * 0.55 + ship.radius * 0.45;
    let px = t.x + nx * standoff, py = t.y + ny * standoff;
    // rock in the way? it's a mining ship: cut through it
    const ddx = px - ship.x, ddy = py - ship.y, dl = Math.hypot(ddx, ddy);
    if (dl > ship.radius) {
      const hit = pl.raycast(ship.x, ship.y, ddx / dl, ddy / dl, dl);
      if (depth < 2 && hit && !(hit.i === t.i && hit.j === t.j) && hit.t < dl - pl.cell) {
        const [hx, hy] = pl.centerOf(hit.i, hit.j);
        this.target = { i: hit.i, j: hit.j, x: hx, y: hy, dir: [ddx / dl, ddy / dl] };
        return this.drive(ship, world, depth + 1);
      }
    }
    const r = this.steer(ship, px, py, 6, [t.x, t.y]);
    const d = Math.hypot(ship.x - t.x, ship.y - t.y);
    r.fire = d < range + ship.radius && Math.abs(r.err) < 0.2;
    return r;
  }
}
