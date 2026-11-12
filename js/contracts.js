// Combat contracts: deterministic wave lists, payouts and difficulty ratings.
// Pure (no DOM) so the economy bot uses exactly the same numbers.
import { SECTORS, ENEMIES, BOSSES, CONTRACTS } from './data.js';
import { rng } from './util.js';

export const ACCURACY = 0.6;   // share of listed weapon dps that actually lands
const STATIONARY = 1.5;        // waves land more hits on a platform that can't dodge

export function contractWave(sectorIndex, k) {
  const sec = SECTORS[sectorIndex];
  const R = rng(9001 + sectorIndex * 131 + k * 17);
  let budget = sec.waveBudget + sec.waveGrowth * k;
  const counts = {};
  for (let guard = 0; budget > 0.5 && guard < 80; guard++) {
    const ok = sec.enemies.filter((t) => ENEMIES[t].cost <= budget + 0.01);
    if (!ok.length) break;
    const t = ok[Math.floor(R() * ok.length)];
    counts[t] = (counts[t] || 0) + 1;
    budget -= ENEMIES[t].cost;
  }
  const scale = sec.enemyScale, dmg = 1 + (scale - 1) * 0.6;
  let hp = 0, dps = 0, bounty = 0, n = 0;
  for (const t in counts) {
    const d = ENEMIES[t], c = counts[t];
    hp += d.hp * scale * c; dps += d.threat * dmg * c; bounty += Math.round(d.bounty * (1 + (scale - 1) * 0.8)) * c; n += c;
  }
  return { counts, hp, dps, bounty, n };
}

export function contractPay(sectorIndex, k, cleared = false) {
  const sec = SECTORS[sectorIndex];
  return Math.round((sec.contractPay * Math.pow(CONTRACTS.payGrowth, k) * (cleared ? CONTRACTS.repeatPay : 1)) / 10) * 10;
}

// Sustained damage a boss lands on a STATIONARY platform (the fighter can't dodge):
// most of a spread hits, beams sweep across it, charges always connect, turrets
// shoot down some missiles, and spawned adds join in.
export function bossThreat(boss) {
  let total = 0;
  for (const ph of boss.phases) {
    let d = 0;
    for (const a of ph.attacks) {
      if (a.type === 'spread') d += (a.damage * a.count * 0.6) / a.every;
      if (a.type === 'ring') d += (a.damage * 1.5) / a.every;
      if (a.type === 'beam') d += (a.damage * a.duration * 0.6) / a.every;
      if (a.type === 'charge') d += a.damage / a.every;
      if (a.type === 'missiles') d += (a.damage * a.count * 0.5) / a.every;
      if (a.type === 'spawn') d += (ENEMIES[a.enemy].threat * a.count * 6) / a.every;
    }
    total += d;
  }
  return { hp: boss.hp, dps: total / boss.phases.length };
}

// a = shipdesign analysis. Returns { label, color, ttk, risk } where risk = expected damage / effective hp.
export function rate(a, foe) {
  const ttk = foe.hp / Math.max(0.1, a.dps * ACCURACY);
  // shields only regenerate between hits, so under sustained fire they barely help
  const incoming = Math.max(0, foe.dps * STATIONARY - a.shieldRegen * 0.15) * ttk;
  const risk = incoming / Math.max(1, a.hp * 0.6 + a.shield);
  const [label, color] = a.dps <= 0 ? ['No weapons', '#ff5d73']
    : risk < 0.25 ? ['Easy', '#2ee6a6'] : risk < 0.6 ? ['Fair', '#a5e05a'] : risk < 1 ? ['Hard', '#ffcf5a'] : ['Deadly', '#ff5d73'];
  return { label, color, ttk, risk };
}

// What's next on a sector's board, given save.contracts[sector.id] = { k, cleared }
export function nextContract(save, sectorIndex) {
  const sec = SECTORS[sectorIndex];
  const st = (save.contracts && save.contracts[sec.id]) || { k: 0, cleared: 0 };
  if (st.k < sec.contracts) {
    return { kind: 'wave', k: st.k, total: sec.contracts, wave: contractWave(sectorIndex, st.k), pay: contractPay(sectorIndex, st.k, st.cleared > 0), cleared: st.cleared };
  }
  if (sec.boss) {
    const b = BOSSES[sec.boss];
    return { kind: 'boss', k: st.k, total: sec.contracts, boss: sec.boss, foe: bossThreat(b), pay: b.bounty, cleared: st.cleared };
  }
  return null;
}
