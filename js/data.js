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
  zoom: 1.35, minZoom: 0.12, maxZoom: 2.2,
  speedZoomOut: 0.00045,    // zoom out a little as you go faster
  lookAhead: 0.35,          // seconds of velocity the camera leads by
  smoothing: 5,             // higher = snappier follow
};

// ---------------------------------------------------------------------
// Ore
// ---------------------------------------------------------------------
// Planet materials. Every mined cube becomes one unit of cargo.
// hp: laser damage to rip a cube out; tier: mining tool tier needed to cut it
// at full speed (weaker tools only scratch it); value: credits per cube.
export const ORES = {
  regolith: { name: 'Regolith',      hp: 5,   tier: 1, value: 1,   mass: 0.06, color: '#8a7f73', glow: '#c9b8a3' },
  ferrite:  { name: 'Ferrite',       hp: 7,   tier: 1, value: 3,   mass: 0.08, color: '#c9a27a', glow: '#ffb86b' },
  basalt:   { name: 'Basalt',        hp: 16,  tier: 1, value: 3,   mass: 0.09, color: '#4f4a52', glow: '#8b8494' },
  cuprite:  { name: 'Cuprite',       hp: 22,  tier: 1, value: 8,   mass: 0.09, color: '#e0784a', glow: '#ff8a50' },
  obsidian: { name: 'Obsidian',      hp: 60,  tier: 2, value: 10,  mass: 0.07, color: '#2a2238', glow: '#7b5cff' },
  lumen:    { name: 'Lumen Crystal', hp: 75,  tier: 2, value: 28,  mass: 0.06, color: '#7ff0ff', glow: '#9ffcff' },
  magmite:  { name: 'Magmite',       hp: 200, tier: 3, value: 35,  mass: 0.08, color: '#b8321e', glow: '#ff7a3d' },
  void:     { name: 'Voidheart',     hp: 240, tier: 3, value: 90,  mass: 0.05, color: '#c08bff', glow: '#e0c2ff' },
  core:     { name: 'Planet Core',   hp: 400, tier: 3, value: 400, mass: 0.04, color: '#ffe36b', glow: '#fff3a8' },
};

// The planet: a disc of cubes in layers. Deeper layers are harder and richer.
export const PLANETGEN = {
  cell: 16,                 // world px per cube
  radius: 2000,             // first planet; later planets are `growth` times larger
  growth: 1.25,
  hpGrowth: 1.6, valueGrowth: 1.8,   // per later planet
  surfaceNoise: 0.035,      // bumpiness of the surface
  layers: [                 // `to`: inner edge as a fraction of the radius
    { name: 'Crust',       to: 0.8, base: 'regolith', vein: 'ferrite', veinChance: 0.2 },
    { name: 'Mantle',      to: 0.5, base: 'basalt',   vein: 'cuprite', veinChance: 0.17 },
    { name: 'Deep Mantle', to: 0.2, base: 'obsidian', vein: 'lumen',   veinChance: 0.16 },
    { name: 'Core',        to: 0,   base: 'magmite',  vein: 'void',    veinChance: 0.22 },
  ],
  starshipGap: 1300,        // distance from the surface to your starship
  underTierDamage: 0.04,    // share of damage a too-weak tool still does
  collapseAt: 0.995,        // past this, the remaining dust collapses and the planet is done
  maxPickups: 320,
};

