// Procedural art: part icons, ship sprites, asteroids, starfield.
import { PARTS, PHYS, ORES } from './data.js';
import { TAU, rng, rand, hexA } from './util.js';
import { footprint, entryCells } from './shipdesign.js';

export const CAT_COLORS = {
  command: '#7df9ff', structure: '#9fb3c8', propulsion: '#ff9f1c', power: '#ffd60a',
  utility: '#2ee6a6', weapon: '#ff4d6d', defense: '#6aa8ff', doomsday: '#ff3cac',
};
export const partColor = (id) => CAT_COLORS[PARTS[id].cat];

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

// Draw a part with its footprint centered at (cx,cy); s = px per cell.
// opts: { hp: 0..1, alpha, glow, flash }
export function drawPart(g, id, cx, cy, s, rot = 0, opts = {}) {
  const def = PARTS[id];
  const col = CAT_COLORS[def.cat];
  const W = def.w * s, H = def.h * s;
  g.save();
  g.translate(cx, cy);
  g.rotate(rot * Math.PI / 2);
  g.globalAlpha = opts.alpha ?? 1;
  const x = -W / 2, y = -H / 2, pad = s * 0.06;
  // body
  const body = g.createLinearGradient(x, y, x + W, y + H);
  body.addColorStop(0, '#1d2740');
  body.addColorStop(1, '#0d1222');
  g.fillStyle = body;
  rr(g, x + pad, y + pad, W - pad * 2, H - pad * 2, s * 0.16);
  g.fill();
  if (opts.glow !== false) { g.shadowColor = col; g.shadowBlur = s * 0.35; }
  g.strokeStyle = col;
  g.lineWidth = Math.max(1, s * 0.07);
  g.stroke();
  g.shadowBlur = 0;
  g.lineWidth = Math.max(1, s * 0.06);
  const u = s / 16; // detail unit
  g.fillStyle = col; g.strokeStyle = col;
  switch (id) {
    case 'core': {
      const grd = g.createRadialGradient(0, -u, 0, 0, 0, s * 0.38);
      grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.4, col); grd.addColorStop(1, '#0a3a5a');
      g.fillStyle = grd;
      g.beginPath(); g.ellipse(0, -u * 0.5, s * 0.26, s * 0.32, 0, 0, TAU); g.fill();
      g.beginPath(); g.arc(0, 0, s * 0.4, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
      break;
    }
    case 'hull': {
      g.globalAlpha *= 0.8;
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { g.beginPath(); g.arc(a * s * 0.28, b * s * 0.28, u * 1.1, 0, TAU); g.fill(); }
      g.beginPath(); g.moveTo(-s * 0.3, 0); g.lineTo(s * 0.3, 0); g.stroke();
      break;
    }
    case 'armor': {
      g.lineWidth = u * 2.2;
      rr(g, x + s * 0.18, y + s * 0.18, W - s * 0.36, H - s * 0.36, u * 2); g.stroke();
      g.lineWidth = u * 1.2;
      g.beginPath();
      for (let k = -2; k <= 2; k++) { g.moveTo(k * u * 4 - u * 3, -s * 0.22); g.lineTo(k * u * 4 + u * 3, s * 0.22); }
      g.globalAlpha *= 0.5; g.stroke();
      break;
    }
    case 'thruster':
    case 'heavyThruster': {
      const big = id === 'heavyThruster';
      g.beginPath();
      g.moveTo(-W * 0.22, y + H * 0.2); g.lineTo(W * 0.22, y + H * 0.2);
      g.lineTo(W * 0.38, y + H - pad); g.lineTo(-W * 0.38, y + H - pad); g.closePath();
      g.globalAlpha *= 0.85; g.fill(); g.globalAlpha /= 0.85;
      g.fillStyle = '#2a1600';
      g.fillRect(-W * 0.28, y + H - pad - u * 3, W * 0.56, u * 2.5);
      g.fillStyle = col;
      g.beginPath(); g.moveTo(0, y + pad + u * 1.5); g.lineTo(u * 3, y + pad + u * 5); g.lineTo(-u * 3, y + pad + u * 5); g.closePath(); g.fill();
      if (big) { g.beginPath(); g.moveTo(-W * 0.3, 0); g.lineTo(W * 0.3, 0); g.stroke(); }
      break;
    }
    case 'gyro': {
      g.beginPath(); g.arc(0, 0, s * 0.3, 0, TAU); g.stroke();
      g.beginPath(); g.ellipse(0, 0, s * 0.3, s * 0.12, Math.PI / 4, 0, TAU); g.stroke();
      g.beginPath(); g.arc(0, 0, u * 2, 0, TAU); g.fill();
      break;
    }
    case 'reactor':
    case 'fusion': {
      const R = Math.min(W, H) * 0.32;
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, R);
      grd.addColorStop(0, '#fffbe0'); grd.addColorStop(0.5, col); grd.addColorStop(1, 'rgba(255,214,10,0.1)');
      g.fillStyle = grd;
      g.beginPath();
      for (let k = 0; k < 6; k++) { const a = k * TAU / 6 + Math.PI / 6; g.lineTo(Math.cos(a) * R, Math.sin(a) * R); }
      g.closePath(); g.fill();
      if (id === 'fusion') { g.beginPath(); g.arc(0, 0, R * 1.35, 0, TAU); g.stroke(); g.beginPath(); g.arc(0, 0, R * 1.55, 0.3, 2.5); g.stroke(); }
      break;
    }
    case 'battery': {
      g.strokeRect(-s * 0.22, -s * 0.28, s * 0.44, s * 0.56);
      g.fillRect(-u * 2, -s * 0.34, u * 4, u * 1.5);
      for (let k = 0; k < 3; k++) g.fillRect(-s * 0.15, s * 0.14 - k * s * 0.15, s * 0.3, s * 0.09);
      break;
    }
    case 'fuelTank': {
      rr(g, -s * 0.26, -s * 0.34, s * 0.52, s * 0.68, s * 0.24); g.stroke();
      g.globalAlpha *= 0.6;
      g.fillRect(-s * 0.26, -u, s * 0.52, u * 2);
      g.fillRect(-s * 0.26, -s * 0.2, s * 0.52, u * 1.4);
      break;
    }
    case 'cargo': {
      g.strokeRect(-s * 0.3, -s * 0.3, s * 0.6, s * 0.6);
      g.beginPath(); g.moveTo(-s * 0.3, -s * 0.3); g.lineTo(s * 0.3, s * 0.3); g.moveTo(s * 0.3, -s * 0.3); g.lineTo(-s * 0.3, s * 0.3); g.stroke();
      break;
    }
    case 'tractor': {
      for (let k = 1; k <= 3; k++) { g.beginPath(); g.arc(0, 0, k * s * 0.11, 0, TAU); g.globalAlpha *= 0.85; g.stroke(); }
      break;
    }
    case 'laser': {
      g.fillRect(-u * 2.5, y + pad, u * 5, s * 0.55);
      g.beginPath(); g.arc(0, s * 0.12, s * 0.22, 0, TAU); g.stroke();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(0, y + pad + u * 2, u * 1.5, 0, TAU); g.fill();
      break;
    }
    case 'turret': {
      g.beginPath(); g.arc(0, 0, s * 0.3, 0, TAU); g.stroke();
      g.beginPath(); g.arc(0, 0, s * 0.16, 0, TAU); g.globalAlpha *= 0.6; g.fill();
      break;
    }
    case 'railgun': {
      g.fillRect(-W * 0.32, y + pad, W * 0.14, H * 0.8);
      g.fillRect(W * 0.18, y + pad, W * 0.14, H * 0.8);
      g.globalAlpha *= 0.6;
      for (let k = 0; k < 4; k++) g.fillRect(-W * 0.18, y + H * 0.15 + k * H * 0.17, W * 0.36, u * 1.5);
      break;
    }
    case 'shield': {
      g.beginPath(); g.arc(0, s * 0.12, s * 0.3, Math.PI, 0); g.closePath(); g.stroke();
      g.globalAlpha *= 0.4; g.fill(); g.globalAlpha /= 0.4;
      g.beginPath(); g.arc(0, s * 0.12, s * 0.38, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      break;
    }
    case 'cracker': {
      const R = W * 0.36;
      g.beginPath(); g.arc(0, H * 0.06, R, 0, TAU); g.stroke();
      const grd = g.createRadialGradient(0, -H * 0.05, 0, 0, 0, R);
      grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.3, col); grd.addColorStop(1, 'rgba(80,0,60,0.2)');
      g.fillStyle = grd; g.beginPath(); g.arc(0, H * 0.06, R * 0.75, 0, TAU); g.fill();
      g.fillStyle = col;
      for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(sx * W * 0.08, y + pad); g.lineTo(sx * W * 0.3, y + H * 0.35); g.lineTo(sx * W * 0.2, y + H * 0.38); g.closePath(); g.fill(); }
      break;
    }
  }
  // damage overlay
  if (opts.hp !== undefined && opts.hp < 0.6) {
    g.globalAlpha = (opts.alpha ?? 1) * (0.6 - opts.hp) * 1.4;
    g.fillStyle = '#000';
    rr(g, x + pad, y + pad, W - pad * 2, H - pad * 2, s * 0.16); g.fill();
    g.strokeStyle = '#ff6a3d'; g.lineWidth = Math.max(1, u);
    g.beginPath(); g.moveTo(x + W * 0.2, y + H * 0.3); g.lineTo(x + W * 0.45, y + H * 0.5); g.lineTo(x + W * 0.38, y + H * 0.8); g.stroke();
  }
  if (opts.flash) {
    g.globalAlpha = opts.flash * 0.8;
    g.fillStyle = '#ffffff';
    rr(g, x + pad, y + pad, W - pad * 2, H - pad * 2, s * 0.16); g.fill();
  }
  g.restore();
}

