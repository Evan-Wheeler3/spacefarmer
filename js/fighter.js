// The fighter: a stationary defense platform that runs contract waves on its
// own, in its own little world, while you fly the freighter. You can watch it,
// take manual control, and it retreats for repairs instead of dying.
//
// This object doubles as the "game" that World / EnemySystem / PlanetSystem
// talk to, so those systems run unchanged inside the fighter's arena.
import { SECTORS, PRESETS, FIGHTER, PARTS, ECONOMY, BOSSES, ORES } from './data.js';
import { World } from './world.js';
import { Ship } from './ship.js';
import { Design, analyze } from './shipdesign.js';
import { EnemySystem } from './enemies.js';
import { PlanetSystem } from './planet.js';
import { nextContract, contractWave, contractPay, rate } from './contracts.js';
import { sectorUnlocked } from './economy.js';
import { Input } from './input.js';
import { angleDiff, clamp, money, rand, TAU } from './util.js';
import { P_GLOW } from './particles.js';
import { toast } from './ui/dom.js';

export function newFighterSave(sector = 0) {
  return {
    design: { cells: PRESETS.bastion.cells.map((c) => [...c]) },
    sector, retreat: FIGHTER.retreatDefault, auto: true, fails: {},
    stats: { earned: 0, contracts: 0, bosses: 0, retreats: 0, kills: 0, time: 0 },
    log: [],
  };
}

export class FighterSim {
  constructor(game) {
    this.game = game;
    this.mode = 'idle';          // idle | deployed | repairing
    this.watching = false;
    this.manual = false;
    this.world = null;
    this.ship = null;
    this.planet = null;
    this.enemySystem = new EnemySystem(this);
    this.planetSystem = new PlanetSystem(this);
    this.trip = { time: 0, ore: 0, kills: 0, bounty: 0, refuel: 0 };
    this.breather = 3;
    this.repairT = 0;
    this._cine = false;
    this.slowmoT = 0;
    this.isFighter = true;
  }

  // ---- the "game" interface the shared systems expect
  get save() { return this.game.save; }
  get levels() { return this.game.levels; }
  get cam() { return this.game.cam; }
  get ui() { return this.game.ui; }
  get audio() { return this.watching ? this.game.audio : null; }
  get W() { return this.game.W; }
  get H() { return this.game.H; }
  get touch() { return this.game.touch; }
  get time() { return this.game.time; }
  get state() { return this.mode !== 'deployed' ? 'idle' : this._cine ? 'cinematic' : 'flight'; }
  set state(v) { this._cine = v === 'cinematic'; }
  get slowmo() { return this.slowmoT; }
  set slowmo(v) { this.slowmoT = v; }
  sfx(n, p) { if (this.watching) this.game.sfx(n, p); }
  shake(a) { if (this.watching) this.game.shake(a); }
  persist() { this.game.persist(); }
  onPlayerHit() {}
  onOreCollected() {}
  onRockDestroyed() {}
  onShipDestroyed() { this.retreat(true); }

  get fs() { return this.save.fighter; }
  get sectorIndex() { return this.fs.sector; }
  design() { return Design.fromJSON(this.fs.design); }

  // ---------------------------------------------------------- lifecycle
  analysis() { return analyze(this.design(), this.levels, { role: 'fighter' }); }

  deploy() {
    const a = this.analysis();
    if (!a.launchable) { this.mode = 'idle'; return false; }
    if (!sectorUnlocked(this.fs.sector, this.save)) this.fs.sector = 0;
    if (!this.world || this.world.sectorIndex !== this.fs.sector) this.world = new World(this.fs.sector, this, 4321 + this.fs.sector, { arena: true });
    this.world.enemies.length = 0;
    this.world.bullets.length = 0;
    const ship = new Ship(this.design(), this.levels, 'fighter');
    ship.x = 0; ship.y = 0; ship.angle = this.ship ? this.ship.angle : 0;
    ship.recomputeMass(true);
    this.ship = ship;
    this.mode = 'deployed';
    this.breather = 3;
    this.enemySystem.onLaunch();
    this.planetSystem.onLaunch();
    this.world.particles.ring(0, 0, 220, '#ff4d6d', 0.6, 4);
    return true;
  }

  recall() {
    this.stash();
    if (this.world) this.enemySystem.onDock();
    this.mode = 'idle';
    this.manual = false;
  }

