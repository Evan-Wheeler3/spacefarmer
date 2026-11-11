// Docked hangar: tabbed overlay (Shipyard, Market, Research, Star Map, Log).
import { ORES, PARTS, SECTORS, ECONOMY, FLAVOR } from '../data.js';
import { el, toast, popEl } from './dom.js';
import { money, fmt, fmtTime, pick } from '../util.js';
import { Builder, refundValue } from './builder.js';
import { sellValue, upgradeEffects, droneIncomePerMinute } from '../economy.js';
import { Design, analyze } from '../shipdesign.js';

export class Hangar {
  constructor(game) {
    this.game = game;
    this.builder = new Builder(game);
    this.tab = 'market';
    this.tabs = {
      shipyard: { label: 'Shipyard', render: (c) => this.builder.mount(c), leave: () => this.builder.unmount() },
      market: { label: 'Market', render: (c) => this.renderMarket(c) },
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
      el('div', { class: 'h-title' }, el('span', { class: 'logo' }, 'SPACE FARMER'), el('span', { class: 'dim' }, ' · Franchise Outpost, ' + SECTORS[this.save.sector].name)),
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
    const a = analyze(Design.fromJSON(this.save.design), this.save.upgrades);
    this.launchBtn.disabled = !a.launchable;
    this.launchBtn.title = a.launchable ? 'Undock and fly (Enter)' : (a.warnings.find((w) => w.lvl === 'err')?.text || 'Ship not flightworthy');
  }

  // --------------------------------------------------------------- market
  renderMarket(c) {
    const s = this.save;
    const fx = upgradeEffects(s.upgrades);
    const cargo = s.cargo || {};
    const total = sellValue(cargo, s.upgrades);
    const rows = Object.keys(cargo).filter((k) => cargo[k] > 0.01);
    const sellCard = el('div', { class: 'card' },
      el('h3', {}, 'Ore Exchange'),
      el('p', { class: 'dim' }, fx.sellMult > 1 ? `Broker bonus: +${Math.round((fx.sellMult - 1) * 100)}%` : 'Prices set by a committee that has never seen ore.'),
      rows.length ? el('table', { class: 'tbl' },
        el('tr', {}, el('th', {}, 'Ore'), el('th', {}, 'Units'), el('th', {}, 'Price'), el('th', {}, 'Value')),
        rows.map((k) => el('tr', {}, el('td', { style: { color: ORES[k].glow } }, ORES[k].name), el('td', {}, Math.floor(cargo[k])), el('td', {}, money(ORES[k].value * fx.sellMult)), el('td', { class: 'money' }, money(ORES[k].value * cargo[k] * fx.sellMult)))))
        : el('p', { class: 'empty' }, 'Cargo hold is empty. Go point a laser at a rock.'),
      el('button', { class: 'btn gold big-btn', disabled: !rows.length, onclick: (e) => this.sellAll(e.target) }, rows.length ? `SELL ALL  ${money(total)}` : 'Nothing to sell'));

    const design = Design.fromJSON(s.design);
    const rep = this.game.repairCost(design);
    const wrecked = design.entries.filter((e) => e.hp === 0).length;
    const repairCard = el('div', { class: 'card' },
      el('h3', {}, 'Repairs'),
      rep.total > 0
        ? el('p', {}, `${rep.damaged} damaged part(s)${wrecked ? `, ${wrecked} wrecked` : ''}. Full repair: `, el('span', { class: 'money' }, money(rep.total)))
        : el('p', { class: 'dim' }, 'Hull is pristine. The mechanics are bored.'),
      el('button', { class: 'btn primary', disabled: rep.total <= 0 || s.credits <= 0, onclick: () => this.game.repair() }, s.credits >= rep.total ? 'Repair all' : 'Repair what we can afford'),
      el('p', { class: 'dim small' }, 'Fuel is topped up automatically when you dock.'));

    const lt = this.game.lastTrip;
    const tripCard = el('div', { class: 'card' },
      el('h3', {}, 'Last Trip'),
      lt ? el('div', { class: 'kv' },
        el('div', {}, el('span', { class: 'dim' }, 'Duration'), el('span', {}, fmtTime(lt.time))),
        el('div', {}, el('span', { class: 'dim' }, 'Ore collected'), el('span', {}, Math.floor(lt.ore))),
        el('div', {}, el('span', { class: 'dim' }, 'Kills'), el('span', {}, lt.kills)),
        el('div', {}, el('span', { class: 'dim' }, 'Bounties'), el('span', { class: 'money' }, money(lt.bounty))),
        el('div', {}, el('span', { class: 'dim' }, 'Refuel'), el('span', {}, money(lt.refuel))))
        : el('p', { class: 'dim' }, pick(FLAVOR.docks)),
      droneIncomePerMinute(s.upgrades) ? el('p', {}, 'Drone Bay income: ', el('span', { class: 'money' }, money(droneIncomePerMinute(s.upgrades)) + '/min')) : '');
    c.append(el('div', { class: 'market' }, el('div', { class: 'col' }, sellCard, this.game.contractCard()), el('div', { class: 'col' }, repairCard, tripCard), this.game.goalCard()));
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
          ...[['Time played', fmtTime(st.playTime)], ['Credits earned', money(st.earned)], ['Ore mined', fmt(st.oreMined)], ['Rocks cracked', fmt(st.rocks)],
            ['Pirates dissuaded', fmt(st.kills)], ['Bosses defeated', fmt(st.bosses)], ['Ships lost', fmt(st.deaths)], ['Planets destroyed', fmt(s.planetsDestroyed)]]
            .map(([k, v]) => el('div', {}, el('span', { class: 'dim' }, k), el('span', {}, v))))),
      el('div', { class: 'card' }, el('h3', {}, 'Settings'),
        slider('Master volume', 'volume', 0, 1, 0.05), slider('Music', 'music', 0, 1, 0.05), slider('Screen shake', 'shake', 0, 1.5, 0.1),
        check('Physics telemetry (F3)', 'telemetry'),
        el('div', { class: 'bp-row' },
          el('button', { class: 'btn small', onclick: () => { s.tutorial = { step: 0, done: false }; this.game.persist(); toast('Tutorial will replay on next launch', 'good'); } }, 'Replay tutorial'),
          el('button', { class: 'btn small danger', onclick: () => { if (confirm('Erase all progress? This cannot be undone.')) this.game.wipe(); } }, 'Erase save'))),
      el('div', { class: 'card' }, el('h3', {}, 'Controls'), el('div', { class: 'kv controls' },
        ...[['W / S', 'Thrust forward / reverse'], ['A / D', 'Rotate'], ['Q / E', 'Strafe'], ['Space', 'Fire mining lasers & railguns'], ['F', 'Dock (near outpost)'],
          ['G', 'Start next combat contract'], ['R (hold)', 'Recall to outpost'], ['C (hold)', 'Charge Planet Cracker'], ['T', 'Toggle flight assist'], ['Wheel', 'Zoom'], ['Esc', 'Pause'], ['Gamepad', 'Sticks fly, RT/A fire, LB/RB strafe, X contract, Y crack, B dock']]
          .map(([k, v]) => el('div', {}, el('span', { class: 'key' }, k), el('span', {}, v)))))));
  }
}
