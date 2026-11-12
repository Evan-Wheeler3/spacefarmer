// First-flight tutorial: short, skippable, driven by what the player actually does.
import { el, toast } from './dom.js';
import { ECONOMY } from '../data.js';
import { TAU } from '../util.js';

const STEPS = [
  { where: 'flight', title: 'Fly', text: 'Hold W to thrust, A / D to turn. Your ship is built from parts — every thruster pushes the way it points.', touch: 'Drag your left thumb anywhere on the left side: the ship turns toward that direction and flies there. Every thruster pushes the way it points.', done: (g) => g.tut.moved > 180 },
  { where: 'flight', title: 'Mine', text: 'Fly to a rock (marked) and hold SPACE. The laser fires from the front of your ship.', touch: 'Fly to the marked rock, point your nose at it and hold FIRE. The laser fires from the front of your ship.', done: (g) => g.ship.cargoUnits >= 2, target: 'rock' },
  { where: 'flight', title: 'Collect', text: 'Ore chunks get pulled into your cargo pods. Grab about 15 — notice the ship gets heavier.', done: (g) => g.ship.cargoUnits >= Math.min(15, g.ship.cargoMax - 1), target: 'rock' },
  { where: 'flight', title: 'Go home', text: 'Follow the cyan arrow to the OUTPOST and press F to dock (or hold R to recall).', touch: 'Follow the cyan arrow to the OUTPOST and tap DOCK when it appears (or hold ⟲ to recall).', done: (g) => g.state === 'hangar', target: 'station' },
  { where: 'hangar', title: 'Sell', text: 'Sell your ore here in the Market. Credits buy parts and research.', done: (g) => (g.save.stats.earned || 0) > 0 },
  { where: 'hangar', title: 'Build', text: 'Open the SHIPYARD. Add a Cargo Pod or a Mining Laser. Watch the stats: off-center thrust makes you spin.', done: (g) => (g.save.stats.partsBought || 0) > 0 || Object.keys(g.save.upgrades).length > 0 },
  { where: 'hangar', title: 'The plan', touch: 'Fighting is your choice: out in space tap Start wave at the top to begin a paid CONTRACT. Clear the board, beat the boss, unlock new sectors. LAUNCH when ready.', text: 'Fighting is your choice: out in space press G to start a paid CONTRACT wave. Clear the board, beat the boss, unlock new sectors. The Market shows each wave\'s pay and difficulty. LAUNCH when ready.', done: (g) => g.state === 'flight' },
];

export class Tutorial {
  constructor(game) {
    this.game = game;
    game.tut = { moved: 0 };
  }
  get t() { return this.game.save.tutorial; }

  card() {
    const g = this.game;
    if (!g.save || this.t.done) { this.remove(); return; }
    const st = STEPS[this.t.step];
    if (!st) return;
    const want = st.where === 'flight' ? g.state === 'flight' : g.state === 'hangar';
    if (!want) { this.remove(); return; }
    if (this.el && this.el.dataset.step === String(this.t.step) && this.el.dataset.where === g.state) return;
    this.remove();
    this.el = el('div', { class: 'tut ' + (st.where === 'flight' ? 'tut-flight' : 'tut-hangar'), 'data-step': this.t.step, 'data-where': g.state },
      el('div', { class: 'tut-head' }, el('span', { class: 'tut-step' }, `${this.t.step + 1}/${STEPS.length}`), el('b', {}, st.title),
        el('button', { class: 'btn small', onclick: () => this.skip() }, 'Skip tutorial')),
      el('div', {}, (g.touch && st.touch) || st.text));
    g.ui.append(this.el);
  }
  remove() { if (this.el) { this.el.remove(); this.el = null; } }
  skip() { this.t.done = true; this.remove(); this.game.persist(); toast('Tutorial skipped. The Road to Doomsday in the Market lists every step.'); }

  onLaunch() { this.spawnX = this.game.ship.x; this.spawnY = this.game.ship.y; }
  update(dt) { this.tick(); }
  updateDocked() { this.tick(); }
  tick() {
    const g = this.game;
    if (!g.save || this.t.done) { this.remove(); return; }
    if (g.state === 'flight' && g.ship) g.tut.moved = Math.max(g.tut.moved, Math.hypot(g.ship.x - (this.spawnX || 0), g.ship.y - (this.spawnY || 0)));
    const st = STEPS[this.t.step];
    if (st && (st.where === 'flight' ? g.state === 'flight' : true) && st.done(g)) {
      this.t.step++;
      g.sfx('click');
      if (this.t.step >= STEPS.length) { this.t.done = true; toast('Tutorial complete. Go make some money.', 'good', 3000); g.persist(); }
    }
    this.card();
  }

  // world-space marker for the current target
  draw(ctx, cam) {
    const g = this.game;
    if (!g.save || this.t.done || g.state !== 'flight') return;
    const st = STEPS[this.t.step];
    if (!st || st.target !== 'rock') return;
    let best = null, bd = 1e18;
    for (const r of g.world.rocks) { const d = (r.x - g.ship.x) ** 2 + (r.y - g.ship.y) ** 2; if (d < bd) { bd = d; best = r; } }
    if (!best) return;
    const pulse = 1 + Math.sin(g.time * 5) * 0.08;
    ctx.strokeStyle = 'rgba(255,214,10,0.8)'; ctx.lineWidth = 3 / cam.zoom; ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.arc(best.x, best.y, (best.r + 22) * pulse, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    this.targetRock = best;
  }
  hud(ctx, W, H) {
    const g = this.game;
    if (!g.save || this.t.done || g.state !== 'flight' || !this.targetRock) return;
    const st = STEPS[this.t.step];
    if (!st || st.target !== 'rock') return;
    const [sx, sy] = g.cam.toScreen(this.targetRock.x, this.targetRock.y);
    if (sx > 0 && sx < W && sy > 0 && sy < H) return;
    const a = Math.atan2(sy - H / 2, sx - W / 2), r = Math.min(W, H) / 2 - 50;
    ctx.save(); ctx.translate(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r); ctx.rotate(a);
    ctx.fillStyle = '#ffd60a'; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -10); ctx.lineTo(-8, 10); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
