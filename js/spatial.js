// Uniform spatial hash, rebuilt every frame. Objects need x, y, radius.
export class SpatialHash {
  constructor(cell = 160) {
    this.cell = cell;
    this.buckets = new Map();
    this.used = [];
    this.stamp = 0;
  }
  clear() {
    for (const b of this.used) b.length = 0;
    this.used.length = 0;
  }
  _key(ix, iy) { return (ix + 32768) * 65536 + (iy + 32768); }
  insert(o) {
    const c = this.cell, r = o.radius || 0;
    const x0 = Math.floor((o.x - r) / c), x1 = Math.floor((o.x + r) / c);
    const y0 = Math.floor((o.y - r) / c), y1 = Math.floor((o.y + r) / c);
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
      const k = this._key(ix, iy);
      let b = this.buckets.get(k);
      if (!b) { b = []; this.buckets.set(k, b); }
      if (b.length === 0) this.used.push(b);
      b.push(o);
    }
  }
  // calls fn(o) once per object overlapping the query circle's bounding box
  query(x, y, r, fn) {
    const c = this.cell;
    const stamp = ++this.stamp;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
      const b = this.buckets.get(this._key(ix, iy));
      if (!b) continue;
      for (let i = 0; i < b.length; i++) {
        const o = b[i];
        if (o._qs === stamp) continue;
        o._qs = stamp;
        if (fn(o) === false) return;
      }
    }
  }
}
