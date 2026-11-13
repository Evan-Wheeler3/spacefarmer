// Game shell: loop, states, and glue between the planet world, the freighter,
// the escort fighter, the swarm, UI and save.
import { PRESETS, ECONOMY, PARTS, FLAVOR, ORES, PLANETGEN, PLANET_THEMES, IDLE, MAIN_PLANETS, LEGACY } from './data.js';
import { Input } from './input.js';
import { Camera } from './camera.js';
import { World } from './world.js';
import { Ship } from './ship.js';
import { Design, analyze } from './shipdesign.js';
import { Starfield, drawShip, SKINS } from './render.js';
import { drawFlightHud, edgeArrow } from './ui/hud.js';
import { Hangar } from './ui/hangar.js';
import { el, toast, modal } from './ui/dom.js';
import { loadSave, newSave, writeSave, wipeSave, SANDBOX_KEY } from './save.js';
import { Dev } from './ui/dev.js';
import { TouchControls } from './ui/touch.js';
import { sellValue, idleWindow, upgradeEffects, legacyEffects } from './economy.js';
import { money, fmt, fmtTime, pick, clamp, TAU } from './util.js';

const FAR_MUTED = new Set(['rail', 'shoot', 'shield', 'partLost', 'bigBoom', 'hit', 'pop', 'explode', 'enemyShoot', 'missile', 'charge', 'steal', 'bump']);
import { P_GLOW, P_SPARK } from './particles.js';
import { EnemySystem } from './enemies.js';
import { Escort } from './fighter.js';
import { Autopilot } from './autopilot.js';
import { renderLegacy } from './ui/legacy.js';
import { renderResearch, goalCard } from './ui/research.js';
import { renderFighter } from './ui/fighterTab.js';
import { Tutorial } from './ui/tutorial.js';
import { Audio } from './audio.js';

const STEP = 1 / 60;