// Cached ship sprite (rebuilt when ship.version changes)
export function shipSprite(ship) {
  if (ship._sprite && ship._spriteVer === ship.version) return ship._sprite;
  const SCALE = 2, C = PHYS.CELL;
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  for (const p of ship.parts) {
    if (!p.alive) continue;
    minx = Math.min(minx, p.gx - p.w / 2); maxx = Math.max(maxx, p.gx + p.w / 2);
    miny = Math.min(miny, p.gy - p.h / 2); maxy = Math.max(maxy, p.gy + p.h / 2);
  }
  if (minx > maxx) { minx = maxx = miny = maxy = 0; }
  const padCells = 0.6;
  const cw = Math.ceil((maxx - minx + padCells * 2) * C * SCALE), ch = Math.ceil((maxy - miny + padCells * 2) * C * SCALE);
  const cv = ship._sprite || document.createElement('canvas');
  cv.width = Math.max(4, cw); cv.height = Math.max(4, ch);
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  const ox = (-minx + padCells) * C * SCALE, oy = (-miny + padCells) * C * SCALE;
  // connecting frame under parts
  g.fillStyle = '#0b1020';
  for (const p of ship.parts) {
    if (!p.alive) continue;
    for (const [x, y] of entryCells(p.entry)) g.fillRect(ox + (x - 0.5) * C * SCALE - 1, oy + (y - 0.5) * C * SCALE - 1, C * SCALE + 2, C * SCALE + 2);
  }
  for (const p of ship.parts) {
    if (!p.alive) continue;
    drawPart(g, p.id, ox + p.gx * C * SCALE, oy + p.gy * C * SCALE, C * SCALE, p.rot, { hp: p.hp / p.maxHp });
  }
  ship._sprite = cv;
  ship._spriteVer = ship.version;
  ship._spriteOff = { x: ox / SCALE, y: oy / SCALE, scale: SCALE };
  return cv;
}

