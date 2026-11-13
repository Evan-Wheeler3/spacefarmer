// Persistent progress in localStorage.
import { ECONOMY, PRESETS, VERSION } from './data.js';

const KEY = 'spacefarmer.save.v2';
const OLD_KEY = 'spacefarmer.save.v1';
export const SANDBOX_KEY = 'spacefarmer.sandbox.v2';

export function newSave() {
  return {
    version: VERSION,
    credits: ECONOMY.startCredits,
    upgrades: {},
    design: { cells: PRESETS.pebble.cells.map((c) => [...c]) },
    fighter: {
      design: { cells: PRESETS.bastion.cells.map((c) => [...c]) },
      retreat: 0.3, repairT: 0, longestShift: 0, shifts: 0,
    },
    planet: { index: 0, seed: (Math.random() * 1e9) | 0, removed: '' },
    cargo: {},
    cargoUnits: 0,
    rates: { cubesPerSec: 0, site: null },   // measured while autopiloting, used for offline progress
    legacy: { points: 0, spent: {}, completed: 0 },
    records: { bestPlanetTime: 0, swarmBest: 0, swarmKills: 0 },
    blueprints: [],
    stats: { playTime: 0, planetTime: 0, oreMined: 0, earned: 0, kills: 0, elites: 0, retreats: 0 },
    tutorial: { step: 0, done: false },
    settings: { volume: 0.7, music: 0.5, telemetry: false, shake: 1, skin: 'industrial' },
    lastSeen: Date.now(),
  };
}

export function loadSave(key = KEY) {
  try {
    let raw = localStorage.getItem(key);
    if (!raw && key === KEY && localStorage.getItem(OLD_KEY)) {
      // the game was rebuilt around mining a planet: start fresh, keep blueprints and settings
      const old = JSON.parse(localStorage.getItem(OLD_KEY));
      const s = newSave();
      s.blueprints = Array.isArray(old.blueprints) ? old.blueprints : [];
      s.settings = { ...s.settings, ...(old.settings || {}) };
      s.pendingNotice = 'Space Farmer has been rebuilt around mining an entire planet, so this is a fresh start. Your saved blueprints came along.';
      return s;
    }
    if (!raw) return null;
    const data = JSON.parse(raw);
    const base = newSave();
    const s = { ...base, ...data };
    for (const k of ['stats', 'settings', 'tutorial', 'fighter', 'planet', 'rates', 'legacy', 'records']) s[k] = { ...base[k], ...(data[k] || {}) };
    return s;
  } catch (e) {
    console.warn('Save could not be read; starting fresh.', e);
    return null;
  }
}

export function writeSave(save, key = KEY) {
  try {
    save.lastSeen = Date.now();
    localStorage.setItem(key, JSON.stringify(save));
    return true;
  } catch (e) {
    return false;
  }
}

export function wipeSave(key = KEY) { try { localStorage.removeItem(key); } catch (e) { /* storage blocked */ } }

// Blueprint share strings: base64 of compact JSON, prefixed for recognisability.
export function exportBlueprint(name, design) {
  const json = JSON.stringify({ n: name, c: design.toJSON().cells.map((c) => c.slice(0, 4)) });
  return 'SFBP1:' + btoa(unescape(encodeURIComponent(json)));
}
export function importBlueprint(str) {
  str = (str || '').trim();
  if (!str.startsWith('SFBP1:')) throw new Error('Not a Space Farmer blueprint (should start with SFBP1:)');
  const json = JSON.parse(decodeURIComponent(escape(atob(str.slice(6)))));
  if (!Array.isArray(json.c)) throw new Error('Blueprint is missing its parts list');
  return { name: String(json.n || 'Imported').slice(0, 40), cells: json.c };
}