// ---------------------------------------------------------------------
// Parts. Rotation 0 = facing "up" (ship forward). Thrusters push in
// their facing direction and exhaust out the back.
// cat drives colour coding: structure, propulsion, power, utility,
// weapon, defense, doomsday.
// ---------------------------------------------------------------------
export const PARTS = {
  core: {
    name: 'Command Core', cat: 'command', role: 'both', w: 1, h: 1, mass: 4, cost: 0, hp: 90,
    desc: 'Contains you, a chair, and a cup holder. Lose this and the trip is over.',
    core: true, gen: 3, battery: 25, fuel: 25, torque: 52000, cargo: 6, magnet: 120,
    rcsThrust: 380, unique: true, unlock: null,
  },
  hull: {
    name: 'Hull Plate', cat: 'structure', role: 'both', w: 1, h: 1, mass: 0.7, cost: 12, hp: 45,
    desc: 'Load-bearing optimism. Cheap, light, and better than a hole.',
    unlock: null,
  },
  armor: {
    name: 'Armor Block', cat: 'structure', role: 'both', w: 1, h: 1, mass: 3, cost: 55, hp: 200, armor: 4,
    desc: 'Dense alloy. Shrugs off 4 damage per hit and most criticism.',
    unlock: null,
  },
  thruster: {
    name: 'Thruster', cat: 'propulsion', role: 'freighter', w: 1, h: 1, mass: 1.1, cost: 40, hp: 40,
    desc: 'Pushes the way it points. Needs a clear cell behind it to vent.',
    thrust: 1150, fuelUse: 0.55, directional: true, exhaust: true, unlock: null,
  },
  heavyThruster: {
    name: 'Torch Drive', cat: 'propulsion', role: 'freighter', w: 1, h: 2, mass: 4, cost: 420, hp: 110,
    desc: 'A thruster that went to the gym. Thirsty. Very thirsty.',
    thrust: 4200, fuelUse: 1.7, directional: true, exhaust: true, unlock: 'torch',
  },
  gyro: {
    name: 'Gyroscope', cat: 'propulsion', role: 'both', w: 1, h: 1, mass: 1.5, cost: 70, hp: 40,
    desc: 'Spins a heavy wheel so the rest of you can spin on purpose.',
    torque: 90000, powerUse: 2.5, unlock: null,
  },
  reactor: {
    name: 'Reactor', cat: 'power', role: 'both', w: 1, h: 1, mass: 2.6, cost: 110, hp: 55,
    desc: 'Makes power. Also makes a very convincing bomb when shot.',
    gen: 6, explode: { damage: 70, radius: 2.2 }, unlock: null,
  },
  fusion: {
    name: 'Fusion Reactor', cat: 'power', role: 'both', w: 2, h: 2, mass: 10, cost: 1900, hp: 240,
    desc: 'A small, polite sun. Please do not tap the glass.',
    gen: 30, explode: { damage: 220, radius: 3.5 }, unlock: 'fusion',
  },
  battery: {
    name: 'Battery', cat: 'power', role: 'both', w: 1, h: 1, mass: 1.2, cost: 60, hp: 35,
    desc: 'Stores power for the moments your reactor cannot keep up with your ambitions.',
    battery: 70, unlock: null,
  },
  fuelTank: {
    name: 'Fuel Tank', cat: 'utility', role: 'freighter', w: 1, h: 1, mass: 0.8, cost: 35, hp: 35,
    desc: 'Holds 70 units of go-juice. Gets lighter as you burn it.',
    fuel: 70, unlock: null,
  },
  cargo: {
    name: 'Cargo Pod', cat: 'utility', role: 'freighter', w: 1, h: 1, mass: 1, cost: 45, hp: 50,
    desc: 'Holds 20 ore. Full pods are heavy pods; plan your center of mass.',
    cargo: 20, unlock: null,
  },
  tractor: {
    name: 'Tractor Coil', cat: 'utility', role: 'freighter', w: 1, h: 1, mass: 1.5, cost: 260, hp: 40,
    desc: 'Politely insists that nearby ore comes over here.',
    magnet: 230, powerUse: 1, unlock: 'tractor',
  },
  laser: {
    name: 'Mining Laser', cat: 'utility', role: 'freighter', w: 1, h: 1, mass: 1.6, cost: 90, hp: 40,
    desc: 'Tier 1 tool. Cuts rock along its facing; fine for the Crust and Mantle.',
    mining: 13, tier: 1, laserRange: 170, enemyDps: 0, powerUse: 3, directional: true, muzzle: true, unlock: null,
  },
  turret: {
    name: 'Autocannon', cat: 'weapon', role: 'fighter', w: 1, h: 1, mass: 2, cost: 130, hp: 55,
    desc: 'Aims itself at anything rude. Fires whenever enemies are in range.',
    weapon: { damage: 7, rate: 4, range: 480, speed: 760, energy: 0.55, spread: 0.06 }, unlock: null,
  },
  railgun: {
    name: 'Railgun', cat: 'weapon', role: 'fighter', w: 1, h: 2, mass: 5, cost: 780, hp: 90,
    desc: 'Fires forward on [Space]. Recoil is real. Mount it centered unless you enjoy pirouettes.',
    weapon: { damage: 95, rate: 0.8, range: 1100, speed: 1900, energy: 14, recoil: 9000, pierce: 3 },
    directional: true, muzzle: true, unlock: 'railgun',
  },
  shield: {
    name: 'Shield Emitter', cat: 'defense', role: 'fighter', w: 1, h: 1, mass: 2.2, cost: 540, hp: 50,
    desc: 'Projects a bubble that absorbs hits and recharges after a short sulk.',
    shield: 70, shieldRegen: 9, powerUse: 4, unlock: 'shields',
  },
  plasmaCutter: {
    name: 'Plasma Cutter', cat: 'utility', role: 'freighter', w: 1, h: 1, mass: 2.4, cost: 900, hp: 50,
    desc: 'Tier 2 tool. Cuts obsidian like warm butter — required to mine the Deep Mantle at full speed.',
    mining: 34, tier: 2, laserRange: 190, enemyDps: 0, powerUse: 7, directional: true, muzzle: true, beam: '150,120,255', beamWidth: 11, unlock: 'plasma',
  },
  deepBore: {
    name: 'Deep Bore', cat: 'utility', role: 'freighter', w: 1, h: 2, mass: 6, cost: 6500, hp: 120,
    desc: 'Tier 3 tool. Argues with planetary cores and wins — required to mine the Core at full speed.',
    mining: 110, tier: 3, laserRange: 220, enemyDps: 0, powerUse: 18, directional: true, muzzle: true, beam: '255,140,60', beamWidth: 15, unlock: 'deepbore',
  },
};

