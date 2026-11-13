// The planet: a disc of cubes stored in a flat grid. Mining removes cubes one
// at a time; rendering uses cached chunk canvases up close and a
// one-pixel-per-cube overview canvas when zoomed out.
import { ORES, PLANETGEN, PLANET_THEMES } from './data.js';
import { hexA, TAU, clamp } from './util.js';

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
    this.skin = new Uint8Array(this.N * this.N); // surface paint: 0 = bare rock, else 1 + biome
    this.theme = PLANET_THEMES[index % PLANET_THEMES.length];
    this.skinCols = this.theme.biomes.map((h) => parseInt(h.slice(1), 16));
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
    const th = this.theme;
    // fractal noise around the rim: continents and coastlines
    const fbm = (x, y, so) => noise(x, y, so) * 0.55 + noise(x * 2.1, y * 2.1, so + 1) * 0.28 + noise(x * 4.3, y * 4.3, so + 2) * 0.17;
    for (let j = 0; j < this.N; j++) for (let i = 0; i < this.N; i++) {
      const [x, y] = this.centerOf(i, j);
      const d = Math.hypot(x, y);
      const ang = Math.atan2(y, x);
      const edge = R * (1 + PLANETGEN.surfaceNoise * (noise(Math.cos(ang) * 3 + 10, Math.sin(ang) * 3 + 10, s) * 2 - 1) + 0.01 * (noise(ang * 12, 0.5, s + 3) - 0.5));
      if (d > edge) continue;
      // surface skin: a few cubes of soil, water or ice painted over the rock
      const depth = edge - d;
      const skinD = this.cell * (3 + 4 * noise(Math.cos(ang) * 9 + 3, Math.sin(ang) * 9 + 3, s + 5));
      if (depth < skinD) {
        const cx = Math.cos(ang) * 2.2 + 20, cy = Math.sin(ang) * 2.2 + 20;
        const land = fbm(cx, cy, s + 31);
        const lat = Math.abs(Math.sin(ang - th.tilt));
        const sea = 0.3 + th.sea * 0.42;  // fbm sits mostly in 0.3..0.72
        let b;
        if (lat > th.cap + (noise(ang * 8, 1, s + 9) - 0.5) * 0.08) b = 5;
        else if (land < sea) b = land < sea - 0.05 ? 0 : 1;
        else if (land > sea + 0.17) b = 3;
        else b = fbm(cx * 1.7, cy * 1.7, s + 41) > 0.56 ? 4 : 2;
        // water is a thin layer; deeper down it turns to wet rock (bare)
        if (b > 1 || depth < skinD * 0.6) this.skin[this.idx(i, j)] = b + 1;
      }
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
      const col = this.colorOf(k, m);
      const sh = 0.86 + hash2(k, 1, this.seed) * 0.22;
      img.data[k * 4] = Math.min(255, ((col >> 16) & 255) * sh);
      img.data[k * 4 + 1] = Math.min(255, ((col >> 8) & 255) * sh);
      img.data[k * 4 + 2] = Math.min(255, (col & 255) * sh);
      img.data[k * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.ov = cv; this.ovg = g;
  }

  colorOf(k, m) {
    const sk = this.skin[k];
    return sk ? this.skinCols[sk - 1] : parseInt(ORES[MATS[m]].color.slice(1), 16);
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
      let o = ORES[MATS[m]];
      const k = this.idx(i, j), sk = this.skin[k];
      if (sk) o = { color: '#' + this.skinCols[sk - 1].toString(16).padStart(6, '0'), glow: sk <= 2 ? '#bfe8ff' : '#ffffff' };
      const x = li * c, y = lj * c;
      const sh = (sk ? 0.9 : 0.82) + hash2(i, j, this.seed) * (sk ? 0.16 : 0.3);
      g.fillStyle = shade(o.color, sh);
      g.fillRect(x, y, c, c);
      // bevel: light top-left, dark bottom-right = reads as a cube
      g.fillStyle = 'rgba(255,255,255,0.13)'; g.fillRect(x, y, c, 2); g.fillRect(x, y, 2, c);
      g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x, y + c - 2, c, 2); g.fillRect(x + c - 2, y, 2, c);
      if (sk === 1 || sk === 2) { g.fillStyle = 'rgba(200,240,255,0.18)'; g.fillRect(x + 3, y + 5 + hash2(i, j, 3) * 6, c - 6, 1.5); }
      else if (sk === 4 || (sk === 3 && hash2(i, j, 5) > 0.7)) { g.fillStyle = 'rgba(10,40,10,0.35)'; g.fillRect(x + 4, y + 4, 4, 4); g.fillRect(x + 9, y + 8, 3, 3); }
      if (!sk && MATS[m] === PLANETGEN.layers.find((L) => L.vein === MATS[m])?.vein) { g.fillStyle = hexA(o.glow, 0.55); g.fillRect(x + c * 0.35, y + c * 0.35, c * 0.3, c * 0.3); }
      // exposed faces glow faintly so the mined edge is readable
      if (!this.matAt(i, j - 1)) { g.fillStyle = hexA(o.glow, 0.5); g.fillRect(x, y, c, 1.5); }
      if (!this.matAt(i, j + 1)) { g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x, y + c - 3, c, 3); }
      if (!this.matAt(i - 1, j)) { g.fillStyle = hexA(o.glow, 0.35); g.fillRect(x, y, 1.5, c); }
      if (!this.matAt(i + 1, j)) { g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(x + c - 3, y, 3, c); }
    }
  }

  // soft cloud texture (alpha only), generated once per planet
  buildClouds() {
    const M = Math.min(384, this.N), cv = document.createElement('canvas');
    cv.width = cv.height = M;
    const g = cv.getContext('2d'), img = g.createImageData(M, M);
    const [r, gg, b] = this.theme.clouds.split(',').map(Number), cover = this.theme.cloudCover, s = this.seed + 77;
    for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
      const u = x / M * 7, v = y / M * 7;
      // stretched sideways like weather bands
      const n = noise(u * 0.6, v * 1.6, s) * 0.5 + noise(u * 1.3, v * 3.1, s + 1) * 0.3 + noise(u * 3, v * 6, s + 2) * 0.2;
      const a = clamp((n - 0.62 + cover * 0.25) / 0.16, 0, 1);
      const k = (y * M + x) * 4;
      img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = a * a * 170;
    }
    g.putImageData(img, 0, 0);
    this.cloudCv = cv;
  }

  // what the planet's face looks like from space: continents, seas and ice caps
  // on a sphere. Only the far view uses it, masked by the cubes that are left.
  buildSurface() {
    const N = this.N, cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d'), img = g.createImageData(N, N);
    const th = this.theme, s = this.seed + this.index * 7919, rad = this.R / this.cell, c = N / 2;
    const fbm = (x, y, so) => noise(x, y, so) * 0.5 + noise(x * 2.1, y * 2.1, so + 1) * 0.27 + noise(x * 4.3, y * 4.3, so + 2) * 0.15 + noise(x * 9, y * 9, so + 3) * 0.08;
    const sea = 0.3 + th.sea * 0.42, ct = Math.cos(th.tilt), st = Math.sin(th.tilt);
    const cols = this.skinCols;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let nx = (x + 0.5 - c) / rad, ny = (y + 0.5 - c) / rad;
      const r2 = nx * nx + ny * ny;
      if (r2 > 1.1) continue;
      const rr = Math.min(0.999, Math.sqrt(r2));
      // tilt the globe, then map to latitude/longitude so features curve round the sphere
      const tx = nx * ct - ny * st, ty = nx * st + ny * ct;
      const lat = Math.asin(Math.max(-1, Math.min(1, ty * Math.min(1, 1 / Math.max(rr, 1e-6)) * rr)));
      const cl = Math.cos(lat) || 1e-6;
      const lon = Math.asin(Math.max(-1, Math.min(1, tx / cl)));
      const u = lon * 1.6 + 10, v = lat * 1.6 + 10;
      const land = fbm(u, v, s + 31);
      let b;
      if (Math.abs(Math.sin(lat)) > th.cap - 0.1 + (noise(u * 3, v * 3, s + 9) - 0.5) * 0.12) b = 5;
      else if (land < sea) b = land < sea - 0.05 ? 0 : 1;
      else if (land > sea + 0.17) b = 3;
      else b = fbm(u * 1.7, v * 1.7, s + 41) > 0.56 ? 4 : 2;
      const col = cols[b];
      const k = (y * N + x) * 4;
      const sh = (b <= 1 ? 0.92 + (land - sea) * 0.8 : 0.85 + noise(u * 12, v * 12, s + 5) * 0.25);
      img.data[k] = Math.min(255, ((col >> 16) & 255) * sh);
      img.data[k + 1] = Math.min(255, ((col >> 8) & 255) * sh);
      img.data[k + 2] = Math.min(255, (col & 255) * sh);
      img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.surfaceCv = cv;
  }

  // the planet as seen from afar: surface + rotating clouds + day/night shading, clipped to what's left
  composeGlobe(time) {
    if (!this.cloudCv) this.buildClouds();
    if (!this.surfaceCv) this.buildSurface();
    const N = this.N, cv = this.globe || (this.globe = document.createElement('canvas'));
    if (cv.width !== N) { cv.width = cv.height = N; }
    const g = cv.getContext('2d');
    // the surface painting, cut to the cubes that are left; mined holes show the rock beneath at the edges
    g.globalCompositeOperation = 'copy'; g.drawImage(this.ov, 0, 0);
    g.globalCompositeOperation = 'source-atop'; g.drawImage(this.surfaceCv, 0, 0);
    // clouds drift around the planet
    const c = N / 2, rad = this.R / this.cell;
    g.save(); g.translate(c, c); g.rotate(time * 0.004);
    g.drawImage(this.cloudCv, -rad * 1.1, -rad * 1.1, rad * 2.2, rad * 2.2);
    g.rotate(-time * 0.0065);
    g.globalAlpha = 0.45; g.drawImage(this.cloudCv, rad * 1.1, -rad * 1.1, -rad * 2.2, rad * 2.2); g.globalAlpha = 1;
    g.restore();
    this.shadeGlobe(g, c, c, rad, 0.75, true);
    g.globalCompositeOperation = 'source-over';
    return cv;
  }

  // sunlight from the upper left; night side and limb darkening
  shadeGlobe(g, cx, cy, rad, night, limb) {
    const lx = -0.55, ly = -0.83;
    const lin = g.createLinearGradient(cx + lx * rad, cy + ly * rad, cx - lx * rad, cy - ly * rad);
    lin.addColorStop(0, `rgba(255,250,235,${limb ? 0.1 : 0})`); lin.addColorStop(0.45, 'rgba(0,0,0,0)');
    lin.addColorStop(0.72, `rgba(0,4,20,${night * 0.6})`); lin.addColorStop(1, `rgba(0,2,12,${night})`);
    g.fillStyle = lin; g.beginPath(); g.arc(cx, cy, rad * 1.05, 0, TAU); g.fill();
    if (limb) {
      const rg = g.createRadialGradient(cx, cy, rad * 0.75, cx, cy, rad * 1.02);
      rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, `rgba(${this.theme.atmo},0.35)`);
      g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, rad * 1.05, 0, TAU); g.fill();
    }
  }

  draw(ctx, cam, time) {
    const R = this.R, atmo = this.theme.atmo;
    // atmosphere: thins out as the planet is mined away
    const air = 0.25 + 0.75 * (this.remaining / this.total);
    const grd = ctx.createRadialGradient(0, 0, R * 0.96, 0, 0, R * 1.2);
    grd.addColorStop(0, `rgba(${atmo},${0.3 * air})`); grd.addColorStop(0.25, `rgba(${atmo},${0.12 * air})`); grd.addColorStop(1, `rgba(${atmo},0)`);
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(0, 0, R * 1.2, 0, TAU); ctx.fill();
    const v = cam.view(40);
    // far away: the globe; up close: individual cubes; cross-fade in between
    const fade = typeof document === 'undefined' ? 0 : clamp((0.62 - cam.zoom) / 0.2, 0, 1);
    if (fade > 0) {
      const gl = this.composeGlobe(time);
      ctx.imageSmoothingEnabled = cam.zoom * this.cell < 3;
      if (fade < 1) this.drawChunks(ctx, cam, v);
      ctx.globalAlpha = fade;
      ctx.drawImage(gl, -this.half, -this.half, this.N * this.cell, this.N * this.cell);
      ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = true;
      return;
    }
    this.drawChunks(ctx, cam, v);
    // up close: gentle night side shading over the cubes
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R * 1.04, 0, TAU); ctx.clip();
    this.shadeGlobe(ctx, 0, 0, R, 0.4, false);
    ctx.restore();
    this.drawCracks(ctx, v);
  }

  drawChunks(ctx, cam, v) {
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
  }

  drawCracks(ctx, v) {
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
