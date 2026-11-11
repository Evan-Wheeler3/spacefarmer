// Shipyard: grid builder wired to the real physics analysis.
import { PARTS, GRID, PHYS, PRESETS, ORES, SECTORS } from '../data.js';
import { Design, analyze, footprint, entryCells, entryCenter, inFrame, edgeCells } from '../shipdesign.js';
import { frameSize, partUnlocked, UPGRADE_BY_ID, oreFromDamage } from '../economy.js';
import { drawPart, CAT_COLORS } from '../render.js';
import { el, toast, modal, popEl } from './dom.js';
import { TAU, DIRS, easeOutBack, money, fmt, rand, hexA, clamp } from '../util.js';
import { exportBlueprint, importBlueprint } from '../save.js';

const CATS = [
  ['structure', 'Structure'], ['propulsion', 'Propulsion'], ['power', 'Power'], ['utility', 'Utility'],
  ['weapon', 'Weapons'], ['defense', 'Defense'], ['doomsday', 'Doomsday'],
];
const mirrorRot = (r) => (r === 1 ? 3 : r === 3 ? 1 : r);

export function refundValue(design) {
  return Math.floor(design.entries.reduce((s, e) => s + PARTS[e.part].cost * (e.hp == null ? 1 : e.hp), 0));
}

export class Builder {
  constructor(game) {
    this.game = game;
    this.sel = 'hull';
    this.rot = 0;
    this.mirror = false;
    this.showForces = true;
    this.anims = [];
    this.sparks = [];
    this.texts = [];
    this.hover = null;
    this.stroke = null;
    this.hoverPart = null;
  }

  get save() { return this.game.save; }

