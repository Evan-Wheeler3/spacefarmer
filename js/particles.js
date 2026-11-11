// Pooled particle system (struct-of-arrays) + floating damage numbers.
import { TAU, rand } from './util.js';

export const P_GLOW = 0, P_SPARK = 1, P_SMOKE = 2, P_DEBRIS = 3, P_RING = 4;

const glowCache = new Map();
export function glowSprite(color) {
  let c = glowCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.18, color);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(color, c);
  return c;
}

export class Particles {
  constructor(max = 5000) {
    this.max = max;
    this.n = 0;
    const F = Float32Array;
    this.x = new F(max); this.y = new F(max); this.vx = new F(max); this.vy = new F(max);
    this.life = new F(max); this.maxLife = new F(max); this.size = new F(max); this.drag = new F(max);
    this.rot = new F(max); this.vr = new F(max); this.grow = new F(max);
    this.type = new Uint8Array(max);
    this.color = new Array(max).fill('#fff');
  }
  spawn(type, x, y, vx, vy, life, size, color, drag = 0, grow = 0) {
    let i;
    if (this.n < this.max) i = this.n++;
    else i = (Math.random() * this.max) | 0; // recycle a random one when saturated
    this.type[i] = type; this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.color[i] = color;
    this.drag[i] = drag; this.grow[i] = grow; this.rot[i] = rand(0, TAU); this.vr[i] = rand(-8, 8);
    return i;
  }
  burst(x, y, count, color, speed = 200, life = 0.6, size = 3, type = P_SPARK, baseVx = 0, baseVy = 0) {
    for (let k = 0; k < count; k++) {
      const a = rand(0, TAU), s = rand(0.2, 1) * speed;
      this.spawn(type, x, y, baseVx + Math.cos(a) * s, baseVy + Math.sin(a) * s, life * rand(0.6, 1.2), size * rand(0.6, 1.3), color, 1.5);
    }
  }
  ring(x, y, radius, color, life = 0.5, width = 3) {
    this.spawn(P_RING, x, y, 0, 0, life, width, color, 0, radius);
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n; // swap-remove
        if (i !== j) {
          this.type[i] = this.type[j]; this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j];
          this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j]; this.size[i] = this.size[j]; this.color[i] = this.color[j];
          this.drag[i] = this.drag[j]; this.grow[i] = this.grow[j]; this.rot[i] = this.rot[j]; this.vr[i] = this.vr[j];
        }
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= d; this.vy[i] *= d;
      this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt;
      this.rot[i] += this.vr[i] * dt;
      i++;
    }
  }
  draw(ctx, view) {
    const { x0, y0, x1, y1 } = view;
    // normal-blend layer: smoke and debris
    for (let i = 0; i < this.n; i++) {
      const t = this.type[i];
      if (t !== P_SMOKE && t !== P_DEBRIS) continue;
      const x = this.x[i], y = this.y[i];
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const k = this.life[i] / this.maxLife[i];
      if (t === P_SMOKE) {
        const s = this.size[i] * (1 + (1 - k) * 2.5);
        ctx.globalAlpha = k * 0.35;
        ctx.fillStyle = this.color[i];
        ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill();
      } else {
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.fillStyle = this.color[i];
        ctx.save(); ctx.translate(x, y); ctx.rotate(this.rot[i]);
        const s = this.size[i];
        ctx.fillRect(-s / 2, -s / 2, s, s * 0.7);
        ctx.restore();
      }
    }
    // additive layer
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.n; i++) {
      const t = this.type[i];
      if (t === P_SMOKE || t === P_DEBRIS) continue;
      const x = this.x[i], y = this.y[i];
      const k = this.life[i] / this.maxLife[i];
      if (t === P_RING) {
        const r = this.grow[i] * (1 - k * k) + 4;
        if (x + r < x0 || x - r > x1 || y + r < y0 || y - r > y1) continue;
        ctx.globalAlpha = k;
        ctx.strokeStyle = this.color[i];
        ctx.lineWidth = this.size[i] * (0.5 + k);
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
        continue;
      }
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      ctx.globalAlpha = Math.min(1, k * 1.5);
      if (t === P_GLOW) {
        const s = this.size[i] * (0.5 + k * 0.8) * 4;
        ctx.drawImage(glowSprite(this.color[i]), x - s / 2, y - s / 2, s, s);
      } else {
        ctx.strokeStyle = this.color[i];
        ctx.lineWidth = this.size[i] * k + 0.5;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - this.vx[i] * 0.03, y - this.vy[i] * 0.03); ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}

// Floating numbers ("+12 Ferrite", "-34")
export class Floaters {
  constructor(max = 140) { this.list = []; this.max = max; this.pool = []; }
  add(x, y, text, color = '#fff', size = 14, vy = -50, life = 1.1) {
    // merge with a recent number at the same spot for readability
    for (const f of this.list) {
      if (f.merge && f.key === text.replace(/[\d.]+/, '#') && f.life > f.maxLife - 0.25 && Math.abs(f.x - x) < 30 && Math.abs(f.y - y) < 30) {
        const n = parseFloat(f.text.match(/[\d.]+/)) + parseFloat(text.match(/[\d.]+/));
        f.text = text.replace(/[\d.]+/, Math.round(n));
        f.life = f.maxLife; f.pop = 1;
        return;
      }
    }
    if (this.list.length >= this.max) this.list.shift();
    const f = this.pool.pop() || {};
    Object.assign(f, { x, y, text, color, size, vy, life, maxLife: life, pop: 1, merge: /\d/.test(text), key: text.replace(/[\d.]+/, '#') });
    this.list.push(f);
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.life -= dt; f.y += f.vy * dt; f.vy *= 1 - dt * 2; f.pop = Math.max(0, f.pop - dt * 6);
      if (f.life <= 0) { this.pool.push(f); this.list.splice(i, 1); }
    }
  }
  draw(ctx, zoom) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.list) {
      const k = Math.min(1, f.life / f.maxLife * 2);
      const s = (f.size * (1 + f.pop * 0.4)) / Math.max(0.6, zoom);
      ctx.globalAlpha = k;
      ctx.font = `700 ${s.toFixed(1)}px "Trebuchet MS", system-ui, sans-serif`;
      ctx.lineWidth = 3 / zoom;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }
}