  // the design changed in the Shipyard or a sector was picked: start fresh
  redeploy() {
    if (this.mode === 'deployed') this.stash();
    if (this.world) this.enemySystem.onDock();
    if (!this.fs.auto) { this.mode = 'idle'; return; }
    this.deploy();
  }

  stash() {
    if (this.ship && this.mode === 'deployed' && !this.ship.dead) this.fs.design = this.ship.writeBack(this.design()).toJSON();
  }

  hull() {
    if (!this.ship) return 1;
    return 1 - this.ship.damageFraction();
  }

  retreat(destroyed = false) {
    if (this.mode !== 'deployed') return;
    const c = this.enemySystem.contract;
    const key = c ? `${this.fs.sector}:${c.kind}:${c.k}` : null;
    if (key && !c.farm) this.fs.fails[key] = (this.fs.fails[key] || 0) + 1;
    // write back damage, rebuild the core for free, and pay what we can for repairs
    const d = this.ship.writeBack(this.design());
    for (const e of d.entries) if (PARTS[e.part].core && e.hp === 0) e.hp = 0.5;
    const cost = this.game.repairCost(d, FIGHTER.repairDiscount).total;
    const pay = Math.min(cost, Math.max(0, this.save.credits));
    const k = cost > 0 ? pay / cost : 1;
    for (const e of d.entries) { const hp = e.hp ?? 1; if (hp < 1) e.hp = Math.min(1, hp + (1 - hp) * k + (hp === 0 && k > 0 ? 0.01 : 0)); }
    this.save.credits -= pay;
    this.fs.design = d.toJSON();
    this.fs.stats.retreats++;
    this.enemySystem.onDock();
    if (this.watching) {
      this.world.particles.ring(0, 0, 300, '#7df9ff', 0.6, 5);
      for (let i = 0; i < 30; i++) this.world.particles.spawn(P_GLOW, rand(-60, 60), rand(-60, 60), rand(-300, 300), rand(-300, 300), 0.6, 6, '#7df9ff');
      this.enemySystem.banner = { title: 'RETREAT', text: `Hull at ${Math.round(this.hull() * 100)}%. Repairs ${money(pay)}. The contract will be waiting.`, t: 3.5, col: '#7df9ff' };
    } else toast(`Fighter retreated for repairs (${money(pay)})`, 'bad', 3000);
    this.addLog(`${destroyed ? 'Core breached — emergency jump' : 'Retreated'}${c ? ` from ${c.kind === 'boss' ? BOSSES[c.boss].name : 'contract ' + (c.k + 1)}` : ''}. Repairs ${money(pay)}.`);
    this.mode = 'repairing';
    this.repairT = FIGHTER.repairTime;
    this.manual = false;
    this.game.persist();
  }

  addLog(text) {
    this.fs.log.unshift({ t: Date.now(), text });
    this.fs.log.length = Math.min(this.fs.log.length, 12);
  }

  onContractDone(c, pay) {
    this.fs.stats.earned += pay;
    this.fs.stats.contracts++;
    if (!c.farm) delete this.fs.fails[`${this.fs.sector}:${c.kind}:${c.k}`];
    this.addLog(`${c.farm ? 'Patrol' : 'Contract ' + (c.k + 1)} cleared: +${money(pay)}`);
    this.breather = FIGHTER.breather;
  }
  onBossDefeated(b, first) {
    this.fs.stats.bosses++;
    this.fs.stats.earned += b.bounty;
    delete this.fs.fails[`${this.fs.sector}:boss:${SECTORS[this.fs.sector].contracts}`];
    this.addLog(`Defeated ${b.def.name}: +${money(b.bounty)}${first ? ' — new jump license available' : ''}`);
    if (!this.watching) toast(`Your fighter defeated ${b.def.name}! +${money(b.bounty)}`, 'money', 4000);
    this.breather = FIGHTER.breather * 2;
  }

