// Headless economy bot for the two-ship game. The freighter mines on trips
// (trip model calibrated against tools/playtest.mjs, which flies the real ship);
// in parallel the fighter works its contract board using the same ratings the
// game shows and the same rules as offline resolution (calibrated against
// tools/arena.mjs, which runs the real fighter simulation).
//
//   node tools/bot.mjs            # one run, timeline
//   node tools/bot.mjs --runs 20  # spread over seeded runs
import { SECTORS, BOSSES, ORES, PRESETS, ECONOMY, FIGHTER, PARTS, PLANETS } from '../js/data.js';
import { analyze, Design } from '../js/shipdesign.js';
import { canBuyUpgrade, oreFromDamage, planetReward, frameSize, partUnlocked, upgradeEffects, UPGRADE_BY_ID, sectorUnlocked } from '../js/economy.js';
import { nextContract, contractWave, contractPay, rate } from '../js/contracts.js';
import { rng } from '../js/util.js';

const args = process.argv.slice(2);
const RUNS = Number(args[args.indexOf('--runs') + 1]) || 1;
const MINING_EFF = 0.65;   // share of a trip spent with a laser on rock (playtest-calibrated)
const WIN_RISK = 0.85;     // the fighter clears a contract below this rated risk (arena-calibrated)

const PLAN = [
  'brokers', 'optics', 'ballistics', 'frame', { freighter: 'prospector' }, 'alloys', 'shields', { fighter: 'bulwark' }, 'fortify', 'brokers', 'optics',
  'licRust', { jump: 1 }, 'tractor', 'refinery', 'ballistics', 'loaders', { freighter: 'excavator' }, 'optics', 'brokers', 'fortify', 'alloys',
  'licGlass', { jump: 2 }, 'railgun', 'fusion', 'harmonics', { fighter: 'citadel' }, 'injectors', 'torch', 'frame', { freighter: 'leviathan' },
  'refinery', 'ballistics', 'loaders', 'optics', 'brokers', 'fortify', 'alloys', 'harmonics',
  'licPale', { jump: 3 }, 'cracker', 'ballistics', 'loaders', 'refinery', 'fortify', 'optics', 'harmonics', 'alloys', 'ballistics',
  'licGorvox', { jump: 4 }, { fighter: 'doom' }, { planet: true },
];

function fits(preset, levels) {
  const d = Design.fromPreset(PRESETS[preset]);
  const h = (frameSize(levels) - 1) / 2;
  return d.entries.every((e) => partUnlocked(e.part, levels) && Math.abs(e.x) <= h && Math.abs(e.y) <= h && Math.abs(e.x + PARTS[e.part].w - 1) <= h && Math.abs(e.y + PARTS[e.part].h - 1) <= h);
}

