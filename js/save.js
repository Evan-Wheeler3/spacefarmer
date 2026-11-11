// Persistent progress in localStorage.
import { ECONOMY, PRESETS, VERSION } from './data.js';

const KEY = 'spacefarmer.save.v1';
export const SANDBOX_KEY = 'spacefarmer.sandbox.v1';

export function newSave() {
  return {
    version: VERSION,
    credits: ECONOMY.startCredits,
    upgrades: {},
    design: { cells: PRESETS.pebble.cells.map((c) => [...c]) },
    sector: 0,
    cargo: {},
    cargoUnits: 0,
    bossKills: {},
    contracts: {},
    planetsDestroyed: 0,
    blueprints: [],
    stats: { playTime: 0, oreMined: 0, earned: 0, kills: 0, deaths: 0, bosses: 0, rocks: 0 },
    tutorial: { step: 0, done: false },
    settings: { volume: 0.7, music: 0.5, telemetry: false, shake: 1 },
    lastSeen: Date.now(),
  };
}

export function loadSave(key = KEY) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const base = newSave();
    // shallow-merge so older saves pick up new fields
    const s = { ...base, ...data };
    s.stats = { ...base.stats, ...(data.stats || {}) };
    s.settings = { ...base.settings, ...(data.settings || {}) };
    s.tutorial = { ...base.tutorial, ...(data.tutorial || {}) };
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