// Builder grid
// Build area: frame starts 7x7 and each Frame Extension level adds 2 (up to size x size)
export const GRID = { size: 31, frameSizes: [7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31] };

// ---------------------------------------------------------------------
// Enemies. `ai` selects a behaviour in enemies.js.
// ---------------------------------------------------------------------
export const ENEMIES = {
  interceptor: {
    cost: 1, threat: 1.6, unlockMin: 0, // wave budget cost; est. damage/s on a target that can't dodge; shift minute it appears
    name: 'Interceptor', ai: 'orbit', hp: 22, radius: 11, speed: 270, accel: 380, turn: 5,
    weapon: { damage: 4, rate: 1.1, speed: 440, range: 380 }, bounty: 3, color: '#ff5d73', orbit: 210,
  },
  raider: {
    cost: 1.5, threat: 2.4, unlockMin: 0.75,
    name: 'Raider', ai: 'ram', hp: 40, radius: 13, speed: 380, accel: 520, turn: 3.5,
    ram: 22, bounty: 5, color: '#ff8c42',
  },
  gunship: {
    cost: 3, threat: 5, unlockMin: 2,
    name: 'Gunship', ai: 'standoff', hp: 110, radius: 18, speed: 170, accel: 220, turn: 2.5,
    weapon: { damage: 9, rate: 0.6, speed: 520, range: 520, burst: 3, burstGap: 0.12 }, bounty: 12, color: '#ffd23f', standoff: 380,
  },
  minelayer: {
    cost: 4, threat: 2.2, unlockMin: 3.5,
    name: 'Minelayer', ai: 'mines', hp: 140, radius: 20, speed: 150, accel: 180, turn: 2,
    mine: { damage: 35, radius: 70, every: 2.2, life: 25 }, bounty: 16, color: '#c77dff',
  },
  frigate: {
    cost: 6, threat: 4, unlockMin: 5,
    name: 'Missile Frigate', ai: 'missiles', hp: 260, radius: 22, speed: 160, accel: 200, turn: 2,
    missile: { damage: 18, speed: 300, turn: 2.6, every: 2.6, life: 6 }, standoff: 450, bounty: 26, color: '#5bc0eb',
  },
};

