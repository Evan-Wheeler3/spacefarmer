// Sandbox: a separate save slot with cheats, research editing, planet and swarm tools.
import { UPGRADES, BOSSES, ENEMIES } from '../data.js';
import { newSave, wipeSave, SANDBOX_KEY } from '../save.js';
import { frameSize } from '../economy.js';
import { el, toast } from './dom.js';
import { TAU, rand } from '../util.js';

const FLAGS = [
  ['infCredits', 'Infinite credits', 'Credits never drop below ¢1B'],
  ['god', 'God mode (fighter)', 'Your fighter takes no damage'],
  ['infFuel', 'Infinite fuel', 'Fuel stays full'],
  ['infPower', 'Infinite power', 'Batteries stay full'],
  ['peaceful', 'No swarm', 'Enemies stop spawning'],
];

export class Dev {
  constructor(game) {
    this.game = game;
    game.hangar.addTab('dev', '⚙ Sandbox', (c) => this.render(c), 'log', () => this.on);
  }
  get on() { return !!(this.game.save && this.game.save.sandbox); }
  get flags() { return (this.game.save.dev = this.game.save.dev || {}); }

  freshSave() {
    const s = newSave();
    s.sandbox = true;
    s.credits = 1e9;
    for (const u of UPGRADES) s.upgrades[u.id] = u.cost.length;
    s.tutorial.done = true;
    s.dev = { infCredits: true, god: false, infFuel: true, infPower: false, peaceful: false };
    return s;
  }

  apply() {
    if (!this.on) return;
    const f = this.flags, g = this.game;
    if (f.infCredits && g.save.credits < 1e9) g.save.credits = 1e9;
    for (const ship of [g.ship, g.escort.ship]) {
      if (!ship) continue;
      if (ship === g.escort.ship) ship.god = !!f.god;
      if (f.infFuel) ship.fuel = ship.fuelMax;
      if (f.infPower) { ship.energy = ship.energyMax; ship.powerFactor = 1; }
    }
  }
  update() { this.apply(); this.bar(); }
  updateDocked() { this.apply(); this.bar(); }
  onHangar() { this.bar(); }

  render(c) {
    const g = this.game, s = g.save;
    const refresh = () => { g.persist(); g.hangar.updateCredits(); g.hangar.updateLaunch(); g.hangar.show('dev'); };
    const flags = el('div', { class: 'card' }, el('h3', {}, 'Cheats'),
      ...FLAGS.map(([k, label, tip]) => el('label', { class: 'set', title: tip }, el('span', {}, label),
        el('input', { type: 'checkbox', checked: !!this.flags[k], onchange: (e) => { this.flags[k] = e.target.checked; g.persist(); } }))),
      el('div', { class: 'bp-row' },
        el('input', { class: 'inp', type: 'number', value: Math.floor(s.credits), id: 'dev-credits' }),
        el('button', { class: 'btn small', onclick: () => { s.credits = Math.max(0, Number(document.getElementById('dev-credits').value) || 0); this.flags.infCredits = false; refresh(); } }, 'Set credits')),
      el('button', { class: 'btn small', onclick: () => { s.fighter.repairT = 0; refresh(); } }, 'Finish fighter repairs'));

    const pl = g.world.planet;
    const planet = el('div', { class: 'card' }, el('h3', {}, 'Planet'),
      el('p', {}, `Planet ${s.planet.index + 1} · ${pl.percent.toFixed(2)}% mined`),
      el('div', { class: 'dev-grid' },
        ...[1, 5, 25].map((p) => el('button', { class: 'btn small', onclick: () => {
          const n = Math.floor(pl.total * p / 100);
          pl.removeNearest(g.world.station.x, g.world.station.y, n);
          refresh();
        } }, `Mine ${p}% now`)),
        el('button', { class: 'btn small', onclick: () => { s.planet = { index: s.planet.index + 1, seed: (Math.random() * 1e9) | 0, removed: '' }; g.world = null; g.enterHangar('dev'); } }, 'Next planet'),
        el('button', { class: 'btn small', onclick: () => { s.planet = { index: Math.max(0, s.planet.index - 1), seed: (Math.random() * 1e9) | 0, removed: '' }; g.world = null; g.enterHangar('dev'); } }, 'Previous planet'),
        el('button', { class: 'btn small danger', onclick: () => { s.planet.removed = ''; s.planet.seed = (Math.random() * 1e9) | 0; g.world = null; g.enterHangar('dev'); } }, 'Fresh planet')),
      el('label', { class: 'set' }, el('span', {}, 'Legacy points'),
        el('input', { class: 'inp', type: 'number', min: 0, value: s.legacy.points, style: { width: '80px' }, onchange: (e) => { s.legacy.points = Math.max(0, Number(e.target.value) || 0); g.persist(); } })),
      el('h3', { style: { marginTop: '12px' } }, 'Sandbox'),
      el('p', { class: 'dim small' }, 'This slot is separate from your real save. In flight, a dev bar at the bottom spawns enemies and capital ships and changes game speed.'),
      el('button', { class: 'btn small danger', onclick: () => { if (!confirm('Reset the sandbox?')) return; wipeSave(SANDBOX_KEY); g.save = this.freshSave(); g.settings = g.save.settings; g.world = null; g.persist(); g.enterHangar('dev'); } }, 'Reset sandbox'));

    const ups = el('div', { class: 'card dev-ups' }, el('h3', {}, 'Research levels'),
      el('div', { class: 'bp-row' },
        el('button', { class: 'btn small primary', onclick: () => { for (const u of UPGRADES) s.upgrades[u.id] = u.cost.length; refresh(); } }, 'Max all'),
        el('button', { class: 'btn small danger', onclick: () => { s.upgrades = {}; refresh(); } }, 'Reset all')),
      ...UPGRADES.map((u) => {
        const lv = s.upgrades[u.id] || 0;
        const set = (v) => { s.upgrades[u.id] = Math.max(0, Math.min(u.cost.length, v)); if (!s.upgrades[u.id]) delete s.upgrades[u.id]; refresh(); };
        return el('div', { class: 'dev-up' },
          el('span', {}, u.name, u.id === 'frame' ? el('span', { class: 'dim' }, ` (${frameSize(s.upgrades)}×${frameSize(s.upgrades)})`) : ''),
          el('button', { class: 'btn small', onclick: () => set(lv - 1) }, '−'),
          el('span', { class: 'dev-lv' }, `${lv}/${u.cost.length}`),
          el('button', { class: 'btn small', onclick: () => set(lv + 1) }, '+'));
      }));
    c.append(el('div', { class: 'market dev' }, el('div', { class: 'col' }, flags, planet), ups));
  }

