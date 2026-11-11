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

const args = process.argv.slice(2);
const RUNS = Number(args[args.indexOf('--runs') + 1]) || 1;
const VERBOSE = RUNS === 1;

const WAVE_COST = { gnat: 1, lancer: 1.5, gunboat: 3, leech: 2, minelayer: 4, warden: 6 };
// effective damage-per-second each enemy lands on an average pilot (accuracy folded in)
const ENEMY_DPS = { gnat: 1.6, lancer: 2.4, gunboat: 5, leech: 0.5, minelayer: 2.2, warden: 4 };
const ACCURACY = 0.6;      // fraction of player weapon dps that connects
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

  function waveStats(sec, n) {
    const budget = Math.min(sec.maxWaveBudget, sec.waveBudget + sec.waveGrowth * n);
    const pool = sec.enemies;
    let hp = 0, dps = 0, bounty = 0, count = 0, b = budget;
    let k = 0;
    while (b > 0.5 && k < 60) {
      const affordable = pool.filter((e) => WAVE_COST[e] <= b + 0.01);
      if (!affordable.length) break;
      const e = affordable[Math.floor(R() * affordable.length)];
      const d = ENEMIES[e];
      hp += d.hp * sec.enemyScale;
      dps += ENEMY_DPS[e] * (1 + (sec.enemyScale - 1) * 0.6);
      bounty += Math.round(d.bounty * (1 + (sec.enemyScale - 1) * 0.8));
      count++; b -= WAVE_COST[e]; k++;
    }
    return { hp, dps, bounty, count };
  }

  function bossThreatDps(boss) {
    // average sustained incoming dps across phases (hit rate ~25%) plus adds
    let total = 0;
    for (const ph of boss.phases) {
      let d = 0;
      for (const a of ph.attacks) {
        if (a.type === 'spread') d += (a.damage * Math.min(3, a.count)) / a.every * 0.35;
        if (a.type === 'ring') d += (a.damage * 2) / a.every * 0.4;
        if (a.type === 'beam') d += (a.damage * a.duration * 0.3) / a.every;
        if (a.type === 'charge') d += a.damage * 0.5 / a.every;
        if (a.type === 'missiles') d += (a.damage * a.count * 0.35) / a.every;
        if (a.type === 'spawn') d += (ENEMY_DPS[a.enemy] * a.count * 4) / a.every;
      }
      total += d;
    }
    return total / boss.phases.length;
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
    // ---- waves during the trip
    const wavesThisTrip = (T - 8) / sec.waveInterval;
    let bounty = 0, damage = 0, fightTime = 0, kills = 0, died = false;
    for (let w = 0; w < Math.floor(wavesThisTrip + R()); w++) {
      const n = (waveN[sec.id] = (waveN[sec.id] || 0) + 1);
      const ws = waveStats(sec, n - 1);
      const ttk = ws.hp / Math.max(1, a.dps * ACCURACY);
      fightTime += ttk;
      const dmg = Math.max(0, ws.dps * ttk - a.shieldRegen * ttk) ;
      damage += dmg;
      if (dmg > ehp * 0.75) { died = true; break; }
      bounty += ws.bounty; kills += ws.count;
    }
    const tripTime = T + fightTime;
    t += tripTime;
    trips++;
    save.credits += (droneIncomePerMinute(save.upgrades) * tripTime) / 60;
    const shipValue = a.value;
    if (died) {
      deaths++;
      save.credits -= Math.min(save.credits * ECONOMY.insuranceCap, shipValue * 0.5 * ECONOMY.repairCostFactor);
      mark(`  died to a wave (sector ${sec.name})`);
    } else {
      save.credits += income + bounty;
      save.credits -= Math.min(save.credits, (damage / Math.max(1, a.hp)) * shipValue * ECONOMY.repairCostFactor);
      save.credits -= a.fuel * 0.5 * ECONOMY.refuelCostPerUnit;
      // threat & boss
      if (sec.boss) {
        save.threat[sec.id] = (save.threat[sec.id] || 0) + ore * sec.threatPerOre + kills * sec.threatPerKill;
        if (save.threat[sec.id] >= 100) {
          const boss = BOSSES[sec.boss];
          const ttk = boss.hp / Math.max(1, a.dps * ACCURACY);
          const incoming = Math.max(0, bossThreatDps(boss) - a.shieldRegen) * ttk;
          t += Math.min(ttk, 240);
          if (incoming < ehp * 0.85 && ttk < 240) {
            save.credits += boss.bounty;
            save.credits -= Math.min(save.credits, (incoming / a.hp) * shipValue * ECONOMY.repairCostFactor);
            save.threat[sec.id] = 0;
            const first = !save.bossKills[sec.boss];
            save.bossKills[sec.boss] = (save.bossKills[sec.boss] || 0) + 1;
            if (first) mark(`DEFEATED ${boss.name} (fight ${Math.round(ttk)}s, took ${Math.round(incoming)} of ${Math.round(ehp)} ehp)`);
          } else {
            deaths++;
            save.threat[sec.id] = 60;
            save.credits -= Math.min(save.credits * ECONOMY.insuranceCap, shipValue * 0.5 * ECONOMY.repairCostFactor);
            mark(`  lost to ${boss.name} (needed ${Math.round(ttk)}s, would take ${Math.round(incoming)} dmg vs ${Math.round(ehp)} ehp)`);
          }
        }
      }
    }
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
