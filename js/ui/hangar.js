// Docked hangar aboard your starship: Planet, Shipyard, Fighter, Research, Log.
import { versionLine } from './version.js';
import { ORES, PARTS, ECONOMY, FLAVOR, PLANETGEN } from '../data.js';
import { el, toast, popEl } from './dom.js';
import { money, fmt, fmtTime, pick } from '../util.js';
import { Builder, refundValue } from './builder.js';
import { sellValue, upgradeEffects } from '../economy.js';
import { Design, analyze } from '../shipdesign.js';

export class Hangar {
  constructor(game) {
    this.game = game;
    this.builder = new Builder(game);
    this.tab = 'market';
    this.tabs = {
      shipyard: { label: 'Shipyard', render: (c) => this.builder.mount(c), leave: () => this.builder.unmount() },
      market: { label: 'Planet', render: (c) => this.renderMarket(c) },
      log: { label: 'Log & Settings', render: (c) => this.renderLog(c) },
    };
    this.order = ['market', 'shipyard', 'log'];
  }

  // other modules register extra tabs (research, star map)
  addTab(id, label, render, after = 'shipyard', when = null) {
    this.tabs[id] = { label, render, when };
    this.order.splice(this.order.indexOf(after) + 1, 0, id);
  }

  get save() { return this.game.save; }

  open(tab) {
    this.close();
    this.root = el('div', { class: 'hangar' });
    this.creditsEl = el('span', { class: 'money big' }, money(this.save.credits));
    this.tabBar = el('div', { class: 'h-tabs' });
    this.launchBtn = el('button', { class: 'btn primary launch', onclick: () => this.game.launch() }, 'LAUNCH ▶');
    this.top = el('div', { class: 'h-top' },
      el('div', { class: 'h-title' }, el('span', { class: 'logo' }, 'SPACE FARMER'), el('span', { class: 'dim' }, ' · Starship, orbiting ' + this.game.planetLabel())),
      this.tabBar,
      el('div', { class: 'h-right' }, this.creditsEl, this.launchBtn));
    this.body = el('div', { class: 'h-body' });
    this.root.append(this.top, this.body);
    this.game.ui.append(this.root);
    this.show(tab || this.tab);
    this.updateLaunch();
  }

  close() {
    if (!this.root) return;
    const t = this.tabs[this.tab];
    t && t.leave && t.leave();
    this.root.remove();
    this.root = null;
  }

  show(id) {
    if (!this.root) return;
    if (this.tabs[id].when && !this.tabs[id].when()) id = 'market';
    const prev = this.tabs[this.tab];
    if (prev && prev.leave && this.tab !== id) prev.leave();
    if (this.tab === 'shipyard' && id === 'shipyard') this.builder.unmount();
    this.tab = id;
    this.tabBar.innerHTML = '';
    for (const k of this.order) {
      if (this.tabs[k].when && !this.tabs[k].when()) continue;
      const b = el('button', { class: 'h-tab' + (k === id ? ' on' : ''), onclick: () => { this.game.sfx('click'); this.show(k); } }, this.tabs[k].label);
      if (k === 'market' && this.save.cargoUnits > 0) b.append(el('span', { class: 'badge' }, '●'));
      this.tabBar.append(b);
    }
    this.body.innerHTML = '';
    this.body.className = 'h-body tab-' + id;
    this.tabs[id].render(this.body);
    this.game.onTab && this.game.onTab(id);
  }

  refresh() { if (this.root) this.show(this.tab); }

  updateCredits() {
    if (!this.root) return;
    this.creditsEl.textContent = money(this.save.credits);
    popEl(this.creditsEl);
  }

