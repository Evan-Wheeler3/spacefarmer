// Research tree and the "Road to the Core" progress tracker.
import { UPGRADES, PARTS, PLANETGEN, MAIN_PLANETS } from '../data.js';
import { UPGRADE_BY_ID, canBuyUpgrade, frameSize } from '../economy.js';
import { el, toast, popEl } from './dom.js';
import { money } from '../util.js';
import { Design } from '../shipdesign.js';

const BRANCH_COLORS = { Mining: '#2ee6a6', Automation: '#7df9ff', Engineering: '#ff9f1c', Defense: '#ff4d6d' };

export function renderResearch(game, c) {
  const s = game.save;
  const branches = [...new Set(UPGRADES.map((u) => u.branch))];
  const wrap = el('div', { class: 'research' });
  for (const b of branches) {
    const col = el('div', { class: 'r-col' }, el('div', { class: 'r-branch', style: { color: BRANCH_COLORS[b] } }, b));
    // order by dependency depth
    const depth = (u) => (u.requires.length ? 1 + Math.max(...u.requires.map((r) => depth(UPGRADE_BY_ID[r]))) : 0);
    const list = UPGRADES.filter((u) => u.branch === b).sort((a, z) => depth(a) - depth(z));
    for (const u of list) {
      const lv = s.upgrades[u.id] || 0;
      const max = u.cost.length;
      const chk = canBuyUpgrade(u.id, s);
      const maxed = lv >= max;
      const state = maxed ? 'maxed' : chk.ok ? 'ready' : chk.reason === 'Not enough credits' ? 'poor' : 'locked';
      const pips = max > 1 ? el('div', { class: 'r-pips' }, Array.from({ length: max }, (_, i) => el('i', { class: i < lv ? 'on' : '' }))) : '';
      const card = el('div', { class: `r-node ${state}`, style: { '--bc': BRANCH_COLORS[b] } },
        el('div', { class: 'r-name' }, u.name, maxed && max === 1 ? ' ✓' : '', el('span', { class: 'r-role ' + (u.role || 'both') }, u.role === 'fighter' ? 'FIGHTER' : u.role === 'freighter' ? 'FREIGHTER' : 'BOTH')),
        el('div', { class: 'r-desc' }, u.desc),
        pips,
        maxed ? el('div', { class: 'r-cost good' }, max > 1 ? 'MAXED' : 'OWNED')
          : el('div', { class: 'r-foot' },
            el('span', { class: 'money' }, money(chk.cost)),
            el('button', { class: 'btn small ' + (chk.ok ? 'gold' : ''), disabled: !chk.ok, title: chk.reason, onclick: (e) => buy(game, u, e.target) }, chk.ok ? (lv ? 'Upgrade' : 'Research') : state === 'poor' ? 'Save up' : 'Locked')),
        !maxed && !chk.ok && chk.reason !== 'Not enough credits' ? el('div', { class: 'r-req' }, chk.reason) : '');
      col.append(card);
    }
    wrap.append(col);
  }
  c.append(wrap);
}

function buy(game, u, btn) {
  const s = game.save;
  const chk = canBuyUpgrade(u.id, s);
  if (!chk.ok) { game.sfx('denied'); return; }
  s.credits -= chk.cost;
  s.upgrades[u.id] = (s.upgrades[u.id] || 0) + 1;
  game.sfx('upgrade');
  game.hangar.updateCredits();
  const unlockedPart = Object.entries(PARTS).find(([, p]) => p.unlock === u.id);
  toast(unlockedPart ? `${u.name}: ${unlockedPart[1].name} now available in the Shipyard` : `${u.name} ${s.upgrades[u.id] > 1 ? 'upgraded to level ' + s.upgrades[u.id] : 'researched'}`, 'good', 3000);
  if (u.id === 'frame') toast(`Build area is now ${frameSize(s.upgrades)}×${frameSize(s.upgrades)}`, 'good');
  game.persist();
  game.hangar.show('research');
  const node = [...document.querySelectorAll('.r-node .r-name')].find((n) => n.textContent.startsWith(u.name));
  if (node) { popEl(node.parentElement); node.parentElement.classList.add('flash'); }
}

// Ordered checklist that always shows the next step toward mining the planet out.
export function roadToCore(game) {
  const s = game.save, pl = game.world.planet, pct = pl.percent;
  const has = (id) => (s.upgrades[id] || 0) > 0;
  const fr = Design.fromJSON(s.design);
  const tool = (t) => fr.entries.some((e) => (PARTS[e.part].tier || 0) >= t);
  const at = (frac) => pct >= (1 - frac * frac) * 100; // share of the planet's area outside a layer edge
  const L = PLANETGEN.layers;
  return [
    { text: 'Mine cubes and bring them home (cargo sells itself at the starship)', done: s.stats.earned > 0 },
    { text: 'Upgrade your freighter or fighter in the Shipyard / Research', done: Object.keys(s.upgrades).some((k) => k !== '__legacy') || s.stats.partsBought > 0 },
    { text: `Strip the ${L[0].name} (${Math.round((1 - L[0].to ** 2) * 100)}% of the planet)`, done: at(L[0].to) },
    { text: 'Research Plasma Cutting and fit a Plasma Cutter', done: has('plasma') && tool(2) },
    { text: `Dig through the ${L[1].name}`, done: at(L[1].to) },
    { text: 'Research Deep Boring and fit a Deep Bore', done: has('deepbore') && tool(3) },
    { text: `Cut through the ${L[2].name}`, done: at(L[2].to) },
    { text: `Reach ${Math.round(PLANETGEN.collapseAt * 100)}%: the ${L[3].name.toLowerCase()} collapses and the planet is yours`, done: false },
  ];
}

export function goalCard(game) {
  const s = game.save;
  const steps = roadToCore(game);
  const next = steps.findIndex((x) => !x.done);
  const options = UPGRADES.map((u) => ({ u, chk: canBuyUpgrade(u.id, s) })).filter((o) => o.chk.cost > 0 && (o.chk.ok || o.chk.reason === 'Not enough credits'));
  options.sort((a, b) => a.chk.cost - b.chk.cost);
  const target = options.find((o) => !o.chk.ok) || options[0];
  return el('div', { class: 'card road-card' },
    el('h3', {}, `Road to the Core · planet ${s.planet.index + 1}${s.planet.index < MAIN_PLANETS ? ' of ' + MAIN_PLANETS : ' (endless)'}`),
    el('ol', { class: 'road' }, steps.map((st, i) => el('li', { class: st.done ? 'done' : i === next ? 'next' : '' }, st.text))),
    target ? el('div', { class: 'saving' }, el('span', { class: 'dim' }, target.chk.ok ? 'Ready to research: ' : 'Saving for: '), target.u.name, ' ',
      el('div', { class: 's-bar' }, el('i', { style: { width: Math.min(100, (s.credits / target.chk.cost) * 100) + '%', background: '#ffd60a' } })),
      el('span', { class: 'money' }, `${money(s.credits)} / ${money(target.chk.cost)}`)) : '');
}
