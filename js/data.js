// =====================================================================
//  DATA — every tunable number in the game lives in this file.
//  Costs, health, damage, drop rates, pacing, physics constants.
//  Pure data: no DOM, no imports, so the headless bot can load it too.
// =====================================================================

export const VERSION = 1;

// ---------------------------------------------------------------------
// Physics & world scale
// ---------------------------------------------------------------------
export const PHYS = {
  CELL: 16,                 // world px per builder cell
  linearDrag: 0.06,         // fraction of velocity lost per second (arcade comfort)
  angularDrag: 0.5,         // fraction of spin lost per second
  maxTurnRate: 2.8,         // rad/s the flight computer aims for when you steer
  assistGain: 6,            // how hard gyros chase the target spin
  dampGain: 1.4,            // how hard inertial dampers chase zero drift
  fuelMassPerUnit: 0.02,    // tonnes per fuel unit (burning fuel makes you lighter)
  restitution: 0.25,        // bounciness of ship-vs-rock
  collisionDamageSpeed: 90, // px/s of impact before parts start taking damage
  collisionDamageScale: 0.18,
  maxSpeed: 900,            // hard safety cap, rarely reached
  boundaryPush: 220,        // px/s^2 shove back into the sector at the edge
};

export const CAMERA = {
  zoom: 1.35, minZoom: 0.45, maxZoom: 2.2,
  speedZoomOut: 0.00045,    // zoom out a little as you go faster
  lookAhead: 0.35,          // seconds of velocity the camera leads by
  smoothing: 5,             // higher = snappier follow
};

// ---------------------------------------------------------------------
// Ore
// ---------------------------------------------------------------------
export const ORES = {
  ferrite: { name: 'Ferrite',      value: 4,   mass: 0.08, color: '#c9a27a', glow: '#ffb86b' },
  cuprite: { name: 'Cuprite',      value: 11,  mass: 0.09, color: '#e0784a', glow: '#ff8a50' },
  lumen:   { name: 'Lumen Crystal',value: 26,  mass: 0.06, color: '#7ff0ff', glow: '#9ffcff' },
  void:    { name: 'Voidglass',    value: 62,  mass: 0.05, color: '#c08bff', glow: '#d9b3ff' },
  core:    { name: 'Planet Core',  value: 400, mass: 0.04, color: '#ffe36b', glow: '#fff3a8' },
};

