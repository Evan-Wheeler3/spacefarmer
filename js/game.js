// Game shell: loop, states, and glue between world, ship, UI and save.
import { PRESETS, SECTORS, ECONOMY, PARTS, FLAVOR, ORES } from './data.js';
import { Input } from './input.js';
import { Camera } from './camera.js';
import { World } from './world.js';
import { Ship } from './ship.js';
import { Design, analyze } from './shipdesign.js';
import { Starfield, drawShip } from './render.js';
import { drawFlightHud, edgeArrow } from './ui/hud.js';
import { Hangar } from './ui/hangar.js';
import { el, toast, popEl, modal } from './ui/dom.js';
import { loadSave, newSave, writeSave, wipeSave } from './save.js';
import { sellValue, offlineEarnings, droneIncomePerMinute, sectorUnlocked } from './economy.js';
import { money, fmt, pick, clamp, TAU } from './util.js';
import { P_GLOW } from './particles.js';
import { EnemySystem } from './enemies.js';
import { PlanetSystem } from './planet.js';
import { renderResearch, renderStarMap, goalCard } from './ui/research.js';
import { Tutorial } from './ui/tutorial.js';
import { Audio } from './audio.js';

const STEP = 1 / 60;

export class Game {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ui = ui;
    this.cam = new Camera();
    this.time = 0;
    this.acc = 0;
    this.state = 'title';
    this.fps = 60; this._fpsAcc = 0; this._fpsN = 0;
    this.systems = [];       // optional subsystems: { update(dt), draw(ctx), hud(ctx), onLaunch(), onDock() }
    this.save = loadSave();
    this.settings = this.save ? this.save.settings : newSave().settings;
    this.hangar = new Hangar(this);
    this.enemySystem = new EnemySystem(this);
    this.planetSystem = new PlanetSystem(this);
    this.tutorial = new Tutorial(this);
    this.systems.push(this.enemySystem, this.planetSystem, this.tutorial);
    this.audio = new Audio();
    const unlock = () => { this.audio.unlock(); this.audio.setVolume(this.settings.volume, this.settings.music); };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
    this.hangar.addTab('research', 'Research', (c) => renderResearch(this, c), 'shipyard');
    this.hangar.addTab('map', 'Star Map', (c) => renderStarMap(this, c), 'research');
    this.goalCard = () => goalCard(this);
    this.stars = new Starfield(SECTORS[this.save ? this.save.sector : 0].bg, 7);
    Input.init(canvas);
    addEventListener('resize', () => this.resize());
    addEventListener('beforeunload', () => this.persist());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.persist(); });
    addEventListener('keydown', (e) => this.onKey(e));
    this.resize();
  }

  get levels() { return this.save ? this.save.upgrades : {}; }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.W = innerWidth; this.H = innerHeight;
    this.canvas.width = Math.floor(this.W * dpr);
    this.canvas.height = Math.floor(this.H * dpr);
    this.cam.resize(this.W, this.H);
  }

  shake(a) { this.cam.shake(a * (this.settings.shake ?? 1)); }
  sfx(name, p) { if (this.audio) this.audio.play(name, p); }
  applySettings() { this.audio && this.audio.setVolume(this.settings.volume, this.settings.music); this.persist(); }

  // ------------------------------------------------------------- save
  persist() {
    if (!this.save) return;
    if (this.state === 'flight' && this.ship && !this.ship.dead) this.stashShip();
    writeSave(this.save);
  }
  stashShip() {
    // capture flight state into the save without docking
    this.save.design = this.ship.writeBack(Design.fromJSON(this.save.design)).toJSON();
    this.save.cargo = { ...this.ship.cargo };
    this.save.cargoUnits = this.ship.cargoUnits;
  }
  wipe() { wipeSave(); location.reload(); }

  addCredits(n, fromEl) {
    this.save.credits += n;
    if (n > 0) { this.save.stats.earned += n; }
    this.hangar.updateCredits();
    if (fromEl && this.hangar.creditsEl) this.coinFly(fromEl, this.hangar.creditsEl, Math.min(16, 4 + Math.floor(Math.log10(Math.max(10, n)) * 3)));
  }
  coinFly(fromEl, toEl, n) {
    const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      const c = el('div', { class: 'coin' }, '¢');
      c.style.left = a.left + a.width / 2 + (Math.random() - 0.5) * a.width * 0.6 + 'px';
      c.style.top = a.top + a.height / 2 + 'px';
      this.ui.append(c);
      setTimeout(() => {
        c.style.transform = `translate(${b.left + b.width / 2 - parseFloat(c.style.left)}px, ${b.top + b.height / 2 - parseFloat(c.style.top)}px) scale(0.6)`;
        c.style.opacity = '0.2';
      }, 20 + i * 35);
      setTimeout(() => { c.remove(); if (i % 3 === 0) this.sfx('coin'); }, 650 + i * 35);
    }
  }

  repairCost(design) {
    let total = 0, damaged = 0;
    for (const e of design.entries) {
      const hp = e.hp == null ? 1 : e.hp;
      if (hp >= 1) continue;
      damaged++;
      const cost = PARTS[e.part].cost || 60;
      total += hp === 0 ? cost * ECONOMY.destroyedPartRepairFactor : cost * (1 - hp) * ECONOMY.repairCostFactor;
    }
    return { total: Math.ceil(total), damaged };
  }

  repair() {
    const d = Design.fromJSON(this.save.design);
    if (!d.damaged()) return;
    let spent = 0;
    // fix the core first, then wrecks, then the most damaged
    const order = d.entries.slice().sort((a, b) => (PARTS[b.part].core ? 1 : 0) - (PARTS[a.part].core ? 1 : 0) || (a.hp ?? 1) - (b.hp ?? 1));
    for (const e of order) {
      const hp = e.hp ?? 1;
      if (hp >= 1) continue;
      const cost = PARTS[e.part].cost || 60;
      const price = Math.ceil(hp === 0 ? cost * ECONOMY.destroyedPartRepairFactor : cost * (1 - hp) * ECONOMY.repairCostFactor);
      if (price > this.save.credits - spent) {
        if (hp > 0) { // partial patch-up
          const afford = this.save.credits - spent;
          const frac = afford / (cost * ECONOMY.repairCostFactor);
          e.hp = Math.min(1, hp + frac); spent += afford;
        }
        break;
      }
      spent += price; e.hp = 1;
    }
    if (spent <= 0) { toast('Not enough credits for repairs', 'bad'); this.sfx('denied'); return; }
    this.save.credits -= spent;
    this.save.design = d.toJSON();
    this.sfx('repair');
    toast(`Repairs complete: ${money(spent)}`, 'good');
    this.persist();
    this.hangar.updateCredits();
    this.hangar.refresh();
    this.hangar.updateLaunch();
  }

  onDesignChanged() { this.hangar.updateCredits(); this.hangar.updateLaunch(); this.persist(); }

  // ----------------------------------------------------------- states
  boot() {
    this.titleWorld = new World(this.save ? this.save.sector : 0, this, 99);
    this.showTitle();
    this.start();
  }

  showTitle() {
    this.state = 'title';
    this.clearOverlays();
    const has = !!this.save;
    const t = el('div', { class: 'title' },
      el('div', { class: 'title-logo' }, 'SPACE FARMER'),
      el('div', { class: 'title-tag' }, 'Mine rocks. Bolt on guns. Eventually, delete a planet.'),
      el('div', { class: 'title-btns' },
        has ? el('button', { class: 'btn primary big-btn', onclick: () => this.continueGame() }, 'CONTINUE') : '',
        el('button', { class: 'btn big-btn' + (has ? '' : ' primary'), onclick: () => {
          if (has && !confirm('Start over? Your current save will be replaced.')) return;
          this.newGame();
        } }, 'NEW GAME')),
      has ? el('div', { class: 'dim' }, `${money(this.save.credits)} · ${SECTORS[this.save.sector].name} · ${this.save.planetsDestroyed} planet(s) destroyed`) : '',
      el('div', { class: 'title-help dim' }, 'W/S thrust · A/D turn · Q/E strafe · Space mine/fire · F dock · Esc pause'));
    this.overlay = t;
    this.ui.append(t);
  }

  clearOverlays() {
    document.body.classList.remove('flying');
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
    this.hangar.close();
  }

  newGame() {
    this.save = newSave();
    this.settings = this.save.settings;
    this.persist();
    this.audio && this.audio.unlock();
    this.lastTrip = null;
    this.enterHangar('market');
    this.launch();
  }

  continueGame() {
    this.audio && this.audio.unlock();
    // idle drones earned money while you were away
    const away = (Date.now() - (this.save.lastSeen || Date.now())) / 1000;
    const earned = offlineEarnings(this.save.upgrades, away);
    this.enterHangar('market');
    if (earned > 0) {
      this.addCredits(earned);
      modal('Welcome back', el('p', {}, `Your drones kept working while you were away and banked `, el('span', { class: 'money' }, money(earned)), '. They did not take a lunch break. You should probably talk to them about that.'), [{ label: 'Nice', cls: 'primary' }]);
    }
  }

  enterHangar(tab) {
    this.state = 'hangar';
    this.clearOverlays();
    this.stars.setTheme(SECTORS[this.save.sector].bg, 7 + this.save.sector);
    if (!this.world || this.world.sectorIndex !== this.save.sector) this.world = new World(this.save.sector, this, 1234 + this.save.sector);
    this.hangar.open(tab);
    for (const s of this.systems) s.onHangar && s.onHangar();
    this.persist();
  }

  jump(i) {
    if (!sectorUnlocked(i, this.save)) return;
    this.save.sector = i;
    this.world = new World(i, this, 1234 + i);
    this.sfx('jump');
    toast(`Jumped to ${SECTORS[i].name}`, 'good');
    this.enterHangar('map');
  }

  launch() {
    const design = Design.fromJSON(this.save.design);
    const a = analyze(design, this.save.upgrades);
    if (!a.launchable) { toast(a.warnings.find((w) => w.lvl === 'err')?.text || 'Not flightworthy', 'bad'); this.sfx('denied'); return; }
    this.clearOverlays();
    if (!this.world || this.world.sectorIndex !== this.save.sector) this.world = new World(this.save.sector, this, 1234 + this.save.sector);
    const ship = new Ship(design, this.save.upgrades);
    // carry over unsold cargo
    for (const k in this.save.cargo || {}) ship.addOre(k, this.save.cargo[k]);
    ship.recomputeMass(true);
    ship.x = 0; ship.y = -this.world.station.r - 70 - ship.radius; ship.vy = -90; ship.angle = 0;
    this.ship = ship;
    this.cam.snap(ship.x, ship.y);
    this.state = 'flight';
    document.body.classList.add('flying');
    this.trip = { time: 0, ore: 0, kills: 0, bounty: 0, refuel: 0 };
    this.recall = 0;
    this.recallAuto = false;
    this.dyingT = 0;
    this.world.particles.ring(ship.x, ship.y + 30, 120, '#7df9ff', 0.5, 3);
    this.sfx('launch');
    for (const s of this.systems) s.onLaunch && s.onLaunch();
  }

  dock(viaRecall = false) {
    const ship = this.ship;
    this.stashShip();
    // refuel
    const need = ship.fuelMax - ship.fuel;
    const cost = Math.ceil(need * ECONOMY.refuelCostPerUnit);
    const paid = Math.min(cost, this.save.credits);
    this.save.credits -= paid;
    this.trip.refuel = paid;
    this.lastTrip = this.trip;
    this.sfx('dock');
    for (const s of this.systems) s.onDock && s.onDock();
    this.enterHangar('market');
    toast(viaRecall ? 'Recalled to the outpost' : pick(FLAVOR.docks));
  }

  onShipDestroyed() {
    this.save.stats.deaths++;
    this.dyingT = 2.8;
  }

  finishDeath() {
    // lose cargo, keep the wreck state; insurance rebuilds the core for free
    const d = this.ship.writeBack(Design.fromJSON(this.save.design));
    for (const e of d.entries) if (PARTS[e.part].core) e.hp = 1;
    this.save.design = d.toJSON();
    this.save.cargo = {}; this.save.cargoUnits = 0;
    this.lastTrip = this.trip;
    for (const s of this.systems) s.onDock && s.onDock(true);
    this.enterHangar('market');
    modal('Ship destroyed', el('div', {}, el('p', {}, pick(FLAVOR.deaths)),
      el('p', { class: 'dim' }, 'Your cargo is now space debris. Insurance rebuilt the Command Core; everything else is in the condition you left it. Repairs are available here at the Market.')), [{ label: 'Understood', cls: 'primary' }]);
  }

  // ------------------------------------------------- world event hooks
  onOreCollected(type, n) {
    this.save.stats.oreMined += n;
    this.trip.ore += n;
    for (const s of this.systems) s.onOre && s.onOre(type, n);
  }
  onRockDestroyed() { this.save.stats.rocks++; }

  // ------------------------------------------------------------ loop
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
      this.render(dt);
      Input.endFrame();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.code === 'Escape') {
      if (document.querySelector('.modal-back')) { document.querySelector('.modal-back').remove(); return; }
      if (this.state === 'flight') this.pause();
      else if (this.state === 'paused') this.resume();
    }
    if (e.code === 'Enter' && this.state === 'hangar' && !document.querySelector('.modal-back') && this.hangar.tab !== 'shipyard') this.launch();
    if (e.code === 'Enter' && this.state === 'hangar' && this.hangar.tab === 'shipyard' && e.ctrlKey) this.launch();
  }

  pause() {
    this.state = 'paused';
    this.persist();
    const p = el('div', { class: 'pause' }, el('h1', {}, 'PAUSED'),
      el('button', { class: 'btn primary big-btn', onclick: () => this.resume() }, 'Resume'),
      el('button', { class: 'btn big-btn', onclick: () => { this.resume(); this.recallAuto = true; } }, 'Recall to outpost'),
      el('button', { class: 'btn big-btn', onclick: () => { this.persist(); this.overlay = null; p.remove(); this.ship = null; this.showTitle(); } }, 'Save & quit to title'),
      el('div', { class: 'dim' }, 'Progress autosaves continuously.'));
    this.overlay = p;
    this.ui.append(p);
    this.audio && this.audio.duck(true);
  }
  resume() {
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
    this.state = 'flight';
    this.audio && this.audio.duck(false);
  }

  update(dt) {
    this.time += dt;
    if (this.save && this.state !== 'title') {
      this.save.stats.playTime += dt;
      const dpm = droneIncomePerMinute(this.save.upgrades);
      if (dpm > 0 && this.state !== 'paused') {
        this._drone = (this._drone || 0) + (dpm / 60) * dt;
        if (this._drone >= 1) { const n = Math.floor(this._drone); this._drone -= n; this.save.credits += n; this.save.stats.earned += n; if (this.state === 'hangar' && Math.random() < 0.02) this.hangar.updateCredits(); }
      }
    }
    if (this.state === 'title') {
      this.titleWorld.update(dt, null);
      this.cam.override = { x: Math.cos(this.time * 0.05) * 900, y: Math.sin(this.time * 0.05) * 900, zoom: 0.8 };
      this.cam.follow({ x: 0, y: 0, vx: 0, vy: 0 }, dt);
      return;
    }
    this.cam.override = null;
    if (this.state === 'hangar') {
      this.hangar.builder.update(dt);
      this.cam.follow({ x: 0, y: 0, vx: 0, vy: 0, radius: 200 }, dt);
      this._autosave = (this._autosave || 0) + dt;
      for (const s of this.systems) s.updateDocked && s.updateDocked(dt);
      return;
    }
    if (this.state !== 'flight' && this.state !== 'cinematic') return;
    if (this.state === 'flight' && document.querySelector('.modal-back')) return; // dialogs pause flight
    const ship = this.ship;
    this.trip.time += dt;

    if (this.state === 'flight') {
      if (Input.hit('KeyT')) { ship.assist = !ship.assist; toast('Flight assist ' + (ship.assist ? 'ON' : 'OFF — pure Newtonian. Good luck.')); }
      if (Input.hit('F3')) { this.settings.telemetry = !this.settings.telemetry; }
      if (Input.hit('KeyM')) { this.settings.volume = this.settings.volume > 0 ? 0 : 0.7; this.applySettings(); toast(this.settings.volume ? 'Sound on' : 'Sound muted'); }
      if (Input.mouse.wheel) this.cam.userZoom = clamp(this.cam.userZoom * (Input.mouse.wheel > 0 ? 0.9 : 1.1), 0.5, 2);
      ship.input = ship.dead ? { thrust: 0, strafe: 0, turn: 0 } : this.autopilot ? this.autopilot(ship, this.world) : Input.flight();
      // docking
      const dSt = Math.hypot(ship.x - this.world.station.x, ship.y - this.world.station.y);
      this.canDock = !ship.dead && dSt < ECONOMY.dockRadius + ship.radius && Math.hypot(ship.vx, ship.vy) < ECONOMY.dockMaxSpeed;
      if (this.canDock && (Input.hit('KeyF') || Input.padPressed.has(1))) { this.dock(); return; }
      // recall: hold R (or chosen from the pause menu)
      if (!ship.dead) {
        if (Input.down('KeyR') || this.recallAuto) {
          this.recall += dt;
          if (this.recall >= 2) { this.world.particles.ring(ship.x, ship.y, 200, '#7df9ff', 0.5, 4); this.dock(true); return; }
        } else this.recall = Math.max(0, this.recall - dt * 3);
      }
    }
    // brief slow motion for big moments
    let sdt = dt;
    if (this.slowmo > 0) { this.slowmo -= dt; sdt = dt * 0.3; }
    ship.update(sdt, this.world);
    this.world.update(sdt, ship);
    for (const s of this.systems) s.update && s.update(sdt);
    if (ship.dead && this.dyingT > 0) { this.dyingT -= dt; if (this.dyingT <= 0) { this.finishDeath(); return; } }
    // pull the camera back when enemies are close so fights stay readable
    let near = 1e9;
    for (const e of this.world.enemies) if (!e.dead && e.type !== 'missile') near = Math.min(near, Math.hypot(e.x - ship.x, e.y - ship.y) - (e.boss ? e.radius * 2 : 0));
    this.cam.combat = near < 900 ? clamp(380 / Math.max(380, near), 0.62, 1) : 1;
    this.cam.follow(ship, dt);
    this._autosave = (this._autosave || 0) + dt;
    if (this._autosave > 15) { this._autosave = 0; this.persist(); }
  }

  render(dt) {
    const { ctx, cam } = this;
    this.audio.update(this);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.stars.draw(ctx, this.W, this.H, cam.x, cam.y, cam.zoom);
    const world = this.state === 'title' ? this.titleWorld : this.world;
    if (!world) return;
    ctx.save();
    ctx.setTransform(cam.zoom * this.dpr, 0, 0, cam.zoom * this.dpr, (this.W / 2 - (cam.x + cam.sx) * cam.zoom) * this.dpr, (this.H / 2 - (cam.y + cam.sy) * cam.zoom) * this.dpr);
    const sys = this.state === 'title' ? [] : this.systems;
    for (const s of sys) s.drawBack && s.drawBack(ctx, cam);
    world.draw(ctx, cam, this.time);
    const flying = (this.state === 'flight' || this.state === 'paused' || this.state === 'cinematic') && this.ship;
    if (flying) {
      world.drawLasers(ctx, this.ship, this.time);
      if (!this.ship.dead) drawShip(ctx, this.ship, this.time);
      world.drawShield(ctx, this.ship, this.time);
    }
    for (const s of sys) s.draw && s.draw(ctx, cam);
    world.drawBullets(ctx, cam);
    world.particles.draw(ctx, cam.view(40));
    world.floaters.draw(ctx, cam.zoom);
    ctx.restore();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (flying && this.state !== 'cinematic') this.drawHud(ctx);
    for (const s of sys) s.hud && s.hud(ctx, this.W, this.H);
  }

  drawHud(ctx) {
    const ship = this.ship;
    drawFlightHud(ctx, this, this.W, this.H);
    edgeArrow(ctx, this.cam, this.world.station.x, this.world.station.y, '#7df9ff', 'OUTPOST');
    if (this.planet && this.planet.p && !this.planet.p.destroyed) edgeArrow(ctx, this.cam, this.planet.p.x, this.planet.p.y, '#ff3cac', this.planet.p.name.toUpperCase());
    // top-left: credits + cargo value
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '700 22px "Trebuchet MS", sans-serif';
    ctx.fillStyle = '#ffd60a';
    ctx.fillText(money(this.save.credits), 16, 32);
    ctx.font = '700 12px "Trebuchet MS", sans-serif';
    ctx.fillStyle = '#8796bd';
    const cv = sellValue(ship.cargo, this.save.upgrades);
    ctx.fillText(`${SECTORS[this.save.sector].name.toUpperCase()} · cargo worth ${money(cv)}`, 16, 50);
    // centre prompts
    ctx.textAlign = 'center';
    if (this.canDock) {
      ctx.font = '700 18px "Trebuchet MS", sans-serif';
      ctx.fillStyle = `rgba(125,249,255,${0.7 + Math.sin(this.time * 6) * 0.3})`;
      ctx.fillText('[F] DOCK AT OUTPOST', this.W / 2, this.H - 90);
    }
    if (this.recall > 0) {
      const k = this.recall / 2;
      ctx.fillStyle = 'rgba(10,14,30,0.8)'; ctx.fillRect(this.W / 2 - 120, this.H / 2 + 80, 240, 14);
      ctx.fillStyle = '#7df9ff'; ctx.fillRect(this.W / 2 - 119, this.H / 2 + 81, 238 * k, 12);
      ctx.font = '700 13px "Trebuchet MS", sans-serif'; ctx.fillText('RECALLING…', this.W / 2, this.H / 2 + 74);
    }
    if (ship.dead) {
      ctx.font = '700 34px "Trebuchet MS", sans-serif';
      ctx.fillStyle = '#ff5d73';
      ctx.fillText('SHIP DESTROYED', this.W / 2, this.H / 2 - 40);
    }
  }
}
