// Hangar tab for the escort fighter: repairs, retreat threshold, service record.
import { FIGHTER } from '../data.js';
import { el, toast } from './dom.js';
import { money, fmt, fmtTime } from '../util.js';

export function renderFighter(game, c) {
  const esc = game.escort, fs = game.save.fighter, s = game.save;
  const a = esc.analysis();
  const refresh = () => { game.persist(); game.hangar.updateCredits(); game.hangar.updateLaunch(); game.hangar.show('fighter'); };

  const repairLine = el('p', {});
  const rushBtn = el('button', { class: 'btn gold', onclick: () => { if (esc.rush()) { game.sfx('repair'); toast('Repairs rushed. Back to work.', 'good'); refresh(); } else { game.sfx('denied'); toast('Not enough credits to rush', 'bad'); } } });
  const live = () => {
    if (!repairLine.isConnected) return;
    if (esc.repairing) {
      repairLine.textContent = `In the repair bay: ${fmtTime(fs.repairT)} left. Mining waits for it.`;
      rushBtn.textContent = `Rush repairs ${money(esc.rushCost())}`;
      rushBtn.disabled = s.credits < esc.rushCost();
      rushBtn.style.display = '';
    } else {
      repairLine.textContent = a.launchable ? 'Repaired and ready to escort.' : (a.warnings.find((w) => w.lvl === 'err')?.text || 'Design not ready.');
      rushBtn.style.display = 'none';
    }
    setTimeout(live, 500);
  };

  const status = el('div', { class: 'card' },
    el('h3', {}, 'Escort fighter'),
    repairLine, rushBtn,
    el('p', { class: 'dim small' }, 'Your fighter escorts the freighter and takes on the planet’s defense swarm. The swarm grows the longer you stay out and the deeper you dig. If the fighter drops below its retreat line, both ships warp home and mining stops until repairs finish.'),
    el('label', { class: 'set' }, el('span', {}, `Retreat below ${Math.round(fs.retreat * 100)}% hull`),
      el('input', { type: 'range', min: 0.1, max: 0.7, step: 0.05, value: fs.retreat,
        oninput: (e) => { fs.retreat = Number(e.target.value); e.target.parentElement.firstChild.textContent = `Retreat below ${Math.round(fs.retreat * 100)}% hull`; }, onchange: () => game.persist() })),
    el('p', { class: 'dim small' }, 'A higher retreat line means shorter shifts but faster, cheaper repairs.'),
    el('div', { class: 'bp-row' }, el('button', { class: 'btn', onclick: () => { game.hangar.builder._role = 'fighter'; game.hangar.show('shipyard'); } }, 'Edit fighter in the Shipyard')));

  const stats = el('div', { class: 'card' }, el('h3', {}, 'Service record'),
    el('div', { class: 'kv' },
      ...[['Weapons', `${a.dps.toFixed(0)} dps`], ['Hull', `${Math.round(a.hp)} hp`], ['Shields', a.shield ? `${a.shield.toFixed(0)} (+${a.shieldRegen.toFixed(0)}/s)` : 'none'],
        ['Longest shift', fmtTime(fs.longestShift || 0)], ['Shifts flown', fmt(fs.shifts || 0)], ['Enemy ships destroyed', fmt(s.stats.kills)], ['Capital ships destroyed', fmt(s.stats.elites)]]
        .map(([k, v]) => el('div', {}, el('span', { class: 'dim' }, k), el('span', {}, v)))),
    el('p', { class: 'dim small' }, `Repairs take ${FIGHTER.repairBase}s plus up to ${FIGHTER.repairPerDamage}s depending on damage (Field Repairs research shortens this), and cost ${Math.round(FIGHTER.repairDiscount * 100)}% of the usual price.`));

  const swarm = el('div', { class: 'card' }, el('h3', {}, 'The swarm'),
    el('div', { class: 'kv' },
      ...[['0–2 min', 'Interceptors and Raiders'], ['2–5 min', '+ Gunships and Minelayers'], ['5 min +', '+ Missile Frigates'], ['Every 4 min', 'a capital ship: Destroyer → Cruiser → Carrier → Battleship']]
        .map(([k, v]) => el('div', {}, el('span', { class: 'dim' }, k), el('span', {}, v)))),
    el('p', { class: 'dim small' }, 'Every ship pays a bounty; capital ships pay big. Deeper layers and later planets field tougher swarms.'));

  c.append(el('div', { class: 'market' }, status, stats, swarm));
  live();
}