// ---------------------------------------------------------------------
// Parts. Rotation 0 = facing "up" (ship forward). Thrusters push in
// their facing direction and exhaust out the back.
// cat drives colour coding: structure, propulsion, power, utility,
// weapon, defense, doomsday.
// ---------------------------------------------------------------------
export const PARTS = {
  core: {
    name: 'Command Core', cat: 'command', w: 1, h: 1, mass: 4, cost: 0, hp: 90,
    desc: 'Contains you, a chair, and a cup holder. Lose this and the trip is over.',
    core: true, gen: 3, battery: 25, fuel: 25, torque: 52000, cargo: 6, magnet: 70,
    rcsThrust: 380, unique: true, unlock: null,
  },
  hull: {
    name: 'Hull Plate', cat: 'structure', w: 1, h: 1, mass: 0.7, cost: 12, hp: 45,
    desc: 'Load-bearing optimism. Cheap, light, and better than a hole.',
    unlock: null,
  },
  armor: {
    name: 'Armor Block', cat: 'structure', w: 1, h: 1, mass: 3, cost: 55, hp: 200, armor: 4,
    desc: 'Dense alloy. Shrugs off 4 damage per hit and most criticism.',
    unlock: null,
  },
  thruster: {
    name: 'Thruster', cat: 'propulsion', w: 1, h: 1, mass: 1.1, cost: 40, hp: 40,
    desc: 'Pushes the way it points. Needs a clear cell behind it to vent.',
    thrust: 1150, fuelUse: 0.55, directional: true, exhaust: true, unlock: null,
  },
  heavyThruster: {
    name: 'Torch Drive', cat: 'propulsion', w: 1, h: 2, mass: 4, cost: 420, hp: 110,
    desc: 'A thruster that went to the gym. Thirsty. Very thirsty.',
    thrust: 4200, fuelUse: 1.7, directional: true, exhaust: true, unlock: 'torch',
  },
  gyro: {
    name: 'Gyroscope', cat: 'propulsion', w: 1, h: 1, mass: 1.5, cost: 70, hp: 40,
    desc: 'Spins a heavy wheel so the rest of you can spin on purpose.',
    torque: 90000, powerUse: 2.5, unlock: null,
  },
  reactor: {
    name: 'Reactor', cat: 'power', w: 1, h: 1, mass: 2.6, cost: 110, hp: 55,
    desc: 'Makes power. Also makes a very convincing bomb when shot.',
    gen: 6, explode: { damage: 70, radius: 2.2 }, unlock: null,
  },
  fusion: {
    name: 'Fusion Reactor', cat: 'power', w: 2, h: 2, mass: 10, cost: 1900, hp: 240,
    desc: 'A small, polite sun. Please do not tap the glass.',
    gen: 30, explode: { damage: 220, radius: 3.5 }, unlock: 'fusion',
  },
  battery: {
    name: 'Battery', cat: 'power', w: 1, h: 1, mass: 1.2, cost: 60, hp: 35,
    desc: 'Stores power for the moments your reactor cannot keep up with your ambitions.',
    battery: 70, unlock: null,
  },
  fuelTank: {
    name: 'Fuel Tank', cat: 'utility', w: 1, h: 1, mass: 0.8, cost: 35, hp: 35,
    desc: 'Holds 70 units of go-juice. Gets lighter as you burn it.',
    fuel: 70, unlock: null,
  },
  cargo: {
    name: 'Cargo Pod', cat: 'utility', w: 1, h: 1, mass: 1, cost: 45, hp: 50,
    desc: 'Holds 20 ore. Full pods are heavy pods; plan your center of mass.',
    cargo: 20, unlock: null,
  },
  tractor: {
    name: 'Tractor Coil', cat: 'utility', w: 1, h: 1, mass: 1.5, cost: 260, hp: 40,
    desc: 'Politely insists that nearby ore comes over here.',
    magnet: 230, powerUse: 1, unlock: 'tractor',
  },
  laser: {
    name: 'Mining Laser', cat: 'utility', w: 1, h: 1, mass: 1.6, cost: 90, hp: 40,
    desc: 'Cuts rock along its facing. Also stings ships, mildly.',
    mining: 13, laserRange: 170, enemyDps: 7, powerUse: 3, directional: true, muzzle: true, unlock: null,
  },
  turret: {
    name: 'Autocannon', cat: 'weapon', w: 1, h: 1, mass: 2, cost: 130, hp: 55,
    desc: 'Aims itself at anything rude. Fires whenever enemies are in range.',
    weapon: { damage: 7, rate: 4, range: 480, speed: 760, energy: 0.55, spread: 0.06 }, unlock: null,
  },
  railgun: {
    name: 'Railgun', cat: 'weapon', w: 1, h: 2, mass: 5, cost: 780, hp: 90,
    desc: 'Fires forward on [Space]. Recoil is real. Mount it centered unless you enjoy pirouettes.',
    weapon: { damage: 95, rate: 0.8, range: 1100, speed: 1900, energy: 14, recoil: 9000, pierce: 3 },
    directional: true, muzzle: true, unlock: 'railgun',
  },
  shield: {
    name: 'Shield Emitter', cat: 'defense', w: 1, h: 1, mass: 2.2, cost: 540, hp: 50,
    desc: 'Projects a bubble that absorbs hits and recharges after a short sulk.',
    shield: 70, shieldRegen: 9, powerUse: 4, unlock: 'shields',
  },
  cracker: {
    name: 'Planet Cracker', cat: 'doomsday', w: 3, h: 3, mass: 45, cost: 80000, hp: 900,
    desc: 'Hold [C] near a planet. Requires a lot of power, nerve, and paperwork.',
    cracker: { chargeTime: 14, power: 28, range: 1300 }, directional: true, muzzle: true, unlock: 'cracker',
  },
};

// Builder grid
export const GRID = { size: 13, frameSizes: [7, 9, 11, 13] };

