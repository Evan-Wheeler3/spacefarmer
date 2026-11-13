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
    this.bans = [];  // { x, y, t }: spots given up on (wedged, unreachable); avoided for a while
    this.targetT = 0;
  }
  ban(p, t) { this.bans.push({ x: p.x, y: p.y, t, r: Math.max(140, (this.game.ship?.radius || 60) * 2.5) }); if (this.bans.length > 24) this.bans.shift(); }
  isBanned(x, y) { for (const b of this.bans) if ((b.x - x) ** 2 + (b.y - y) ** 2 < b.r * b.r) return true; return false; }
  reset() { this.mode = 'mine'; this.target = null; this.bans = []; }

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

  // choose where to dig: only cubes open to the sky (the first cube a ray from
  // space hits), so the dig is always a crater, never a cave, and the way in
  // from straight above is clear. Prefer shallow cubes near home that our tools
  // can cut; skip crevices too narrow for the ship. A small window around the
  // current spot is checked every time; the whole planet every few seconds.
  pickTarget(ship, world) {
    const pl = world.planet;
    const home = Math.atan2(world.station.y, world.station.x);
    if (this.theta == null) this.theta = home;
    const tier = this.bestTier(ship);
    const evalAt = (a) => {
      const sfc = pl.surfaceAt(a);
      if (!sfc || this.isBanned(sfc.x, sfc.y)) return null;
      const r = Math.hypot(sfc.x, sfc.y);
      let sc = r - Math.abs(angleDiff(home, a)) * pl.R * 0.2;
      if (ORES[pl.matName(pl.matAt(sfc.i, sfc.j))].tier > tier) sc -= pl.R * 4; // anything cuttable, anywhere, comes first
      // too narrow to fit? (both sides rise well above it within the ship's half-width)
      const hw = (ship.radius * 1.1) / Math.max(r, 150);
      const L = pl.surfaceAt(a - hw), Rt = pl.surfaceAt(a + hw);
      const rise = Math.min(L ? Math.hypot(L.x, L.y) - r : 0, Rt ? Math.hypot(Rt.x, Rt.y) - r : 0);
      if (rise > ship.radius * 0.5) sc -= pl.R * 0.8;
      return { i: sfc.i, j: sfc.j, x: sfc.x, y: sfc.y, a, sc, dir: [-Math.cos(a), -Math.sin(a)] };
    };
    let best = null;
    const step = pl.cell / pl.R;
    for (let k = -8; k <= 8; k++) {
      const c = evalAt(this.theta + k * step);
      if (c && (!best || c.sc - Math.abs(k) * 2 > best.sc)) best = c;
    }
    const now = world.time;
    if (!this.scan || now - this.scanT > 4 || this.scanTier !== tier || !best || best.sc < -pl.R * 0.5) {
      this.scanT = now; this.scanTier = tier; this.scan = null;
      for (let q = 0; q < 120; q++) {
        const c = evalAt(home + (q / 120) * TAU);
        if (c && (!this.scan || c.sc > this.scan.sc)) this.scan = c;
      }
    }
    if (this.scan && pl.matAt(this.scan.i, this.scan.j) && (!best || this.scan.sc > best.sc + pl.cell * 10)) { best = this.scan; this.scan = null; }
    // nothing open to the sky? (scattered leftovers) go for the nearest cube anywhere
    if (!best && now - (this.gridT || -9) > 3) {
      this.gridT = now;
      let bd = 1e18;
      const N = pl.N;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const m = pl.cells[j * N + i];
        if (!m) continue;
        const [x, y] = pl.centerOf(i, j);
        const d = (x - ship.x) ** 2 + (y - ship.y) ** 2 + (ORES[pl.matName(m)].tier > tier ? 1e12 : 0);
        if (d < bd && !this.isBanned(x, y)) { bd = d; const dl = Math.sqrt(d) || 1; best = { i, j, x, y, a: Math.atan2(y, x), sc: 0, dir: [(x - ship.x) / dl, (y - ship.y) / dl] }; }
      }
    }
    if (best) this.theta = best.a;
    this.targetT = 0;
    return best;
  }

  // the way to (tx, ty) is blocked by rock: a waypoint straight up out of the
  // pit, above the original surface. null if the way is clear (or we're already out).
  climbOut(ship, pl, tx, ty, force = false) {
    const r = Math.hypot(ship.x, ship.y) || 1;
    if (r > pl.R * 1.06) return null;
    if (!force) {
      const dx = tx - ship.x, dy = ty - ship.y, dl = Math.hypot(dx, dy);
      const hit = pl.raycast(ship.x, ship.y, dx / dl, dy / dl, dl);
      if (!hit || hit.t > dl - pl.cell) return null;
    }
    const k = (pl.R * 1.12) / r;
    return [ship.x * k, ship.y * k];
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
    } else if (now - this.wdT > 30) {
      this.ban(this.target || ship, now);
      this.target = null; this.scan = null; this.mode = 'home'; this.wdT = now;
    }
    if (this.mode === 'mine' && (full || ship.fuel < ship.fuelMax * 0.22 || !laser || g.idleLeft <= 0)) this.mode = 'home';
    if (this.mode === 'home') {
      const st = world.station;
      const w = this.climbOut(ship, world.planet, st.x, st.y);
      const r = w ? this.steer(ship, w[0], w[1], 0) : this.steer(ship, st.x, st.y, ECONOMY.dockRadius * 0.4);
      if (g.canDock) g.autoDock();
      return r;
    }
    const pl = world.planet;
    // give up on a target that's taking forever (wedged, or around a corner)
    this.targetT += 1 / 60;
    if (this.target && this.targetT > 25) {
      this.ban(this.target, world.time);
      this.target = null; this.scan = null;
    }
    if (this.bans.length) this.bans = this.bans.filter((b) => world.time - b.t < 240);
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
    if (dl > pl.cell * 2) {
      // sweep the hull's width, not just its centre line
      const ux = ddx / dl, uy = ddy / dl, w = ship.radius * 0.8;
      let hit = null;
      for (const o of [0, -w, w]) {
        const h = pl.raycast(ship.x - uy * o, ship.y + ux * o, ux, uy, dl);
        if (h && h.t > 0 && (!hit || h.t < hit.t)) hit = h;
      }
      if (depth < 2 && hit && !(hit.i === t.i && hit.j === t.j) && hit.t < dl - pl.cell) {
        // too hard to cut? climb out of the pit and come at it from above instead
        if (ORES[pl.matName(pl.matAt(hit.i, hit.j))].tier > this.bestTier(ship)) {
          const w = this.climbOut(ship, pl, px, py, true);
          return this.steer(ship, w[0], w[1], 0);
        }
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
