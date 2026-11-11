// Research tree, Star Map, and the "Road to Doomsday" progress tracker.
import { UPGRADES, SECTORS, BOSSES, PARTS, ORES, PLANETS } from '../data.js';
import { UPGRADE_BY_ID, canBuyUpgrade, sectorUnlocked, droneIncomePerMinute, frameSize, planetReward } from '../economy.js';
import { el, toast, popEl } from './dom.js';
import { money } from '../util.js';
import { Design } from '../shipdesign.js';

const BRANCH_COLORS = { Industry: '#2ee6a6', Engineering: '#ff9f1c', Arsenal: '#ff4d6d', Licenses: '#7df9ff', Doomsday: '#ff3cac' };

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
        el('div', { class: 'r-name' }, u.name, maxed && max === 1 ? ' ✓' : ''),
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

export function renderStarMap(game, c) {
  const s = game.save;
  const map = el('div', { class: 'starmap' });
  SECTORS.forEach((sec, i) => {
    const open = sectorUnlocked(i, s);
    const here = s.sector === i;
    const bossDone = sec.boss ? s.bossKills[sec.boss] : null;
    const ores = Object.keys(sec.ores).map((k) => el('span', { class: 'ore-chip', style: { color: ORES[k].glow, borderColor: ORES[k].glow } }, ORES[k].name));
    const lic = sec.license ? UPGRADE_BY_ID[sec.license] : null;
    const planet = el('canvas', { width: 90, height: 90, class: 'sm-planet' });
    drawMiniPlanet(planet.getContext('2d'), sec, i);
    map.append(el('div', { class: `sm-node ${open ? '' : 'locked'} ${here ? 'here' : ''}` },
      planet,
      el('div', { class: 'sm-name' }, sec.name),
      el('div', { class: 'sm-blurb dim' }, sec.blurb),
      el('div', { class: 'sm-ores' }, ores),
      el('div', { class: 'sm-row' }, el('span', { class: 'dim' }, 'Rock hardness'), el('span', {}, '×' + sec.hardness)),
      el('div', { class: 'sm-row' }, el('span', { class: 'dim' }, 'Hostiles'), el('span', {}, '×' + sec.enemyScale)),
      sec.boss ? el('div', { class: 'sm-row' }, el('span', { class: 'dim' }, 'Boss'), el('span', { class: bossDone ? 'good' : 'bad' }, BOSSES[sec.boss].name + (bossDone ? ' ✓' : ''))) : el('div', { class: 'sm-row' }, el('span', { class: 'dim' }, 'Target'), el('span', { class: 'bad' }, PLANETS.names[s.planetsDestroyed % PLANETS.names.length])),
      here ? el('div', { class: 'sm-here' }, 'YOU ARE HERE')
        : open ? el('button', { class: 'btn primary small', onclick: () => game.jump(i) }, 'Jump here')
          : el('div', { class: 'r-req' }, `Needs ${lic.name} (Research)`)));
    if (i < SECTORS.length - 1) map.append(el('div', { class: 'sm-link' + (sectorUnlocked(i + 1, s) ? ' on' : '') }));
  });
  c.append(el('p', { class: 'dim center' }, 'Each sector has its own outpost. Harder rocks hold richer ore. Jumping is free; the paperwork is not.'), map);
}

function drawMiniPlanet(g, sec, i) {
  const grd = g.createRadialGradient(36, 36, 4, 45, 45, 42);
  grd.addColorStop(0, sec.bg[1]); grd.addColorStop(0.7, sec.bg[0]); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(45, 45, 40, 0, Math.PI * 2); g.fill();
  const oreCol = ORES[Object.keys(sec.ores).slice(-1)[0]].glow;
  g.strokeStyle = oreCol; g.lineWidth = 2; g.shadowColor = oreCol; g.shadowBlur = 8;
  g.beginPath(); g.arc(45, 45, 32, 0, Math.PI * 2); g.stroke();
  g.shadowBlur = 0;
  for (let k = 0; k < 6 + i * 2; k++) { const a = k * 2.4 + i, r = 12 + ((k * 7) % 18); g.fillStyle = oreCol; g.globalAlpha = 0.7; g.fillRect(45 + Math.cos(a) * r, 45 + Math.sin(a) * r, 3, 3); }
  g.globalAlpha = 1;
}