// ---------------------------------------------------------------------
// Enemies. `ai` selects a behaviour in enemies.js.
// ---------------------------------------------------------------------
export const ENEMIES = {
  gnat: {
    name: 'Scrap Gnat', ai: 'orbit', hp: 22, radius: 11, speed: 260, accel: 380, turn: 5,
    weapon: { damage: 4, rate: 1.1, speed: 420, range: 380 }, bounty: 14, color: '#ff5d73',
    orbit: 200,
  },
  lancer: {
    name: 'Repo Lancer', ai: 'ram', hp: 40, radius: 13, speed: 380, accel: 520, turn: 3.5,
    ram: 22, bounty: 22, color: '#ff8c42',
  },
  gunboat: {
    name: 'Toll Collector', ai: 'standoff', hp: 110, radius: 18, speed: 170, accel: 220, turn: 2.5,
    weapon: { damage: 9, rate: 0.6, speed: 520, range: 520, burst: 3, burstGap: 0.12 }, bounty: 55,
    color: '#ffd23f', standoff: 380,
  },
  leech: {
    name: 'Ore Leech', ai: 'leech', hp: 60, radius: 14, speed: 300, accel: 420, turn: 4,
    steal: 3, bounty: 40, color: '#7bd389',
  },
  minelayer: {
    name: 'Litterbug', ai: 'mines', hp: 140, radius: 20, speed: 150, accel: 180, turn: 2,
    mine: { damage: 35, radius: 70, every: 2.2, life: 25 }, bounty: 70, color: '#c77dff',
  },
  warden: {
    name: 'Complaints Dept.', ai: 'missiles', hp: 260, radius: 22, speed: 160, accel: 200, turn: 2,
    missile: { damage: 18, speed: 300, turn: 2.6, every: 2.6, life: 6 }, standoff: 450, bounty: 120,
    color: '#5bc0eb',
  },
};

// Bosses: phases are attack lists the boss cycles through. Attack types
// are implemented in enemies.js (spread, ring, spawn, charge, beam, missiles).
export const BOSSES = {
  grudge: {
    name: 'Foreman Grudge', title: 'Disputes your mining rights', hp: 1500, radius: 60, speed: 90,
    accel: 90, turn: 0.8, color: '#ff8c42', bounty: 1200, standoff: 340,
    phases: [
      { until: 0.5, attacks: [{ type: 'spread', count: 5, arc: 0.7, damage: 6, speed: 380, every: 1.6 },
                              { type: 'spawn', enemy: 'gnat', count: 2, every: 9 }] },
      { until: 0, attacks: [{ type: 'ring', count: 14, damage: 6, speed: 300, every: 2.6 },
                            { type: 'spawn', enemy: 'lancer', count: 2, every: 8 },
                            { type: 'spread', count: 7, arc: 0.9, damage: 6, speed: 420, every: 2.1 }] },
    ],
  },
  auditor: {
    name: 'The Auditor', title: 'Found some irregularities', hp: 7000, radius: 64, speed: 110,
    accel: 110, turn: 1, color: '#ffd23f', bounty: 5000, standoff: 420,
    phases: [
      { until: 0.6, attacks: [{ type: 'beam', damage: 26, length: 700, sweep: 1.3, duration: 2.4, every: 6 },
                              { type: 'spawn', enemy: 'gunboat', count: 1, every: 12 }] },
      { until: 0, attacks: [{ type: 'beam', damage: 30, length: 760, sweep: 1.8, duration: 2.6, every: 4.5 },
                            { type: 'ring', count: 18, damage: 9, speed: 340, every: 3 },
                            { type: 'spawn', enemy: 'gnat', count: 3, every: 9 }] },
    ],
  },
  matriarch: {
    name: 'Matriarch Vexa', title: 'Owns this rock and all rocks like it', hp: 17000, radius: 70,
    speed: 140, accel: 140, turn: 1.2, color: '#7bd389', bounty: 14000, standoff: 300,
    phases: [
      { until: 0.5, attacks: [{ type: 'spawn', enemy: 'leech', count: 3, every: 8 },
                              { type: 'ring', count: 20, damage: 12, speed: 320, every: 2.8 }] },
      { until: 0, attacks: [{ type: 'charge', damage: 60, speed: 620, every: 6 },
                            { type: 'spread', count: 9, arc: 1.2, damage: 12, speed: 460, every: 1.8 },
                            { type: 'spawn', enemy: 'minelayer', count: 1, every: 14 }] },
    ],
  },
  mildred: {
    name: 'Dreadnought Mildred', title: 'Has been doing this since before you were a schematic',
    hp: 42000, radius: 84, speed: 80, accel: 80, turn: 0.6, color: '#5bc0eb', bounty: 35000, standoff: 460,
    phases: [
      { until: 0.66, attacks: [{ type: 'missiles', count: 4, damage: 22, speed: 320, turn: 2.4, every: 4 },
                               { type: 'spread', count: 7, arc: 0.8, damage: 16, speed: 500, every: 2 }] },
      { until: 0.33, attacks: [{ type: 'beam', damage: 45, length: 900, sweep: 2.2, duration: 3, every: 6 },
                               { type: 'spawn', enemy: 'warden', count: 1, every: 15 },
                               { type: 'ring', count: 24, damage: 14, speed: 360, every: 3.2 }] },
      { until: 0, attacks: [{ type: 'missiles', count: 6, damage: 22, speed: 360, turn: 2.8, every: 3.2 },
                            { type: 'charge', damage: 90, speed: 700, every: 7 },
                            { type: 'ring', count: 30, damage: 14, speed: 380, every: 2.4 }] },
    ],
  },
};

