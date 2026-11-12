// Hangar tab for the fighter: status, deployment settings, contract board, log.
import { SECTORS, BOSSES, PLANETS } from '../data.js';
import { sectorUnlocked, planetReward } from '../economy.js';
import { el } from './dom.js';
import { money, fmt } from '../util.js';
import { contractCard } from './research.js';

export function renderFighter(game, c) {
  const f = game.fighter, fs = game.save.fighter, s = game.save;
  const a = f.analysis();
  const refresh = () => { game.persist(); game.hangar.show('fighter'); };
  const hours = Math.max(1 / 60, (fs.stats.time || 0) / 3600);

  const status = el('div', { class: 'card' },
    el('h3', {}, 'Defense Post'),
    el('p', {}, el('b', {}, f.status() || '—')),
    el('p', { class: 'dim small' }, 'Your fighter is a stationary platform. It works the contract board on its own while you mine, retreats for repairs before it can be destroyed, and keeps your place on the board.'),
    el('label', { class: 'set' }, el('span', {}, 'Post sector'),
      el('select', { class: 'inp', style: { width: 'auto' }, onchange: (e) => { fs.sector = Number(e.target.value); f.world = null; f.clearFails(); f.redeploy(); refresh(); } },
        ...SECTORS.map((sec, i) => el('option', { value: i, selected: i === fs.sector, disabled: !sectorUnlocked(i, s) }, sec.name + (sectorUnlocked(i, s) ? '' : ' (locked)'))))),
    el('label', { class: 'set' }, el('span', {}, 'Work contracts automatically'),
      el('input', { type: 'checkbox', checked: fs.auto, onchange: (e) => { fs.auto = e.target.checked; if (fs.auto) f.redeploy(); else f.recall(); refresh(); } })),
    el('label', { class: 'set' }, el('span', {}, `Retreat below ${Math.round(fs.retreat * 100)}% hull`),
      el('input', { type: 'range', min: 0.1, max: 0.7, step: 0.05, value: fs.retreat, oninput: (e) => { fs.retreat = Number(e.target.value); e.target.parentElement.firstChild.textContent = `Retreat below ${Math.round(fs.retreat * 100)}% hull`; }, onchange: () => game.persist() })),
    el('div', { class: 'bp-row' },
      el('button', { class: 'btn primary', disabled: !a.launchable, onclick: () => game.enterWatch() }, '▶ Watch / take control'),
      el('button', { class: 'btn', onclick: () => { game.hangar.builder._role = 'fighter'; game.hangar.show('shipyard'); } }, 'Edit fighter')),
    !a.launchable ? el('p', { class: 'bad small' }, a.warnings.find((w) => w.lvl === 'err')?.text || 'Not ready') : '');

  const stats = el('div', { class: 'card' }, el('h3', {}, 'Service Record'),
    el('div', { class: 'kv' },
      ...[['Earned', money(fs.stats.earned), 'money'], ['Per hour on duty', (fs.stats.time || 0) > 120 ? money(fs.stats.earned / hours) : '—', 'money'], ['Contracts cleared', fmt(fs.stats.contracts)],
        ['Bosses defeated', fmt(fs.stats.bosses)], ['Retreats', fmt(fs.stats.retreats)], ['Weapons', `${a.dps.toFixed(0)} dps`], ['Hull', `${Math.round(a.hp)} hp`]]
        .map(([k, v, cls]) => el('div', {}, el('span', { class: 'dim' }, k), el('span', { class: cls || '' }, v)))),
    el('h3', { style: { marginTop: '12px' } }, 'Log'),
    el('div', { class: 'f-log' }, fs.log.length ? fs.log.map((l) => el('div', {}, el('span', { class: 'dim small' }, new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '  '), l.text)) : el('div', { class: 'dim' }, 'Nothing yet. Give it a minute.')));

  const planet = SECTORS[fs.sector].planet ? el('div', { class: 'card' }, el('h3', {}, 'Doomsday'),
    el('p', {}, `${PLANETS.names[s.planetsDestroyed % PLANETS.names.length]} is in range of your post. Destroying it pays `, el('span', { class: 'money' }, money(planetReward(s.planetsDestroyed, s.upgrades))), ' plus core salvage.'),
    a.crackers ? el('p', {}, 'Watch your fighter, turn the Cracker toward the planet and hold ', el('b', {}, game.touch ? 'CRACK' : 'C'), '. Planetary defense will object.')
      : el('p', { class: 'warn' }, 'Install a Planet Cracker on the fighter first (research Planet Cracker Schematics).')) : '';

  c.append(el('div', { class: 'market' }, el('div', { class: 'col' }, status, planet), contractCard(game, fs.sector), stats));
}