  updateLaunch() {
    if (!this.root) return;
    const a = analyze(Design.fromJSON(this.save.design), this.save.upgrades, { role: 'freighter' });
    const rep = this.game.escort.repairing;
    this.launchBtn.disabled = !a.launchable || rep;
    this.launchBtn.textContent = rep ? `REPAIRING ${fmtTime(this.save.fighter.repairT)}` : 'LAUNCH ▶';
    this.launchBtn.title = rep ? 'Your fighter is in the repair bay. Mining waits for it.' : a.launchable ? 'Undock and fly (Enter)' : (a.warnings.find((w) => w.lvl === 'err')?.text || 'Ship not flightworthy');
  }
  // keep the launch button's repair countdown live
  tick(dt) {
    this._t = (this._t || 0) + dt;
    if (this._t < 0.5) return;
    this._t = 0;
    const was = this._rep;
    this._rep = this.game.escort.repairing;
    this.updateLaunch();
    if (was && !this._rep) { toast('Your fighter is repaired and ready.', 'good'); this.game.sfx('repair'); if (this.tab === 'fighter' || this.tab === 'market') this.refresh(); }
  }

  // ---------------------------------------------------------------- planet
  renderMarket(c) {
    const s = this.save, g = this.game;
    const pl = g.world.planet;
    const fx = upgradeEffects(s.upgrades);
    const pct = pl.percent;
    // layer breakdown: how much of each layer is gone
    const layers = PLANETGEN.layers.map((L, i) => ({ L, inner: L.to, outer: i ? PLANETGEN.layers[i - 1].to : 1 }));
    const prog = el('div', { class: 'card planet-card' },
      el('h3', {}, g.planetLabel()),
      el('div', { class: 'big-pct' }, `${pct < 10 ? pct.toFixed(3) : pct.toFixed(2)}%`),
      el('div', { class: 'dim' }, `mined · ${fmt(pl.total - pl.remaining)} of ${fmt(pl.total)} cubes`),
      el('div', { class: 's-bar big' }, el('i', { style: { width: Math.max(0.5, pct) + '%', background: 'linear-gradient(90deg,#ffd60a,#ff3cac)' } })),
      el('table', { class: 'tbl' },
        el('tr', {}, el('th', {}, 'Layer'), el('th', {}, 'Ore'), el('th', {}, 'Tool')),
        layers.map(({ L }) => el('tr', {}, el('td', {}, L.name), el('td', {}, el('span', { style: { color: ORES[L.base].glow } }, ORES[L.base].name), ' / ', el('span', { style: { color: ORES[L.vein].glow } }, ORES[L.vein].name)),
          el('td', { class: ORES[L.base].tier > 1 ? 'warn' : 'dim' }, ['', 'Mining Laser', 'Plasma Cutter', 'Deep Bore'][ORES[L.base].tier])))),
      el('p', { class: 'dim small' }, 'Cargo is offloaded and sold automatically whenever the freighter returns to the starship.'));
    const prices = el('div', { class: 'card' },
      el('h3', {}, 'Ore prices'),
      el('p', { class: 'dim small' }, fx.sellMult * fx.yieldMult > 1 ? `Your bonuses: ×${(fx.sellMult * fx.yieldMult).toFixed(2)}` : 'Prices set by a committee that has never seen ore.'),
      el('table', { class: 'tbl' }, el('tr', {}, el('th', {}, 'Ore'), el('th', {}, 'Per cube'), el('th', {}, 'Hardness')),
        Object.keys(ORES).filter((k) => k !== 'core').map((k) => el('tr', {}, el('td', { style: { color: ORES[k].glow } }, ORES[k].name),
          el('td', { class: 'money' }, money(Math.max(1, ORES[k].value * pl.valueMult * fx.sellMult * fx.yieldMult))), el('td', { class: 'dim' }, Math.round(ORES[k].hp * pl.hpMult))))));
    const rec = el('div', { class: 'card' }, el('h3', {}, 'Records'),
      el('div', { class: 'kv' },
        ...[['Time on this planet', fmtTime(s.stats.planetTime)], ['Planets mined', s.legacy.completed], ['Longest fighter shift', fmtTime(s.fighter.longestShift || 0)],
          ['Enemy ships destroyed', fmt(s.stats.kills)], ['Capital ships destroyed', fmt(s.stats.elites)], ['Cubes mined (all time)', fmt(s.stats.oreMined)]]
          .map(([k, v]) => el('div', {}, el('span', { class: 'dim' }, k), el('span', {}, String(v))))));
    c.append(el('div', { class: 'market' }, prog, el('div', { class: 'col' }, this.game.goalCard(), rec), prices));
  }