// ---------------------------------------------------------------------
// Sectors. Each is a separate jump destination with its own outpost.
// ---------------------------------------------------------------------
export const SECTORS = [
  {
    id: 'shallows', name: 'The Shallows', blurb: 'Gentle rocks, gentle pirates. A fine place to make mistakes.',
    radius: 3600, asteroids: 120, hardness: 1, ores: { ferrite: 1 }, enemyScale: 1,
    enemies: ['gnat', 'lancer'], firstWave: 80, waveInterval: 75, waveBudget: 2, waveGrowth: 0.5, maxWaveBudget: 7,
    boss: 'grudge', threatPerOre: 0.3, threatPerKill: 1.5, bg: ['#0a0f24', '#1b1140'], license: null,
  },
  {
    id: 'rust', name: 'Rust Belt', blurb: 'Industrial leftovers and the people who left them.',
    radius: 4000, asteroids: 140, hardness: 1.8, ores: { ferrite: 0.45, cuprite: 0.55 }, enemyScale: 1.5,
    enemies: ['gnat', 'lancer', 'gunboat', 'leech'], firstWave: 60, waveInterval: 65, waveBudget: 4, waveGrowth: 0.7, maxWaveBudget: 12,
    boss: 'auditor', threatPerOre: 0.12, threatPerKill: 1.2, bg: ['#160b0b', '#3a1a12'], license: 'licRust',
  },
  {
    id: 'glass', name: 'Glass Reach', blurb: 'Crystal fields that sing when lasered. Locals find this territorial.',
    radius: 4400, asteroids: 150, hardness: 3, ores: { cuprite: 0.3, lumen: 0.7 }, enemyScale: 2.4,
    enemies: ['gnat', 'gunboat', 'leech', 'minelayer', 'lancer'], firstWave: 55, waveInterval: 60, waveBudget: 6, waveGrowth: 0.9, maxWaveBudget: 18,
    boss: 'matriarch', threatPerOre: 0.06, threatPerKill: 0.9, bg: ['#04141c', '#0b3a4a'], license: 'licGlass',
  },
  {
    id: 'pale', name: 'The Deep Pale', blurb: 'Quiet, cold, and full of things that dislike quiet and cold.',
    radius: 4800, asteroids: 160, hardness: 4.6, ores: { lumen: 0.4, void: 0.6 }, enemyScale: 3.6,
    enemies: ['gunboat', 'leech', 'minelayer', 'warden', 'lancer'], firstWave: 50, waveInterval: 55, waveBudget: 9, waveGrowth: 1.1, maxWaveBudget: 26,
    boss: 'mildred', threatPerOre: 0.03, threatPerKill: 0.7, bg: ['#0c0c14', '#2b2340'], license: 'licPale',
  },
  {
    id: 'gorvox', name: 'Gorvox System', blurb: 'Home of Gorvox IV, a planet nobody will miss. Probably.',
    radius: 5200, asteroids: 130, hardness: 5.5, ores: { void: 1 }, enemyScale: 4.5,
    enemies: ['gunboat', 'warden', 'minelayer', 'lancer', 'gnat'], firstWave: 45, waveInterval: 55, waveBudget: 10, waveGrowth: 1.2, maxWaveBudget: 30,
    boss: null, planet: true, threatPerOre: 0, threatPerKill: 0, bg: ['#160812', '#40142a'], license: 'licGorvox',
  },
];