// Elite capital ships turn up on a schedule during long shifts. Phases are attack
// lists cycled by enemies.js (spread, ring, spawn, charge, beam, missiles).
export const BOSSES = {
  grudge: {
    name: 'Warden-class Destroyer', title: 'Planetary defense picket', hp: 2000, radius: 60, speed: 90,
    accel: 90, turn: 0.8, color: '#ff8c42', bounty: 600, standoff: 340,
    phases: [
      { until: 0.5, attacks: [{ type: 'spread', count: 5, arc: 0.7, damage: 6, speed: 380, every: 1.6 },
                              { type: 'spawn', enemy: 'interceptor', count: 2, every: 9 }] },
      { until: 0, attacks: [{ type: 'ring', count: 14, damage: 6, speed: 300, every: 2.6 },
                            { type: 'spawn', enemy: 'raider', count: 2, every: 8 },
                            { type: 'spread', count: 7, arc: 0.9, damage: 6, speed: 420, every: 2.1 }] },
    ],
  },
  auditor: {
    name: 'Tribunal-class Cruiser', title: 'Heavy beam cruiser', hp: 7000, radius: 64, speed: 110,
    accel: 110, turn: 1, color: '#ffd23f', bounty: 2400, standoff: 420,
    phases: [
      { until: 0.6, attacks: [{ type: 'beam', damage: 13, length: 700, sweep: 1.3, duration: 2.4, every: 6 },
                              { type: 'spawn', enemy: 'gunship', count: 1, every: 12 }] },
      { until: 0, attacks: [{ type: 'beam', damage: 15, length: 760, sweep: 1.8, duration: 2.6, every: 4.5 },
                            { type: 'ring', count: 18, damage: 9, speed: 340, every: 3 },
                            { type: 'spawn', enemy: 'interceptor', count: 3, every: 9 }] },
    ],
  },
  matriarch: {
    name: 'Bastion-class Carrier', title: 'Launches strike craft in endless waves', hp: 17000, radius: 70,
    speed: 140, accel: 140, turn: 1.2, color: '#7bd389', bounty: 7000, standoff: 300,
    phases: [
      { until: 0.5, attacks: [{ type: 'spawn', enemy: 'raider', count: 3, every: 8 },
                              { type: 'ring', count: 20, damage: 12, speed: 320, every: 2.8 }] },
      { until: 0, attacks: [{ type: 'charge', damage: 35, speed: 620, every: 6 },
                            { type: 'spread', count: 9, arc: 1.2, damage: 12, speed: 460, every: 1.8 },
                            { type: 'spawn', enemy: 'minelayer', count: 1, every: 14 }] },
    ],
  },
  mildred: {
    name: 'Sovereign-class Battleship', title: 'The planet would like a word',
    hp: 42000, radius: 84, speed: 80, accel: 80, turn: 0.6, color: '#5bc0eb', bounty: 18000, standoff: 460,
    phases: [
      { until: 0.66, attacks: [{ type: 'missiles', count: 4, damage: 22, speed: 320, turn: 2.4, every: 4 },
                               { type: 'spread', count: 7, arc: 0.8, damage: 16, speed: 500, every: 2 }] },
      { until: 0.33, attacks: [{ type: 'beam', damage: 22, length: 900, sweep: 2.2, duration: 3, every: 6 },
                               { type: 'spawn', enemy: 'frigate', count: 1, every: 15 },
                               { type: 'ring', count: 24, damage: 14, speed: 360, every: 3.2 }] },
      { until: 0, attacks: [{ type: 'missiles', count: 6, damage: 22, speed: 360, turn: 2.8, every: 3.2 },
                            { type: 'charge', damage: 50, speed: 700, every: 7 },
                            { type: 'ring', count: 30, damage: 14, speed: 380, every: 2.4 }] },
    ],
  },
};

// The planet's defense swarm. It starts the moment you launch and escalates
// the longer you stay; it resets whenever you dock or your fighter falls.
export const SWARM = {
  spawnEvery: 4,          // seconds between spawn checks
  baseRate: 2.0,          // budget per minute at the start of a shift
  growth: 1.5,            // extra budget per minute, per minute of shift
  scaleGrowth: 0.06,      // enemy health/damage +6% per minute of shift
  depthScale: 1.5,        // at the core, rate and toughness are this much higher
  planetScale: 1.7,       // each later planet's swarm is this much tougher
  maxAlive: 45,
  spawnDist: [1100, 1400],
  eliteFirst: 240, eliteEvery: 240,  // seconds into a shift
  eliteOrder: ['grudge', 'auditor', 'matriarch', 'mildred'],
  eliteScaleGrowth: 0.35, // each repeat of the elite cycle is this much tougher
};

// Your fighter escorts the freighter. When it falls, both warp home and all
// mining stops until repairs finish.
export const FIGHTER = {
  escortDist: 2400,       // its picket line: this far out from the freighter, on the space side (off-screen)
  picketDrift: 0.35,      // ...swinging slowly side to side along the line (radians)
  repairBase: 20,         // seconds in the repair bay, plus...
  repairPerDamage: 100,   // ...this many seconds at 100% damage
  repairDiscount: 0.4,    // repairs cost this share of the normal price
  rushPerSecond: 4,       // credits per remaining second to rush repairs (scales with planet)
  retreatDefault: 0.3,    // retreat when hull falls below this share (player adjustable)
  coreRetreat: 0.4,       // ...or when the Command Core itself drops below this
};

// Autopilot: the freighter mines on its own after a few seconds without input,
// for a limited window (upgradeable). Offline time counts against the window.
export const IDLE = {
  delay: 5,               // seconds without input before the autopilot takes over
  windows: [120, 300, 600, 1200, 2400, 4800, 9600, 14400], // window by Autopilot research level
};