  // what the fighter will do next: the board's next contract, or a patrol of a cleared wave
  // if it keeps retreating from the next one
  plan() {
    const n = nextContract(this.save, this.fs.sector);
    if (!n) return null;
    const key = `${this.fs.sector}:${n.kind}:${n.k}`;
    if ((this.fs.fails[key] || 0) >= FIGHTER.failsBeforePatrol) {
      const k = Math.max(0, Math.min(n.k, SECTORS[this.fs.sector].contracts) - 1);
      const st = this.save.contracts?.[SECTORS[this.fs.sector].id];
      if (n.k > 0 || st?.cleared) return { kind: 'wave', k, farm: true, wave: contractWave(this.fs.sector, k), pay: contractPay(this.fs.sector, k, true), blocked: n };
    }
    return n;
  }
  // a new fighter design or new research gets another shot at the hard contract
  clearFails() { this.fs.fails = {}; }

  // ------------------------------------------------------------- update
  update(dt) {
    if (!this.save || !this.save.fighter) return;
    if (this.mode === 'idle' && this.fs.auto) { if (!this.deploy()) return; }
    if (this.mode === 'repairing') {
      this.repairT -= dt;
      if (this.repairT <= 0) { if (this.fs.auto) this.deploy(); else this.mode = 'idle'; }
      return;
    }
    if (this.mode !== 'deployed') return;
    this.fs.stats.time = (this.fs.stats.time || 0) + dt;
    if (this.slowmoT > 0) { this.slowmoT -= dt; if (this.watching) dt *= 0.3; }
    const ship = this.ship;
    ship.input = ship.dead ? { thrust: 0, strafe: 0, turn: 0 } : this.manual && this.watching ? this.manualInput() : this.ai();
    ship.update(dt, this.world);
    // the platform is anchored to its post
    ship.x = 0; ship.y = 0; ship.vx = 0; ship.vy = 0;
    this.world.update(dt, ship);
    this.enemySystem.update(dt);
    this.planetSystem.update(dt);
    if (this.mode !== 'deployed') return; // retreated during the update
    // auto contracts
    const es = this.enemySystem;
    if (!es.contract && !this._cine && !(ship.crackCharge > 0.01)) {
      this.breather -= dt;
      if (this.breather <= 0 && this.fs.auto) {
        const p = this.plan();
        if (p) es.startContract(p.farm ? p.k : null);
        this.breather = FIGHTER.breather;
      }
    }
    // retreat before total destruction
    if (!ship.dead && !this._cine) {
      const core = ship.core;
      if (this.hull() < this.fs.retreat || (core && core.hp / core.maxHp < FIGHTER.coreRetreat)) this.retreat();
    }
    this.fs.stats.kills = this.save.stats.kills;
  }

  // AI: turrets aim themselves; this turns the hull so fixed guns (railguns) bear
  ai() {
    const ship = this.ship;
    const out = { thrust: 0, strafe: 0, turn: 0, fire: false, crack: false, brake: false };
    const guns = ship.parts.filter((p) => p.alive && !p.blocked && p.def.weapon && p.def.directional);
    if (!guns.length) { out.turn = clamp(-ship.av * 0.5, -1, 1); return out; }
    let best = null, bd = 1e18;
    const range = guns[0].def.weapon.range;
    for (const e of this.world.enemies) {
      if (e.dead || e.type === 'missile') continue;
      const d = e.x * e.x + e.y * e.y - (e.boss ? 1e6 : 0);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) { out.turn = clamp(-ship.av * 0.5, -1, 1); return out; }
    const g = guns[0];
    const t = Math.hypot(best.x, best.y) / g.def.weapon.speed;
    const tx = best.x + (best.vx || 0) * t, ty = best.y + (best.vy || 0) * t;
    const offset = Math.atan2(g.dir[0], -g.dir[1]); // gun facing relative to the hull's forward
    const want = Math.atan2(tx, -ty) - offset;
    const err = angleDiff(ship.angle, want);
    out.turn = clamp(err * 3 - ship.av * 0.6, -1, 1);
    out.fire = Math.abs(err) < 0.07 && Math.hypot(best.x, best.y) < range;
    return out;
  }

  manualInput() {
    const i = Input.flight();
    const out = { thrust: 0, strafe: 0, turn: i.turn, fire: i.fire, crack: i.crack, brake: i.brake };
    // holding the Cracker trigger swings the hull toward the planet for you
    const cr = this.ship.parts.find((p) => p.alive && p.def.cracker);
    const pl = this.planet && this.planet.p;
    if (i.crack && cr && pl && !pl.destroyed && Math.abs(i.turn) < 0.1) {
      const offset = Math.atan2(cr.dir[0], -cr.dir[1]);
      const err = angleDiff(this.ship.angle, Math.atan2(pl.x, -pl.y) - offset);
      out.turn = clamp(err * 3 - this.ship.av * 0.6, -1, 1);
    }
    return out;
  }

