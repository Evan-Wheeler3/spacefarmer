// Pure economy rules shared by the game and the headless bot.
import { UPGRADES, ECONOMY, PARTS, ORES, ASTEROIDS, DRONES, PLANETS, GRID, SECTORS } from './data.js';

export const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

// levels: { [id]: level }
export function upgradeEffects(levels = {}) {
  const fx = {
    sellMult: 1, miningMult: 1, yieldMult: 1, droneRate: 0, frame: 0, hpMult: 1, fuelEff: 1,
    damageMult: 1, rateMult: 1, shieldMult: 1, chargeEff: 1, planetMult: 1, magnetMult: 1,
  };
  for (const u of UPGRADES) {
    const lv = levels[u.id] || 0;
    if (!lv) continue;
    for (const k in u.effect) {
      const v = u.effect[k] * lv;
      if (k === 'fuelEff' || k === 'chargeEff') fx[k] *= Math.max(0.2, 1 - v);
      else if (k === 'droneRate' || k === 'frame') fx[k] += v;
      else fx[k] += v;
    }
  }
  return fx;
}

export function frameSize(levels) {
  const f = upgradeEffects(levels).frame;
  return GRID.frameSizes[Math.min(GRID.frameSizes.length - 1, f)];
}

export function partUnlocked(partId, levels) {
  const p = PARTS[partId];
  return !p.unlock || (levels[p.unlock] || 0) > 0;
}

// returns { ok, reason, cost }
export function canBuyUpgrade(id, save) {
  const u = UPGRADE_BY_ID[id];
  const lv = save.upgrades[id] || 0;
  if (lv >= u.cost.length) return { ok: false, reason: 'Maxed', cost: 0 };
  for (const r of u.requires) if (!(save.upgrades[r] > 0)) return { ok: false, reason: 'Requires ' + UPGRADE_BY_ID[r].name, cost: u.cost[lv] };
  if (u.requiresBoss && !save.bossKills[u.requiresBoss]) return { ok: false, reason: 'Defeat the sector boss first', cost: u.cost[lv] };
  const cost = u.cost[lv];
  if (save.credits < cost) return { ok: false, reason: 'Not enough credits', cost };
  return { ok: true, reason: '', cost };
}

export function sellValue(cargo, levels) {
  const fx = upgradeEffects(levels);
  let total = 0;
  for (const k in cargo) total += (ORES[k]?.value || 0) * cargo[k];
  return Math.floor(total * fx.sellMult);
}

export function oreFromDamage(dmg, hardness, levels) {
  return (dmg * ASTEROIDS.orePerHp * upgradeEffects(levels).yieldMult) / hardness;
}

export function droneIncomePerMinute(levels) {
  const lv = Math.min(DRONES.creditsPerMinutePerLevel.length - 1, levels.drones || 0);
  return DRONES.creditsPerMinutePerLevel[lv];
}

export function offlineEarnings(levels, seconds) {
  const capped = Math.min(seconds, ECONOMY.offlineCapHours * 3600);
  return Math.floor((droneIncomePerMinute(levels) * capped) / 60);
}

export function planetReward(count, levels) {
  return Math.floor(PLANETS.baseReward * Math.pow(PLANETS.rewardGrowth, count) * upgradeEffects(levels).planetMult);
}

export function sectorUnlocked(index, save) {
  const s = SECTORS[index];
  return !s.license || (save.upgrades[s.license] || 0) > 0;
}

export function partCost(id) { return PARTS[id].cost; }
