// Keyboard, mouse and gamepad input.
export const Input = {
  keys: new Set(),
  pressed: new Set(),      // keys pressed since last frame (edge)
  mouse: { x: 0, y: 0, down: false, right: false, wheel: 0, clicked: false, rclicked: false },
  pad: null,
  padPressed: new Set(),
  _padPrev: [],
  enabled: true,
  touchState: null,

  init(canvas) {
    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousemove', (e) => { const r = canvas.getBoundingClientRect(); this.mouse.x = e.clientX - r.left; this.mouse.y = e.clientY - r.top; });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouse.down = true; this.mouse.clicked = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rclicked = true; }
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.down = false; if (e.button === 2) this.mouse.right = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  },

  down(...codes) { return codes.some((c) => this.keys.has(c)); },
  hit(...codes) { return codes.some((c) => this.pressed.has(c)); },

  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pad = null;
    this.padPressed.clear();
    for (const p of pads) if (p && p.connected) { this.pad = p; break; }
    if (!this.pad) return;
    const b = this.pad.buttons.map((x) => x.pressed);
    b.forEach((v, i) => { if (v && !this._padPrev[i]) this.padPressed.add(i); });
    this._padPrev = b;
  },
  padAxis(i) { if (!this.pad) return 0; const v = this.pad.axes[i] || 0; return Math.abs(v) < 0.18 ? 0 : v; },
  padBtn(i) { return !!(this.pad && this.pad.buttons[i] && this.pad.buttons[i].pressed); },
  padTrig(i) { return this.pad && this.pad.buttons[i] ? this.pad.buttons[i].value : 0; },

  // Flight controls
  flight() {
    const k = (...c) => (this.down(...c) ? 1 : 0);
    let thrust = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown');
    let turn = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
    let strafe = k('KeyE') - k('KeyQ');
    let fire = this.down('Space');
    let crack = this.down('KeyC');
    const t = this.touchState;
    if (t) {
      thrust = thrust || t.thrust; turn = turn || t.turn; strafe = strafe || t.strafe;
      fire = fire || t.fire; crack = crack || t.crack;
    }
    if (this.pad) {
      thrust = thrust || -this.padAxis(1);
      turn = turn || this.padAxis(2) || this.padAxis(0);
      strafe = strafe || (this.padBtn(5) ? 1 : 0) - (this.padBtn(4) ? 1 : 0);
      fire = fire || this.padTrig(7) > 0.3 || this.padBtn(0);
      crack = crack || this.padBtn(3);
    }
    return { thrust, turn, strafe, fire, crack };
  },

  endFrame() {
    this.pressed.clear();
    this.mouse.clicked = false; this.mouse.rclicked = false; this.mouse.wheel = 0;
  },
};
