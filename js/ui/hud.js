// Canvas HUD for flight: status bars, damage diagram, radar, prompts.
import { PHYS, ORES } from '../data.js';
import { TAU, clamp, fmt, hexA } from '../util.js';
import { CAT_COLORS } from '../render.js';

export function bar(ctx, x, y, w, h, frac, col, label, value) {
  ctx.fillStyle = 'rgba(10,14,30,0.8)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = col;
  ctx.fillRect(x + 1, y + 1, (w - 2) * clamp(frac, 0, 1), h - 2);
  ctx.strokeStyle = hexA(col, 0.6);
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = '#e6eeff';
  ctx.font = '700 11px "Trebuchet MS", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(label, x + 6, y + h / 2 + 0.5);
  ctx.textAlign = 'right';
  ctx.fillText(value, x + w - 6, y + h / 2 + 0.5);
}

export function drawFlightHud(ctx, game, W, H) {
  const ship = game.ship;
  if (!ship) return;
  // keep clear of notches / the Dynamic Island (safe-area insets, CSS px)
  const sa = game.safe || { t: 0, r: 0, b: 0, l: 0 };
  const pad = 16 + sa.l, padR = 16 + sa.r;

  // ---- status bars (bottom-left)
  const touch = !!game.touch;
  const bw = touch ? 170 : 230, bh = touch ? 14 : 17;
  let y = H - 16 - sa.b - bh;
  const hullFrac = 1 - ship.damageFraction();
  const rows = [
    ['HULL', hullFrac, hullFrac > 0.5 ? '#2ee6a6' : hullFrac > 0.25 ? '#ffcf5a' : '#ff5d73', Math.round(hullFrac * 100) + '%'],
    ['FUEL', ship.fuelMax ? ship.fuel / ship.fuelMax : 0, ship.fuel < ship.fuelMax * 0.2 ? '#ff5d73' : '#ff9f1c', Math.ceil(ship.fuel) + ' / ' + ship.fuelMax],
    ['POWER', ship.energyMax ? ship.energy / ship.energyMax : 0, ship.powerFactor < 0.9 ? '#ff5d73' : '#ffd60a', Math.floor(ship.energy) + ' / ' + ship.energyMax],
    ['CARGO', ship.cargoMax ? ship.cargoUnits / ship.cargoMax : 0, '#c9a27a', Math.floor(ship.cargoUnits) + ' / ' + ship.cargoMax],
  ];
  if (ship.shieldMax > 0) rows.push(['SHIELD', ship.shield / ship.shieldMax, '#6aa8ff', Math.floor(ship.shield) + '']);
  if (touch) {
    // thumbs live at the bottom on phones: stack the bars under the credits instead
    y = 62 + sa.t;
    for (const r of rows) { bar(ctx, pad, y, bw, bh, r[1], r[2], r[0], r[3]); y += bh + 4; }
    y += 14;
  } else for (const r of rows) { bar(ctx, pad, y, bw, bh, r[1], r[2], r[0], r[3]); y -= bh + 5; }
  if (ship.fuel <= 0) warnText(ctx, pad, y - 6, 'OUT OF FUEL — core RCS only. [R] recall home', game.time);
  else if (ship.powerFactor < 0.5) warnText(ctx, pad, y - 6, 'BROWNOUT — systems underpowered', game.time);
  else if (ship.cargoUnits >= ship.cargoMax - 0.01 && ship.cargoMax > 0) warnText(ctx, pad, y - 6, 'CARGO FULL — dock at the outpost to sell', game.time, '#ffcf5a');

  // ---- damage diagram (bottom-left, right of bars)
  if (!touch) drawDamageDiagram(ctx, ship, pad + bw + 14, H - 16 - sa.b - 110, 110, 110);

  // ---- radar (top-right)
  const rs = touch ? Math.min(120, H * 0.28) : 170;
  drawRadar(ctx, game, W - padR - rs - (touch ? 44 : 0), 16 + sa.t, rs);

  // ---- telemetry (bottom-right)
  if (game.settings.telemetry) {
    const sp = Math.hypot(ship.vx, ship.vy);
    const lines = [
      ['SPEED', sp.toFixed(0) + ' px/s'],
      ['SPIN', (ship.av * 57.3).toFixed(0) + '°/s'],
      ['MASS', ship.mass.toFixed(1) + ' t'],
      ['COM', `${ship.comX.toFixed(2)}, ${ship.comY.toFixed(2)}`],
      ['THRUST TORQUE', fmt(ship.stats.thrustTorque)],
      ['GYRO LOAD', Math.round(ship.stats.gyroUse * 100) + '%'],
      ['ASSIST [T]', ship.assist ? 'ON' : 'OFF'],
    ];
    ctx.font = '700 11px "Trebuchet MS", sans-serif';
    const tx = W - padR - 200;
    let ty = H - 16 - sa.b - lines.length * 16;
    ctx.fillStyle = 'rgba(10,14,30,0.65)';
    ctx.fillRect(tx - 8, ty - 12, 208, lines.length * 16 + 8);
    for (const [k, v] of lines) {
      ctx.textAlign = 'left'; ctx.fillStyle = '#8796bd'; ctx.fillText(k, tx, ty);
      ctx.textAlign = 'right'; ctx.fillStyle = k.startsWith('GYRO') && ship.stats.gyroUse > 0.95 ? '#ff5d73' : '#dfe8ff'; ctx.fillText(v, tx + 192, ty);
      ty += 16;
    }
  }
}