  // in-flight dev bar
  bar() {
    const g = this.game;
    const show = this.on && (g.state === 'flight' || g.state === 'watch') && g.escort.ship;
    if (!show) { if (this.barEl) { this.barEl.remove(); this.barEl = null; } return; }
    if (this.barEl) {
      this.barEl.querySelector('.dev-god').classList.toggle('on', !!this.flags.god);
      for (const b of this.barEl.querySelectorAll('.dev-speed')) b.classList.toggle('on', Number(b.dataset.s) === g.timeScale);
      return;
    }
    const es = g.enemySystem;
    const near = () => { const f = g.escort.ship, a = rand(0, TAU); return [f.x + Math.cos(a) * 700, f.y + Math.sin(a) * 700]; };
    const typeSel = el('select', { class: 'inp dev-sel', onchange: (e) => e.target.blur() }, ...Object.entries(ENEMIES).map(([id, d]) => el('option', { value: id }, d.name)));
    const bossSel = el('select', { class: 'inp dev-sel', onchange: (e) => e.target.blur() }, ...Object.entries(BOSSES).map(([id, d]) => el('option', { value: id }, d.name)));
    const b = (label, fn, cls = '') => el('button', { class: 'btn small ' + cls, onmousedown: (e) => e.preventDefault(), onclick: (e) => { e.currentTarget.blur(); fn(); } }, label);
    const spawn = (n) => { for (let i = 0; i < n; i++) { const [x, y] = near(); es.makeEnemy(typeSel.value, x, y); } };
    this.barEl = el('div', { class: 'devbar' },
      el('span', { class: 'dev-tag' }, 'DEV'),
      typeSel, b('+1', () => spawn(1)), b('+5', () => spawn(5)),
      bossSel, b('Capital', () => { if (es.boss) return toast('One capital ship at a time', 'bad'); es.spawnBoss(bossSel.value); }, 'danger'),
      b('Kill all', () => { for (const e of g.world.enemies) if (!e.dead) es.damage(e, 1e12, e.x, e.y, true); }),
      b('+1 min', () => { es.shiftT += 60; }),
      b('God', () => { this.flags.god = !this.flags.god; g.persist(); }, 'dev-god'),
      ...[0.25, 1, 2, 4].map((sp) => { const x = b(`×${sp}`, () => { g.timeScale = sp; }, 'dev-speed'); x.dataset.s = sp; return x; }));
    g.ui.append(this.barEl);
    this.bar();
  }
}
