// Headless economy bot. Plays the whole progression using the real data file,
// the real ship analysis (mass, thrust, mining, dps from shipdesign.js) and the
// real economy rules, and prints when each progression step happens.
//
//   node tools/bot.mjs            # one run, timeline
//   node tools/bot.mjs --runs 20  # spread over 20 seeded runs
//
// The trip model was calibrated against tools/playtest.mjs, which flies the
// real ship with real physics in the browser (Pebble: ~50s trips, ~¢180/trip).
import { SECTORS, ENEMIES, BOSSES, ORES, PRESETS, ECONOMY, UPGRADES, PLANETS, PARTS } from '../js/data.js';
import { analyze, Design } from '../js/shipdesign.js';
import { upgradeEffects, canBuyUpgrade, oreFromDamage, droneIncomePerMinute, planetReward, frameSize, partUnlocked, UPGRADE_BY_ID } from '../js/economy.js';
import { rng } from '../js/util.js';
import { nextContract, rate } from '../js/contracts.js';

// The bot takes a contract when its ship rates it at or below this risk (Fair).
const TAKE_RISK = 0.6;

const args = process.argv.slice(2);
const RUNS = Number(args[args.indexOf('--runs') + 1]) || 1;
const VERBOSE = RUNS === 1;

const MINING_EFF = 0.65;   // time actually spent with a laser on a rock (playtest-calibrated)

// The plan a sensible player follows. Items: research id, {design}, {jump}, {planet}
const PLAN = [
  'brokers', 'optics', 'frame', { design: 'prospector' }, 'ballistics', 'alloys', 'brokers', 'optics',
  'licRust', { jump: 1 }, 'shields', { design: 'excavator' }, 'refinery', 'ballistics', 'optics', 'brokers', 'alloys', 'drones',
  'licGlass', { jump: 2 }, 'injectors', 'torch', 'fusion', 'railgun', 'tractor', 'frame', 'harmonics', 'loaders', { design: 'leviathan' },
  'refinery', 'drones', 'ballistics', 'optics', 'brokers', 'alloys', 'loaders',
  'licPale', { jump: 3 }, 'cracker', 'harmonics', 'drones', 'ballistics', 'refinery', 'alloys', 'optics', 'loaders',
  'licGorvox', { jump: 4 }, { design: 'doom' }, { planet: true },
];

