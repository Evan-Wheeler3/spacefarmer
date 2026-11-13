// Legacy: permanent perks bought with points earned by mining planets out.
import { LEGACY, MAIN_PLANETS } from '../data.js';
import { legacyEffects } from '../economy.js';
import { el, toast } from './dom.js';

export function renderLegacy(game, c) {
  const s = game.save, L = s.legacy;
  const free = L.points;
  const head = el('div', { class: 'card legacy-head' },
    el('h3', {}, '★ Legacy'),
    el('p', {}, el('span', { class: 'legacy-pts' }, `${free} point${free === 1 ? '' : 's'}`), ' to spend'),
    el('p', { class: 'dim small' }, `Every planet you mine out earns Legacy points (more for bigger planets). Perks are permanent and stack with research. ${L.completed >= MAIN_PLANETS ? 'You finished the main campaign: planets keep coming, and Swarm Survival is on the title screen.' : `Mine ${MAIN_PLANETS} planets to finish the campaign.`}`));
  const grid = el('div', { class: 'legacy-grid' });
  for (const p of LEGACY) {
    const lv = L.spent[p.id] || 0, max = p.cost.length, cost = p.cost[lv];
    const can = lv < max && free >= cost;
    grid.append(el('div', { class: 'r-node legacy ' + (lv >= max ? 'maxed' : can ? 'ready' : 'poor'), style: { '--bc': '#ffd60a' } },
      el('div', { class: 'r-name' }, p.name),
      el('div', { class: 'r-desc' }, p.desc),
      el('div', { class: 'r-pips' }, Array.from({ length: max }, (_, i) => el('i', { class: i < lv ? 'on' : '' }))),
      lv >= max ? el('div', { class: 'r-cost good' }, 'MAXED')
        : el('div', { class: 'r-foot' }, el('span', { class: 'legacy-cost' }, `★ ${cost}`),
          el('button', { class: 'btn small ' + (can ? 'gold' : ''), disabled: !can, onclick: () => {
            if (!(lv < max && L.points >= cost)) return;
            L.points -= cost;
            L.spent[p.id] = lv + 1;
            s.upgrades.__legacy = legacyEffects(L.spent);
            game.sfx('upgrade');
            toast(`${p.name} ${lv + 1 > 1 ? 'level ' + (lv + 1) : 'unlocked'}`, 'good');
            game.persist();
            game.hangar.show('legacy');
          } }, can ? 'Take it' : 'Need ★' + cost))));
  }
  c.append(el('div', { class: 'legacy-wrap' }, head, grid));
}