function simulate(seed) {
  const R = rng(seed);
  const plan = PLAN.slice();
  const save = { credits: ECONOMY.startCredits, upgrades: {}, bossKills: {}, sector: 0, contracts: {}, planets: 0 };
  let freighter = 'pebble', fighter = 'bastion', fSector = 0, fails = {}, wear = 0;
  let t = 0, trips = 0, mined = 0, fought = 0, retreats = 0;
  const log = [];
  const mark = (what) => log.push({ t, what, credits: Math.round(save.credits) });
  const fA = () => analyze(Design.fromPreset(PRESETS[freighter]), save.upgrades, { role: 'freighter' });
  const gA = () => analyze(Design.fromPreset(PRESETS[fighter]), save.upgrades, { role: 'fighter' });

  function buy() {
    for (let guard = 0; guard < 200; guard++) {
      let acted = false;
      for (let i = 0; i < plan.length; i++) {
        const it = plan[i];
        if (it.done) continue;
        if (typeof it === 'string') {
          const chk = canBuyUpgrade(it, save);
          if (chk.reason === 'Maxed') { plan[i] = { done: true }; continue; }
          if (!chk.ok && chk.reason !== 'Not enough credits') continue;
          if (!chk.ok) return;
          save.credits -= chk.cost; save.upgrades[it] = (save.upgrades[it] || 0) + 1; fails = {};
          plan[i] = { done: true }; mark(`research ${UPGRADE_BY_ID[it].name} ${save.upgrades[it]}`); acted = true; break;
        }
        if (it.freighter || it.fighter) {
          const id = it.freighter || it.fighter, cur = it.freighter ? freighter : fighter;
          if (!fits(id, save.upgrades)) continue;
          const cost = Design.fromPreset(PRESETS[id]).value() - Design.fromPreset(PRESETS[cur]).value();
          if (cost > save.credits) return;
          save.credits -= cost;
          if (it.freighter) freighter = id; else { fighter = id; fails = {}; }
          plan[i] = { done: true }; mark(`${it.freighter ? 'freighter' : 'fighter'} → ${PRESETS[id].name} (¢${cost})`); acted = true; break;
        }
        if (it.jump !== undefined) {
          if (!sectorUnlocked(it.jump, save)) continue;
          save.sector = it.jump; plan[i] = { done: true }; mark(`freighter jumps to ${SECTORS[it.jump].name}`); acted = true; break;
        }
        if (it.planet) { if (fighter === 'doom' && save.upgrades.licGorvox) return 'planet'; continue; }
      }
      if (!acted) return;
    }
  }

  // fighter: pick the toughest unlocked sector it can work comfortably
  function chooseFighterSector() {
    const a = gA();
    let best = fSector;
    for (let i = 0; i < SECTORS.length; i++) {
      if (!sectorUnlocked(i, save)) continue;
      const n = nextContract(save, i);
      if (n && n.kind === 'wave' && rate(a, n.wave).risk < 0.5 && i > best) best = i;
    }
    if (best !== fSector) { fSector = best; mark(`fighter posts to ${SECTORS[best].name}`); }
  }

  // run the fighter for `secs` seconds of game time
  function fight(secs) {
    const a = gA();
    let guard = 0;
    while (secs > 0 && guard++ < 400) {
      const n = nextContract(save, fSector);
      if (!n) break;
      const key = `${fSector}:${n.kind}:${n.k}`;
      let p = n;
      if ((fails[key] || 0) >= FIGHTER.failsBeforePatrol) {
        const k = Math.max(0, Math.min(n.k, SECTORS[fSector].contracts) - 1);
        p = { kind: 'wave', k, farm: true, wave: contractWave(fSector, k), pay: contractPay(fSector, k, true) };
      }
      const r = rate(a, p.kind === 'boss' ? p.foe : p.wave);
      const dur = r.ttk + FIGHTER.breather + 5; // +5s for the wave to fly in
      secs -= dur;
      const st = (save.contracts[SECTORS[fSector].id] ||= { k: 0, cleared: 0 });
      // damage piles up across waves until the platform has to pull back for repairs
      wear += Math.min(1, r.risk) * 0.6;
      const worn = wear > 1 - FIGHTER.retreatDefault;
      if (worn) { wear = 0; retreats++; save.credits -= Math.min(save.credits, a.value * 0.5 * ECONOMY.repairCostFactor * FIGHTER.repairDiscount); secs -= FIGHTER.repairTime; continue; }
      if (r.risk < WIN_RISK) {
        const pay = p.pay + (p.kind === 'wave' ? p.wave.bounty : 0);
        save.credits += pay; fought += pay;
        if (!p.farm) {
          delete fails[key];
          if (p.kind === 'wave') { st.k++; if (st.k >= SECTORS[fSector].contracts && !SECTORS[fSector].boss) { st.k = 0; st.cleared++; } }
          else {
            st.k = 0; st.cleared++;
            const first = !save.bossKills[p.boss];
            save.bossKills[p.boss] = 1;
            if (first) mark(`FIGHTER DEFEATS ${BOSSES[p.boss].name} (fight ${Math.round(r.ttk)}s, risk ${r.risk.toFixed(2)})`);
          }
        }
      } else {
        fails[key] = (fails[key] || 0) + 1; retreats++; wear = 0;
        save.credits -= Math.min(save.credits, a.value * 0.5 * ECONOMY.repairCostFactor * FIGHTER.repairDiscount);
        secs -= FIGHTER.repairTime;
      }
    }
  }

  buy();
  mark('start');
  while (t < 8 * 3600) {
    const a = fA(), sec = SECTORS[save.sector], f = upgradeEffects(save.upgrades);
    const oreRate = oreFromDamage(a.mining, sec.hardness, save.upgrades) * MINING_EFF;
    const travel = 4 * Math.sqrt(900 / Math.max(20, a.accelLoaded)) + 10;
    const T = Math.max(30, travel + (oreRate > 0 ? a.cargo / oreRate : 0));
    let value = 0;
    for (const k in sec.ores) value += sec.ores[k] * ORES[k].value;
    const income = a.cargo * value * f.sellMult * (0.95 + R() * 0.1);
    save.credits += income - a.fuel * 0.5 * ECONOMY.refuelCostPerUnit;
    mined += income;
    chooseFighterSector();
    fight(T);
    t += T; trips++;
    if (buy() === 'planet') {
      t += 150; // post the doomsday platform, hold the line, crack
      const reward = planetReward(save.planets, save.upgrades) + PLANETS.coreDrops * ORES.core.value * PLANETS.coreSalvage;
      save.credits += reward; save.planets++;
      mark(`PLANET DESTROYED (+¢${Math.round(reward)})`);
      break;
    }
  }
  return { log, t, trips, mined, fought, retreats, done: save.planets > 0 };
}

const fmtT = (s) => `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
if (RUNS === 1) {
  const r = simulate(1);
  for (const e of r.log) console.log(`${fmtT(e.t).padStart(7)}  ¢${String(e.credits).padStart(9)}  ${e.what}`);
  console.log(`\n${r.done ? 'Planet destroyed' : 'Did NOT finish'} after ${fmtT(r.t)} · ${r.trips} freighter trips · mining ¢${Math.round(r.mined)} vs fighter ¢${Math.round(r.fought)} · ${r.retreats} retreats`);
} else {
  const keys = ['FIGHTER DEFEATS Foreman Grudge', 'freighter jumps to Rust Belt', 'FIGHTER DEFEATS The Auditor', 'freighter jumps to Glass Reach', 'FIGHTER DEFEATS Matriarch Vexa', 'freighter jumps to The Deep Pale', 'FIGHTER DEFEATS Dreadnought Mildred', 'PLANET DESTROYED'];
  const acc = Object.fromEntries(keys.map((k) => [k, []]));
  let unfinished = 0, mined = 0, fought = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = simulate(1000 + i);
    if (!r.done) unfinished++;
    mined += r.mined; fought += r.fought;
    for (const k of keys) { const e = r.log.find((x) => x.what.startsWith(k)); if (e) acc[k].push(e.t); }
  }
  for (const k of keys) { const v = acc[k].sort((a, b) => a - b); console.log(k.padEnd(38), v.length ? `median ${fmtT(v[v.length >> 1])}  range ${fmtT(v[0])}–${fmtT(v[v.length - 1])}` : 'never'); }
  console.log(`income split: mining ${Math.round((100 * mined) / (mined + fought))}% / fighter ${Math.round((100 * fought) / (mined + fought))}% · unfinished ${unfinished}/${RUNS}`);
}