// Planet looks. The surface skin is paint only: underneath it's the same rock
// and ore. biomes: deep water, shallows, lowland, highland, dry, polar cap.
// sea: share of the surface under water. tilt: axial tilt (radians) for the caps.
export const PLANET_THEMES = [
  { name: 'Kessar Prime', bg: ['#0a0f24', '#1b1140'], sea: 0.42, cap: 0.9, tilt: 0.55,
    biomes: ['#1d4f8f', '#2f7fb8', '#4f8a3a', '#2e6531', '#c2a35d', '#e9f2f8'],
    atmo: '120,175,255', clouds: '255,255,255', cloudCover: 0.5 },
  { name: 'Vorn', bg: ['#160b0b', '#3a1a12'], sea: 0.12, cap: 0.95, tilt: 0.3,
    biomes: ['#5c1d12', '#8a3218', '#b2582f', '#6e2e20', '#d08a4c', '#e8c7a6'],
    atmo: '255,140,90', clouds: '235,190,150', cloudCover: 0.32 },
  { name: 'Oruleth', bg: ['#04141c', '#0b3a4a'], sea: 0.66, cap: 0.88, tilt: 0.8,
    biomes: ['#0d4560', '#1b8790', '#5fb36a', '#3d8a52', '#d7c98a', '#e4f6fa'],
    atmo: '90,225,235', clouds: '245,255,255', cloudCover: 0.6 },
  { name: 'Hallow', bg: ['#0c0c14', '#2b2340'], sea: 0.25, cap: 0.6, tilt: 0.2,
    biomes: ['#2b3f6b', '#4f6f9f', '#9fc0da', '#7a91b4', '#c9d6e6', '#f2f8ff'],
    atmo: '185,205,255', clouds: '240,245,255', cloudCover: 0.3 },
  { name: 'Gorvox', bg: ['#160812', '#40142a'], sea: 0.35, cap: 0.93, tilt: 0.65,
    biomes: ['#3f1653', '#6b2d7a', '#3d8b5a', '#28603f', '#c4d650', '#e7d9f2'],
    atmo: '200,120,255', clouds: '235,240,170', cloudCover: 0.5 },
];
export const MAIN_PLANETS = 3;  // finishing this many planets completes the main game

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
  // Mining (freighter)
  { id: 'brokers', role: 'freighter', branch: 'Mining', name: 'Ore Brokers', desc: '+12% sell price per level. They know a guy.',
    cost: [150, 450, 1200, 3200, 8000, 20000], effect: { sellMult: 0.12 }, requires: [] },
  { id: 'optics', role: 'freighter', branch: 'Mining', name: 'Laser Optics', desc: '+20% mining damage for every tool, per level.',
    cost: [250, 700, 1900, 5000, 13000, 32000, 80000], effect: { miningMult: 0.2 }, requires: [] },
  { id: 'tractor', role: 'freighter', branch: 'Mining', name: 'Tractor Coils', desc: 'Unlocks the Tractor Coil part; every level pulls cubes from 40% further away.',
    cost: [400, 1500, 5000], effect: { magnetMult: 0.4 }, requires: [] },
  { id: 'refinery', role: 'freighter', branch: 'Mining', name: 'Onboard Refinery', desc: '+15% value from every cube, per level.',
    cost: [900, 2600, 7000, 18000, 45000], effect: { yieldMult: 0.15 }, requires: ['brokers'] },
  { id: 'plasma', role: 'freighter', branch: 'Mining', name: 'Plasma Cutting', desc: 'Unlocks the Plasma Cutter (tier 2): the Deep Mantle needs it.',
    cost: [3500], effect: {}, requires: ['optics'] },
  { id: 'deepbore', role: 'freighter', branch: 'Mining', name: 'Deep Boring', desc: 'Unlocks the Deep Bore (tier 3): the Core needs it.',
    cost: [30000], effect: {}, requires: ['plasma'] },
  // Automation
  { id: 'autopilot', role: 'freighter', branch: 'Automation', name: 'Autopilot Cores', desc: 'Longer idle window: 2 → 5 → 10 → 20 → 40 → 80 min → 2.7 h → 4 h. Offline time counts too.',
    cost: [300, 800, 2000, 5000, 12000, 30000, 70000], effect: { autopilot: 1 }, requires: [] },
  { id: 'repairs', role: 'fighter', branch: 'Automation', name: 'Field Repairs', desc: '-15% fighter repair time per level.',
    cost: [600, 1800, 5000, 14000], effect: { repairEff: 0.15 }, requires: [] },
  // Engineering
  { id: 'frame', role: 'both', branch: 'Engineering', name: 'Frame Extension', desc: 'Build area +2 per level, from 7×7 up to 31×31. Big ships turn slowly; physics is undefeated.',
    cost: [500, 4000, 20000, 50000, 110000, 230000, 450000, 850000, 1500000, 2600000, 4400000, 7500000], effect: { frame: 1 }, requires: [] },
  { id: 'alloys', role: 'both', branch: 'Engineering', name: 'Better Alloys', desc: '+15% part health per level.',
    cost: [400, 1200, 3500, 10000], effect: { hpMult: 0.15 }, requires: [] },
  { id: 'injectors', role: 'freighter', branch: 'Engineering', name: 'Fuel Injectors', desc: '-12% thruster fuel use per level.',
    cost: [350, 1100, 3200], effect: { fuelEff: 0.12 }, requires: [] },
  { id: 'torch', role: 'freighter', branch: 'Engineering', name: 'Torch Drives', desc: 'Unlocks the Torch Drive heavy thruster.',
    cost: [2200], effect: {}, requires: ['injectors'] },
  { id: 'fusion', role: 'both', branch: 'Engineering', name: 'Fusion Licensing', desc: 'Unlocks the Fusion Reactor.',
    cost: [6000], effect: {}, requires: ['alloys'] },
  // Defense (fighter)
  { id: 'ballistics', role: 'fighter', branch: 'Defense', name: 'Ballistics', desc: '+18% weapon damage per level.',
    cost: [350, 1000, 3000, 8500, 22000, 55000], effect: { damageMult: 0.18 }, requires: [] },
  { id: 'loaders', role: 'fighter', branch: 'Defense', name: 'Auto-Loaders', desc: '+12% fire rate per level.',
    cost: [600, 2000, 6000, 16000, 40000], effect: { rateMult: 0.12 }, requires: ['ballistics'] },
  { id: 'shields', role: 'fighter', branch: 'Defense', name: 'Shield Theory', desc: 'Unlocks the Shield Emitter.',
    cost: [1400], effect: {}, requires: [] },
  { id: 'railgun', role: 'fighter', branch: 'Defense', name: 'Railgun Permit', desc: 'Unlocks the Railgun. The permit is mostly a formality.',
    cost: [3000], effect: {}, requires: ['ballistics'] },
  { id: 'fortify', role: 'fighter', branch: 'Defense', name: 'Fortification', desc: '+15% fighter part health per level.',
    cost: [900, 3000, 9000, 25000, 70000], effect: { fortify: 0.15 }, requires: ['alloys'] },
  { id: 'harmonics', role: 'fighter', branch: 'Defense', name: 'Shield Harmonics', desc: '+25% shield capacity and regen per level.',
    cost: [2500, 7000, 20000, 50000], effect: { shieldMult: 0.25 }, requires: ['shields'] },
];


