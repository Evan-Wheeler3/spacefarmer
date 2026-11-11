// Dev sandbox: a separate save slot with cheats, upgrade editing and spawn tools.
import { UPGRADES, BOSSES, ENEMIES, SECTORS, GRID } from '../data.js';
import { newSave } from '../save.js';
import { frameSize, UPGRADE_BY_ID } from '../economy.js';
import { el, toast } from './dom.js';
import { money, TAU, rand } from '../util.js';
import { wipeSave, SANDBOX_KEY } from '../save.js';

const FLAGS = [
  ['infCredits', 'Infinite credits', 'Credits never drop below ¢1B'],
  ['god', 'God mode', 'Your parts take no damage'],
  ['infFuel', 'Infinite fuel', 'Fuel stays full'],
  ['infPower', 'Infinite power', 'Batteries stay full (no brownouts)'],
  ['peaceful', 'Peaceful', 'No ambient pirates while mining'],
];

export class Dev {
  constructor(game) {
    this.game = game;
    game.hangar.addTab('dev', '⚙ Dev', (c) => this.render(c), 'log', () => this.on);
  }
  get on() { return !!(this.game.save && this.game.save.sandbox); }
  get flags() { return (this.game.save.dev = this.game.save.dev || {}); }

  freshSave() {
    const s = newSave();
    s.sandbox = true;
    s.credits = 1e9;
    for (const u of UPGRADES) s.upgrades[u.id] = u.cost.length;
    for (const b in BOSSES) s.bossKills[b] = 1;
    s.tutorial.done = true;
    s.dev = { infCredits: true, god: false, infFuel: true, infPower: false, peaceful: true };
    return s;
  }

  // ------------------------------------------------------------ per-frame
  apply() {
    if (!this.on) return;
    const f = this.flags, g = this.game;
    if (f.infCredits && g.save.credits < 1e9) g.save.credits = 1e9;
    const ship = g.ship;
    if (ship && (g.state === 'flight' || g.state === 'cinematic')) {
      ship.god = !!f.god;
      if (f.infFuel) ship.fuel = ship.fuelMax;
      if (f.infPower) { ship.energy = ship.energyMax; ship.powerFactor = 1; }
    }
  }
  update() { this.apply(); this.bar(); }
  updateDocked() { this.apply(); this.bar(); }
  onHangar() { this.bar(); }

  // --------------------------------------------------------- hangar tab
  render(c) {
    const g = this.game, s = g.save;
    const refresh = () => { g.persist(); g.hangar.updateCredits(); g.hangar.updateLaunch(); g.hangar.show('dev'); };

    const flags = el('div', { class: 'card' }, el('h3', {}, 'Cheats'),
      ...FLAGS.map(([k, label, tip]) => el('label', { class: 'set', title: tip }, el('span', {}, label),
        el('input', { type: 'checkbox', checked: !!this.flags[k], onchange: (e) => { this.flags[k] = e.target.checked; g.persist(); } }))),
      el('div', { class: 'bp-row' },
        el('input', { class: 'inp', type: 'number', value: Math.floor(s.credits), id: 'dev-credits' }),
        el('button', { class: 'btn small', onclick: () => { s.credits = Math.max(0, Number(document.getElementById('dev-credits').value) || 0); this.flags.infCredits = false; refresh(); } }, 'Set credits')),
      el('p', { class: 'dim small' }, 'Turn off Infinite credits to test the real economy from a set balance.'));

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

    const prog = el('div', { class: 'card' }, el('h3', {}, 'Progress'),
      ...Object.entries(BOSSES).map(([id, b]) => el('label', { class: 'set' }, el('span', {}, `${b.name} defeated`),
        el('input', { type: 'checkbox', checked: !!s.bossKills[id], onchange: (e) => { if (e.target.checked) s.bossKills[id] = 1; else delete s.bossKills[id]; refresh(); } }))),
      el('h3', { style: { marginTop: '12px' } }, 'Contract boards'),
      ...SECTORS.map((sec) => {
        const bd = (s.contracts[sec.id] = s.contracts[sec.id] || { k: 0, cleared: 0 });
        return el('label', { class: 'set' }, el('span', {}, sec.name),
          el('input', { class: 'inp', type: 'number', min: 0, max: sec.contracts, value: bd.k, style: { width: '70px' },
            onchange: (e) => { bd.k = Math.max(0, Math.min(sec.contracts, Number(e.target.value) || 0)); g.persist(); } }),
          el('span', { class: 'dim small' }, `/ ${sec.contracts}${sec.boss ? ' (= boss)' : ''}`));
      }),
      el('label', { class: 'set' }, el('span', {}, 'Planets destroyed'),
        el('input', { class: 'inp', type: 'number', min: 0, value: s.planetsDestroyed, style: { width: '70px' }, onchange: (e) => { s.planetsDestroyed = Math.max(0, Number(e.target.value) || 0); g.persist(); } })));

    const jump = el('div', { class: 'card' }, el('h3', {}, 'Jump anywhere'),
      el('div', { class: 'dev-grid' }, ...SECTORS.map((sec, i) => el('button', { class: 'btn small' + (s.sector === i ? ' on' : ''), onclick: () => {
        g.jump(i, true, 'dev'); } }, sec.name))),
      el('h3', { style: { marginTop: '12px' } }, 'Sandbox'),
      el('p', { class: 'dim small' }, 'This slot is separate from your real save. In flight, a dev bar at the bottom spawns enemies and bosses and changes game speed.'),
      el('button', { class: 'btn small danger', onclick: () => { if (!confirm('Reset the sandbox to a fresh, fully-upgraded state?')) return; wipeSave(SANDBOX_KEY); g.save = this.freshSave(); g.settings = g.save.settings; g.persist(); g.enterHangar('dev'); } }, 'Reset sandbox'));

    c.append(el('div', { class: 'market dev' }, el('div', { class: 'col' }, flags, jump), ups, prog));
  }

