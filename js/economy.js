// Pure economy rules shared by the game and the headless bot.
import { UPGRADES, PARTS, ORES, GRID, IDLE } from './data.js';

export const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

// levels: { [id]: level }; legacy: permanent prestige bonuses (same keys, applied on top)
export function upgradeEffects(levels = {}) {
  const fx = {
    sellMult: 1, miningMult: 1, yieldMult: 1, frame: 0, hpMult: 1, fuelEff: 1, fortify: 0, autopilot: 0, repairEff: 1,
    damageMult: 1, rateMult: 1, shieldMult: 1, magnetMult: 1,
  };
  for (const u of UPGRADES) {
    const lv = levels[u.id] || 0;
    if (!lv) continue;
    for (const k in u.effect) {
      const v = u.effect[k] * lv;
      if (k === 'fuelEff' || k === 'repairEff') fx[k] *= Math.max(0.2, 1 - v);
      else fx[k] += v;
    }
  }
  // permanent legacy bonuses (prestige) ride along in levels.__legacy
  const L = levels.__legacy;
  if (L) for (const k in L) if (k in fx) fx[k] = k === 'repairEff' ? fx[k] * L[k] : fx[k] * L[k];
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
  const cost = u.cost[lv];
  if (save.credits < cost) return { ok: false, reason: 'Not enough credits', cost };
  return { ok: true, reason: '', cost };
}

// value of a cargo hold, given the planet's value multiplier
export function sellValue(cargo, levels, valueMult = 1) {
  const fx = upgradeEffects(levels);
  let total = 0;
  for (const k in cargo) total += (ORES[k]?.value || 0) * cargo[k];
  return Math.floor(total * fx.sellMult * fx.yieldMult * valueMult);
}

export function idleWindow(levels) {
  const fx = upgradeEffects(levels);
  return IDLE.windows[Math.min(IDLE.windows.length - 1, fx.autopilot | 0)];
}

// role filters: which parts / research a ship type uses
export const partFits = (id, role) => PARTS[id].role === 'both' || PARTS[id].role === role;