// Ordered checklist that always shows the next step to planet destruction.
export function roadToDoomsday(save) {
  const has = (id) => (save.upgrades[id] || 0) > 0;
  const design = Design.fromJSON(save.design);
  const steps = [
    { text: 'Mine ore and sell it at the Market', done: save.stats.earned > 0 },
    { text: 'Buy a part or research an upgrade', done: Object.keys(save.upgrades).length > 0 || (save.stats.partsBought || 0) > 0 },
    { text: `Defeat ${BOSSES.grudge.name} (fill the threat meter in The Shallows)`, done: !!save.bossKills.grudge },
    { text: 'Research the Rust Belt License', done: has('licRust') },
    { text: `Defeat ${BOSSES.auditor.name} in the Rust Belt`, done: !!save.bossKills.auditor },
    { text: 'Research the Glass Reach License', done: has('licGlass') },
    { text: `Defeat ${BOSSES.matriarch.name} in the Glass Reach`, done: !!save.bossKills.matriarch },
    { text: 'Research the Deep Pale License', done: has('licPale') },
    { text: 'Research Fusion Licensing and Planet Cracker Schematics', done: has('cracker') },
    { text: `Defeat ${BOSSES.mildred.name} in the Deep Pale`, done: !!save.bossKills.mildred },
    { text: 'Research Gorvox Clearance', done: has('licGorvox') },
    { text: 'Install a Planet Cracker (3×3, needs an 11×11 frame and serious power)', done: design.entries.some((e) => e.part === 'cracker') || save.planetsDestroyed > 0 },
    { text: 'Jump to Gorvox, aim at the planet and hold [C]', done: save.planetsDestroyed > 0 },
  ];
  return steps;
}

export function goalCard(game) {
  const s = game.save;
  const steps = roadToDoomsday(s);
  const next = steps.findIndex((x) => !x.done);
  const list = el('ol', { class: 'road' }, steps.map((st, i) => el('li', { class: st.done ? 'done' : i === next ? 'next' : '' }, st.text)));
  const drones = droneIncomePerMinute(s.upgrades);
  // what to save for: cheapest thing currently purchasable that isn't owned
  const options = UPGRADES.map((u) => ({ u, chk: canBuyUpgrade(u.id, s) })).filter((o) => o.chk.cost > 0 && (o.chk.ok || o.chk.reason === 'Not enough credits'));
  options.sort((a, b) => a.chk.cost - b.chk.cost);
  const target = options.find((o) => !o.chk.ok) || options[0];
  return el('div', { class: 'card road-card' },
    el('h3', {}, next < 0 ? `Planets destroyed: ${s.planetsDestroyed}` : 'Road to Doomsday'),
    next < 0 ? el('p', {}, `The next planet pays `, el('span', { class: 'money' }, money(planetReward(s.planetsDestroyed, s.upgrades))), '. Gorvox has more where that came from.') : list,
    target ? el('div', { class: 'saving' }, el('span', { class: 'dim' }, target.chk.ok ? 'Ready to research: ' : 'Saving for: '), target.u.name, ' ',
      el('div', { class: 's-bar' }, el('i', { style: { width: Math.min(100, (s.credits / target.chk.cost) * 100) + '%', background: '#ffd60a' } })),
      el('span', { class: 'money' }, `${money(s.credits)} / ${money(target.chk.cost)}`)) : '',
    drones ? el('p', { class: 'dim small' }, `Drones: +${money(drones)}/min, even offline (up to 4h).`) : '');
}
