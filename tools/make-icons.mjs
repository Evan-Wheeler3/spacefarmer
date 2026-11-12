// Renders the home-screen icons (icons/*.png) from the game's own procedural part art.
import { launch } from './pw.mjs';
import fs from 'node:fs';
const { page, close } = await launch({ port: 8231 });
const out = await page.evaluate(async () => {
  const { drawPart } = await import('/js/render.js');
  const res = {};
  for (const size of [180, 192, 512]) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    const bg = g.createRadialGradient(size * 0.5, size * 0.42, size * 0.05, size * 0.5, size * 0.5, size * 0.75);
    bg.addColorStop(0, '#1b1140'); bg.addColorStop(1, '#04050c');
    g.fillStyle = bg; g.fillRect(0, 0, size, size);
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(255,255,255,' + (0.2 + Math.random() * 0.6) + ')'; g.fillRect(Math.random() * size, Math.random() * size, size / 256, size / 256); }
    const s = size * 0.16, cx = size / 2, cy = size * 0.47;
    const ship = [['laser', 0, -1, 0], ['hull', -1, 0, 0], ['core', 0, 0, 0], ['cargo', 1, 0, 0], ['thruster', -1, 1, 0], ['reactor', 0, 1, 0], ['thruster', 1, 1, 0]];
    // flames
    g.globalCompositeOperation = 'lighter';
    for (const x of [-1, 1]) {
      const bx = cx + x * s, by = cy + 1.5 * s;
      const grd = g.createLinearGradient(bx, by, bx, by + s * 1.3);
      grd.addColorStop(0, 'rgba(255,255,230,0.95)'); grd.addColorStop(0.35, 'rgba(255,160,40,0.8)'); grd.addColorStop(1, 'rgba(255,60,0,0)');
      g.fillStyle = grd; g.beginPath(); g.moveTo(bx - s * 0.3, by); g.lineTo(bx, by + s * 1.3); g.lineTo(bx + s * 0.3, by); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    for (const [p, x, y, r] of ship) drawPart(g, p, cx + x * s, cy + y * s, s, r);
    res[size] = c.toDataURL('image/png').split(',')[1];
  }
  return res;
});
for (const [size, b64] of Object.entries(out)) fs.writeFileSync(`icons/icon-${size}.png`, Buffer.from(b64, 'base64'));
console.log('icons written:', Object.keys(out).join(', '));
await close();
