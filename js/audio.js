// All sound is synthesized with WebAudio: one-shot effects, engine/laser loops,
// and a small generative soundtrack that intensifies in combat.
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Audio {
  constructor() {
    this.ctx = null;
    this.last = {};
    this.volume = 0.7;
    this.musicVol = 0.5;
    this.intensity = 0;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 6;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.comp); this.comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.8; this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = this.musicVol * 0.5; this.music.connect(this.master);
    // shared noise buffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // a cheap echo for big moments
    this.echo = ctx.createDelay(1); this.echo.delayTime.value = 0.28;
    const fb = ctx.createGain(); fb.gain.value = 0.35;
    this.echo.connect(fb); fb.connect(this.echo); this.echo.connect(this.sfx);
    this.makeLoops();
    this.startMusic();
  }

  setVolume(v, m) {
    this.volume = v; this.musicVol = m;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    this.music.gain.setTargetAtTime(m * 0.5 * (this._musicDuck ? 0.25 : 1), this.ctx.currentTime, 0.1);
  }
  duck(on) { if (this.ctx) this.sfx.gain.setTargetAtTime(on ? 0.15 : 0.8, this.ctx.currentTime, 0.1); }
  duckMusic(on) { this._musicDuck = on; this.setVolume(this.volume, this.musicVol); }

  // ------------------------------------------------------------ helpers
  osc(type, f0, f1, t0, dur, vol, dest = this.sfx, curve = 'exp') {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) curve === 'exp' ? o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur) : o.frequency.linearRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.01, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.02);
    return o;
  }
  noise(t0, dur, vol, f0, f1 = f0, type = 'lowpass', q = 1, dest = this.sfx) {
    const c = this.ctx, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0, Math.random()); src.stop(t0 + dur + 0.05);
  }

  play(name, p = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const gap = { shoot: 0.045, hit: 0.03, enemyShoot: 0.06, chunk: 0.05, pickup: 0.04, coin: 0.05, bump: 0.08, shield: 0.08, zap: 0.1, explode: 0.04, place: 0.03, steal: 0.3, missile: 0.15, pop: 0.05 }[name] ?? 0.02;
    if (this.last[name] && t - this.last[name] < gap) return;
    this.last[name] = t;
    const s = this.sfx;
    switch (name) {
      case 'click': this.osc('sine', 1100, 900, t, 0.04, 0.12); break;
      case 'rotate': this.osc('triangle', 600, 820, t, 0.06, 0.12); break;
      case 'place': { const f = 240 / Math.sqrt(Math.max(0.5, p)); this.osc('sine', f * 1.6, f * 0.7, t, 0.09, 0.4); this.noise(t, 0.04, 0.25, 3000, 1500, 'bandpass', 2); this.osc('triangle', 1400, 1400, t + 0.02, 0.05, 0.07); break; }
      case 'remove': this.osc('triangle', 520, 180, t, 0.09, 0.2); this.noise(t, 0.05, 0.12, 1500, 500); break;
      case 'undo': this.osc('sine', 700, 500, t, 0.05, 0.12); this.osc('sine', 500, 350, t + 0.05, 0.05, 0.1); break;
      case 'denied': this.osc('square', 150, 140, t, 0.08, 0.12); this.osc('square', 120, 110, t + 0.1, 0.12, 0.12); break;
      case 'purchase':
      case 'upgrade': [60, 64, 67, 72, 76].forEach((n, i) => this.osc('triangle', NOTE(n + 12), NOTE(n + 12), t + i * 0.06, 0.25, 0.16)); this.noise(t + 0.25, 0.4, 0.06, 8000, 12000, 'highpass'); break;
      case 'sell': this.osc('square', NOTE(88), NOTE(88), t, 0.08, 0.08); this.osc('sine', NOTE(93), NOTE(93), t + 0.08, 0.5, 0.18); this.noise(t, 0.3, 0.1, 9000, 6000, 'highpass'); this.osc('sine', NOTE(100), NOTE(100), t + 0.16, 0.4, 0.08); break;
      case 'coin': this.osc('sine', 1900 + Math.random() * 600, 2600, t, 0.07, 0.07); break;
      case 'repair': for (let i = 0; i < 5; i++) { this.noise(t + i * 0.07, 0.04, 0.15, 4000, 2000, 'bandpass', 4); } this.osc('sawtooth', 200, 600, t, 0.4, 0.05); break;
      case 'launch': this.noise(t, 1.1, 0.35, 300, 3000, 'bandpass', 1.2); this.osc('sawtooth', 70, 140, t, 1, 0.08); break;
      case 'dock': this.osc('sine', 500, 180, t, 0.3, 0.2); this.noise(t + 0.25, 0.15, 0.4, 800, 200); this.osc('sine', 90, 60, t + 0.25, 0.25, 0.4); break;
      case 'jump': this.noise(t, 1.4, 0.4, 100, 6000, 'bandpass', 2); this.osc('sawtooth', 50, 900, t, 1.2, 0.1); this.osc('sine', 900, 60, t + 1.1, 0.5, 0.3); break;
      case 'pickup': { const f = 700 + Math.log2(1 + p) * 160; this.osc('sine', f, f * 1.5, t, 0.08, 0.1); break; }
      case 'chunk': this.noise(t, 0.05, 0.12, 2500, 800, 'bandpass', 3); break;
      case 'rockBreak': { const d = 0.25 + Math.min(0.6, p / 100); this.noise(t, d, 0.6, 1800, 120); this.osc('sine', 120, 40, t, d, 0.5); break; }
      case 'bump': { const v = Math.min(0.6, p / 400); this.osc('sine', 110, 45, t, 0.18, v + 0.05); this.noise(t, 0.08, v * 0.6, 900, 200); break; }
      case 'shoot': this.osc('square', 820, 260, t, 0.05, 0.07); this.noise(t, 0.03, 0.08, 5000, 2000, 'highpass'); break;
      case 'rail': this.osc('sawtooth', 1600, 60, t, 0.35, 0.3); this.noise(t, 0.4, 0.5, 6000, 300, 'lowpass'); this.osc('sine', 60, 30, t, 0.4, 0.5); break;
      case 'enemyShoot': this.osc('triangle', 520, 220, t, 0.08, 0.06); break;
      case 'hit': this.noise(t, 0.04, 0.12, 3500, 1500, 'bandpass', 2); break;
      case 'pop': this.osc('sine', 900, 300, t, 0.06, 0.12); break;
      case 'explode': { const d = 0.35 + Math.min(0.4, p / 60); this.noise(t, d, 0.55, 2400, 90); this.osc('sine', 140, 35, t, d, 0.5); break; }
      case 'bigBoom': this.noise(t, 1.6, 0.9, 3000, 50); this.osc('sine', 90, 25, t, 1.5, 0.8); this.noise(t, 1.2, 0.3, 800, 100, 'lowpass', 1, this.echo); break;
      case 'planetBoom':
        this.noise(t, 5, 1, 5000, 30); this.osc('sine', 70, 18, t, 5, 1); this.osc('sawtooth', 45, 20, t, 3, 0.3);
        this.noise(t, 3, 0.5, 1200, 60, 'lowpass', 1, this.echo);
        [48, 52, 55, 60].forEach((n, i) => this.osc('triangle', NOTE(n), NOTE(n), t + 1.5 + i * 0.25, 3, 0.08));
        break;
      case 'crackerFire': this.osc('sawtooth', 60, 1200, t, 3.4, 0.18, s, 'lin'); this.noise(t, 3.6, 0.35, 200, 8000, 'bandpass', 3); break;
      case 'partLost': this.noise(t, 0.3, 0.5, 1600, 200, 'bandpass', 1.5); this.osc('square', 220, 70, t, 0.25, 0.15); break;
      case 'shield': this.osc('sine', 340, 260, t, 0.12, 0.12); this.osc('sine', 680, 520, t, 0.1, 0.05); break;
      case 'warning': [0, 0.22].forEach((d) => { this.osc('square', 880, 880, t + d, 0.12, 0.07); this.osc('square', 660, 660, t + d + 0.11, 0.1, 0.07); }); break;
      case 'bossWarn': for (let i = 0; i < 3; i++) this.osc('sawtooth', 110, 220, t + i * 0.55, 0.5, 0.18, s, 'lin'); this.osc('sine', 55, 40, t, 1.6, 0.4); break;
      case 'victory': [60, 64, 67, 72, 67, 72, 76, 79].forEach((n, i) => this.osc('triangle', NOTE(n + 12), NOTE(n + 12), t + i * 0.09, 0.4, 0.14)); this.osc('sine', NOTE(48), NOTE(48), t, 1.2, 0.2); break;
      case 'zap': this.noise(t, 0.12, 0.25, 7000, 2000, 'bandpass', 5); this.osc('sawtooth', 2000, 400, t, 0.1, 0.05); break;
      case 'steal': this.osc('sine', 600, 150, t, 0.3, 0.12); break;
      case 'missile': this.noise(t, 0.4, 0.15, 800, 3000, 'bandpass', 3); break;
      case 'charge': this.osc('sawtooth', 200, 900, t, 0.9, 0.08, s, 'lin'); break;
    }
  }

  // --------------------------------------------------------- loops
  makeLoops() {
    const c = this.ctx;
    // engine: filtered noise
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    this.engF = c.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 300;
    this.engG = c.createGain(); this.engG.gain.value = 0;
    src.connect(this.engF); this.engF.connect(this.engG); this.engG.connect(this.sfx); src.start();
    // laser hum
    const lo = c.createOscillator(); lo.type = 'sawtooth'; lo.frequency.value = 96;
    const lo2 = c.createOscillator(); lo2.type = 'square'; lo2.frequency.value = 192.7;
    this.lasF = c.createBiquadFilter(); this.lasF.type = 'bandpass'; this.lasF.frequency.value = 900; this.lasF.Q.value = 2;
    this.lasG = c.createGain(); this.lasG.gain.value = 0;
    lo.connect(this.lasF); lo2.connect(this.lasF); this.lasF.connect(this.lasG); this.lasG.connect(this.sfx); lo.start(); lo2.start();
    // cracker / recall charge tone
    this.chgO = c.createOscillator(); this.chgO.type = 'sawtooth'; this.chgO.frequency.value = 80;
    this.chgG = c.createGain(); this.chgG.gain.value = 0;
    const chgF = c.createBiquadFilter(); chgF.type = 'lowpass'; chgF.frequency.value = 1800;
    this.chgO.connect(chgF); chgF.connect(this.chgG); this.chgG.connect(this.sfx); this.chgO.start();
  }

  update(game) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const ship = game.ship;
    const flying = game.state === 'flight' && ship && !ship.dead;
    let thrust = 0, laser = 0;
    if (flying) {
      for (const p of ship.parts) {
        if (!p.alive) continue;
        if (p.def.thrust) thrust += p.act * (p.def.thrust / 1150);
        if (p.def.mining && p.firing) laser = 1;
      }
    }
    const th = Math.min(1, thrust / 3);
    this.engG.gain.setTargetAtTime(th * 0.35, t, 0.05);
    this.engF.frequency.setTargetAtTime(180 + th * 700, t, 0.08);
    this.lasG.gain.setTargetAtTime(laser * 0.06, t, 0.03);
    this.lasF.frequency.setTargetAtTime(800 + Math.sin(t * 13) * 200, t, 0.02);
    const chg = flying ? (game.recall ? game.recall / 2 : 0) : game.state === 'watch' && game.fighter.ship ? game.fighter.ship.crackCharge : 0;
    this.chgG.gain.setTargetAtTime(chg > 0.01 ? 0.05 + chg * 0.08 : 0, t, 0.05);
    this.chgO.frequency.setTargetAtTime(80 + chg * 700, t, 0.05);
    // combat intensity for the music
    let target = 0;
    const f = game.fighter;
    if (game.state === 'watch' && f && f.world && f.ship) {
      for (const e of f.world.enemies) if (!e.dead && Math.hypot(e.x, e.y) < 1300) { target = e.boss ? 1 : Math.max(target, 0.6); }
    }
    this.intensity += (target - this.intensity) * 0.02;
  }

  // ---------------------------------------------------------- music
  startMusic() {
    const c = this.ctx;
    this.beat = 0;
    this.nextT = c.currentTime + 0.2;
    // A minor-ish progression
    this.chords = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]];
    this.scale = [57, 60, 62, 64, 67, 69, 72, 74, 76];
    const tick = () => {
      if (!this.ctx) return;
      while (this.nextT < c.currentTime + 0.25) { this.scheduleBeat(this.nextT); this.nextT += 60 / 84 / 2; this.beat++; }
    };
    this.musicTimer = setInterval(tick, 60);
  }
  scheduleBeat(t) {
    const m = this.music;
    const step = this.beat % 64;
    const chord = this.chords[Math.floor(step / 16) % 4];
    if (step % 16 === 0) {
      // pad
      for (const n of chord) {
        for (const det of [-6, 6]) {
          const o = this.ctx.createOscillator(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
          o.type = 'sawtooth'; o.frequency.value = NOTE(n - 12); o.detune.value = det;
          f.type = 'lowpass'; f.frequency.value = 700;
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03, t + 1.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 11);
          o.connect(f); f.connect(g); g.connect(m); o.start(t); o.stop(t + 11.2);
        }
      }
      this.osc('sine', NOTE(chord[0] - 24), NOTE(chord[0] - 24), t, 5, 0.12, m);
    }
    // sparse plucks
    if (step % 2 === 0 && Math.random() < 0.38) {
      const n = this.scale[Math.floor(Math.random() * this.scale.length)] + 12;
      this.osc('triangle', NOTE(n), NOTE(n), t, 0.6, 0.035, m);
      this.osc('sine', NOTE(n), NOTE(n), t + 0.36, 0.5, 0.012, m);
    }
    // combat layer: driving bass + hats
    const I = this.intensity;
    if (I > 0.1) {
      if (step % 2 === 0) this.osc('square', NOTE(chord[0] - 24), NOTE(chord[0] - 24), t, 0.18, 0.05 * I, m);
      if (step % 2 === 1) this.noise(t, 0.05, 0.05 * I, 9000, 7000, 'highpass', 1, m);
      if (step % 8 === 0) { this.osc('sine', 120, 40, t, 0.25, 0.18 * I, m); }
      if (step % 8 === 4 && I > 0.8) this.noise(t, 0.15, 0.12 * I, 2000, 800, 'bandpass', 1, m);
    }
  }
}