export const ASTEROIDS = {
  minRadius: 18, maxRadius: 78,
  hpPerArea: 0.018,          // hp = pi r^2 * this * hardness
  orePerHp: 0.1,             // ore units dropped per point of mining damage (before hardness)
  chunkEvery: 1,             // drop a chunk each time this many ore accumulate
  splitMinRadius: 30,        // rocks bigger than this split into two when destroyed
  respawnDelay: 6,           // seconds between respawns when below target count
  innerClear: 650,           // no rocks this close to the outpost
  pickupLife: 40,
};

// ---------------------------------------------------------------------
// Planets (endgame)
// ---------------------------------------------------------------------
export const PLANETS = {
  names: ['Gorvox IV', 'Gorvox V (Spite)', 'New Gorvox', 'Gorvox Prime Deluxe', 'Gorvox Again'],
  radius: 520, distance: 3300,
  baseReward: 250000, rewardGrowth: 1.6,   // credits for each successive planet
  coreDrops: 120,                          // Planet Core ore chunks flung out
  defenseWaveEvery: 7, defenseBudget: 8,   // waves while the cracker charges
};

// ---------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------
export const ECONOMY = {
  startCredits: 150,
  refuelCostPerUnit: 0.05,
  repairCostFactor: 0.35,          // fraction of part cost per 100% damage
  destroyedPartRepairFactor: 0.6,  // fraction of part cost to rebuild a lost part
  insuranceCap: 0.5,               // you pay at most this share of your credits on death
  waveDropChance: 0.55,            // enemies drop salvage ore
  stationSafeRadius: 520,
  dockRadius: 260,
  dockMaxSpeed: 160,
  offlineCapHours: 4,
};

// ---------------------------------------------------------------------
// Research tree. cost is an array (one entry per level).
// effect keys are read by economy.js -> upgradeEffects().
// ---------------------------------------------------------------------
export const UPGRADES = [
  // Industry
  { id: 'brokers',  branch: 'Industry', name: 'Ore Brokers', desc: '+12% sell price per level. They know a guy.',
    cost: [220, 600, 1500, 3800, 9000], effect: { sellMult: 0.12 }, requires: [] },
  { id: 'optics',   branch: 'Industry', name: 'Laser Optics', desc: '+20% mining damage per level.',
    cost: [300, 900, 2400, 6500, 16000], effect: { miningMult: 0.2 }, requires: [] },
  { id: 'tractor',  branch: 'Industry', name: 'Tractor Coils', desc: 'Unlocks the Tractor Coil part.',
    cost: [700], effect: {}, requires: ['brokers'] },
  { id: 'refinery', branch: 'Industry', name: 'Onboard Refinery', desc: '+15% ore per rock per level.',
    cost: [1200, 3500, 9000, 22000], effect: { yieldMult: 0.15 }, requires: ['optics'] },
  { id: 'drones',   branch: 'Industry', name: 'Drone Bay', desc: 'Drones mine while you do anything else. Passive income, also offline.',
    cost: [1500, 4000, 11000, 30000, 80000], effect: { droneRate: 1 }, requires: ['refinery'] },
  // Engineering
  { id: 'frame',    branch: 'Engineering', name: 'Frame Extension', desc: 'Larger build area: 9x9, 11x11, 13x13.',
    cost: [500, 4000, 20000], effect: { frame: 1 }, requires: [] },
  { id: 'alloys',   branch: 'Engineering', name: 'Better Alloys', desc: '+15% part health per level.',
    cost: [400, 1200, 3500, 10000], effect: { hpMult: 0.15 }, requires: [] },
  { id: 'injectors', branch: 'Engineering', name: 'Fuel Injectors', desc: '-12% thruster fuel use per level.',
    cost: [350, 1100, 3200], effect: { fuelEff: 0.12 }, requires: [] },
  { id: 'torch',    branch: 'Engineering', name: 'Torch Drives', desc: 'Unlocks the Torch Drive heavy thruster.',
    cost: [2200], effect: {}, requires: ['injectors'] },
  { id: 'fusion',   branch: 'Engineering', name: 'Fusion Licensing', desc: 'Unlocks the Fusion Reactor.',
    cost: [6000], effect: {}, requires: ['alloys'] },
  // Arsenal
  { id: 'ballistics', branch: 'Arsenal', name: 'Ballistics', desc: '+18% weapon damage per level.',
    cost: [350, 1000, 3000, 8500, 22000], effect: { damageMult: 0.18 }, requires: [] },
  { id: 'loaders',  branch: 'Arsenal', name: 'Auto-Loaders', desc: '+12% fire rate per level.',
    cost: [600, 2000, 6000, 16000], effect: { rateMult: 0.12 }, requires: ['ballistics'] },
  { id: 'shields',  branch: 'Arsenal', name: 'Shield Theory', desc: 'Unlocks the Shield Emitter.',
    cost: [1400], effect: {}, requires: [] },
  { id: 'railgun',  branch: 'Arsenal', name: 'Railgun Permit', desc: 'Unlocks the Railgun. The permit is mostly a formality.',
    cost: [3000], effect: {}, requires: ['ballistics'] },
  { id: 'harmonics', branch: 'Arsenal', name: 'Shield Harmonics', desc: '+25% shield capacity and regen per level.',
    cost: [2500, 7000, 20000], effect: { shieldMult: 0.25 }, requires: ['shields'] },
  // Licenses (jump access). requiresBoss: you must defeat that sector's boss first.
  { id: 'licRust',  branch: 'Licenses', name: 'Rust Belt License', desc: 'Jump access to the Rust Belt.',
    cost: [900], effect: {}, requires: [], requiresBoss: 'grudge' },
  { id: 'licGlass', branch: 'Licenses', name: 'Glass Reach License', desc: 'Jump access to the Glass Reach.',
    cost: [8000], effect: {}, requires: ['licRust'], requiresBoss: 'auditor' },
  { id: 'licPale',  branch: 'Licenses', name: 'Deep Pale License', desc: 'Jump access to the Deep Pale.',
    cost: [30000], effect: {}, requires: ['licGlass'], requiresBoss: 'matriarch' },
  { id: 'licGorvox', branch: 'Licenses', name: 'Gorvox Clearance', desc: 'Jump access to the Gorvox System. Nobody asks why.',
    cost: [75000], effect: {}, requires: ['licPale'], requiresBoss: 'mildred' },
  // Doomsday
  { id: 'cracker',  branch: 'Doomsday', name: 'Planet Cracker Schematics', desc: 'Unlocks the Planet Cracker. It is exactly what it sounds like.',
    cost: [40000], effect: {}, requires: ['licPale', 'fusion'] },
  { id: 'capacitors', branch: 'Doomsday', name: 'Cracker Capacitors', desc: '-15% cracker charge time per level.',
    cost: [30000, 70000], effect: { chargeEff: 0.15 }, requires: ['cracker'] },
  { id: 'salvage',  branch: 'Doomsday', name: 'Planetary Salvage', desc: '+30% planet destruction reward per level.',
    cost: [50000, 120000], effect: { planetMult: 0.3 }, requires: ['cracker'] },
];