  mount(container) {
    this.design = Design.fromJSON(this.save.design);
    this.frame = frameSize(this.save.upgrades);
    this.history = [this.snapshot()];
    this.hidx = 0;
    this.root = el('div', { class: 'builder' });
    this.palette = el('div', { class: 'b-palette' });
    this.canvas = el('canvas', { class: 'b-canvas' });
    this.stats = el('div', { class: 'b-stats' });
    this.info = el('div', { class: 'b-info' });
    const tb = (label, title, fn, cls = '') => el('button', { class: 'btn small ' + cls, title, onclick: fn }, label);
    this.btnUndo = tb('↶ Undo', 'Ctrl+Z', () => this.undo());
    this.btnRedo = tb('↷ Redo', 'Ctrl+Y', () => this.redo());
    this.btnMirror = tb('⇋ Mirror', 'M: place symmetrically', () => this.toggleMirror());
    this.btnForces = tb('➚ Forces', 'Show thrust vectors and center of mass', () => { this.showForces = !this.showForces; this.btnForces.classList.toggle('on', this.showForces); }, 'on');
    const toolbar = el('div', { class: 'b-toolbar' },
      this.btnUndo, this.btnRedo,
      tb('⟳ Rotate', 'R or mouse wheel', () => this.rotate(1)),
      this.btnMirror, this.btnForces,
      el('span', { class: 'b-sep' }),
      tb('Presets', 'Load a pre-built design', () => this.presetsDialog()),
      tb('Blueprints', 'Save, load, export, import', () => this.blueprintsDialog()),
      tb('Strip', 'Remove everything except the core', () => this.clearAll(), 'danger'));
    const hint = el('div', { class: 'b-hint' }, 'Left-click/drag: place · Right-click/drag: remove · R/wheel: rotate · M: mirror · Middle-click: pick part · Ctrl+Z/Y: undo/redo');
    this.root.append(this.palette, el('div', { class: 'b-center' }, toolbar, this.canvas, hint), el('div', { class: 'b-side' }, this.stats, this.info));
    container.append(this.root);
    this.buildPalette();
    this.bindCanvas();
    this.refresh();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas);
    this.resize();
    this.mounted = true;
  }

  unmount() {
    if (!this.mounted) return;
    this.mounted = false;
    this.ro.disconnect();
    removeEventListener('keydown', this._key);
    removeEventListener('mouseup', this._up);
    this.root.remove();
  }

  snapshot() { return { design: JSON.stringify(this.design.toJSON()), credits: this.save.credits }; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.cw = r.width; this.ch = r.height; this.dpr = dpr;
    this.canvas.width = Math.max(1, r.width * dpr); this.canvas.height = Math.max(1, r.height * dpr);
    this.S = Math.floor(Math.min(r.width, r.height) / (GRID.size + 0.6));
  }

  // ------------------------------------------------------------ palette
  buildPalette() {
    this.palette.innerHTML = '';
    this.cards = {};
    for (const [cat, label] of CATS) {
      const ids = Object.keys(PARTS).filter((id) => PARTS[id].cat === cat);
      if (!ids.length) continue;
      this.palette.append(el('div', { class: 'b-cat', style: { color: CAT_COLORS[cat] } }, label));
      for (const id of ids) {
        const p = PARTS[id];
        const unlocked = partUnlocked(id, this.save.upgrades);
        const icon = el('canvas', { width: 64, height: 64, class: 'b-icon' });
        const g = icon.getContext('2d');
        const s = 44 / Math.max(p.w, p.h);
        drawPart(g, id, 32, 32, s, 0);
        const card = el('div', {
          class: 'b-card' + (unlocked ? '' : ' locked'),
          onmousedown: (e) => { if (e.button !== 0) return; if (!unlocked) { toast(`Locked — research ${UPGRADE_BY_ID[p.unlock].name}`, 'bad'); this.game.sfx('denied'); return; } this.select(id); this.dragFromPalette = true; },
          onmouseenter: () => this.showInfo(id),
          onmouseleave: () => this.showInfo(null),
        }, icon, el('div', { class: 'b-card-text' }, el('div', { class: 'b-card-name' }, p.name), el('div', { class: 'b-card-cost' }, unlocked ? (p.cost ? money(p.cost) : 'free') : '🔒 ' + UPGRADE_BY_ID[p.unlock].name)));
        if (id === 'core') card.classList.add('hidden-core');
        this.cards[id] = card;
        this.palette.append(card);
      }
    }
    this.select(this.sel);
  }

  select(id) {
    this.sel = id;
    for (const k in this.cards) this.cards[k].classList.toggle('sel', k === id);
    this.game.sfx('click');
  }

  showInfo(id, entry = null) {
    if (!id) { this.info.innerHTML = ''; return; }
    const p = PARTS[id];
    const rows = [['Mass', p.mass + ' t'], ['Health', p.hp], ['Cost', p.cost ? money(p.cost) : '—']];
    if (p.thrust) rows.push(['Thrust', fmt(p.thrust)], ['Fuel use', p.fuelUse + '/s']);
    if (p.torque) rows.push(['Torque', fmt(p.torque)]);
    if (p.gen) rows.push(['Power gen', '+' + p.gen + '/s']);
    if (p.powerUse) rows.push(['Power use', p.powerUse + '/s']);
    if (p.battery) rows.push(['Battery', p.battery]);
    if (p.fuel) rows.push(['Fuel', p.fuel]);
    if (p.cargo) rows.push(['Cargo', p.cargo + ' ore']);
    if (p.armor) rows.push(['Armor', '-' + p.armor + ' dmg/hit']);
    if (p.mining) rows.push(['Mining', p.mining + ' dmg/s'], ['Range', p.laserRange]);
    if (p.weapon) rows.push(['Damage', p.weapon.damage], ['Fire rate', p.weapon.rate + '/s'], ['Range', p.weapon.range]);
    if (p.shield) rows.push(['Shield', p.shield], ['Regen', p.shieldRegen + '/s']);
    if (p.magnet) rows.push(['Ore magnet', p.magnet + ' px']);
    if (p.cracker) rows.push(['Charge time', p.cracker.chargeTime + ' s'], ['Charge power', p.cracker.power + '/s']);
    if (entry && entry.hp != null && entry.hp < 1) rows.push(['Condition', Math.round(entry.hp * 100) + '%']);
    this.info.innerHTML = '';
    this.info.append(
      el('div', { class: 'i-name', style: { color: CAT_COLORS[p.cat] } }, p.name, p.w * p.h > 1 ? el('span', { class: 'dim' }, ` ${p.w}×${p.h}`) : ''),
      el('div', { class: 'i-desc' }, p.desc),
      el('div', { class: 'i-rows' }, rows.map(([k, v]) => el('div', {}, el('span', { class: 'dim' }, k), el('span', {}, String(v))))));
  }

  // ------------------------------------------------------------- input
  bindCanvas() {
    const cv = this.canvas;
    cv.addEventListener('mousemove', (e) => {
      const r = cv.getBoundingClientRect();
      this.mx = e.clientX - r.left; this.my = e.clientY - r.top;
      this.updateHover();
      if (this.stroke) this.paint();
    });
    cv.addEventListener('mouseleave', () => { this.hover = null; });
    cv.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.button === 1) { this.eyedrop(); return; }
      this.stroke = { mode: e.button === 2 ? 'erase' : 'place', before: this.snapshot(), changed: false, last: null };
      this.paint();
    });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.rotate(e.deltaY > 0 ? 1 : -1); }, { passive: false });
    this._up = (e) => {
      if (this.dragFromPalette && this.hover && !this.stroke && e.target === this.canvas) { this.stroke = { mode: 'place', before: this.snapshot(), changed: false, last: null }; this.paint(); }
      this.dragFromPalette = false;
      if (this.stroke) { if (this.stroke.changed) this.pushHistory(); this.stroke = null; }
    };
    addEventListener('mouseup', this._up);
    this._key = (e) => {
      if (!this.mounted || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); this.redo(); }
      else if (e.code === 'KeyR') this.rotate(e.shiftKey ? -1 : 1);
      else if (e.code === 'KeyM') this.toggleMirror();
    };
    addEventListener('keydown', this._key);
  }

  toggleMirror() { this.mirror = !this.mirror; this.btnMirror.classList.toggle('on', this.mirror); this.game.sfx('click'); }
  rotate(d) { this.rot = (this.rot + d + 4) % 4; this.game.sfx('rotate'); this.updateHover(); }

  cellAt(mx, my) { return [(mx - this.cw / 2) / this.S, (my - this.ch / 2) / this.S]; }
  anchorFor(id, rot, fx, fy) {
    const f = footprint(id, rot);
    return [Math.round(fx - (f.w - 1) / 2), Math.round(fy - (f.h - 1) / 2)];
  }
  updateHover() {
    if (this.mx == null) return;
    const [fx, fy] = this.cellAt(this.mx, this.my);
    const cx = Math.round(fx), cy = Math.round(fy);
    if (Math.abs(cx) > (GRID.size - 1) / 2 + 1 || Math.abs(cy) > (GRID.size - 1) / 2 + 1) { this.hover = null; return; }
    const [ax, ay] = this.anchorFor(this.sel, this.rot, fx, fy);
    this.hover = { cx, cy, ax, ay };
    const idx = this.design.at(cx, cy);
    if (idx !== this.hoverIdx) {
      this.hoverIdx = idx;
      if (idx >= 0) this.showInfo(this.design.entries[idx].part, this.design.entries[idx]);
      else this.showInfo(null);
    }
  }

  mirrorOf(id, x, y, rot) {
    const f = footprint(id, rot);
    const mr = mirrorRot(rot);
    return [-(x + f.w - 1), y, mr];
  }

  paint() {
    const h = this.hover;
    if (!h || !this.stroke) return;
    const st = this.stroke;
    const key = st.mode === 'erase' ? h.cx + ',' + h.cy : h.ax + ',' + h.ay;
    if (st.last === key) return;
    st.last = key;
    if (st.mode === 'place') {
      const ok = this.place(this.sel, h.ax, h.ay, this.rot, true);
      if (ok && this.mirror) {
        const [mx, my, mr] = this.mirrorOf(this.sel, h.ax, h.ay, this.rot);
        if (mx !== h.ax || mr !== this.rot) this.place(this.sel, mx, my, mr, false);
      }
    } else {
      const i = this.design.at(h.cx, h.cy);
      if (i >= 0) {
        const e = this.design.entries[i];
        const ok = this.remove(i, true);
        if (ok && this.mirror) {
          const [mx, my, mr] = this.mirrorOf(e.part, e.x, e.y, e.rot);
          const j = this.design.entries.findIndex((q) => q.part === e.part && q.x === mx && q.y === my);
          if (j >= 0) this.remove(j, false);
        }
      }
    }
  }

  place(id, x, y, rot, loud) {
    const chk = this.design.check(id, x, y, rot, this.frame);
    const cost = PARTS[id].cost;
    if (!chk.ok) { if (loud && chk.reason !== 'Cell occupied') this.deny(chk.reason); return false; }
    if (this.save.credits < cost) { if (loud) this.deny('Not enough credits — need ' + money(cost)); return false; }
    this.save.credits -= cost;
    this.design.add({ part: id, x, y, rot, hp: 1 });
    this.stroke && (this.stroke.changed = true);
    const c = entryCenter({ part: id, x, y, rot });
    this.anims.push({ part: id, x, y, rot, t: 0, kind: 'in' });
    this.burst(c.x, c.y, CAT_COLORS[PARTS[id].cat], 10);
    if (cost) this.floatText(c.x, c.y, '-' + money(cost), '#ffd60a');
    this.game.sfx('place', PARTS[id].mass);
    this.refresh();
    return true;
  }

  remove(i, loud) {
    const e = this.design.entries[i];
    if (PARTS[e.part].core) { if (loud) this.deny('The core stays. It is load-bearing, emotionally.'); return false; }
    const refund = Math.floor(PARTS[e.part].cost * (e.hp == null ? 1 : e.hp));
    this.design.removeIndex(i);
    this.save.credits += refund;
    this.stroke && (this.stroke.changed = true);
    const c = entryCenter(e);
    this.anims.push({ part: e.part, x: e.x, y: e.y, rot: e.rot, t: 0, kind: 'out' });
    this.burst(c.x, c.y, '#8a8f9e', 6);
    if (refund) this.floatText(c.x, c.y, '+' + money(refund), '#2ee6a6');
    this.game.sfx('remove');
    this.refresh();
    return true;
  }

  eyedrop() {
    const h = this.hover; if (!h) return;
    const i = this.design.at(h.cx, h.cy);
    if (i < 0) return;
    const e = this.design.entries[i];
    if (PARTS[e.part].core) return;
    this.select(e.part); this.rot = e.rot;
  }

  deny(msg) {
    toast(msg, 'bad');
    this.game.sfx('denied');
    this.denyT = 0.3;
  }

  burst(gx, gy, col, n) {
    for (let k = 0; k < n; k++) { const a = rand(0, TAU), s = rand(60, 220); this.sparks.push({ gx, gy, x: 0, y: 0, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: rand(0.25, 0.5), col }); }
  }
  floatText(gx, gy, text, col) { this.texts.push({ gx, gy, text, col, t: 1 }); }

  pushHistory() {
    this.history.length = this.hidx + 1;
    this.history.push(this.snapshot());
    if (this.history.length > 80) this.history.shift();
    this.hidx = this.history.length - 1;
    this.commit();
  }
  restore(snap) {
    this.design = Design.fromJSON(JSON.parse(snap.design));
    this.save.credits = snap.credits;
    this.refresh();
    this.commit();
  }
  undo() { if (this.hidx <= 0) return; this.hidx--; this.restore(this.history[this.hidx]); this.game.sfx('undo'); }
  redo() { if (this.hidx >= this.history.length - 1) return; this.hidx++; this.restore(this.history[this.hidx]); this.game.sfx('undo'); }

  commit() {
    this.save.design = this.design.toJSON();
    this.game.onDesignChanged();
  }

  clearAll() {
    const before = this.design.entries.length;
    for (let i = this.design.entries.length - 1; i >= 0; i--) if (!PARTS[this.design.entries[i].part].core) this.remove(i, false);
    if (this.design.entries.length !== before) this.pushHistory();
  }

  // Load a full-condition design, paying the difference
  loadDesign(cells, name) {
    const d = Design.fromJSON({ cells });
    if (!d.hasCore()) return this.deny('That blueprint has no Command Core.');
    for (const e of d.entries) {
      if (!partUnlocked(e.part, this.save.upgrades)) return this.deny(`Needs ${PARTS[e.part].name} (research ${UPGRADE_BY_ID[PARTS[e.part].unlock].name}).`);
      for (const [x, y] of entryCells(e)) if (!inFrame(x, y, this.frame)) return this.deny(`Too big for your ${this.frame}×${this.frame} frame. Research Frame Extension.`);
    }
    const cost = d.value() - refundValue(this.design);
    if (cost > this.save.credits) return this.deny(`Need ${money(cost)} more to switch to ${name}.`);
    this.save.credits -= cost;
    this.design = d;
    for (const e of d.entries) this.anims.push({ part: e.part, x: e.x, y: e.y, rot: e.rot, t: -Math.random() * 0.25, kind: 'in' });
    this.game.sfx('purchase');
    toast(`${name} loaded (${cost >= 0 ? '-' : '+'}${money(Math.abs(cost))})`, 'money');
    this.refresh();
    this.pushHistory();
    return true;
  }

  // ----------------------------------------------------------- dialogs
  previewCanvas(cells, size = 110) {
    const cv = el('canvas', { width: size * 2, height: size * 2, style: { width: size + 'px', height: size + 'px' } });
    const g = cv.getContext('2d');
    const d = Design.fromJSON({ cells });
    let minx = 0, maxx = 0, miny = 0, maxy = 0;
    for (const e of d.entries) for (const [x, y] of entryCells(e)) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
    const s = Math.min((size * 2 - 12) / (maxx - minx + 1), (size * 2 - 12) / (maxy - miny + 1), 34);
    const ox = size - ((minx + maxx) / 2) * s, oy = size - ((miny + maxy) / 2) * s;
    for (const e of d.entries) { const c = entryCenter(e); drawPart(g, e.part, ox + c.x * s, oy + c.y * s, s, e.rot); }
    return cv;
  }

  presetsDialog() {
    const list = el('div', { class: 'bp-list' });
    let dlg;
    for (const [id, p] of Object.entries(PRESETS)) {
      const d = Design.fromJSON({ cells: p.cells });
      const cost = d.value() - refundValue(this.design);
      const locked = d.entries.find((e) => !partUnlocked(e.part, this.save.upgrades));
      const big = d.entries.some((e) => entryCells(e).some(([x, y]) => !inFrame(x, y, this.frame)));
      const why = locked ? `Needs ${PARTS[locked.part].name}` : big ? `Needs a bigger frame` : cost > this.save.credits ? `Need ${money(cost)}` : '';
      list.append(el('div', { class: 'bp-item' }, this.previewCanvas(p.cells),
        el('div', { class: 'bp-text' }, el('b', {}, p.name), el('div', { class: 'dim' }, p.desc),
          el('div', {}, 'Value ', el('span', { class: 'money' }, money(d.value())), ' · switch cost ', el('span', { class: cost > 0 ? 'money' : 'good' }, (cost >= 0 ? '' : '+') + money(Math.abs(cost))))),
        el('button', { class: 'btn small primary', disabled: !!why, title: why, onclick: () => { if (this.loadDesign(p.cells, p.name)) dlg.close(); } }, why || 'Load')));
    }
    dlg = modal('Preset Designs', el('div', {}, el('p', { class: 'dim' }, 'Switching sells your current parts (at their condition) and buys the preset.'), list), [{ label: 'Close' }]);
  }

  blueprintsDialog() {
    const body = el('div');
    let dlg;
    const render = () => {
      body.innerHTML = '';
      const name = el('input', { type: 'text', placeholder: 'Blueprint name', maxlength: 40, class: 'inp' });
      body.append(el('div', { class: 'bp-row' }, name, el('button', { class: 'btn small primary', onclick: () => {
        const n = name.value.trim() || `Design ${this.save.blueprints.length + 1}`;
        this.save.blueprints.push({ name: n, cells: this.design.pristine().toJSON().cells });
        this.game.persist(); toast(`Saved “${n}”`, 'good'); this.game.sfx('click'); render();
      } }, 'Save current')));
      const list = el('div', { class: 'bp-list' });
      if (!this.save.blueprints.length) list.append(el('p', { class: 'dim' }, 'No saved blueprints yet.'));
      this.save.blueprints.forEach((bp, i) => {
        list.append(el('div', { class: 'bp-item' }, this.previewCanvas(bp.cells, 80),
          el('div', { class: 'bp-text' }, el('b', {}, bp.name), el('div', { class: 'dim' }, `${bp.cells.length} parts · value ${money(Design.fromJSON({ cells: bp.cells }).value())}`)),
          el('div', { class: 'bp-btns' },
            el('button', { class: 'btn small primary', onclick: () => { if (this.loadDesign(bp.cells, bp.name)) dlg.close(); } }, 'Load'),
            el('button', { class: 'btn small', onclick: () => {
              const code = exportBlueprint(bp.name, Design.fromJSON({ cells: bp.cells }));
              navigator.clipboard?.writeText(code).then(() => toast('Blueprint code copied to clipboard', 'good'), () => {});
              exportBox.value = code; exportBox.select();
            } }, 'Export'),
            el('button', { class: 'btn small danger', onclick: () => { this.save.blueprints.splice(i, 1); this.game.persist(); render(); } }, '✕'))));
      });
      body.append(list);
      const exportBox = el('textarea', { class: 'inp', rows: 3, placeholder: 'Paste a blueprint code (SFBP1:...) here and press Import. Exported codes appear here too.' });
      body.append(el('h3', {}, 'Share'), exportBox, el('div', { class: 'bp-row' },
        el('button', { class: 'btn small', onclick: () => {
          const code = exportBlueprint('Current design', this.design.pristine());
          exportBox.value = code; exportBox.select();
          navigator.clipboard?.writeText(code).then(() => toast('Current design copied as a blueprint code', 'good'), () => {});
        } }, 'Export current'),
        el('button', { class: 'btn small primary', onclick: () => {
          try {
            const bp = importBlueprint(exportBox.value);
            this.save.blueprints.push({ name: bp.name, cells: bp.cells });
            this.game.persist(); toast(`Imported “${bp.name}”`, 'good'); render();
          } catch (err) { toast(err.message, 'bad'); }
        } }, 'Import')));
    };
    render();
    dlg = modal('Blueprints', body, [{ label: 'Close' }]);
  }

  // ------------------------------------------------------------ stats
  refresh() {
    this.analysis = analyze(this.design, this.save.upgrades);
    const a = this.analysis;
    const sector = SECTORS[this.save.sector] || SECTORS[0];
    const oreRate = oreFromDamage(a.mining, sector.hardness, this.save.upgrades);
    const row = (k, v, cls = '', bar = null) => el('div', { class: 's-row' }, el('span', { class: 'dim' }, k), el('span', { class: cls }, v),
      bar ? el('div', { class: 's-bar' }, el('i', { style: { width: clamp(bar[0], 0, 1) * 100 + '%', background: bar[1] } })) : '');
    const powerOk = a.gen >= a.peakDraw;
    this.stats.innerHTML = '';
    this.stats.append(
      el('div', { class: 's-head' }, 'FLIGHT'),
      row('Mass', `${a.mass.toFixed(1)} t  (${a.loadedMass.toFixed(1)} loaded)`),
      row('Acceleration', `${a.accel.toFixed(0)} px/s²`, a.accel < 60 ? 'warn' : 'good', [a.accel / 250, '#ff9f1c']),
      row('Thrust-to-weight', `${a.twr.toFixed(2)} g  (${(a.accelLoaded / 100).toFixed(2)} loaded)`),
      row('90° turn', isFinite(a.turn90) ? `${a.turn90.toFixed(2)} s` : '—', a.turn90 > 1.6 ? 'warn' : '', [1 - a.turn90 / 3, '#ff9f1c']),
      row('Off-center torque', `${Math.round((a.imbalance / Math.max(1, a.gyroTorque)) * 100)}% of gyros`, a.imbalance > a.gyroTorque * 0.95 ? 'bad' : a.imbalance > a.gyroTorque * 0.45 ? 'warn' : 'good', [a.imbalance / Math.max(1, a.gyroTorque), a.imbalance > a.gyroTorque ? '#ff5d73' : '#2ee6a6']),
      row('Reverse / strafe', `${fmt(a.thrustBack)} / ${fmt(Math.min(a.thrustLeft, a.thrustRight))}`),
      el('div', { class: 's-head' }, 'SYSTEMS'),
      row('Power', `+${a.gen.toFixed(1)} / -${a.peakDraw.toFixed(1)} peak`, powerOk ? 'good' : 'warn', [a.gen / Math.max(0.1, a.peakDraw), powerOk ? '#ffd60a' : '#ff5d73']),
      row('Battery', `${a.battery}`),
      row('Fuel', `${a.fuel}  (${isFinite(a.endurance) ? Math.round(a.endurance) + 's full burn' : '—'})`),
      row('Cargo', `${a.cargo} ore`),
      row('Mining', `${oreRate.toFixed(2)} ore/s here`),
      row('Weapons', `${a.dps.toFixed(0)} dps`),
      a.shield ? row('Shield', `${a.shield.toFixed(0)} (+${a.shieldRegen.toFixed(0)}/s)`) : '',
      row('Hull', `${Math.round(a.hp)} hp`),
      row('Ship value', money(a.value), 'money'),
      el('div', { class: 's-head' }, 'DIAGNOSTICS'),
      el('div', { class: 's-warns' }, a.warnings.length ? a.warnings.map((w) => el('div', { class: 'w-' + w.lvl }, (w.lvl === 'err' ? '✖ ' : w.lvl === 'warn' ? '⚠ ' : 'ℹ ') + w.text)) : el('div', { class: 'w-ok' }, '✔ All systems nominal. Suspiciously so.')),
    );
    this.btnUndo.disabled = this.hidx <= 0;
    this.btnRedo.disabled = this.hidx >= this.history.length - 1;
    this.game.onBuilderRefresh && this.game.onBuilderRefresh(a);
  }

  // ------------------------------------------------------------ render
  update(dt) {
    if (!this.mounted) return;
    for (const a of this.anims) a.t += dt;
    this.anims = this.anims.filter((a) => a.t < 0.35);
    for (const s of this.sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.9; s.vy *= 0.9; s.t -= dt; }
    this.sparks = this.sparks.filter((s) => s.t > 0);
    for (const t of this.texts) t.t -= dt;
    this.texts = this.texts.filter((t) => t.t > 0);
    this.denyT = Math.max(0, (this.denyT || 0) - dt);
    this.time = (this.time || 0) + dt;
    this.render();
  }

  render() {
    const g = this.canvas.getContext('2d');
    const S = this.S, W = this.cw, H = this.ch;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const cx = W / 2 + (this.denyT ? Math.sin(this.time * 90) * 4 * this.denyT * 3 : 0), cy = H / 2;
    const half = (GRID.size - 1) / 2;
    const P = (x, y) => [cx + x * S, cy + y * S];
    // grid
    for (let y = -half; y <= half; y++) for (let x = -half; x <= half; x++) {
      const [px, py] = P(x, y);
      const inside = inFrame(x, y, this.frame);
      g.fillStyle = inside ? 'rgba(40,60,110,0.25)' : 'rgba(10,12,24,0.6)';
      g.fillRect(px - S / 2 + 1, py - S / 2 + 1, S - 2, S - 2);
      if (!inside) { g.strokeStyle = 'rgba(80,90,130,0.15)'; g.beginPath(); g.moveTo(px - S / 2 + 3, py + S / 2 - 3); g.lineTo(px + S / 2 - 3, py - S / 2 + 3); g.stroke(); }
    }
    const fh = (this.frame - 1) / 2;
    g.strokeStyle = 'rgba(125,249,255,0.5)'; g.lineWidth = 2; g.shadowColor = '#7df9ff'; g.shadowBlur = 10;
    g.strokeRect(cx - (fh + 0.5) * S, cy - (fh + 0.5) * S, this.frame * S, this.frame * S);
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(125,249,255,0.5)'; g.font = '700 11px "Trebuchet MS"'; g.textAlign = 'center';
    g.fillText('▲ FORWARD', cx, cy - (fh + 0.5) * S - 8);
    if (this.mirror) { g.strokeStyle = 'rgba(255,214,10,0.35)'; g.setLineDash([6, 6]); g.beginPath(); g.moveTo(cx, cy - (half + 0.5) * S); g.lineTo(cx, cy + (half + 0.5) * S); g.stroke(); g.setLineDash([]); }

    const a = this.analysis;
    // parts
    const animFor = (e) => this.anims.find((q) => q.kind === 'in' && q.part === e.part && q.x === e.x && q.y === e.y);
    this.design.entries.forEach((e, i) => {
      const c = entryCenter(e);
      const [px, py] = P(c.x, c.y);
      const an = animFor(e);
      let sc = 1, flash = 0;
      if (an) { const t = clamp(an.t / 0.25, 0, 1); sc = an.t < 0 ? 0 : 0.4 + 0.6 * easeOutBack(t); flash = 1 - t; }
      g.save(); g.translate(px, py); g.scale(sc, sc);
      drawPart(g, e.part, 0, 0, S, e.rot, { hp: e.hp == null ? 1 : e.hp, flash: flash * 0.8 });
      g.restore();
      if (a.bad.has(i)) {
        const f = footprint(e.part, e.rot);
        g.strokeStyle = `rgba(255,93,115,${0.5 + Math.sin(this.time * 8) * 0.4})`; g.lineWidth = 3;
        g.strokeRect(px - (f.w * S) / 2 + 2, py - (f.h * S) / 2 + 2, f.w * S - 4, f.h * S - 4);
        if (e.hp === 0) { g.strokeStyle = '#ff5d73'; g.beginPath(); g.moveTo(px - S * 0.3, py - S * 0.3); g.lineTo(px + S * 0.3, py + S * 0.3); g.moveTo(px + S * 0.3, py - S * 0.3); g.lineTo(px - S * 0.3, py + S * 0.3); g.stroke(); }
      }
    });
    for (const an of this.anims) {
      if (an.kind !== 'out') continue;
      const c = entryCenter(an);
      const [px, py] = P(c.x, c.y);
      const t = an.t / 0.25;
      if (t > 1) continue;
      g.save(); g.translate(px, py); g.scale(1 - t * 0.6, 1 - t * 0.6);
      drawPart(g, an.part, 0, 0, S, an.rot, { alpha: 1 - t });
      g.restore();
    }
    // force overlay
    if (this.showForces && a) {
      g.lineWidth = 2.5;
      for (const t of a.thrusters) {
        const e = this.design.entries[t.i];
        const c = entryCenter(e);
        const [px, py] = P(c.x, c.y);
        const L = (t.thrust / 1150) * S * 0.9;
        const bx = px - t.dx * L * 0.2, by = py - t.dy * L * 0.2;
        const ex = px + t.dx * L, ey = py + t.dy * L;
        g.strokeStyle = 'rgba(255,159,28,0.85)'; g.fillStyle = 'rgba(255,159,28,0.85)';
        g.beginPath(); g.moveTo(bx, by); g.lineTo(ex, ey); g.stroke();
        g.beginPath(); g.moveTo(ex + t.dx * 7, ey + t.dy * 7); g.lineTo(ex - t.dy * 5, ey + t.dx * 5); g.lineTo(ex + t.dy * 5, ey - t.dx * 5); g.closePath(); g.fill();
      }
      this.design.entries.forEach((e, i) => {
        const p = PARTS[e.part];
        if (!p.muzzle) return;
        const blocked = this.design.blockedMuzzle(i);
        const f = footprint(e.part, e.rot);
        const c = entryCenter(e);
        const [dx, dy] = DIRS[e.rot];
        const [px, py] = P(c.x + dx * f.h / 2, c.y + dy * f.h / 2);
        g.strokeStyle = blocked ? 'rgba(255,93,115,0.8)' : 'rgba(46,230,166,0.4)';
        g.setLineDash([4, 5]); g.beginPath(); g.moveTo(px, py); g.lineTo(px + dx * S * 2.5, py + dy * S * 2.5); g.stroke(); g.setLineDash([]);
      });
      if (a.mass > 0) {
        const [mx, my] = P(a.com.x, a.com.y);
        g.strokeStyle = '#fff'; g.lineWidth = 2;
        g.beginPath(); g.arc(mx, my, 7, 0, TAU); g.moveTo(mx - 12, my); g.lineTo(mx + 12, my); g.moveTo(mx, my - 12); g.lineTo(mx, my + 12); g.stroke();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(mx, my, 7, 0, Math.PI / 2); g.lineTo(mx, my); g.fill(); g.beginPath(); g.arc(mx, my, 7, Math.PI, Math.PI * 1.5); g.lineTo(mx, my); g.fill();
        // torque arc: how hard forward thrust tries to spin the ship vs gyro authority
        const k = a.gyroTorque > 0 ? a.fwdTorque / a.gyroTorque : 0;
        if (Math.abs(k) > 0.05) {
          const R = 24, span = clamp(Math.abs(k), 0, 1.6) * Math.PI;
          g.strokeStyle = Math.abs(k) > 0.95 ? '#ff5d73' : Math.abs(k) > 0.45 ? '#ffcf5a' : '#2ee6a6';
          g.lineWidth = 3;
          const s0 = -Math.PI / 2, s1 = s0 + span * Math.sign(k);
          g.beginPath(); g.arc(mx, my, R, Math.min(s0, s1), Math.max(s0, s1)); g.stroke();
          const ax = mx + Math.cos(s1) * R, ay = my + Math.sin(s1) * R;
          g.beginPath(); g.arc(ax, ay, 4, 0, TAU); g.fillStyle = g.strokeStyle; g.fill();
        }
      }
    }
    // ghost
    const h = this.hover;
    if (h && !this.stroke?.mode?.startsWith('erase')) {
      const ghosts = [[h.ax, h.ay, this.rot]];
      if (this.mirror) { const m = this.mirrorOf(this.sel, h.ax, h.ay, this.rot); if (m[0] !== h.ax || m[2] !== this.rot) ghosts.push(m); }
      for (const [gx, gy, gr] of ghosts) {
        const chk = this.design.check(this.sel, gx, gy, gr, this.frame);
        const afford = this.save.credits >= PARTS[this.sel].cost;
        const ok = chk.ok && afford;
        for (const [x, y] of entryCells({ part: this.sel, x: gx, y: gy, rot: gr })) {
          const [px, py] = P(x, y);
          g.fillStyle = ok ? 'rgba(46,230,166,0.18)' : 'rgba(255,93,115,0.2)';
          g.fillRect(px - S / 2 + 1, py - S / 2 + 1, S - 2, S - 2);
        }
        const c = entryCenter({ part: this.sel, x: gx, y: gy, rot: gr });
        const [px, py] = P(c.x, c.y);
        drawPart(g, this.sel, px, py, S, gr, { alpha: ok ? 0.6 : 0.3 });
        if (PARTS[this.sel].exhaust) {
          for (const [x, y] of edgeCells({ part: this.sel, x: gx, y: gy, rot: gr }, -1)) {
            const [qx, qy] = P(x, y);
            g.fillStyle = this.design.at(x, y) >= 0 ? 'rgba(255,93,115,0.45)' : 'rgba(255,159,28,0.18)';
            g.beginPath(); g.arc(qx, qy, S * 0.22, 0, TAU); g.fill();
          }
        }
      }
    } else if (h && this.stroke?.mode === 'erase') {
      const [px, py] = P(h.cx, h.cy);
      g.strokeStyle = '#ff5d73'; g.lineWidth = 2; g.strokeRect(px - S / 2 + 2, py - S / 2 + 2, S - 4, S - 4);
    }
    // sparks + texts
    g.globalCompositeOperation = 'lighter';
    for (const s of this.sparks) {
      const [px, py] = P(s.gx, s.gy);
      g.fillStyle = s.col; g.globalAlpha = Math.min(1, s.t * 3);
      g.fillRect(px + s.x - 1.5, py + s.y - 1.5, 3, 3);
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.font = '700 14px "Trebuchet MS"'; g.textAlign = 'center';
    for (const t of this.texts) {
      const [px, py] = P(t.gx, t.gy);
      g.globalAlpha = Math.min(1, t.t * 2);
      g.lineWidth = 3; g.strokeStyle = '#000'; g.strokeText(t.text, px, py - (1 - t.t) * 40);
      g.fillStyle = t.col; g.fillText(t.text, px, py - (1 - t.t) * 40);
    }
    g.globalAlpha = 1;
  }
}
