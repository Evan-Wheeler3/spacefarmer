// Test autopilot used by automated playtests. It flies the real ship with the
// real physics: seek rock -> mine -> fly home -> dock. Not loaded by the game.
import { ECONOMY } from '../js/data.js';
import { angleDiff, clamp } from '../js/util.js';

export function install(game, opts = {}) {
  const st = { mode: 'seek', target: null, stuck: 0, log: [] };
  const fullAt = opts.fullAt ?? 0.92;

  function steer(ship, tx, ty, stop, face = null) {
    const dx = tx - ship.x, dy = ty - ship.y;
    const dist = Math.hypot(dx, dy);
    const accel = Math.max(30, (ship._apAccel || 100) * 0.55);
    const vmax = Math.min(420, Math.sqrt(2 * accel * Math.max(0, dist - stop)));
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
      fire: false, crack: false, dist, err,
    };
  }

  game.autopilot = (ship, world) => {
    const fwd = ship.parts.filter((p) => p.alive && p.def.thrust && p.dir[1] < 0).reduce((a, p) => a + p.def.thrust, 0);
    ship._apAccel = fwd / ship.mass;
    const laser = ship.parts.find((p) => p.alive && p.def.mining && !p.blocked);
    const range = laser ? laser.def.laserRange : 150;
    if (st.mode !== 'home' && (ship.cargoUnits >= ship.cargoMax * fullAt || ship.fuel < ship.fuelMax * 0.25 || !laser)) st.mode = 'home';
    if (st.mode === 'home') {
      const r = steer(ship, world.station.x, world.station.y, ECONOMY.dockRadius * 0.5);
      if (game.canDock) { st.mode = 'seek'; st.target = null; game.dock(); }
      return r;
    }
    if (!st.target || !world.rocks.includes(st.target)) {
      let best = null, bd = 1e18;
      for (const r of world.rocks) {
        const d = (r.x - ship.x) ** 2 + (r.y - ship.y) ** 2 - r.r * r.r * 40;
        if (d < bd) { bd = d; best = r; }
      }
      st.target = best;
      st.mode = 'seek';
    }
    const rock = st.target;
    if (!rock) return { thrust: 0, strafe: 0, turn: 0, fire: false };
    const ax = ship.x - rock.x, ay = ship.y - rock.y, ad = Math.hypot(ax, ay) || 1;
    const standoff = rock.r + range * 0.55 + ship.radius * 0.3;
    const px = rock.x + (ax / ad) * standoff, py = rock.y + (ay / ad) * standoff;
    const r = steer(ship, px, py, 4, [rock.x, rock.y]);
    // collect nearby pickups by drifting over them when the rock is gone or loot is close
    r.fire = ad < standoff + 60 && Math.abs(r.err) < 0.25;
    return r;
  };
  return st;
}

// Advance the game N seconds without rendering (fast headless simulation).
export function simulate(game, seconds, step = 1 / 60) {
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) {
    if (game.state === 'hangar' && game.onAutoHangar) game.onAutoHangar();
    game.update(step);
  }
}