  // ------------------------------------------------------ offline time
  // Resolve time spent away with the same ratings the contract board shows.
  offline(seconds) {
    if (!this.save.fighter || !this.fs.auto) return null;
    const a = this.analysis();
    if (!a.launchable || a.dps <= 0) return null;
    const res = { contracts: 0, bosses: [], earned: 0, retreats: 0, repairs: 0 };
    let t = Math.min(seconds, ECONOMY.offlineCapHours * 3600);
    let guard = 0, wear = 0;
    while (t > 0 && guard++ < 5000) {
      const p = this.plan();
      if (!p) break;
      const foe = p.kind === 'boss' ? p.foe : p.wave;
      const r = rate(a, foe);
      const dur = r.ttk + FIGHTER.offlineBreather;
      if (dur > t) break;
      t -= dur;
      const st = (this.save.contracts[SECTORS[this.fs.sector].id] ||= { k: 0, cleared: 0 });
      const key = `${this.fs.sector}:${p.kind}:${p.k}`;
      // damage piles up over waves; past the retreat line it pulls back for repairs
      wear += Math.min(1, r.risk) * 0.6;
      if (wear > 1 - this.fs.retreat) {
        wear = 0; res.retreats++;
        const cost = Math.min(this.save.credits, Math.round(a.value * 0.5 * ECONOMY.repairCostFactor * FIGHTER.repairDiscount));
        this.save.credits -= cost; res.repairs += cost; t -= FIGHTER.repairTime;
        continue;
      }
      if (r.risk < 0.85) {
        const pay = Math.round((p.pay + (p.kind === 'wave' ? p.wave.bounty : 0)) * FIGHTER.offlineRate);
        res.earned += pay; this.save.credits += pay; this.save.stats.earned += pay;
        res.contracts++;
        if (!p.farm) {
          delete this.fs.fails[key];
          if (p.kind === 'wave') { st.k++; if (st.k >= SECTORS[this.fs.sector].contracts && !SECTORS[this.fs.sector].boss) { st.k = 0; st.cleared++; } }
          else { st.k = 0; st.cleared++; this.save.bossKills[p.boss] = (this.save.bossKills[p.boss] || 0) + 1; this.save.stats.bosses++; res.bosses.push(BOSSES[p.boss].name); }
        }
      } else {
        res.retreats++; wear = 0;
        this.fs.fails[key] = (this.fs.fails[key] || 0) + 1;
        const cost = Math.min(this.save.credits, Math.round(a.value * 0.5 * ECONOMY.repairCostFactor * FIGHTER.repairDiscount));
        this.save.credits -= cost; res.repairs += cost;
        t -= FIGHTER.repairTime;
      }
    }
    this.fs.stats.earned += res.earned - res.repairs;
    this.fs.stats.time = (this.fs.stats.time || 0) + Math.min(seconds, ECONOMY.offlineCapHours * 3600);
    this.fs.stats.contracts += res.contracts;
    this.fs.stats.retreats += res.retreats;
    if (res.contracts || res.retreats) this.addLog(`While you were away: ${res.contracts} contract(s), +${money(res.earned)}${res.retreats ? `, ${res.retreats} retreat(s)` : ''}.`);
    return res;
  }

  // one-line status for the freighter HUD chip
  status() {
    if (!this.save?.fighter) return '';
    if (this.mode === 'repairing') return `Repairing ${Math.ceil(this.repairT)}s`;
    if (this.mode !== 'deployed') return this.fs.auto ? 'Needs a working design' : 'Standing by';
    const c = this.enemySystem.contract;
    const hull = `hull ${Math.round(this.hull() * 100)}%`;
    if (!c) return `Next wave ${Math.max(0, Math.ceil(this.breather))}s · ${hull}`;
    if (c.kind === 'boss') return `vs ${BOSSES[c.boss].name} · ${hull}`;
    const left = this.world.enemies.filter((e) => e.contract && !e.dead).length;
    return `${c.farm ? 'Patrol' : `Wave ${c.k + 1}/${c.total}`} · ${left} left · ${hull}`;
  }
}