// Draw a ship in world space (ctx already in camera transform)
export function drawShip(ctx, ship, time) {
  const C = PHYS.CELL;
  const spr = shipSprite(ship);
  const off = ship._spriteOff;
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);
  ctx.translate(-ship.comX * C, -ship.comY * C);
  // thruster flames (behind the hull)
  ctx.globalCompositeOperation = 'lighter';
  for (const p of ship.parts) {
    if (!p.alive || !p.def.thrust || p.act < 0.02) continue;
    const big = p.id === 'heavyThruster';
    const L = (big ? 2.4 : 1.4) * C * p.act * (0.85 + Math.random() * 0.3);
    const bx = p.gx * C - p.dir[0] * (p.h * C) / 2, by = p.gy * C - p.dir[1] * (p.h * C) / 2;
    const W = (big ? 0.5 : 0.32) * C;
    const px = -p.dir[1], py = p.dir[0];
    const tx = bx - p.dir[0] * L, ty = by - p.dir[1] * L;
    const grd = ctx.createLinearGradient(bx, by, tx, ty);
    grd.addColorStop(0, 'rgba(255,255,230,0.95)'); grd.addColorStop(0.3, 'rgba(255,160,40,0.8)'); grd.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.moveTo(bx + px * W, by + py * W); ctx.lineTo(tx, ty); ctx.lineTo(bx - px * W, by - py * W); ctx.closePath(); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(spr, -off.x, -off.y, spr.width / off.scale, spr.height / off.scale);
  // dynamic bits: turret barrels, gyro spin, flashes
  for (const p of ship.parts) {
    if (!p.alive) continue;
    const x = p.gx * C, y = p.gy * C;
    if (p.def.weapon && !p.def.directional) {
      const a = p.aim - ship.angle;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = '#ffd0d8'; ctx.fillRect(0, -2, C * 0.62 - p.flash * 3, 4);
      ctx.fillStyle = CAT_COLORS.weapon; ctx.beginPath(); ctx.arc(0, 0, C * 0.18, 0, TAU); ctx.fill();
      ctx.restore();
    }
    if (p.def.torque && !p.def.core && ship.stats.gyroUse > 0.05) {
      ctx.strokeStyle = hexA(CAT_COLORS.propulsion, 0.6 * ship.stats.gyroUse);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, C * 0.36, time * 12, time * 12 + 2); ctx.stroke();
    }
    if (p.flash > 0) {
      ctx.globalAlpha = p.flash * 0.7; ctx.fillStyle = '#fff';
      ctx.fillRect(x - (p.w * C) / 2, y - (p.h * C) / 2, p.w * C, p.h * C);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------
// Asteroids
// ---------------------------------------------------------------------
export function makeAsteroidShape(r, seed) {
  const R = rng(seed);
  const n = 9 + Math.floor(r / 8);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const rad = r * R.range(0.78, 1.08);
    pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
  }
  return pts;
}

export function asteroidSprite(rock) {
  const r = rock.r, pad = 6;
  const cv = document.createElement('canvas');
  cv.width = cv.height = Math.ceil(r * 2.3 + pad * 2);
  const g = cv.getContext('2d');
  const c = cv.width / 2;
  const R = rng(rock.seed + 7);
  const ore = ORES[rock.ore];
  g.translate(c, c);
  g.beginPath();
  rock.shape.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  const grd = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r * 1.1);
  grd.addColorStop(0, '#5d5a63'); grd.addColorStop(0.6, '#34313d'); grd.addColorStop(1, '#1c1a24');
  g.fillStyle = grd;
  g.fill();
  g.save();
  g.clip();
  // craters
  for (let i = 0; i < 3 + r / 12; i++) {
    const x = R.range(-r, r) * 0.7, y = R.range(-r, r) * 0.7, cr = R.range(3, r * 0.25);
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.beginPath(); g.arc(x, y, cr, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.beginPath(); g.arc(x - cr * 0.25, y - cr * 0.25, cr * 0.7, 0, TAU); g.fill();
  }
  // ore veins
  g.strokeStyle = ore.color; g.lineWidth = 2; g.shadowColor = ore.glow; g.shadowBlur = 8;
  for (let i = 0; i < 2 + r / 18; i++) {
    let x = R.range(-r, r) * 0.6, y = R.range(-r, r) * 0.6;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += R.range(-8, 8); y += R.range(-8, 8); g.lineTo(x, y); }
    g.stroke();
  }
  for (let i = 0; i < 2 + r / 10; i++) {
    g.fillStyle = ore.glow;
    g.beginPath(); g.arc(R.range(-r, r) * 0.7, R.range(-r, r) * 0.7, R.range(1, 2.6), 0, TAU); g.fill();
  }
  g.restore();
  g.lineWidth = 1.5; g.strokeStyle = hexA(ore.glow, 0.45);
  g.beginPath(); rock.shape.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
  return cv;
}