export const DRONES = { creditsPerMinutePerLevel: [0, 40, 110, 260, 600, 1300] };

// Pre-built ships. Cells are [part, x, y, rot] relative to grid center.
export const PRESETS = {
  pebble: { name: 'Pebble', desc: 'The starter. Reliable, modest, beige in spirit.', cells: [
    ['thruster', -1, -2, 2], ['laser', 0, -2, 0], ['thruster', 1, -2, 2],
    ['hull', -1, -1, 0], ['cargo', 0, -1, 0], ['turret', 1, -1, 0],
    ['fuelTank', -1, 0, 0], ['core', 0, 0, 0], ['cargo', 1, 0, 0],
    ['thruster', -1, 1, 0], ['reactor', 0, 1, 0], ['thruster', 1, 1, 0],
  ] },
  prospector: { name: 'Prospector', desc: 'Two lasers, deep holds. Fights like an accountant.', cells: [
    ['laser', -1, -3, 0], ['hull', 0, -3, 0], ['laser', 1, -3, 0],
    ['thruster', -2, -2, 2], ['cargo', -1, -2, 0], ['turret', 0, -2, 0], ['cargo', 1, -2, 0], ['thruster', 2, -2, 2],
    ['cargo', -2, -1, 0], ['cargo', -1, -1, 0], ['reactor', 0, -1, 0], ['cargo', 1, -1, 0], ['cargo', 2, -1, 0],
    ['thruster', -2, 0, 1], ['fuelTank', -1, 0, 0], ['core', 0, 0, 0], ['fuelTank', 1, 0, 0], ['thruster', 2, 0, 3],
    ['gyro', -1, 1, 0], ['battery', 0, 1, 0], ['gyro', 1, 1, 0],
    ['thruster', -1, 2, 0], ['thruster', 0, 2, 0], ['thruster', 1, 2, 0],
  ] },
  brawler: { name: 'Brawler', desc: 'Armor, guns, and a tendency to start things.', cells: [
    ['thruster', -2, -3, 2], ['armor', -1, -3, 0], ['laser', 0, -3, 0], ['armor', 1, -3, 0], ['thruster', 2, -3, 2],
    ['turret', -2, -2, 0], ['armor', -1, -2, 0], ['hull', 0, -2, 0], ['armor', 1, -2, 0], ['turret', 2, -2, 0],
    ['turret', -2, -1, 0], ['reactor', -1, -1, 0], ['cargo', 0, -1, 0], ['reactor', 1, -1, 0], ['turret', 2, -1, 0],
    ['thruster', -2, 0, 1], ['battery', -1, 0, 0], ['core', 0, 0, 0], ['battery', 1, 0, 0], ['thruster', 2, 0, 3],
    ['gyro', -1, 1, 0], ['fuelTank', 0, 1, 0], ['gyro', 1, 1, 0],
    ['thruster', -1, 2, 0], ['thruster', 0, 2, 0], ['thruster', 1, 2, 0],
  ] },
  excavator: { name: 'Excavator', desc: 'Three lasers, shields, and enough guns to finish arguments. Needs a 9×9 frame.', cells: [
    ['laser', -2, -4, 0], ['laser', 0, -4, 0], ['laser', 2, -4, 0],
    ['thruster', -3, -3, 2], ['armor', -2, -3, 0], ['cargo', -1, -3, 0], ['turret', 0, -3, 0], ['cargo', 1, -3, 0], ['armor', 2, -3, 0], ['thruster', 3, -3, 2],
    ['turret', -3, -2, 0], ['cargo', -2, -2, 0], ['cargo', -1, -2, 0], ['reactor', 0, -2, 0], ['cargo', 1, -2, 0], ['cargo', 2, -2, 0], ['turret', 3, -2, 0],
    ['thruster', -4, -1, 1], ['cargo', -3, -1, 0], ['cargo', -2, -1, 0], ['battery', -1, -1, 0], ['shield', 0, -1, 0], ['battery', 1, -1, 0], ['cargo', 2, -1, 0], ['cargo', 3, -1, 0], ['thruster', 4, -1, 3],
    ['gyro', -3, 0, 0], ['fuelTank', -2, 0, 0], ['reactor', -1, 0, 0], ['core', 0, 0, 0], ['reactor', 1, 0, 0], ['fuelTank', 2, 0, 0], ['gyro', 3, 0, 0],
    ['turret', -3, 1, 0], ['cargo', -2, 1, 0], ['battery', -1, 1, 0], ['shield', 0, 1, 0], ['battery', 1, 1, 0], ['cargo', 2, 1, 0], ['turret', 3, 1, 0],
    ['gyro', -3, 2, 0], ['fuelTank', -2, 2, 0], ['thruster', -1, 2, 0], ['thruster', 0, 2, 0], ['thruster', 1, 2, 0], ['fuelTank', 2, 2, 0], ['gyro', 3, 2, 0],
    ['thruster', -3, 3, 0], ['thruster', -2, 3, 0], ['thruster', 2, 3, 0], ['thruster', 3, 3, 0],
  ] },
  leviathan: { name: 'Leviathan', desc: 'Torch drives, fusion power, a railgun and a cargo bay you could lose a moon in. 11×11.', cells: [
    ['laser', -4, -5, 0], ['laser', -2, -5, 0], ['railgun', 0, -5, 0], ['laser', 2, -5, 0], ['laser', 4, -5, 0],
    ['thruster', -5, -4, 2], ['cargo', -4, -4, 0], ['armor', -3, -4, 0], ['cargo', -2, -4, 0], ['armor', -1, -4, 0], ['armor', 1, -4, 0], ['cargo', 2, -4, 0], ['armor', 3, -4, 0], ['cargo', 4, -4, 0], ['thruster', 5, -4, 2],
    ['turret', -5, -3, 0], ['cargo', -4, -3, 0], ['cargo', -3, -3, 0], ['cargo', -2, -3, 0], ['shield', -1, -3, 0], ['turret', 0, -3, 0], ['shield', 1, -3, 0], ['cargo', 2, -3, 0], ['cargo', 3, -3, 0], ['cargo', 4, -3, 0], ['turret', 5, -3, 0],
    ['thruster', -5, -2, 1], ['fuelTank', -4, -2, 0], ['fusion', -3, -2, 0], ['battery', -1, -2, 0], ['battery', 0, -2, 0], ['battery', 1, -2, 0], ['fusion', 2, -2, 0], ['fuelTank', 4, -2, 0], ['thruster', 5, -2, 3],
    ['turret', -5, -1, 0], ['fuelTank', -4, -1, 0], ['battery', -1, -1, 0], ['gyro', 0, -1, 0], ['battery', 1, -1, 0], ['fuelTank', 4, -1, 0], ['turret', 5, -1, 0],
    ['shield', -5, 0, 0], ['gyro', -4, 0, 0], ['cargo', -3, 0, 0], ['cargo', -2, 0, 0], ['tractor', -1, 0, 0], ['core', 0, 0, 0], ['battery', 1, 0, 0], ['cargo', 2, 0, 0], ['cargo', 3, 0, 0], ['gyro', 4, 0, 0], ['shield', 5, 0, 0],
    ['turret', -5, 1, 0], ['gyro', -4, 1, 0], ['cargo', -3, 1, 0], ['cargo', -2, 1, 0], ['armor', -1, 1, 0], ['gyro', 0, 1, 0], ['armor', 1, 1, 0], ['cargo', 2, 1, 0], ['cargo', 3, 1, 0], ['gyro', 4, 1, 0], ['turret', 5, 1, 0],
    ['thruster', -4, 2, 0], ['heavyThruster', -3, 2, 0], ['fuelTank', -2, 2, 0], ['heavyThruster', -1, 2, 0], ['fuelTank', 0, 2, 0], ['heavyThruster', 1, 2, 0], ['fuelTank', 2, 2, 0], ['heavyThruster', 3, 2, 0], ['thruster', 4, 2, 0],
  ] },
  larry: { name: 'Lopsided Larry', desc: 'A teaching aid. Watch what off-center thrust does.', cells: [
    ['laser', 0, -1, 0], ['core', 0, 0, 0], ['cargo', 1, 0, 0], ['hull', 2, 0, 0],
    ['hull', 3, 0, 0], ['thruster', 3, 1, 0], ['thruster', 2, 1, 0], ['reactor', 0, 1, 0],
  ] },
  doom: { name: 'Doomsday Barge', desc: 'Built for one job. The job is a planet.', cells: [
    ['cracker', -1, -5, 0],
    ['shield', -3, -2, 0], ['fusion', -2, -2, 0], ['hull', 0, -2, 0], ['fusion', 1, -2, 0], ['shield', 3, -2, 0],
    ['turret', -3, -1, 0], ['hull', 0, -1, 0], ['turret', 3, -1, 0],
    ['turret', -3, 0, 0], ['battery', -2, 0, 0], ['battery', -1, 0, 0], ['core', 0, 0, 0], ['battery', 1, 0, 0], ['battery', 2, 0, 0], ['turret', 3, 0, 0],
    ['fuelTank', -3, 1, 0], ['gyro', -2, 1, 0], ['gyro', -1, 1, 0], ['fuelTank', 0, 1, 0], ['gyro', 1, 1, 0], ['gyro', 2, 1, 0], ['fuelTank', 3, 1, 0],
    ['thruster', -3, 2, 0], ['heavyThruster', -2, 2, 0], ['thruster', -1, 2, 0], ['thruster', 0, 2, 0], ['thruster', 1, 2, 0], ['heavyThruster', 2, 2, 0], ['thruster', 3, 2, 0],
  ] },
};

// Fun text bits
export const FLAVOR = {
  deaths: [
    'Hull integrity: philosophical.',
    'The insurance adjuster sighs audibly.',
    'Your ship has been converted into a debris field. Very efficient.',
    'Lesson learned. Probably.',
  ],
  docks: [
    'Welcome to the Franchise Outpost. Wipe your thrusters.',
    'Outpost services: buying ore, selling hope.',
    'Docking clamps engaged. Please do not lick the clamps.',
  ],
  bossKills: [
    'Their lawyers will be in touch.',
    'Dispute resolved.',
    'That will look excellent on a résumé.',
  ],
};