  sellAll(btn) {
    const s = this.save;
    const total = sellValue(s.cargo || {}, s.upgrades);
    if (total <= 0) return;
    s.oreSold = (s.oreSold || 0) + s.cargoUnits;
    s.cargo = {}; s.cargoUnits = 0;
    this.game.addCredits(total, btn);
    this.game.sfx('sell');
    toast(`Sold ore for ${money(total)}`, 'money');
    this.game.onSold && this.game.onSold(total);
    this.game.persist();
    this.show('market');
  }

  // ------------------------------------------------------------------ log
  renderLog(c) {
    const s = this.save, st = s.stats;
    const set = s.settings;
    const slider = (label, key, min, max, step) => el('label', { class: 'set' }, el('span', {}, label),
      el('input', { type: 'range', min, max, step, value: set[key], oninput: (e) => { set[key] = Number(e.target.value); this.game.applySettings(); } }));
    const check = (label, key) => el('label', { class: 'set' }, el('span', {}, label),
      el('input', { type: 'checkbox', checked: !!set[key], onchange: (e) => { set[key] = e.target.checked; this.game.applySettings(); } }));
    c.append(el('div', { class: 'market' },
      el('div', { class: 'card' }, el('h3', {}, 'Career'),
        el('div', { class: 'kv' },
          ...[['Time played', fmtTime(st.playTime)], ['Credits earned', money(st.earned)], ['Cubes mined', fmt(st.oreMined)],
            ['Enemy ships destroyed', fmt(st.kills)], ['Capital ships destroyed', fmt(st.elites)], ['Fighter retreats', fmt(st.retreats)], ['Planets mined', fmt(s.legacy.completed)]]
            .map(([k, v]) => el('div', {}, el('span', { class: 'dim' }, k), el('span', {}, v))))),
      el('div', { class: 'card' }, el('h3', {}, 'Settings'),
        slider('Master volume', 'volume', 0, 1, 0.05), slider('Music', 'music', 0, 1, 0.05), slider('Screen shake', 'shake', 0, 1.5, 0.1),
        check('Physics telemetry (F3)', 'telemetry'),
        this.game.skinPicker(),
        el('div', { class: 'bp-row' },
          el('button', { class: 'btn small', onclick: () => { s.tutorial = { step: 0, done: false }; this.game.persist(); toast('Tutorial will replay on next launch', 'good'); } }, 'Replay tutorial'),
          el('button', { class: 'btn small danger', onclick: () => { if (confirm('Erase all progress? This cannot be undone.')) this.game.wipe(); } }, 'Erase save')),
        versionLine()),
      el('div', { class: 'card' }, el('h3', {}, 'Controls'), el('div', { class: 'kv controls' },
        ...[['W / S', 'Thrust forward / reverse'], ['A / D', 'Rotate'], ['Q / E', 'Strafe'], ['Space', 'Fire mining tools'], ['F', 'Dock at the starship'],
          ['X (hold)', 'Brake'], ['V', 'Watch your fighter'], ['P', 'Whole-planet view'], ['R (hold)', 'Warp home'], ['T', 'Toggle flight assist'], ['Wheel', 'Zoom'], ['Esc', 'Pause (settings live here too)'], ['Idle', 'Autopilot mines after 5s without input'], ['Gamepad', 'Sticks fly, RT/A fire, LT brake, LB/RB strafe, B dock']]
          .map(([k, v]) => el('div', {}, el('span', { class: 'key' }, k), el('span', {}, v)))))));
  }
}