// Pre-built ships. Cells are [part, x, y, rot] relative to grid center.
// Pre-built ships. Cells are [part, x, y, rot]; x,y = top-left of the part's
// footprint relative to the grid centre. role: which ship the preset is for.
export const PRESETS = {
  // ---- freighters (fly these: mining, hauling, exploring)
  pebble: { role: 'freighter', name: 'Pebble', desc: 'The starter. Reliable, modest, beige in spirit.', cells: [
    ['thruster', -1, -2, 2], ['laser', 0, -2, 0], ['thruster', 1, -2, 2],
    ['hull', -1, -1, 0], ['cargo', 0, -1, 0], ['cargo', 1, -1, 0],
    ['fuelTank', -1, 0, 0], ['core', 0, 0, 0], ['cargo', 1, 0, 0],
    ['thruster', -1, 1, 0], ['reactor', 0, 1, 0], ['thruster', 1, 1, 0],
  ] },
  prospector: { role: 'freighter', name: 'Prospector', desc: 'Two lasers, deep holds. Needs a 9×9 frame.', cells: [
    ['laser', -1, -3, 0], ['hull', 0, -3, 0], ['laser', 1, -3, 0],
    ['thruster', -2, -2, 2], ['cargo', -1, -2, 0], ['hull', 0, -2, 0], ['cargo', 1, -2, 0], ['thruster', 2, -2, 2],
    ['cargo', -2, -1, 0], ['cargo', -1, -1, 0], ['reactor', 0, -1, 0], ['cargo', 1, -1, 0], ['cargo', 2, -1, 0],
    ['thruster', -2, 0, 1], ['fuelTank', -1, 0, 0], ['core', 0, 0, 0], ['fuelTank', 1, 0, 0], ['thruster', 2, 0, 3],
    ['gyro', -1, 1, 0], ['battery', 0, 1, 0], ['gyro', 1, 1, 0],
    ['thruster', -1, 2, 0], ['thruster', 0, 2, 0], ['thruster', 1, 2, 0],
  ] },
  excavator: { role: 'freighter', name: 'Excavator', desc: 'Three lasers and a hold the size of a small moon. 9×9.', cells: [
    ['laser', -2, -4, 0], ['laser', 0, -4, 0], ['laser', 2, -4, 0],
    ['thruster', -3, -3, 2], ['armor', -2, -3, 0], ['cargo', -1, -3, 0], ['hull', 0, -3, 0], ['cargo', 1, -3, 0], ['armor', 2, -3, 0], ['thruster', 3, -3, 2],
    ['cargo', -3, -2, 0], ['cargo', -2, -2, 0], ['cargo', -1, -2, 0], ['reactor', 0, -2, 0], ['cargo', 1, -2, 0], ['cargo', 2, -2, 0], ['cargo', 3, -2, 0],
    ['thruster', -4, -1, 1], ['cargo', -3, -1, 0], ['cargo', -2, -1, 0], ['battery', -1, -1, 0], ['cargo', 0, -1, 0], ['battery', 1, -1, 0], ['cargo', 2, -1, 0], ['cargo', 3, -1, 0], ['thruster', 4, -1, 3],
    ['gyro', -3, 0, 0], ['fuelTank', -2, 0, 0], ['reactor', -1, 0, 0], ['core', 0, 0, 0], ['reactor', 1, 0, 0], ['fuelTank', 2, 0, 0], ['gyro', 3, 0, 0],
    ['cargo', -3, 1, 0], ['cargo', -2, 1, 0], ['battery', -1, 1, 0], ['cargo', 0, 1, 0], ['battery', 1, 1, 0], ['cargo', 2, 1, 0], ['cargo', 3, 1, 0],
    ['gyro', -3, 2, 0], ['fuelTank', -2, 2, 0], ['thruster', -1, 2, 0], ['thruster', 0, 2, 0], ['thruster', 1, 2, 0], ['fuelTank', 2, 2, 0], ['gyro', 3, 2, 0],
    ['thruster', -3, 3, 0], ['thruster', -2, 3, 0], ['thruster', 2, 3, 0], ['thruster', 3, 3, 0],
  ] },
  leviathan: { role: 'freighter', name: 'Leviathan', desc: 'Torch drives, fusion power, five lasers and a cargo bay you could lose a moon in. 11×11.', cells: [
    ['laser', -4, -5, 0], ['laser', -2, -5, 0], ['laser', 0, -5, 0], ['laser', 2, -5, 0], ['laser', 4, -5, 0],
    ['thruster', -5, -4, 2], ['cargo', -4, -4, 0], ['armor', -3, -4, 0], ['cargo', -2, -4, 0], ['armor', -1, -4, 0], ['armor', 0, -4, 0], ['armor', 1, -4, 0], ['cargo', 2, -4, 0], ['armor', 3, -4, 0], ['cargo', 4, -4, 0], ['thruster', 5, -4, 2],
    ['cargo', -5, -3, 0], ['cargo', -4, -3, 0], ['cargo', -3, -3, 0], ['cargo', -2, -3, 0], ['cargo', -1, -3, 0], ['cargo', 0, -3, 0], ['cargo', 1, -3, 0], ['cargo', 2, -3, 0], ['cargo', 3, -3, 0], ['cargo', 4, -3, 0], ['cargo', 5, -3, 0],
    ['thruster', -5, -2, 1], ['fuelTank', -4, -2, 0], ['fusion', -3, -2, 0], ['battery', -1, -2, 0], ['battery', 0, -2, 0], ['battery', 1, -2, 0], ['fusion', 2, -2, 0], ['fuelTank', 4, -2, 0], ['thruster', 5, -2, 3],
    ['cargo', -5, -1, 0], ['fuelTank', -4, -1, 0], ['battery', -1, -1, 0], ['gyro', 0, -1, 0], ['battery', 1, -1, 0], ['fuelTank', 4, -1, 0], ['cargo', 5, -1, 0],
    ['cargo', -5, 0, 0], ['gyro', -4, 0, 0], ['cargo', -3, 0, 0], ['cargo', -2, 0, 0], ['tractor', -1, 0, 0], ['core', 0, 0, 0], ['battery', 1, 0, 0], ['cargo', 2, 0, 0], ['cargo', 3, 0, 0], ['gyro', 4, 0, 0], ['cargo', 5, 0, 0],
    ['cargo', -5, 1, 0], ['gyro', -4, 1, 0], ['cargo', -3, 1, 0], ['cargo', -2, 1, 0], ['armor', -1, 1, 0], ['gyro', 0, 1, 0], ['armor', 1, 1, 0], ['cargo', 2, 1, 0], ['cargo', 3, 1, 0], ['gyro', 4, 1, 0], ['cargo', 5, 1, 0],
    ['thruster', -4, 2, 0], ['heavyThruster', -3, 2, 0], ['fuelTank', -2, 2, 0], ['heavyThruster', -1, 2, 0], ['fuelTank', 0, 2, 0], ['heavyThruster', 1, 2, 0], ['fuelTank', 2, 2, 0], ['heavyThruster', 3, 2, 0], ['thruster', 4, 2, 0],
  ] },
  larry: { role: 'freighter', name: 'Lopsided Larry', desc: 'A teaching aid. Watch what off-center thrust does.', cells: [
    ['laser', 0, -1, 0], ['core', 0, 0, 0], ['cargo', 1, 0, 0], ['hull', 2, 0, 0], ['hull', 3, 0, 0],
    ['thruster', 3, 1, 0], ['thruster', 2, 1, 0], ['reactor', 0, 1, 0],
  ] },
  // ---- fighters (stationary defense platforms: no thrusters needed)
  bastion: { role: 'fighter', name: 'Bastion', desc: 'The starter platform. Two guns, some armor, a can-do attitude.', cells: [
    ['turret', -1, -1, 0], ['hull', 0, -1, 0], ['turret', 1, -1, 0],
    ['armor', -1, 0, 0], ['core', 0, 0, 0], ['armor', 1, 0, 0],
    ['battery', -1, 1, 0], ['reactor', 0, 1, 0], ['hull', 1, 1, 0],
  ] },
  bulwark: { role: 'fighter', name: 'Bulwark', desc: 'Eight autocannons behind armor and two shield emitters. Needs Shield Theory.', cells: [
    ['turret', -2, -2, 0], ['armor', -1, -2, 0], ['turret', 0, -2, 0], ['armor', 1, -2, 0], ['turret', 2, -2, 0],
    ['armor', -2, -1, 0], ['battery', -1, -1, 0], ['shield', 0, -1, 0], ['battery', 1, -1, 0], ['armor', 2, -1, 0],
    ['turret', -2, 0, 0], ['reactor', -1, 0, 0], ['core', 0, 0, 0], ['reactor', 1, 0, 0], ['turret', 2, 0, 0],
    ['armor', -2, 1, 0], ['battery', -1, 1, 0], ['shield', 0, 1, 0], ['battery', 1, 1, 0], ['armor', 2, 1, 0],
    ['turret', -2, 2, 0], ['armor', -1, 2, 0], ['turret', 0, 2, 0], ['armor', 1, 2, 0], ['turret', 2, 2, 0],
  ] },
  citadel: { role: 'fighter', name: 'Citadel', desc: 'Twin railguns that turn to face trouble, fusion power, layered shields. 9×9.', cells: [
    ['railgun', -1, -4, 0], ['turret', 0, -4, 0], ['railgun', 1, -4, 0], ['hull', 0, -3, 0],
    ['turret', -3, -2, 0], ['turret', -2, -2, 0], ['armor', -1, -2, 0], ['gyro', 0, -2, 0], ['armor', 1, -2, 0], ['turret', 2, -2, 0], ['turret', 3, -2, 0],
    ['fusion', -3, -1, 0], ['battery', -1, -1, 0], ['shield', 0, -1, 0], ['battery', 1, -1, 0], ['fusion', 2, -1, 0],
    ['gyro', -1, 0, 0], ['core', 0, 0, 0], ['gyro', 1, 0, 0],
    ['turret', -3, 1, 0], ['armor', -2, 1, 0], ['shield', -1, 1, 0], ['battery', 0, 1, 0], ['shield', 1, 1, 0], ['armor', 2, 1, 0], ['turret', 3, 1, 0],
    ['turret', -2, 2, 0], ['armor', -1, 2, 0], ['turret', 0, 2, 0], ['armor', 1, 2, 0], ['turret', 2, 2, 0],
  ] },
  fortress: { role: 'fighter', name: 'Fortress', desc: 'Triple railgun battery, fusion power, shields on every side. 11×11.', cells: [
    ['railgun', -1, -5, 0], ['railgun', 0, -5, 0], ['railgun', 1, -5, 0], ['armor', -1, -3, 0], ['armor', 0, -3, 0], ['armor', 1, -3, 0], ['turret', -2, -3, 0], ['turret', 2, -3, 0],
    ['turret', -3, -2, 0], ['shield', -2, -2, 0], ['armor', -1, -2, 0], ['gyro', 0, -2, 0], ['armor', 1, -2, 0], ['shield', 2, -2, 0], ['turret', 3, -2, 0],
    ['fusion', -4, -1, 0], ['battery', -2, -1, 0], ['battery', -1, -1, 0], ['shield', 0, -1, 0], ['battery', 1, -1, 0], ['battery', 2, -1, 0], ['fusion', 3, -1, 0],
    ['gyro', -2, 0, 0], ['gyro', -1, 0, 0], ['core', 0, 0, 0], ['gyro', 1, 0, 0], ['gyro', 2, 0, 0],
    ['turret', -4, 1, 0], ['turret', -3, 1, 0], ['shield', -2, 1, 0], ['battery', -1, 1, 0], ['reactor', 0, 1, 0], ['battery', 1, 1, 0], ['shield', 2, 1, 0], ['turret', 3, 1, 0], ['turret', 4, 1, 0],
    ['turret', -3, 2, 0], ['armor', -2, 2, 0], ['turret', -1, 2, 0], ['armor', 0, 2, 0], ['turret', 1, 2, 0], ['armor', 2, 2, 0], ['turret', 3, 2, 0],
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
