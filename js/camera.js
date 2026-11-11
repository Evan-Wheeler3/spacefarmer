// Smooth follow camera with velocity look-ahead, speed zoom and shake.
import { CAMERA } from './data.js';
import { clamp, rand } from './util.js';

export class Camera {
  constructor() {
    this.x = 0; this.y = 0; this.zoom = CAMERA.zoom; this.userZoom = 1;
    this.shakeAmt = 0; this.sx = 0; this.sy = 0; this.w = 800; this.h = 600;
    this.override = null; // {x,y,zoom} for cinematics
  }
  resize(w, h) { this.w = w; this.h = h; }
  shake(a) { this.shakeAmt = Math.min(40, this.shakeAmt + a); }
  follow(target, dt) {
    let tx, ty, tz;
    if (this.override) { tx = this.override.x; ty = this.override.y; tz = this.override.zoom; }
    else {
      const sp = Math.hypot(target.vx, target.vy);
      tx = target.x + target.vx * CAMERA.lookAhead;
      ty = target.y + target.vy * CAMERA.lookAhead;
      const sizeZoom = clamp(70 / Math.max(40, target.radius || 40), 0.55, 1.1);
      tz = clamp(CAMERA.zoom * this.userZoom * sizeZoom / (1 + sp * CAMERA.speedZoomOut), CAMERA.minZoom, CAMERA.maxZoom);
      // scale for screen size so a 720p and 1440p screen show similar framing
      tz *= clamp(Math.min(this.w, this.h * 1.6) / 1100, 0.7, 1.6);
    }
    const k = 1 - Math.exp(-CAMERA.smoothing * dt);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
    this.zoom += (tz - this.zoom) * (1 - Math.exp(-2.5 * dt));
    this.shakeAmt *= Math.exp(-dt * 7);
    this.sx = rand(-1, 1) * this.shakeAmt; this.sy = rand(-1, 1) * this.shakeAmt;
  }
  snap(x, y) { this.x = x; this.y = y; }
  apply(ctx) {
    ctx.setTransform(this.zoom, 0, 0, this.zoom, this.w / 2 - (this.x + this.sx) * this.zoom, this.h / 2 - (this.y + this.sy) * this.zoom);
  }
  view(margin = 60) {
    const hw = this.w / 2 / this.zoom + margin, hh = this.h / 2 / this.zoom + margin;
    return { x0: this.x - hw, x1: this.x + hw, y0: this.y - hh, y1: this.y + hh };
  }
  toScreen(x, y) { return [(x - this.x - this.sx) * this.zoom + this.w / 2, (y - this.y - this.sy) * this.zoom + this.h / 2]; }
}
