// Touch controls for phones and tablets: floating "point to fly" stick,
// hold-to-fire and action buttons. Writes into Input.touchState.
import { Input } from '../input.js';
import { el } from './dom.js';
import { angleDiff, clamp } from '../util.js';

export function isTouchDevice() {
  if (/[?&]touch\b/.test(location.search)) return true;
  return (matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 1 && !matchMedia('(pointer: fine)').matches;
}

const STICK_R = 58;

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.on = isTouchDevice();
    this.stick = null;       // { id, x0, y0, dx, dy }
    Input.touchState = { thrust: 0, turn: 0, strafe: 0, fire: false, crack: false, recall: false, brake: false };
    if (!this.on) return;
    document.body.classList.add('touch');
    game.touch = true;
    this.build();
  }

  build() {
    const g = this.game;
    const hold = (label, cls, key) => {
      const b = el('div', { class: 'tc-btn ' + cls }, label);
      const set = (v) => (e) => { e.preventDefault(); Input.touchState[key] = v; b.classList.toggle('down', v); };
      b.addEventListener('pointerdown', set(true));
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, set(false));
      return b;
    };
    const tap = (label, cls, fn) => {
      const b = el('div', { class: 'tc-btn ' + cls }, label);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('down'); fn(); });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => b.classList.remove('down'));
      return b;
    };
    this.zone = el('div', { class: 'tc-zone' });
    this.base = el('div', { class: 'tc-base' }, el('div', { class: 'tc-knob' }));
    this.fire = hold('FIRE', 'tc-fire', 'fire');
    this.crack = hold('CRACK', 'tc-crack', 'crack');
    this.strafeL = el('div', { class: 'tc-btn tc-small tc-strafe' }, '⇠', el('small', {}, 'SLIDE'));
    this.strafeR = el('div', { class: 'tc-btn tc-small tc-strafe' }, '⇢', el('small', {}, 'SLIDE'));
    this.brake = hold('BRAKE', 'tc-brake', 'brake');
    for (const [b, v] of [[this.strafeL, -1], [this.strafeR, 1]]) {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); Input.touchState.strafe = v; b.classList.add('down'); });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => { if (Input.touchState.strafe === v) Input.touchState.strafe = 0; b.classList.remove('down'); });
    }
    this.dock = tap('DOCK', 'tc-dock', () => { if (g.state === 'flight' && g.canDock) g.dock(); });
    this.side = el('div', { class: 'tc-side' },
      tap('❚❚', 'tc-small', () => { if (g.state === 'flight') g.pause(); }),
      hold('⟲', 'tc-small tc-recall', 'recall'),
      tap('A', 'tc-small tc-assist', () => { if (g.ship) { g.ship.assist = !g.ship.assist; } }));
    this.right = el('div', { class: 'tc-right' }, el('div', { class: 'tc-row' }, this.strafeL, this.strafeR), this.crack, el('div', { class: 'tc-row tc-bottom' }, this.brake, this.fire));
    this.root = el('div', { class: 'tc hidden' }, this.zone, this.base, this.right, this.side, this.dock);
    g.ui.append(this.root);

    // floating stick in the left half of the screen
    this.zone.addEventListener('pointerdown', (e) => {
      if (this.stick) return;
      e.preventDefault();
      this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 };
      this.zone.setPointerCapture(e.pointerId);
      this.base.style.left = e.clientX + 'px'; this.base.style.top = e.clientY + 'px';
      this.base.classList.add('on');
      this.moveStick(e);
    });
    this.zone.addEventListener('pointermove', (e) => { if (this.stick && e.pointerId === this.stick.id) this.moveStick(e); });
    const end = (e) => { if (this.stick && e.pointerId === this.stick.id) { this.stick = null; this.base.classList.remove('on'); } };
    this.zone.addEventListener('pointerup', end);
    this.zone.addEventListener('pointercancel', end);
  }

  moveStick(e) {
    const s = this.stick;
    let dx = e.clientX - s.x0, dy = e.clientY - s.y0;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
    s.dx = dx / STICK_R; s.dy = dy / STICK_R;
    this.base.firstChild.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  // called every frame by the game (before ship.update)
  update() {
    if (!this.on) return;
    const g = this.game, ts = Input.touchState, ship = g.ship;
    const flying = g.state === 'flight' && ship && !ship.dead;
    this.root.classList.toggle('hidden', !flying);
    if (!flying) { ts.thrust = 0; ts.turn = 0; return; }
    this.dock.classList.toggle('show', !!g.canDock);
    this.crack.classList.toggle('show', ship.parts.some((p) => p.alive && p.def.cracker));
    this.side.querySelector('.tc-assist').classList.toggle('off', !ship.assist);
    // point-to-fly: turn the nose toward the stick and thrust when roughly facing it
    const s = this.stick;
    const mag = s ? Math.hypot(s.dx, s.dy) : 0;
    if (mag > 0.18) {
      const want = Math.atan2(s.dx, -s.dy);
      const err = angleDiff(ship.angle, want);
      ts.turn = clamp(err * 3 - ship.av * 0.5, -1, 1);
      const facing = Math.cos(err);
      ts.thrust = facing > 0.5 ? clamp((mag - 0.18) / 0.6, 0, 1) * facing : 0;
    } else { ts.turn = 0; ts.thrust = 0; }
  }
}