  // ------------------------------------------------------------ flight bar
  bar() {
    const g = this.game;
    const show = this.on && g.state === 'flight' && g.ship;
    if (!show) { if (this.barEl) { this.barEl.remove(); this.barEl = null; } return; }
    if (this.barEl) {
      this.barEl.querySelector('.dev-god').classList.toggle('on', !!this.flags.god);
      for (const b of this.barEl.querySelectorAll('.dev-speed')) b.classList.toggle('on', Number(b.dataset.s) === g.timeScale);
      return;
    }
    const es = g.enemySystem;
    const near = () => { const a = rand(0, TAU); return [g.ship.x + Math.cos(a) * 520, g.ship.y + Math.sin(a) * 520]; };
    const typeSel = el('select', { class: 'inp dev-sel', onchange: (e) => e.target.blur() }, ...Object.entries(ENEMIES).map(([id, d]) => el('option', { value: id }, d.name)));
    const bossSel = el('select', { class: 'inp dev-sel', onchange: (e) => e.target.blur() }, ...Object.entries(BOSSES).map(([id, d]) => el('option', { value: id }, d.name)));
    const b = (label, fn, cls = '') => el('button', { class: 'btn small ' + cls, onmousedown: (e) => e.preventDefault(), onclick: (e) => { e.currentTarget.blur(); fn(); } }, label);
    const spawn = (n) => { for (let i = 0; i < n; i++) { const [x, y] = near(); es.makeEnemy(typeSel.value, x, y); } };
    this.barEl = el('div', { class: 'devbar' },
      el('span', { class: 'dev-tag' }, 'DEV'),
      typeSel, b('+1', () => spawn(1)), b('+5', () => spawn(5)),
      bossSel, b('Boss', () => { if (es.boss) return toast('One boss at a time', 'bad'); es.spawnBoss(bossSel.value); }, 'danger'),
      b('Kill all', () => { for (const e of g.world.enemies) if (!e.dead) es.damage(e, 1e12, e.x, e.y, true); }),
      b('God', () => { this.flags.god = !this.flags.god; g.persist(); }, 'dev-god'),
      b('Repair', () => { for (const p of g.ship.parts) if (p.alive) p.hp = p.maxHp; g.ship.version++; }),
      ...[0.25, 1, 2, 4].map((sp) => { const x = b(`×${sp}`, () => { g.timeScale = sp; }, 'dev-speed'); x.dataset.s = sp; return x; }),
      g.planet && g.planet.p ? b('→ Planet', () => { const p = g.planet.p; const a = Math.atan2(g.ship.y - p.y, g.ship.x - p.x); g.ship.x = p.x + Math.cos(a) * (p.r + 600); g.ship.y = p.y + Math.sin(a) * (p.r + 600); g.ship.vx = g.ship.vy = 0; g.cam.snap(g.ship.x, g.ship.y); }) : '');
    g.ui.append(this.barEl);
    this.bar();
  }
}
