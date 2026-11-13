// The planet: a disc of cubes stored in a flat grid. Mining removes cubes one
// at a time; rendering uses cached chunk canvases up close and a
// one-pixel-per-cube overview canvas when zoomed out.
import { ORES, PLANETGEN } from './data.js';
import { rng, hexA, TAU } from './util.js';

export const MATS = ['', ...Object.keys(ORES).filter((k) => k !== 'core')];
const MAT_INDEX = Object.fromEntries(MATS.map((m, i) => [m, i]));
const CH = 32; // cells per chunk side

function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// smooth value noise in [0,1)
function noise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export class PlanetGrid {
  // index: which planet (0 = first); seed varies the layout
  constructor({ index = 0, seed = 1 } = {}) {
    this.index = index;
    this.seed = seed;
    this.cell = PLANETGEN.cell;
    this.R = Math.round(PLANETGEN.radius * Math.pow(PLANETGEN.growth, index));
    this.hpMult = Math.pow(PLANETGEN.hpGrowth, index);
    this.valueMult = Math.pow(PLANETGEN.valueGrowth, index);
    this.N = Math.ceil((this.R * 2.2) / this.cell);
    this.half = (this.N * this.cell) / 2;
    this.cells = new Uint8Array(this.N * this.N);
    this.dmg = new Map();           // partially mined cubes: index -> damage taken
    this.chunks = new Map();        // chunk key -> { cv, dirty, used }
    this.generate();
    this.buildOverview();
  }

  // ------------------------------------------------------------ geometry
  idx(i, j) { return j * this.N + i; }
  cellOf(wx, wy) { return [Math.floor((wx + this.half) / this.cell), Math.floor((wy + this.half) / this.cell)]; }
  centerOf(i, j) { return [(i + 0.5) * this.cell - this.half, (j + 0.5) * this.cell - this.half]; }
  matName(m) { return MATS[m]; }
  matAt(i, j) { return i < 0 || j < 0 || i >= this.N || j >= this.N ? 0 : this.cells[this.idx(i, j)]; }
  solidAt(wx, wy) { const [i, j] = this.cellOf(wx, wy); return this.matAt(i, j) > 0; }

  layerAt(d) { // d = distance / R
    for (const L of PLANETGEN.layers) if (d >= L.to) return L;
    return PLANETGEN.layers[PLANETGEN.layers.length - 1];
  }

  generate() {
    const R = this.R, s = this.seed + this.index * 7919;
    let total = 0;
    const craters = [];
    const rr = rng(s);
    for (let k = 0; k < 10; k++) { const a = rr() * TAU; craters.push([Math.cos(a) * R * rr.range(0.93, 1.02), Math.sin(a) * R * rr.range(0.93, 1.02), rr.range(60, 180)]); }
    for (let j = 0; j < this.N; j++) for (let i = 0; i < this.N; i++) {
      const [x, y] = this.centerOf(i, j);
      const d = Math.hypot(x, y);
      const ang = Math.atan2(y, x);
      const edge = R * (1 + PLANETGEN.surfaceNoise * (noise(Math.cos(ang) * 3 + 10, Math.sin(ang) * 3 + 10, s) * 2 - 1) + 0.01 * (noise(ang * 12, 0.5, s + 3) - 0.5));
      if (d > edge) continue;
      let cut = false;
      for (const [cx, cy, cr] of craters) if ((x - cx) ** 2 + (y - cy) ** 2 < cr * cr) { cut = true; break; }
      if (cut) continue;
      const L = this.layerAt(d / R);
      const n = noise(x / 90, y / 90, s + 11) * 0.65 + noise(x / 30, y / 30, s + 17) * 0.35;
      const mat = n > 1 - L.veinChance * 1.6 ? L.vein : L.base;
      this.cells[this.idx(i, j)] = MAT_INDEX[mat];
      total++;
    }
    this.total = total;
    this.remaining = total;
  }

  get percent() { return this.total ? (1 - this.remaining / this.total) * 100 : 0; }

  // ------------------------------------------------------- persistence
  // removed cubes as a base64 bitset over the generated layout
  exportRemoved() {
    const bits = new Uint8Array(Math.ceil((this.N * this.N) / 8));
    if (!this._orig) return '';
    for (let k = 0; k < this.cells.length; k++) if (this._orig[k] && !this.cells[k]) bits[k >> 3] |= 1 << (k & 7);
    let s = '';
    for (let k = 0; k < bits.length; k += 8192) s += String.fromCharCode.apply(null, bits.subarray(k, k + 8192));
    return btoa(s);
  }
  importRemoved(b64) {
    if (!b64) return;
    let bin;
    try { bin = atob(b64); } catch (e) { return; }
    for (let k = 0; k < this.cells.length; k++) {
      if (bin.charCodeAt(k >> 3) & (1 << (k & 7)) && this.cells[k]) { this.cells[k] = 0; this.remaining--; }
    }
    this.buildOverview();
    this.chunks.clear();
  }

  // --------------------------------------------------------------- mining
  hpOf(mat) { return ORES[MATS[mat]].hp * this.hpMult; }
  valueOf(mat) { return ORES[MATS[mat]].value * this.valueMult; }

  // apply laser damage; returns the material name if the cube came loose
  damage(i, j, amount, tier) {
    const k = this.idx(i, j);
    const m = this.cells[k];
    if (!m) return null;
    const o = ORES[MATS[m]];
    if (tier < o.tier) amount *= PLANETGEN.underTierDamage;
    const hp = this.hpOf(m);
    const d = (this.dmg.get(k) || 0) + amount;
    if (d < hp) { this.dmg.set(k, d); return null; }
    this.dmg.delete(k);
    this.remove(i, j);
    return MATS[m];
  }
  damageOf(i, j) { const k = this.idx(i, j); const m = this.cells[k]; return m ? (this.dmg.get(k) || 0) / this.hpOf(m) : 0; }

  remove(i, j) {
    const k = this.idx(i, j);
    if (!this.cells[k]) return;
    this.cells[k] = 0;
    this.remaining--;
    if (this.ov) this.ovg.clearRect(i, j, 1, 1);
    // mark this chunk (and neighbours whose edge shading changes) dirty
    for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = this.chunks.get(this.chunkKey(Math.floor((i + di) / CH), Math.floor((j + dj) / CH)));
      if (c) c.dirty = true;
    }
  }

  // Grid ray march (Amanatides & Woo). Returns { t, i, j } of the first solid cube.
  raycast(ox, oy, dx, dy, maxT) {
    const c = this.cell;
    let [i, j] = this.cellOf(ox, oy);
    if (this.matAt(i, j)) return { t: 0, i, j };
    const stepI = dx > 0 ? 1 : -1, stepJ = dy > 0 ? 1 : -1;
    const bx = (i + (dx > 0 ? 1 : 0)) * c - this.half, by = (j + (dy > 0 ? 1 : 0)) * c - this.half;
    let tMaxX = dx !== 0 ? (bx - ox) / dx : Infinity, tMaxY = dy !== 0 ? (by - oy) / dy : Infinity;
    const tDX = dx !== 0 ? c / Math.abs(dx) : Infinity, tDY = dy !== 0 ? c / Math.abs(dy) : Infinity;
    let t = 0;
    for (let n = 0; n < 4000; n++) {
      if (tMaxX < tMaxY) { t = tMaxX; tMaxX += tDX; i += stepI; } else { t = tMaxY; tMaxY += tDY; j += stepJ; }
      if (t > maxT) return null;
      if (i < 0 || j < 0 || i >= this.N || j >= this.N) return null;
      if (this.cells[this.idx(i, j)]) return { t, i, j };
    }
    return null;
  }

  // outward normal at a world point, from nearby empty space
  normalAt(wx, wy) {
    const [i, j] = this.cellOf(wx, wy);
    let nx = 0, ny = 0;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) if (!this.matAt(i + di, j + dj)) { nx += di; ny += dj; }
    const l = Math.hypot(nx, ny);
    if (l < 1e-6) { const d = Math.hypot(wx, wy) || 1; return [wx / d, wy / d]; }
    return [nx / l, ny / l];
  }

  // The surface point reached by marching inward from outside the planet at angle a
  surfaceAt(a) {
    const ox = Math.cos(a) * (this.R * 1.15), oy = Math.sin(a) * (this.R * 1.15);
    const h = this.raycast(ox, oy, -Math.cos(a), -Math.sin(a), this.R * 1.15);
    if (!h) return null;
    const [x, y] = this.centerOf(h.i, h.j);
    return { x, y, i: h.i, j: h.j, depth: 1 - Math.hypot(x, y) / this.R };
  }

  // nearest remaining cubes to a point (used offline and for the final collapse)
  removeNearest(x, y, n, onCube) {
    const [ci, cj] = this.cellOf(x, y);
    let removed = 0;
    for (let r = 0; r < this.N && removed < n; r++) {
      for (let dj = -r; dj <= r && removed < n; dj++) for (let di = -r; di <= r && removed < n; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di, j = cj + dj, m = this.matAt(i, j);
        if (!m) continue;
        this.remove(i, j); removed++;
        onCube && onCube(MATS[m]);
      }
    }
    return removed;
  }

  // --------------------------------------------------------------- render
  chunkKey(ci, cj) { return ci * 4096 + cj; }

  buildOverview() {
    if (typeof document === 'undefined') return; // headless (bot)
    if (!this._orig) this._orig = this.cells.slice();
    const cv = this.ov || document.createElement('canvas');
    cv.width = cv.height = this.N;
    const g = cv.getContext('2d');
    const img = g.createImageData(this.N, this.N);
    for (let k = 0; k < this.cells.length; k++) {
      const m = this.cells[k];
      if (!m) continue;
      const col = parseInt(ORES[MATS[m]].color.slice(1), 16);
      const sh = 0.8 + hash2(k, 1, this.seed) * 0.35;
      img.data[k * 4] = Math.min(255, ((col >> 16) & 255) * sh);
      img.data[k * 4 + 1] = Math.min(255, ((col >> 8) & 255) * sh);
      img.data[k * 4 + 2] = Math.min(255, (col & 255) * sh);
      img.data[k * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.ov = cv; this.ovg = g;
  }

  renderChunk(ci, cj, cv) {
    const c = this.cell, S = CH * c;
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, S, S);
    for (let lj = 0; lj < CH; lj++) for (let li = 0; li < CH; li++) {
      const i = ci * CH + li, j = cj * CH + lj;
      const m = this.matAt(i, j);
      if (!m) continue;
      const o = ORES[MATS[m]];
      const x = li * c, y = lj * c;
      const sh = 0.82 + hash2(i, j, this.seed) * 0.3;
      g.fillStyle = shade(o.color, sh);
      g.fillRect(x, y, c, c);
      // bevel: light top-left, dark bottom-right = reads as a cube
      g.fillStyle = 'rgba(255,255,255,0.13)'; g.fillRect(x, y, c, 2); g.fillRect(x, y, 2, c);
      g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x, y + c - 2, c, 2); g.fillRect(x + c - 2, y, 2, c);
      if (MATS[m] === PLANETGEN.layers.find((L) => L.vein === MATS[m])?.vein) { g.fillStyle = hexA(o.glow, 0.55); g.fillRect(x + c * 0.35, y + c * 0.35, c * 0.3, c * 0.3); }
      // exposed faces glow faintly so the mined edge is readable
      if (!this.matAt(i, j - 1)) { g.fillStyle = hexA(o.glow, 0.5); g.fillRect(x, y, c, 1.5); }
      if (!this.matAt(i, j + 1)) { g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x, y + c - 3, c, 3); }
      if (!this.matAt(i - 1, j)) { g.fillStyle = hexA(o.glow, 0.35); g.fillRect(x, y, 1.5, c); }
      if (!this.matAt(i + 1, j)) { g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(x + c - 3, y, 3, c); }
    }
  }

  draw(ctx, cam, time) {
    const R = this.R;
    // atmosphere
    const grd = ctx.createRadialGradient(0, 0, R * 0.92, 0, 0, R * 1.22);
    grd.addColorStop(0, 'rgba(120,170,255,0.18)'); grd.addColorStop(1, 'rgba(120,170,255,0)');
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(0, 0, R * 1.22, 0, TAU); ctx.fill();
    const v = cam.view(40);
    if (cam.zoom < 0.45) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.ov, -this.half, -this.half, this.N * this.cell, this.N * this.cell);
      ctx.imageSmoothingEnabled = true;
      return;
    }
    const S = CH * this.cell;
    const ci0 = Math.max(0, Math.floor((v.x0 + this.half) / S)), ci1 = Math.min(Math.ceil(this.N / CH) - 1, Math.floor((v.x1 + this.half) / S));
    const cj0 = Math.max(0, Math.floor((v.y0 + this.half) / S)), cj1 = Math.min(Math.ceil(this.N / CH) - 1, Math.floor((v.y1 + this.half) / S));
    let rebuilt = 0;
    const stamp = ++this._stamp || (this._stamp = 1);
    for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) {
      const k = this.chunkKey(ci, cj);
      let c = this.chunks.get(k);
      if (!c) { c = { cv: document.createElement('canvas'), dirty: true }; this.chunks.set(k, c); }
      if (c.dirty && rebuilt < 6) { this.renderChunk(ci, cj, c.cv); c.dirty = false; rebuilt++; }
      c.used = stamp;
      ctx.drawImage(c.cv, ci * S - this.half, cj * S - this.half);
    }
    // keep memory bounded
    if (this.chunks.size > 72) {
      const old = [...this.chunks.entries()].sort((a, b) => (a[1].used || 0) - (b[1].used || 0));
      for (let n = 0; n < this.chunks.size - 64; n++) { old[n][1].cv.width = 0; this.chunks.delete(old[n][0]); }
    }
    // cracks on cubes being cut
    ctx.strokeStyle = 'rgba(255,240,200,0.8)'; ctx.lineWidth = 1.5;
    for (const [k, d] of this.dmg) {
      const i = k % this.N, j = (k / this.N) | 0;
      const f = d / this.hpOf(this.cells[k] || 1);
      const [x, y] = this.centerOf(i, j);
      if (x < v.x0 || x > v.x1 || y < v.y0 || y > v.y1) continue;
      const h = this.cell * 0.45 * Math.min(1, f + 0.2);
      ctx.beginPath(); ctx.moveTo(x - h, y - h * 0.3); ctx.lineTo(x, y + h * 0.2); ctx.lineTo(x + h * 0.6, y - h); ctx.moveTo(x, y + h * 0.2); ctx.lineTo(x - h * 0.2, y + h); ctx.stroke();
    }
  }
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * k) | 0, g = Math.min(255, ((n >> 8) & 255) * k) | 0, b = Math.min(255, (n & 255) * k) | 0;
  return `rgb(${r},${g},${b})`;
}