export function planetName(i) {
  if (i < PLANET_THEMES.length) return PLANET_THEMES[i].name;
  return `${PLANET_THEMES[i % PLANET_THEMES.length].name} ${['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][Math.floor(i / PLANET_THEMES.length) - 1] || i}`;
}
const themeOf = (i) => PLANET_THEMES[i % PLANET_THEMES.length].bg;

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
    this.systems = [];
    this.saveKey = undefined;
    this.timeScale = 1;
    this.save = loadSave();
    this.settings = this.save ? this.save.settings : newSave().settings;
    this.hangar = new Hangar(this);
    this.enemySystem = new EnemySystem(this);
    this.escort = new Escort(this);
    this.autopilot = new Autopilot(this);
    this.tutorial = new Tutorial(this);
    this.dev = new Dev(this);
    this.touchControls = new TouchControls(this);
    this.systems.push(this.tutorial, this.dev);
    this.audio = new Audio();
    const unlock = () => { this.audio.unlock(); this.audio.setVolume(this.settings.volume, this.settings.music); };
    addEventListener('pointerdown', unlock);
    addEventListener('touchend', unlock);
    addEventListener('keydown', unlock);
    this.hangar.addTab('fighter', '⚔ Fighter', (c) => renderFighter(this, c), 'shipyard');
    this.hangar.addTab('research', 'Research', (c) => renderResearch(this, c), 'fighter');
    this.hangar.addTab('legacy', '★ Legacy', (c) => renderLegacy(this, c), 'research', () => this.save && (this.save.legacy.completed > 0 || this.save.legacy.points > 0));
    this.goalCard = () => goalCard(this);
    this.stars = new Starfield(themeOf(this.save ? this.save.planet.index : 0), 7);
    Input.init(canvas);
    addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 300));
    addEventListener('beforeunload', () => this.persist());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.persist(); });
    addEventListener('keydown', (e) => this.onKey(e));
    this.idleLeft = 0;
    this.lastInput = 0;
    this.resize();
  }

  get levels() { return this.save ? this.save.upgrades : {}; }
  get planet() { return this.world ? this.world.planet : null; }
  planetLabel() { return planetName(this.save.planet.index); }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.W = innerWidth; this.H = innerHeight;
    this.canvas.width = Math.floor(this.W * dpr);
    this.canvas.height = Math.floor(this.H * dpr);
    this.cam.resize(this.W, this.H);
    this.readSafeArea();
  }
  readSafeArea() {
    if (!this._probe) {
      this._probe = document.createElement('div');
      this._probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
      document.body.append(this._probe);
    }
    const cs = getComputedStyle(this._probe);
    this.safe = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
    this.cam.safeX = Math.max(this.safe.l, this.safe.r);
  }

  shake(a) { if (!this.farCombat) this.cam.shake(a * (this.settings.shake ?? 1)); }
  sfx(name, p) {
    if (!this.audio) return;
    // in the freighter view the fight is happening far away: you only hear the big moments
    if (this.farCombat && FAR_MUTED.has(name)) return;
    this.audio.play(name, p);
  }
  // true while the fighter's battle runs off-screen (freighter view)
  get farCombatView() { return this.state === 'flight' && !this.planetView; }
  applySettings() { this.audio && this.audio.setVolume(this.settings.volume, this.settings.music); this.persist(); }

  // ------------------------------------------------------------- save
  persist() {
    if (!this.save) return;
    if ((this.state === 'flight' || this.state === 'watch') && this.ship && !this.ship.dead) this.stashShip();
    if (!this.survival) this.escort.stash();
    if (this.world && this.save.planet.index === this.world.planet.index && this.save.planet.seed === this.world.planet.seed) this.save.planet.removed = this.world.planet.exportRemoved();
    writeSave(this.save, this.saveKey);
  }
  stashShip() {
    this.save.design = this.ship.writeBack(Design.fromJSON(this.save.design)).toJSON();
    this.save.cargo = { ...this.ship.cargo };
    this.save.cargoUnits = this.ship.cargoUnits;
  }
  wipe() { wipeSave(this.saveKey); location.reload(); }

  addCredits(n, fromEl) {
    this.save.credits += n;
    if (n > 0) this.save.stats.earned += n;
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
      setTimeout(() => { c.style.transform = `translate(${b.left + b.width / 2 - parseFloat(c.style.left)}px, ${b.top + b.height / 2 - parseFloat(c.style.top)}px) scale(0.6)`; c.style.opacity = '0.2'; }, 20 + i * 35);
      setTimeout(() => { c.remove(); if (i % 3 === 0) this.sfx('coin'); }, 650 + i * 35);
    }
  }

  repairCost(design, mult = 1) {
    let total = 0, damaged = 0;
    for (const e of design.entries) {
      const hp = e.hp == null ? 1 : e.hp;
      if (hp >= 1) continue;
      damaged++;
      const cost = PARTS[e.part].cost || 60;
      total += hp === 0 ? cost * ECONOMY.destroyedPartRepairFactor : cost * (1 - hp) * ECONOMY.repairCostFactor;
    }
    return { total: Math.ceil(total * mult), damaged };
  }

  onDesignChanged() { this.hangar.updateCredits(); this.hangar.updateLaunch(); this.persist(); }

  // ----------------------------------------------------------- states
  boot() {
    this.titleWorld = new World(this, { index: 0, seed: 42 });
    this.showTitle();
    this.start();
  }

  ensureWorld() {
    this.save.upgrades.__legacy = legacyEffects(this.save.legacy.spent);
    const p = this.save.planet;
    if (!this.world || this.world.planet.index !== p.index || this.world.planet.seed !== p.seed) {
      this.world = new World(this, p);
      this.stars.setTheme(themeOf(p.index), 7 + p.index);
    }
  }

  showTitle() {
    if (this.survival) { this.endSurvival(true); return; }
    this.state = 'title';
    this.clearOverlays();
    if (this.saveKey) { this.saveKey = undefined; this.timeScale = 1; this.save = loadSave(); this.world = null; if (this.save) this.settings = this.save.settings; }
    const has = !!this.save;
    const t = el('div', { class: 'title' },
      el('div', { class: 'title-logo' }, 'SPACE FARMER'),
      el('div', { class: 'title-tag' }, 'One planet. Every last cube of it.'),
      el('div', { class: 'title-btns' },
        has ? el('button', { class: 'btn primary big-btn', onclick: () => this.continueGame() }, 'CONTINUE') : '',
        el('button', { class: 'btn big-btn' + (has ? '' : ' primary'), onclick: () => {
          if (has && !this.save.pendingNotice && !confirm('Start over? Your current save will be replaced.')) return;
          this.newGame();
        } }, 'NEW GAME'),
        has && this.save.legacy.completed >= MAIN_PLANETS ? el('button', { class: 'btn big-btn danger', title: 'Pilot your fighter against a swarm that never stops growing. Your ships and credits are untouched.', onclick: () => this.startSurvival() }, 'SWARM SURVIVAL') : '',
        el('button', { class: 'btn big-btn', title: 'Separate save slot with everything unlocked, cheats and spawn tools. Never touches your real progress.', onclick: () => this.startSandbox() }, 'SANDBOX')),
      has && !this.save.pendingNotice ? el('div', { class: 'dim' }, `${money(this.save.credits)} · ${planetName(this.save.planet.index)} · ${this.save.legacy.completed} planet(s) mined`) : '',
      el('div', { class: 'title-help dim' }, this.touch ? 'Left thumb: fly · FIRE: mine · leave the controls and the autopilot takes over' : 'W/S thrust · A/D turn · Q/E strafe · Space mine · F dock · V watch fighter · P planet view · Esc pause'));
    this.overlay = t;
    this.ui.append(t);
  }

  clearOverlays() {
    document.body.classList.remove('flying', 'watching');
    if (this.chips) { this.chips.remove(); this.chips = null; }
    if (this.watchPanel) { this.watchPanel.remove(); this.watchPanel = null; }
    this.planetView = false;
    this.dev && this.dev.bar();
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
    this.hangar.close();
  }

  newGame() {
    const keep = this.save && this.save.pendingNotice ? this.save : null;
    this.save = newSave();
    if (keep) { this.save.blueprints = keep.blueprints; this.save.settings = keep.settings; }
    this.settings = this.save.settings;
    this.world = null;
    this.persist();
    this.audio && this.audio.unlock();
    this.enterHangar('market');
    this.launch();
  }

  startSandbox() {
    this.persist();
    this.saveKey = SANDBOX_KEY;
    this.save = loadSave(SANDBOX_KEY) || this.dev.freshSave();
    this.settings = this.save.settings;
    this.world = null;
    this.audio && this.audio.unlock();
    this.enterHangar('dev');
  }

  // ------------------------------------------------------ Swarm Survival
  // Your real fighter, an endless and much faster swarm, a high score. Nothing
  // carries over: the fighter's damage and your credits are restored afterwards.
  startSurvival() {
    this.audio && this.audio.unlock();
    if (this.save.pendingNotice) return;
    const fs = this.save.fighter;
    this.survival = { design: JSON.parse(JSON.stringify(fs.design)), repairT: fs.repairT || 0, credits: this.save.credits, kills: 0 };
    fs.repairT = 0;
    this.ensureWorld();
    this.launch();
    if (this.state !== 'flight') { this.endSurvival(true); return; }
    this.enterWatch();
    this.escort.manual = true;
    modal('SWARM SURVIVAL', el('div', {},
      el('p', {}, 'Your fighter, alone on the picket line. The swarm grows three times faster and never stops.'),
      el('p', { class: 'dim' }, `Best so far: ${this.save.records.survival ? fmtTime(this.save.records.survival.time) + ' · ' + this.save.records.survival.kills + ' kills' : 'none yet'}. Hand control to the AI any time.`)),
      [{ label: 'Bring it', cls: 'danger' }]);
  }

  endSurvival(silent = false) {
    const run = this.survival;
    if (!run) return;
    this.survival = null;
    const t = this.enemySystem.shiftT, kills = run.kills;
    const fs = this.save.fighter;
    fs.design = run.design; fs.repairT = run.repairT;
    this.save.credits = run.credits;
    const best = this.save.records.survival;
    const isBest = !silent && (!best || t > best.time);
    if (isBest) this.save.records.survival = { time: t, kills };
    this.escort.ship = null; this.escort.manual = false;
    this.ship = null;
    this.persist();
    this.showTitle();
    if (!silent) modal(isBest ? 'NEW BEST' : 'OVERRUN', el('div', { class: 'reward' },
      el('div', { class: 'reward-big' }, fmtTime(t)),
      el('p', {}, `${kills} ships destroyed${isBest ? '. A new record.' : `. Best: ${fmtTime(best.time)}.`}`)), [{ label: 'OK', cls: 'primary' }]);
  }

  continueGame() {
    this.audio && this.audio.unlock();
    if (this.save.pendingNotice) {
      const n = this.save.pendingNotice;
      this.newGame();
      modal('A new game', el('p', {}, n), [{ label: 'Let’s go', cls: 'primary' }]);
      return;
    }
    this.ensureWorld();
    // the autopilot kept mining while you were away, for as long as its window lasted
    const away = (Date.now() - (this.save.lastSeen || Date.now())) / 1000;
    const res = away > 30 ? this.offlineMining(away) : null;
    this.enterHangar('market');
    if (res && res.cubes > 0) {
      this.hangar.updateCredits();
      modal('Welcome back', el('div', {},
        el('p', {}, `Your autopilot mined ${fmt(res.cubes)} cubes for `, el('span', { class: 'money' }, money(res.credits)), ` in the ${fmtTime(res.time)} its window allowed.`),
        res.time < away - 60 ? el('p', { class: 'dim' }, 'Research Autopilot Cores for a longer idle window.') : ''), [{ label: 'Nice', cls: 'primary' }]);
    }
  }

  offlineMining(away) {
    const r = this.save.rates;
    const t = Math.min(away, idleWindow(this.levels));
    if (!r.cubesPerSec || !r.site || !this.world) return null;
    const pl = this.world.planet;
    const n = Math.min(pl.remaining, Math.floor(r.cubesPerSec * t * 0.8));
    let credits = 0;
    const fx = upgradeEffects(this.levels);
    pl.removeNearest(r.site[0], r.site[1], n, (mat) => { credits += ORES[mat].value * pl.valueMult; });
    credits = Math.floor(credits * fx.sellMult * fx.yieldMult);
    this.save.credits += credits; this.save.stats.earned += credits; this.save.stats.oreMined += n;
    this.persist();
    return { cubes: n, credits, time: t };
  }

  enterHangar(tab) {
    this.state = 'hangar';
    this.clearOverlays();
    this.ensureWorld();
    this.enemySystem.reset();
    this.escort.stow();
    this.hangar.open(tab);
    for (const s of this.systems) s.onHangar && s.onHangar();
    this.persist();
  }

  launch() {
    const design = Design.fromJSON(this.save.design);
    const a = analyze(design, this.save.upgrades, { role: 'freighter' });
    if (!a.launchable) { toast(a.warnings.find((w) => w.lvl === 'err')?.text || 'Not flightworthy', 'bad'); this.sfx('denied'); return; }
    if (this.escort.repairing) { toast(`Your fighter is still in the repair bay (${fmtTime(this.save.fighter.repairT)}).`, 'bad'); this.sfx('denied'); return; }
    if (!this.escort.analysis().launchable) { toast('Your fighter design isn’t ready. Check the Shipyard (⚔ Fighter).', 'bad'); this.sfx('denied'); return; }
    this.clearOverlays();
    this.ensureWorld();
    const st = this.world.station;
    const ship = new Ship(design, this.save.upgrades, 'freighter');
    for (const k in this.save.cargo || {}) ship.addOre(k, this.save.cargo[k]);
    ship.recomputeMass(true);
    ship.x = st.x; ship.y = st.y + 160 + ship.radius; ship.vy = 120; ship.angle = Math.PI;
    ship.god = true; // the freighter never takes damage
    this.ship = ship;
    this.escort.deploy(ship);
    this.enemySystem.reset();
    this.autopilot.reset();
    this.cam.snap(ship.x, ship.y);
    this.state = 'flight';
    document.body.classList.add('flying');
    this.lastInput = this.time;
    this.idleLeft = idleWindow(this.levels);
    this.buildChips();
    this.world.particles.ring(ship.x, ship.y - 30, 120, '#7df9ff', 0.5, 3);
    this.sfx('launch');
    for (const s of this.systems) s.onLaunch && s.onLaunch();
  }

  // cargo is offloaded automatically whenever the freighter passes the hangar
  offload() {
    const s = this.ship;
    if (!s) return 0;
    const v = s.cargoUnits >= 1 ? sellValue(s.cargo, this.levels, this.world.planet.valueMult) : 0;
    s.clearCargo(); s.recomputeMass();
    this.save.cargo = {}; this.save.cargoUnits = 0;
    const fuelCost = Math.min(this.save.credits + v, Math.ceil((s.fuelMax - s.fuel) * ECONOMY.refuelCostPerUnit));
    s.fuel = s.fuelMax;
    this.save.credits += v - fuelCost;
    this.save.stats.earned += v;
    if (v > 0) { this.world.floaters.add(s.x, s.y - s.radius - 20, '+' + money(v), '#ffd60a', 22, -40, 1.6); this.sfx('sell'); }
    return v;
  }

  // ran the tanks dry: the starship reels the freighter in (cargo and all)
  towHome() {
    const s = this.ship, st = this.world.station;
    this.world.particles.ring(s.x, s.y, 200, '#7df9ff', 0.5, 4);
    s.x = st.x; s.y = st.y + 160 + s.radius; s.vx = 0; s.vy = 60; s.av = 0;
    this.cam.snap(s.x, s.y);
    this.offload();
    this.autopilot.mode = 'mine';
    toast('Out of fuel: the starship towed the freighter home.', '', 3000);
  }

  // autopilot reached the starship: offload, then head back out while the window lasts
  autoDock() {
    this.offload();
    if (this.idleLeft > 0) { this.autopilot.mode = 'mine'; return; }
    this.dock(true);
  }

  dock(auto = false) {
    this.offload();
    this.stashShip();
    this.sfx('dock');
    this.enterHangar('market');
    toast(auto ? 'The autopilot’s window ran out, so it brought the freighter home. Launch to keep going.' : pick(FLAVOR.docks), '', 3500);
  }

  // the fighter can't hold: both ships warp home and nothing gets mined until it's repaired
  fighterDown(destroyed) {
    if (this.state !== 'flight' && this.state !== 'watch') return;
    if (this.survival) { this.endSurvival(); return; }
    const f = this.escort.ship;
    if (f) {
      this.world.particles.burst(f.x, f.y, 40, '#7df9ff', 400, 0.8, 3, P_SPARK);
      this.world.particles.ring(f.x, f.y, 300, '#7df9ff', 0.6, 5);
    }
    const shift = this.enemySystem.shiftT;
    this.save.fighter.longestShift = Math.max(this.save.fighter.longestShift || 0, shift);
    this.save.fighter.shifts = (this.save.fighter.shifts || 0) + 1;
    this.save.stats.retreats++;
    const r = this.escort.startRepairs(destroyed);
    this.offload();
    this.stashShip();
    this.sfx('jump');
    this.enterHangar('fighter');
    modal('Fighter down', el('div', {},
      el('p', {}, `Your fighter held the line for ${fmtTime(shift)} before ${destroyed ? 'its core was breached' : 'pulling out'}. Both ships warped home.`),
      el('p', {}, 'Repairs: ', el('span', { class: 'money' }, money(r.pay)), ` · back in ${fmtTime(r.time)}. Mining stops until then.`),
      el('p', { class: 'dim small' }, 'Tougher fighters hold longer. The swarm grows the longer you stay out, and the deeper you dig.')), [{ label: 'OK', cls: 'primary' }]);
  }

  onShipDestroyed(ship) { if (ship === this.escort.ship) this.fighterDown(true); }

  // ------------------------------------------------- mining progress
  onCubeMined() {
    this._cubesWindow = (this._cubesWindow || 0) + 1;
    this.save.stats.oreMined++;
    if (this.world.planet.percent >= PLANETGEN.collapseAt * 100 && !this.completing) this.planetComplete();
  }
  onOreCollected() {}

  planetComplete() {
    this.completing = true;
    const pl = this.world.planet;
    let credits = 0;
    const fx = upgradeEffects(this.levels);
    pl.removeNearest(0, 0, pl.remaining, (m) => { credits += ORES[m].value * pl.valueMult; });
    credits = Math.floor(credits * fx.sellMult * fx.yieldMult);
    for (let k = 0; k < 6; k++) this.world.particles.ring(0, 0, pl.R * (0.4 + k * 0.4), k % 2 ? '#ff3cac' : '#ffd27a', 1.5 + k * 0.4, 10);
    this.world.particles.burst(0, 0, 200, '#ffd27a', 900, 2.5, 6, P_SPARK);
    this.world.particles.spawn(P_GLOW, 0, 0, 0, 0, 2.5, pl.R * 1.5, '#fff1d0');
    this.shake(40);
    this.sfx('planetBoom');
    const s = this.save;
    const idx = s.planet.index;
    const pts = 3 + 2 * idx;
    const seedLv = s.legacy.spent.seed || 0;
    const seed = Math.round(seedLv * (LEGACY.find((p) => p.id === 'seed').startCredits) * Math.pow(PLANETGEN.valueGrowth, idx + 1));
    s.credits += credits + seed;
    s.legacy.completed++;
    s.legacy.points += pts;
    const t = s.stats.planetTime;
    if (!s.records.bestPlanetTime || t < s.records.bestPlanetTime) s.records.bestPlanetTime = t;
    s.stats.planetTime = 0;
    s.rates = { cubesPerSec: 0, site: null };
    s.planet = { index: idx + 1, seed: (Math.random() * 1e9) | 0, removed: '' };
    const finishedMain = idx + 1 === MAIN_PLANETS;
    this.persist();
    setTimeout(() => {
      this.completing = false;
      this.enterHangar('market');
      modal(finishedMain ? 'YOU MINED THEM ALL' : 'PLANET MINED', el('div', { class: 'reward' },
        el('div', { class: 'reward-big' }, planetName(idx)),
        el('p', {}, 'Every last cube. The core collapsed for a final ', el('span', { class: 'money' }, money(credits)), '.'),
        seed ? el('p', {}, 'Seed Money: ', el('span', { class: 'money' }, money(seed)), ' to get started.') : '',
        el('p', {}, `+${pts} Legacy points for permanent bonuses (★ Legacy tab). New research unlocks on the next planet too.`),
        el('p', { class: 'dim' }, finishedMain ? 'That was the main campaign. Endless planets keep coming, and Swarm Survival is unlocked on the title screen.' : `Next up: ${planetName(idx + 1)}. Bigger, deeper and better defended.`)),
        [{ label: 'Onward', cls: 'gold' }]);
    }, 2600);
  }

  // ---------------------------------------------------- watching the fighter
  get controlledShip() {
    if (this.state === 'flight') return this.ship;
    if (this.state === 'watch' && this.escort.manual && this.escort.ship) return this.escort.ship;
    return null;
  }

  enterWatch() {
    if (this.state !== 'flight' || !this.escort.ship) return;
    this.state = 'watch';
    document.body.classList.add('watching');
    const f = this.escort;
    const status = el('span', { class: 'w-status' });
    const ctrl = el('button', { class: 'btn small', onclick: (e) => { e.currentTarget.blur(); f.manual = !f.manual; this.sfx('click'); } });
    const surv = !!this.survival;
    this.watchPanel = el('div', { class: 'watch' }, el('span', { class: 'w-tag' }, surv ? 'SURVIVAL' : 'FIGHTER'), status, ctrl,
      el('button', { class: 'btn small ' + (surv ? 'danger' : 'primary'), onclick: (e) => { e.currentTarget.blur(); this.exitWatch(); } }, surv ? 'End run' : '◀ Freighter'));
    this.ui.append(this.watchPanel);
    const refresh = () => {
      if (!this.watchPanel) return;
      status.textContent = `Hull ${Math.round(f.hull() * 100)}% · ${this.survival ? this.survival.kills + ' kills' : this.enemySystem.threatLabel() + ' swarm'} · ${fmtTime(this.enemySystem.shiftT)}`;
      ctrl.textContent = f.manual ? 'Hand back to AI' : (this.touch ? 'Take control' : 'Take control (A/D aim · Space fire)');
      ctrl.classList.toggle('on', f.manual);
      setTimeout(refresh, 250);
    };
    refresh();
  }
  exitWatch() {
    if (this.state !== 'watch') return;
    if (this.survival) { this.endSurvival(); return; }
    this.escort.manual = false;
    document.body.classList.remove('watching');
    if (this.watchPanel) { this.watchPanel.remove(); this.watchPanel = null; }
    this.state = 'flight';
  }

  togglePlanetView() { this.planetView = !this.planetView; this.sfx('click'); }

  // top-of-screen chips: planet progress (opens the planet view) and fighter status (watch)
  buildChips() {
    const pc = el('button', { class: 'chip planet-chip', onclick: (e) => { e.currentTarget.blur(); this.togglePlanetView(); }, title: 'View the whole planet (P)' });
    const fc = el('button', { class: 'chip fighter-chip', onclick: (e) => { e.currentTarget.blur(); this.state === 'watch' ? this.exitWatch() : this.enterWatch(); }, title: 'Watch your fighter (V)' });
    this.chips = el('div', { class: 'chips' }, pc, fc);
    this.ui.append(this.chips);
    this.chipEls = { pc, fc };
  }
  updateChips() {
    if (!this.chips) return;
    const pct = this.world.planet.percent;
    const txt = `🌍 ${pct < 10 ? pct.toFixed(3) : pct.toFixed(2)}% mined`;
    if (this.chipEls.pc.textContent !== txt) this.chipEls.pc.textContent = txt;
    const f = this.escort;
    const ftxt = f.ship ? `⚔ Fighter ${Math.round(f.hull() * 100)}% · ${this.enemySystem.boss ? 'CAPITAL SHIP' : this.enemySystem.threatLabel() + ' swarm'}` : '⚔ —';
    if (this.chipEls.fc.textContent !== ftxt) this.chipEls.fc.textContent = ftxt;
    this.chipEls.fc.classList.toggle('alert', f.hull() < this.save.fighter.retreat + 0.15 || !!this.enemySystem.boss);
    this.chips.style.display = this.state === 'watch' ? 'none' : '';
  }

  // ------------------------------------------------------------ loop
  start() {
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this._fpsAcc += dt; this._fpsN++;
      if (this._fpsAcc > 0.5) { this.fps = this._fpsN / this._fpsAcc; this._fpsAcc = 0; this._fpsN = 0; }
      Input.pollPad();
      this.acc += dt * (this.state === 'flight' || this.state === 'watch' ? this.timeScale : 1);
      let steps = 0;
      const maxSteps = 6 * Math.max(1, this.timeScale);
      while (this.acc >= STEP && steps < maxSteps) { this.update(STEP); this.acc -= STEP; steps++; }
      if (steps >= maxSteps) this.acc = 0;
      this.render(dt);
      Input.endFrame();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
    const modalOpen = document.querySelector('.modal-back');
    if (e.code === 'Escape') {
      if (modalOpen) { modalOpen.remove(); return; }
      if (this.planetView) { this.planetView = false; return; }
      if (this.state === 'flight' || this.state === 'watch') this.pause();
      else if (this.state === 'paused') this.resume();
    }
    if (modalOpen) return;
    if (e.code === 'KeyV' && this.state === 'flight') this.enterWatch();
    else if ((e.code === 'KeyV' || e.code === 'Backspace') && this.state === 'watch') this.exitWatch();
    if (e.code === 'KeyP' && (this.state === 'flight' || this.state === 'watch')) this.togglePlanetView();
    if (e.code === 'Enter' && this.state === 'hangar' && this.hangar.tab !== 'shipyard') this.launch();
  }

  pause() {
    this.pausedFrom = this.state;
    this.state = 'paused';
    this.persist();
    this.overlay = this.pauseMenu();
    this.ui.append(this.overlay);
    this.audio && this.audio.duck(true);
  }
  resume() {
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
    this.state = this.pausedFrom || 'flight';
    this.audio && this.audio.duck(false);
  }

  // pick the in-flight hull skin (the Shipyard always shows blocks)
  skinPicker() {
    const wrap = el('div', { class: 'skins' }, el('div', { class: 'dim small' }, 'Ship skin'));
    const row = el('div', { class: 'skin-row' });
    for (const [id, sk] of Object.entries(SKINS)) {
      const b = el('button', { class: 'btn small' + (this.settings.skin === id ? ' on' : ''), onclick: () => {
        this.settings.skin = id; this.applySettings();
        for (const x of row.children) x.classList.toggle('on', x === b);
      } }, sk.name);
      if (sk.hull) b.style.borderLeft = `6px solid ${sk.hull}`;
      row.append(b);
    }
    wrap.append(row);
    return wrap;
  }

  pauseMenu() {
    const set = this.settings;
    const slider = (label, key, min, max, step) => el('label', { class: 'set' }, el('span', {}, label),
      el('input', { type: 'range', min, max, step, value: set[key], oninput: (e) => { set[key] = Number(e.target.value); this.applySettings(); } }));
    const check = (label, key) => el('label', { class: 'set' }, el('span', {}, label),
      el('input', { type: 'checkbox', checked: !!set[key], onchange: (e) => { set[key] = e.target.checked; this.applySettings(); } }));
    const p = el('div', { class: 'pause' },
      el('h1', {}, 'PAUSED'),
      el('div', { class: 'pause-grid' },
        el('div', { class: 'pause-col' },
          el('button', { class: 'btn primary big-btn', onclick: () => this.resume() }, 'Resume'),
          el('button', { class: 'btn big-btn', onclick: () => { this.resume(); this.planetView = true; } }, '🌍 View planet'),
          el('button', { class: 'btn big-btn', onclick: () => { this.resume(); if (this.state === 'flight') this.enterWatch(); } }, '⚔ View fighter'),
          el('button', { class: 'btn big-btn', onclick: () => { this.resume(); this.dock(); } }, 'Dock at starship'),
          el('button', { class: 'btn big-btn', onclick: () => { this.persist(); this.overlay = null; p.remove(); this.escort.manual = false; this.ship = null; this.showTitle(); } }, 'Save & quit to title')),
        el('div', { class: 'pause-col card' }, el('h3', {}, 'Settings'),
          slider('Master volume', 'volume', 0, 1, 0.05), slider('Music', 'music', 0, 1, 0.05), slider('Screen shake', 'shake', 0, 1.5, 0.1),
          check('Physics telemetry (F3)', 'telemetry'),
          this.skinPicker())),
      el('div', { class: 'dim' }, 'Progress autosaves continuously.'));
    return p;
  }

  update(dt) {
    this.time += dt;
    this.touchControls.update();
    if (this.save && this.state !== 'title') { this.save.stats.playTime += dt; if (this.state !== 'paused') this.escort.tick(dt); }
    if (this.state === 'title') {
      this.titleWorld.update(dt, null);
      this.cam.override = { x: Math.cos(this.time * 0.05) * 600, y: -this.titleWorld.planet.R - 100 + Math.sin(this.time * 0.05) * 250, zoom: 0.55 };
      this.cam.follow({ x: 0, y: 0, vx: 0, vy: 0 }, dt);
      return;
    }
    if (this.state === 'hangar') {
      this.cam.override = null;
      this.hangar.builder.update(dt);
      this.cam.follow({ x: this.world.station.x, y: this.world.station.y, vx: 0, vy: 0, radius: 260 }, dt);
      for (const s of this.systems) s.updateDocked && s.updateDocked(dt);
      this.hangar.tick && this.hangar.tick(dt);
      this._autosave = (this._autosave || 0) + dt;
      if (this._autosave > 15) { this._autosave = 0; this.persist(); }
      return;
    }
    if (this.state !== 'flight' && this.state !== 'watch') return;
    if (document.querySelector('.modal-back')) return; // dialogs pause play
    const ship = this.ship;
    this.save.stats.planetTime += dt;
    if (Input.hit('KeyT')) { ship.assist = !ship.assist; toast('Flight assist ' + (ship.assist ? 'ON' : 'OFF')); }
    if (Input.hit('F3')) this.settings.telemetry = !this.settings.telemetry;
    if (Input.hit('KeyM')) { this.settings.volume = this.settings.volume > 0 ? 0 : 0.7; this.applySettings(); toast(this.settings.volume ? 'Sound on' : 'Sound muted'); }
    if (Input.mouse.wheel) this.cam.userZoom = clamp(this.cam.userZoom * (Input.mouse.wheel > 0 ? 0.9 : 1.1), 0.25, 2);

    if (this.survival) {
      const st = this.world.station;
      ship.x = st.x; ship.y = st.y + 160 + ship.radius; ship.vx = ship.vy = 0; ship.av = 0;
      ship.input = { thrust: 0, turn: 0, strafe: 0, fire: false, brake: false };
      this.idleLeft = 1e9;
    }
    // freighter: your hands, or the autopilot after a few idle seconds
    const inp = this.state === 'flight' ? Input.flight() : { thrust: 0, turn: 0, strafe: 0, fire: false, brake: false };
    const active = Math.abs(inp.thrust) + Math.abs(inp.turn) + Math.abs(inp.strafe) > 0.05 || inp.fire || inp.brake;
    if (active) { this.lastInput = this.time; this.idleLeft = idleWindow(this.levels); if (this.autopilot.mode === 'home' && ship.cargoUnits < ship.cargoMax * 0.95) this.autopilot.mode = 'mine'; }
    this.autoOn = !this.survival && this.time - this.lastInput > IDLE.delay && !active;
    if (this.autoOn) {
      this.idleLeft = Math.max(0, this.idleLeft - dt);
      ship.input = this.autopilot.drive(ship, this.world);
      this.measureRate(dt);
    } else if (!this.survival) ship.input = inp;
    if (this.state !== 'flight' && this.state !== 'watch') return; // the autopilot docked

    // starship: cargo offloads on arrival; F docks to upgrade
    const st = this.world.station;
    this.canDock = Math.hypot(ship.x - st.x, ship.y - st.y) < ECONOMY.dockRadius + ship.radius;
    if (this.canDock && ship.cargoUnits >= 1 && !this.autoOn) this.offload();
    if (this.canDock && this.state === 'flight' && (Input.hit('KeyF') || Input.padPressed.has(1))) { this.dock(); return; }

    // hold R (or the touch recall button) to warp home
    if (this.state === 'flight' && (Input.down('KeyR') || Input.touchState.recall)) {
      this.recall = (this.recall || 0) + dt;
      if (this.recall >= 2) { this.recall = 0; this.world.particles.ring(ship.x, ship.y, 220, '#7df9ff', 0.5, 4); this.dock(); return; }
    } else this.recall = Math.max(0, (this.recall || 0) - dt * 3);

    let sdt = dt;
    if (this.slowmo > 0) { this.slowmo -= dt; sdt = dt * 0.3; }
    ship.update(sdt, this.world);
    this.farCombat = this.farCombatView;
    this.escort.update(sdt, ship, this.world);
    if (this.state !== 'flight' && this.state !== 'watch') { this.farCombat = false; return; } // the fighter fell this frame
    this.enemySystem.update(sdt);
    this.farCombat = false;
    this.world.update(sdt, ship);
    for (const s of this.systems) s.update && s.update(sdt);
    if (this.state !== 'flight' && this.state !== 'watch') return;

    // camera: the planet view, the fighter, or the freighter
    const tgt = this.state === 'watch' && this.escort.ship ? this.escort.ship : ship;
    let near = 1e9;
    for (const e of this.world.enemies) if (!e.dead && e.type !== 'missile') near = Math.min(near, Math.hypot(e.x - tgt.x, e.y - tgt.y));
    this.cam.combat = this.state === 'watch' && near < 1300 ? clamp(420 / Math.max(420, near), 0.5, 1) : 1;
    if (this.planetView) {
      const R = this.world.planet.R;
      this.cam.override = { x: 0, y: -PLANETGEN.starshipGap * 0.35, zoom: Math.min(this.W, this.H) / ((R + PLANETGEN.starshipGap * 0.7) * 2.3) };
    } else this.cam.override = null;
    this.cam.follow(tgt, dt);
    this.updateChips();
    this._autosave = (this._autosave || 0) + dt;
    if (this._autosave > 15) { this._autosave = 0; this.persist(); }
  }

  // cubes per second while autopiloting (drives offline progress)
  measureRate(dt) {
    this._rateT = (this._rateT || 0) + dt;
    if (this._rateT < 20) return;
    const cps = (this._cubesWindow || 0) / this._rateT;
    const r = this.save.rates;
    r.cubesPerSec = r.cubesPerSec ? r.cubesPerSec * 0.7 + cps * 0.3 : cps;
    if (this.autopilot.target) r.site = [this.autopilot.target.x, this.autopilot.target.y];
    this._rateT = 0; this._cubesWindow = 0;
  }

  render() {
    const { ctx, cam } = this;
    this.audio.update(this);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.stars.draw(ctx, this.W, this.H, cam.x, cam.y, cam.zoom);
    const world = this.state === 'title' ? this.titleWorld : this.world;
    if (!world) return;
    ctx.save();
    ctx.setTransform(cam.zoom * this.dpr, 0, 0, cam.zoom * this.dpr, (this.W / 2 - (cam.x + cam.sx) * cam.zoom) * this.dpr, (this.H / 2 - (cam.y + cam.sy) * cam.zoom) * this.dpr);
    world.draw(ctx, cam, this.time);
    const live = this.state === 'flight' || this.state === 'watch' || (this.state === 'paused' && (this.pausedFrom === 'flight' || this.pausedFrom === 'watch'));
    if (live && this.ship) {
      world.drawLasers(ctx, this.ship, this.time);
      drawShip(ctx, this.ship, this.time, this.settings.skin);
      world.drawMagnet(ctx, this.ship, this.time);
      const f = this.escort.ship;
      if (f && !f.dead) {
        const v = cam.view(f.radius + 60);
        if (f.x > v.x0 && f.x < v.x1 && f.y > v.y0 && f.y < v.y1) { drawShip(ctx, f, this.time, this.settings.skin); world.drawShield(ctx, f); }
      }
      this.enemySystem.draw(ctx, cam);
    }
    world.drawBullets(ctx, cam);
    world.particles.draw(ctx, cam.view(40));
    world.floaters.draw(ctx, cam.zoom);
    if (this.planetView && live) this.drawPlanetMarkers(ctx);
    ctx.restore();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (live && this.ship) {
      this.drawHud(ctx);
      this.enemySystem.hud(ctx, this.W, this.H);
    }
    for (const s of this.systems) s.hud && s.hud(ctx, this.W, this.H);
  }

  // big markers so you can find your ships on the whole-planet view
  drawPlanetMarkers(ctx) {
    const z = this.cam.zoom;
    const mark = (x, y, col, label) => {
      ctx.strokeStyle = col; ctx.lineWidth = 3 / z;
      ctx.beginPath(); ctx.arc(x, y, 26 / z, 0, TAU); ctx.stroke();
      ctx.fillStyle = col; ctx.font = `700 ${13 / z}px "Trebuchet MS", sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(label, x, y - 34 / z);
    };
    mark(this.ship.x, this.ship.y, '#2ee6a6', 'FREIGHTER');
    if (this.escort.ship) mark(this.escort.ship.x, this.escort.ship.y, '#ff4d6d', 'FIGHTER');
    mark(this.world.station.x, this.world.station.y, '#7df9ff', 'STARSHIP');
  }

  // freighter view: an arrow on the screen edge toward the (off-screen) fighter
  drawFighterPointer(ctx) {
    const f = this.escort.ship, cam = this.cam;
    if (!f || f.dead || this.state !== 'flight' || this.planetView) return;
    const sx = (f.x - cam.x) * cam.zoom, sy = (f.y - cam.y) * cam.zoom;
    const sa = this.safe, m = 46;
    const hw = this.W / 2 - m, hh = this.H / 2 - m;
    if (Math.abs(sx) < hw && Math.abs(sy) < hh) return;
    const k = Math.min(hw / Math.abs(sx || 1e-6), hh / Math.abs(sy || 1e-6));
    const x = clamp(this.W / 2 + sx * k, m + sa.l, this.W - m - sa.r), y = clamp(this.H / 2 + sy * k, 110 + sa.t, this.H - 90 - sa.b);
    const a = Math.atan2(sy, sx), hull = this.escort.hull();
    let busy = false;
    for (const e of this.world.enemies) if (!e.dead && Math.abs(e.x - f.x) < 1000 && Math.abs(e.y - f.y) < 1000) { busy = true; break; }
    const col = hull < 0.5 ? '#ff5d73' : busy ? '#ffb347' : '#ff4d6d';
    ctx.save(); ctx.translate(x, y);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(8,12,24,0.7)'; ctx.beginPath(); ctx.arc(0, 0, 20, 0, TAU); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 20, -Math.PI / 2, -Math.PI / 2 + TAU * hull); ctx.stroke();
    ctx.rotate(a); ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(22, -6); ctx.lineTo(22, 6); ctx.fill();
    ctx.rotate(-a);
    ctx.font = '700 10px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(busy ? '⚔' : 'F', 0, 1);
    ctx.restore();
  }

  drawHud(ctx) {
    this.drawFighterPointer(ctx);
    const ship = this.ship, sa = this.safe;
    drawFlightHud(ctx, this, this.W, this.H, this.state === 'watch' && this.escort.ship ? this.escort.ship : ship);
    edgeArrow(ctx, this.cam, this.world.station.x, this.world.station.y, '#7df9ff', 'STARSHIP');
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '700 22px "Trebuchet MS", sans-serif';
    ctx.fillStyle = '#ffd60a';
    ctx.fillText(money(this.save.credits), 16 + sa.l, 32 + sa.t);
    ctx.font = '700 12px "Trebuchet MS", sans-serif';
    ctx.fillStyle = '#8796bd';
    const pl = this.world.planet;
    const d = Math.hypot(ship.x, ship.y) / pl.R;
    const layer = d < 1 ? pl.layerAt(d).name : 'Orbit';
    ctx.fillText(`${planetName(pl.index).toUpperCase()} · ${layer.toUpperCase()} · cargo ${money(sellValue(ship.cargo, this.levels, pl.valueMult))}`, 16 + sa.l, 50 + sa.t);
    ctx.textAlign = 'center';
    const by = this.H - (this.touch ? 150 : 40) - sa.b;
    ctx.font = '700 13px "Trebuchet MS", sans-serif';
    if (this.state === 'flight') {
      if (this.autoOn) {
        ctx.fillStyle = this.idleLeft > 0 ? '#7df9ff' : '#ffcf5a';
        ctx.fillText(this.idleLeft > 0 ? `AUTOPILOT · ${fmtTime(this.idleLeft)} left · touch the controls to take over` : 'AUTOPILOT WINDOW USED UP · heading home', this.W / 2, by);
      } else {
        ctx.fillStyle = 'rgba(135,150,189,0.8)';
        ctx.fillText(`MANUAL · autopilot takes over after ${IDLE.delay}s idle (window ${fmtTime(idleWindow(this.levels))})`, this.W / 2, by);
      }
    }
    if (this.recall > 0) {
      ctx.fillStyle = 'rgba(10,14,30,0.8)'; ctx.fillRect(this.W / 2 - 120, this.H / 2 + 80, 240, 14);
      ctx.fillStyle = '#7df9ff'; ctx.fillRect(this.W / 2 - 119, this.H / 2 + 81, 238 * Math.min(1, this.recall / 2), 12);
      ctx.font = '700 13px "Trebuchet MS", sans-serif'; ctx.fillText('WARPING HOME…', this.W / 2, this.H / 2 + 74);
    }
    if (this.canDock && !this.touch && this.state === 'flight') {
      ctx.font = '700 16px "Trebuchet MS", sans-serif';
      ctx.fillStyle = `rgba(125,249,255,${0.7 + Math.sin(this.time * 6) * 0.3})`;
      ctx.fillText('[F] DOCK TO UPGRADE · cargo offloads automatically', this.W / 2, by - 26);
    }
  }
}