function warnText(ctx, x, y, text, t, col = '#ff5d73') {
  ctx.globalAlpha = 0.6 + Math.sin(t * 8) * 0.4;
  ctx.fillStyle = col;
  ctx.font = '700 13px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
}

export function drawDamageDiagram(ctx, ship, x, y, w, h) {
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  for (const p of ship.parts) { minx = Math.min(minx, p.gx - p.w / 2); maxx = Math.max(maxx, p.gx + p.w / 2); miny = Math.min(miny, p.gy - p.h / 2); maxy = Math.max(maxy, p.gy + p.h / 2); }
  const s = Math.min(w / (maxx - minx), h / (maxy - miny), 14);
  const ox = x + w / 2 - ((minx + maxx) / 2) * s, oy = y + h / 2 - ((miny + maxy) / 2) * s;
  ctx.fillStyle = 'rgba(10,14,30,0.6)';
  ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
  for (const p of ship.parts) {
    const k = p.alive ? p.hp / p.maxHp : 0;
    ctx.fillStyle = !p.alive ? 'rgba(255,93,115,0.18)' : k > 0.66 ? hexA(CAT_COLORS[p.def.cat], 0.75) : k > 0.33 ? '#ffcf5a' : '#ff5d73';
    if (p.flash > 0) ctx.fillStyle = '#fff';
    ctx.fillRect(ox + (p.gx - p.w / 2) * s + 1, oy + (p.gy - p.h / 2) * s + 1, p.w * s - 2, p.h * s - 2);
  }
  // center of mass
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
  const cx = ox + ship.comX * s, cy = oy + ship.comY * s;
  ctx.beginPath(); ctx.arc(cx, cy, 3, 0, TAU); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.stroke();
}

export function drawRadar(ctx, game, x, y, size) {
  const ship = game.ship, world = game.world;
  const R = size / 2, cx = x + R, cy = y + R;
  const range = 2200, k = R / range;
  ctx.save();
  ctx.fillStyle = 'rgba(8,12,26,0.75)';
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(125,249,255,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.5, 0, TAU); ctx.strokeStyle = 'rgba(125,249,255,0.12)'; ctx.stroke();
  ctx.clip();
  const dot = (wx, wy, col, r) => {
    let dx = (wx - ship.x) * k, dy = (wy - ship.y) * k;
    const d = Math.hypot(dx, dy);
    let edge = false;
    if (d > R - 4) { dx *= (R - 4) / d; dy *= (R - 4) / d; edge = true; }
    ctx.fillStyle = col; ctx.globalAlpha = edge ? 0.7 : 1;
    ctx.beginPath(); ctx.arc(cx + dx, cy + dy, r, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  };
  for (const r of world.rocks) if (Math.abs(r.x - ship.x) < range && Math.abs(r.y - ship.y) < range) dot(r.x, r.y, hexA(ORES[r.ore].glow, 0.6), Math.max(1, r.r * k * 0.8));
  for (const p of world.pickups) if (Math.abs(p.x - ship.x) < range && Math.abs(p.y - ship.y) < range) dot(p.x, p.y, ORES[p.ore].glow, 1);
  for (const e of world.enemies) if (!e.dead) dot(e.x, e.y, e.boss ? '#ff3cac' : '#ff5d73', e.boss ? 5 : 2.5);
  const pl = game.planet && game.planet.p;
  if (pl && !pl.destroyed) dot(pl.x, pl.y, '#ff3cac', 7);
  dot(world.station.x, world.station.y, '#7df9ff', 4.5);
  // sector edge
  ctx.strokeStyle = 'rgba(255,80,120,0.4)';
  ctx.beginPath(); ctx.arc(cx - ship.x * k, cy - ship.y * k, world.sector.radius * k, 0, TAU); ctx.stroke();
  // ship arrow
  ctx.translate(cx, cy); ctx.rotate(ship.angle);
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// Arrow on the screen edge pointing at an off-screen world position
export function edgeArrow(ctx, cam, wx, wy, col, label) {
  const [sx, sy] = cam.toScreen(wx, wy);
  const W = cam.w, H = cam.h, m = 40 + Math.max(cam.safeX || 0, 0);
  if (sx > m && sx < W - m && sy > m && sy < H - m) return;
  const cx = W / 2, cy = H / 2;
  const a = Math.atan2(sy - cy, sx - cx);
  const t = Math.min((W / 2 - m) / Math.abs(Math.cos(a) || 1e-6), (H / 2 - m) / Math.abs(Math.sin(a) || 1e-6));
  const x = cx + Math.cos(a) * t, y = cy + Math.sin(a) * t;
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, -8); ctx.lineTo(-6, 8); ctx.closePath(); ctx.fill();
  ctx.restore();
  if (label) {
    ctx.fillStyle = col; ctx.font = '700 11px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(label, x - Math.cos(a) * 26, y - Math.sin(a) * 22);
  }
}
