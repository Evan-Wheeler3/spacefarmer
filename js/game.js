// Game shell: loop, states, and glue between world, ship, UI and save.
import { PRESETS, SECTORS } from './data.js';
import { Input } from './input.js';
import { Camera } from './camera.js';
import { World } from './world.js';
import { Ship } from './ship.js';
import { Design } from './shipdesign.js';
import { Starfield, drawShip } from './render.js';
import { drawFlightHud, edgeArrow } from './ui/hud.js';

const STEP = 1 / 60;

export class Game {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ui = ui;
    this.cam = new Camera();
    this.stars = new Starfield(SECTORS[0].bg, 7);
    this.time = 0;
    this.acc = 0;
    this.levels = {};
    this.settings = { telemetry: true };
    this.state = 'flight';
    this.fps = 60; this._fpsAcc = 0; this._fpsN = 0;
    Input.init(canvas);
    addEventListener('resize', () => this.resize());
    this.resize();
    this.presetKeys = Object.keys(PRESETS);
    this.loadTestShip('pebble');
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.W = innerWidth; this.H = innerHeight;
    this.canvas.width = Math.floor(this.W * dpr);
    this.canvas.height = Math.floor(this.H * dpr);
    this.cam.resize(this.W, this.H);
  }

  loadTestShip(id) {
    this.testShip = id;
    this.world = this.world || new World(0, this);
    const d = Design.fromPreset(PRESETS[id]);
    this.ship = new Ship(d, { torch: 1, fusion: 1, cracker: 1, railgun: 1, shields: 1, tractor: 1 });
    this.ship.x = 0; this.ship.y = 320; this.ship.angle = 0;
    this.cam.snap(this.ship.x, this.ship.y);
  }

  shake(a) { this.cam.shake(a); }
  sfx(name, p) { if (this.audio) this.audio.play(name, p); }

  start() {
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this._fpsAcc += dt; this._fpsN++;
      if (this._fpsAcc > 0.5) { this.fps = this._fpsN / this._fpsAcc; this._fpsAcc = 0; this._fpsN = 0; }
      Input.pollPad();
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 6) { this.update(STEP); this.acc -= STEP; steps++; }
      if (steps === 6) this.acc = 0;
      this.render();
      Input.endFrame();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  update(dt) {
    this.time += dt;
    const ship = this.ship;
    if (Input.hit('KeyT')) ship.assist = !ship.assist;
    if (Input.hit('F3')) this.settings.telemetry = !this.settings.telemetry;
    this.presetKeys.forEach((k, i) => { if (Input.hit('Digit' + (i + 1))) this.loadTestShip(k); });
    if (Input.hit('KeyR')) this.loadTestShip(this.testShip);
    if (Input.mouse.wheel) this.cam.userZoom = Math.max(0.5, Math.min(2, this.cam.userZoom * (Input.mouse.wheel > 0 ? 0.9 : 1.1)));
    ship.input = Input.flight();
    ship.update(dt, this.world);
    this.world.update(dt, ship);
    this.cam.follow(ship, dt);
  }

  render() {
    const { ctx, cam } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.stars.draw(ctx, this.W, this.H, cam.x, cam.y, cam.zoom);
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.setTransform(cam.zoom * this.dpr, 0, 0, cam.zoom * this.dpr, (this.W / 2 - (cam.x + cam.sx) * cam.zoom) * this.dpr, (this.H / 2 - (cam.y + cam.sy) * cam.zoom) * this.dpr);
    this.world.draw(ctx, cam, this.time);
    this.world.drawLasers(ctx, this.ship, this.time);
    if (!this.ship.dead) drawShip(ctx, this.ship, this.time);
    this.world.drawShield(ctx, this.ship, this.time);
    this.world.drawBullets(ctx, cam);
    this.world.particles.draw(ctx, cam.view(40));
    this.world.floaters.draw(ctx, cam.zoom);
    ctx.restore();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    drawFlightHud(ctx, this, this.W, this.H);
    edgeArrow(ctx, cam, this.world.station.x, this.world.station.y, '#7df9ff', 'OUTPOST');
    ctx.fillStyle = '#8796bd';
    ctx.font = '12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`FLIGHT SANDBOX — test ship: ${PRESETS[this.testShip].name}  [1-${this.presetKeys.length}] swap ship  [R] reset  [T] assist  ${this.fps.toFixed(0)} fps`, 16, 22);
    ctx.fillText('W/S thrust · A/D turn · Q/E strafe · Space fire', 16, 40);
  }
}
