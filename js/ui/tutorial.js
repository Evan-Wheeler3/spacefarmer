// First-flight tutorial: short, skippable, driven by what the player actually does.
import { el, toast } from './dom.js';
import { ECONOMY } from '../data.js';
import { TAU } from '../util.js';

const STEPS = [
  { where: 'flight', title: 'Fly', text: 'Hold W to thrust, A / D to turn. Your freighter is built from parts — every thruster pushes the way it points.', touch: 'Drag your left thumb anywhere on the left side: the freighter turns toward that direction and flies there.', done: (g) => g.tut.moved > 180 },
  { where: 'flight', title: 'Mine the planet', text: 'Fly down to the planet (marked), point your nose at it and hold SPACE. Your laser rips cubes right out of it.', touch: 'Fly down to the planet (marked), point your nose at it and hold FIRE. Your laser rips cubes right out of it.', done: (g) => g.ship.cargoUnits >= 3, target: 'rock' },
  { where: 'flight', title: 'Collect', text: 'Loose cubes get pulled into your cargo pods. Fill up a bit — the freighter gets heavier as it loads.', done: (g) => g.ship.cargoUnits >= Math.min(15, g.ship.cargoMax - 1), target: 'rock' },
  { where: 'flight', title: 'Head home', text: 'Follow the cyan arrow back to your STARSHIP. Cargo is offloaded and sold automatically when you arrive.', done: (g) => g.save.stats.earned > 0, target: 'station' },
  { where: 'flight', title: 'Your fighter', text: 'Your FIGHTER escorts you and fights the planet’s defense swarm. If it falls, both ships warp home and mining stops until it’s repaired. Press V (or tap its chip at the top) to watch it.', touch: 'Your FIGHTER escorts you and fights the planet’s defense swarm. If it falls, both ships warp home until it’s repaired. Tap its chip at the top to watch it.', done: (g) => g.tut.t > 14 },
  { where: 'flight', title: 'Autopilot', text: 'Let go of the controls for a few seconds and the autopilot mines for you — for a limited window. Research Autopilot Cores to make it last longer. Dock with F to upgrade.', touch: 'Let go of the controls for a few seconds and the autopilot mines for you, for a limited window (Research makes it longer). Tap DOCK at the starship to upgrade.', done: (g) => g.state === 'hangar' },
  { where: 'hangar', title: 'Upgrade', text: 'Spend credits in the Shipyard (two ships: ⛏ Freighter and ⚔ Fighter) and Research. Tap the planet chip in flight any time to see how much of it is gone. LAUNCH when ready.', done: (g) => g.state === 'flight' },
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
    if (g.state === 'flight' && g.ship) g.tut.t = (g.tut.t || 0) + 1 / 60;
    if (g.state === 'flight' && g.ship) g.tut.moved = Math.max(g.tut.moved, Math.hypot(g.ship.x - (this.spawnX || 0), g.ship.y - (this.spawnY || 0)));
    const st = STEPS[this.t.step];
    if (st && (st.where === 'flight' ? g.state === 'flight' : true) && st.done(g)) {
      this.t.step++;
      g.tut.t = 0;
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
    const pl = g.world.planet;
    const sfc = pl.surfaceAt(Math.atan2(g.ship.y, g.ship.x));
    if (!sfc) return;
    const best = { x: sfc.x, y: sfc.y, r: 30 };
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