function simulate(seed) {
  const R = rng(seed);
  const plan = PLAN.slice();
  const save = { credits: ECONOMY.startCredits, upgrades: {}, bossKills: {}, sector: 0, threat: {}, planets: 0 };
  let design = 'pebble';
  let t = 0, deaths = 0, waveN = {}, trips = 0;
  const log = [];
  const mark = (what) => { log.push({ t, what, credits: Math.round(save.credits) }); };
  const stats = () => analyze(Design.fromPreset(PRESETS[design]), save.upgrades);
  const fx = () => upgradeEffects(save.upgrades);

  function tryPlan() {
    for (let guard = 0; guard < 200; guard++) {
      let acted = false;
      for (let i = 0; i < plan.length; i++) {
        const item = plan[i];
        if (item.done) continue;
        if (typeof item === 'string') {
          const chk = canBuyUpgrade(item, save);
          const lv = save.upgrades[item] || 0;
          if (chk.reason === 'Maxed') { plan[i] = { done: true }; continue; }
          if (!chk.ok && chk.reason !== 'Not enough credits') continue; // blocked: look further down the plan
          if (!chk.ok) return; // save up for it
          save.credits -= chk.cost;
          save.upgrades[item] = lv + 1;
          plan[i] = { done: true, id: item };
          mark(`research ${UPGRADE_BY_ID[item].name} ${lv + 1}`);
          acted = true; break;
        }
        if (item.design) {
          const p = PRESETS[item.design];
          const d = Design.fromPreset(p);
          const frame = frameSize(save.upgrades);
          if (d.entries.some((e) => !partUnlocked(e.part, save.upgrades)) || d.entries.some((e) => Math.abs(e.x) > (frame - 1) / 2 || Math.abs(e.y) > (frame - 1) / 2 || Math.abs(e.x + PARTS[e.part].w - 1) > (frame - 1) / 2 || Math.abs(e.y + PARTS[e.part].h - 1) > (frame - 1) / 2)) continue;
          const cost = d.value() - Design.fromPreset(PRESETS[design]).value();
          if (cost > save.credits) return;
          save.credits -= cost;
          design = item.design;
          plan[i] = { done: true };
          mark(`switch to ${p.name} (${cost > 0 ? '-' : '+'}¢${Math.abs(cost)})`);
          acted = true; break;
        }
        if (item.jump !== undefined) {
          const lic = SECTORS[item.jump].license;
          if (lic && !save.upgrades[lic]) continue;
          save.sector = item.jump;
          plan[i] = { done: true };
          mark(`jump to ${SECTORS[item.jump].name}`);
          acted = true; break;
        }
        if (item.planet) {
          if (design !== 'doom' || save.sector !== 4) continue;
          return 'planet';
        }
      }
      if (!acted) return;
    }
  }

  tryPlan();
  mark('start');
  const MAX_T = 6 * 3600;
  while (t < MAX_T) {
    const a = stats();
    const sec = SECTORS[save.sector];
    const f = fx();
    const ehp = a.hp + a.shield;
    // ---- one trip
    const oreRate = oreFromDamage(a.mining, sec.hardness, save.upgrades) * MINING_EFF;
    const travel = 2 * 2 * Math.sqrt(900 / Math.max(20, a.accelLoaded)) + 10;
    const mineTime = oreRate > 0 ? a.cargo / oreRate : 0;
    const T = Math.max(30, travel + mineTime);
    let ore = oreRate > 0 ? a.cargo : 0;
    let value = 0;
    for (const k in sec.ores) value += sec.ores[k] * ORES[k].value;
    let income = ore * value * f.sellMult;
    // ---- contracts: take the ones this ship rates Easy/Fair (a few per trip)
    let fightTime = 0, bonus = 0, damage = 0;
    save.contracts = save.contracts || {};
    for (let n = 0; n < 3; n++) {
      const c = nextContract(save, save.sector);
      if (!c) break;
      const foe = c.kind === 'wave' ? c.wave : c.foe;
      const r = rate(a, foe);
      if (r.risk > TAKE_RISK || r.ttk > 240) break;
      fightTime += r.ttk + 15;
      damage += r.risk * (a.hp * 0.6 + a.shield);
      bonus += c.pay + (c.kind === 'wave' ? c.wave.bounty : 0);
      const bd = (save.contracts[sec.id] = save.contracts[sec.id] || { k: 0, cleared: 0 });
      if (c.kind === 'wave') { bd.k++; if (bd.k >= sec.contracts && !sec.boss) { bd.k = 0; bd.cleared++; } }
      else {
        bd.k = 0; bd.cleared++;
        const first = !save.bossKills[c.boss];
        save.bossKills[c.boss] = (save.bossKills[c.boss] || 0) + 1;
        if (first) mark(`DEFEATED ${BOSSES[c.boss].name} (fight ${Math.round(r.ttk)}s, risk ${r.risk.toFixed(2)})`);
      }
    }
    const tripTime = T + fightTime;
    t += tripTime;
    trips++;
    save.credits += (droneIncomePerMinute(save.upgrades) * tripTime) / 60;
    save.credits += income + bonus;
    save.credits -= Math.min(save.credits, (damage / Math.max(1, a.hp)) * a.value * ECONOMY.repairCostFactor);
    save.credits -= a.fuel * 0.5 * ECONOMY.refuelCostPerUnit;
    const r = tryPlan();
    if (r === 'planet') {
      const d = stats();
      const charge = PARTS.cracker.cracker.chargeTime * f.chargeEff / Math.min(1, d.gen / (PARTS.cracker.cracker.power + 8));
      t += 120 + charge; // fly over from the outpost, get in position, charge
      const reward = planetReward(save.planets, save.upgrades);
      save.credits += reward;
      save.planets++;
      mark(`PLANET DESTROYED (+¢${reward}, charge ${charge.toFixed(0)}s)`);
      break;
    }
  }
  return { log, t, deaths, trips, done: save.planets > 0 };
}

const fmtT = (s) => `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m${String(Math.floor(s % 60)).padStart(2, '0')}s`;

if (VERBOSE) {
  const r = simulate(1);
  let last = 0;
  for (const e of r.log) {
    console.log(`${fmtT(e.t).padStart(10)}  (+${fmtT(e.t - last).replace(/^0h/, '')})  ¢${String(e.credits).padStart(8)}  ${e.what}`);
    last = e.t;
  }
  console.log(`\n${r.done ? 'Planet destroyed' : 'Did NOT finish'} after ${fmtT(r.t)} · ${r.trips} trips · ${r.deaths} deaths`);
} else {
  const keys = ['research Ore Brokers 1', 'switch to Prospector', 'DEFEATED Foreman Grudge', 'jump to Rust Belt', 'DEFEATED The Auditor', 'jump to Glass Reach', 'DEFEATED Matriarch Vexa', 'jump to The Deep Pale', 'DEFEATED Dreadnought Mildred', 'PLANET DESTROYED'];
  const acc = Object.fromEntries(keys.map((k) => [k, []]));
  let deaths = 0, fails = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = simulate(1000 + i);
    deaths += r.deaths; if (!r.done) fails++;
    for (const k of keys) { const e = r.log.find((x) => x.what.startsWith(k)); if (e) acc[k].push(e.t); }
  }
  for (const k of keys) {
    const v = acc[k].sort((a, b) => a - b);
    if (!v.length) { console.log(k.padEnd(32), 'never'); continue; }
    console.log(k.padEnd(32), 'median', fmtT(v[Math.floor(v.length / 2)]), ' min', fmtT(v[0]), ' max', fmtT(v[v.length - 1]));
  }
  console.log(`avg deaths ${(deaths / RUNS).toFixed(1)}, unfinished runs ${fails}/${RUNS}`);
}