// ---------------------------------------------------------------------
// Background: parallax star tiles + nebula
// ---------------------------------------------------------------------
export class Starfield {
  constructor(colors = ['#0a0f24', '#1b1140'], seed = 1) { this.setTheme(colors, seed); }
  setTheme(colors, seed = 1) {
    this.colors = colors;
    const R = rng(seed);
    // far layer: one opaque tile (backdrop + nebula + faint stars) = a single blit per frame
    const T = 1024;
    const far = document.createElement('canvas');
    far.width = far.height = T;
    const g = far.getContext('2d');
    g.fillStyle = '#04050c'; g.fillRect(0, 0, T, T);
    for (let i = 0; i < 9; i++) {
      const x = R() * T, y = R() * T, r = R.range(150, 420);
      const col = i % 2 ? colors[1] : colors[0];
      for (const dx of [-T, 0, T]) for (const dy of [-T, 0, T]) {
        const grd = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        grd.addColorStop(0, hexA(col, 0.55)); grd.addColorStop(1, hexA(col, 0));
        g.fillStyle = grd; g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
    for (let i = 0; i < 520; i++) {
      const x = R() * T, y = R() * T, sz = R.range(0.3, 1.1);
      g.globalAlpha = R.range(0.25, 0.9);
      g.fillStyle = R.pick(['#ffffff', '#cfe3ff', '#ffe9c4', '#c4d9ff']);
      g.beginPath(); g.arc(x, y, sz, 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
    this.far = far;
    // near layers: individual points, cheap to draw and properly parallaxed
    this.near = [0.18, 0.4].map((par, li) => ({
      par,
      stars: Array.from({ length: li ? 45 : 70 }, () => ({ x: R() * 512, y: R() * 512, s: R.range(0.8, 1.6) * (li + 1), a: R.range(0.4, 1), c: R.pick(['#ffffff', '#cfe3ff', '#ffe9c4']), sparkle: R() < 0.2 })),
    }));
  }
  draw(ctx, w, h, camx, camy, zoom) {
    const T = this.far.width;
    const ox = camx * 0.05, oy = camy * 0.05;
    const sx = -(((ox % T) + T) % T), sy = -(((oy % T) + T) % T);
    for (let x = sx; x < w; x += T) for (let y = sy; y < h; y += T) ctx.drawImage(this.far, x, y);
    for (const L of this.near) {
      const S = 512 * (0.8 + zoom * 0.3);
      const k = S / 512;
      const bx = -(((camx * L.par) % S) + S) % S, by = -(((camy * L.par) % S) + S) % S;
      for (const st of L.stars) {
        ctx.globalAlpha = st.a;
        ctx.fillStyle = st.c;
        for (let x = bx + st.x * k; x < w; x += S) for (let y = by + st.y * k; y < h; y += S) {
          ctx.fillRect(x, y, st.s, st.s);
          if (st.sparkle) { ctx.globalAlpha = st.a * 0.3; ctx.fillRect(x - st.s * 2, y + st.s / 2 - 0.3, st.s * 5, 0.6); ctx.fillRect(x + st.s / 2 - 0.3, y - st.s * 2, 0.6, st.s * 5); ctx.globalAlpha = st.a; }
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}
