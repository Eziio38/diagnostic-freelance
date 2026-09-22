'use strict';
// ---------------------------------------------------------------------------
// Entrées clavier / souris / manette (API Gamepad, mapping "standard" :
// DualSense PS5, DualShock 4, manettes Xbox). Le clavier utilise event.code
// (position physique) : ZQSD (AZERTY) et WASD (QWERTY) marchent sans réglage.
// ---------------------------------------------------------------------------
const BINDS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  reload: ['KeyR'],
  melee: ['KeyF'],
  interact: ['KeyE'],
  dodge: ['Space'],
  heal: ['KeyH'],
  throw: ['KeyG'],
  mode: ['KeyB'],
  pause: ['Escape', 'KeyP'],
  slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'], slot4: ['Digit4'],
  next: ['Tab'],
  prev: [],
  view: ['KeyV']
};
// Boutons du mapping standard (numérotation W3C) — noms DualSense
const GP = { CROSS: 0, CIRCLE: 1, SQUARE: 2, TRIANGLE: 3, L1: 4, R1: 5, L2: 6, R2: 7, CREATE: 8, OPTIONS: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, PS: 16, TOUCHPAD: 17 };
const GP_BINDS = {
  sprint: [GP.L3], reload: [GP.SQUARE], melee: [GP.R1], interact: [GP.TRIANGLE], dodge: [GP.CROSS],
  heal: [GP.UP], throw: [GP.L1], mode: [GP.DOWN], pause: [GP.OPTIONS], next: [GP.RIGHT], prev: [GP.LEFT],
  forward: [], back: [], left: [], right: [], slot1: [], slot2: [], slot3: [], slot4: [], view: [GP.TOUCHPAD]
};
const GP_GLYPH = { CROSS: '✕', CIRCLE: '○', SQUARE: '□', TRIANGLE: '△', L1: 'L1', R1: 'R1', L2: 'L2', R2: 'R2', OPTIONS: 'Options', L3: 'L3', R3: 'R3', UP: '↑', DOWN: '↓', LEFT: '←', RIGHT: '→' };

class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = Object.create(null);
    this.just = Object.create(null);
    this.mouse = { x: 0, y: 0, down: false, rdown: false, justDown: false, justRDown: false, wheel: 0, dx: 0, dy: 0 };
    this.locked = false; this.onLockChange = null;
    this.gp = { connected: false, index: -1, id: '', standard: true, lx: 0, ly: 0, lmag: 0, rx: 0, ry: 0, rmag: 0, buttons: new Array(18).fill(false), just: new Array(18).fill(false), values: new Array(18).fill(0) };
    this.pad = null;
    this.usingGamepad = false;
    this.onConnect = null;
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys[e.code] = true; this.just[e.code] = true;
      this.usingGamepad = false;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = Object.create(null); this.mouse.down = false; this.mouse.rdown = false; });
    window.addEventListener('mousemove', e => {
      if (this.locked) {
        // Curseur verrouillé (vue 3D) : on n'a que le mouvement relatif
        this.mouse.dx += e.movementX || 0; this.mouse.dy += e.movementY || 0;
        if (Math.abs(e.movementX) + Math.abs(e.movementY) > 1) this.usingGamepad = false;
        return;
      }
      if (Math.abs(e.clientX - this.mouse.x) + Math.abs(e.clientY - this.mouse.y) > 3) this.usingGamepad = false;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => { this.locked = false; });
    window.addEventListener('mousedown', e => {
      if (e.target !== canvas) return;
      this.usingGamepad = false;
      if (e.button === 0) { this.mouse.down = true; this.mouse.justDown = true; }
      if (e.button === 2) { this.mouse.rdown = true; this.mouse.justRDown = true; }
      e.preventDefault();
    });
    window.addEventListener('mouseup', e => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.rdown = false;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    window.addEventListener('gamepadconnected', e => {
      this.gp.connected = true; this.gp.index = e.gamepad.index; this.gp.id = e.gamepad.id;
      if (this.onConnect) this.onConnect(e.gamepad);
    });
    window.addEventListener('gamepaddisconnected', e => {
      if (e.gamepad.index === this.gp.index) { this.gp.connected = false; this.gp.index = -1; this.pad = null; this.usingGamepad = false; }
    });
  }
  // À appeler une fois par image, avant la mise à jour du jeu
  poll() {
    const pads = (navigator.getGamepads ? navigator.getGamepads() : []) || [];
    let pad = null;
    for (let i = 0; i < pads.length; i++) { const p = pads[i]; if (!p || p.connected === false) continue; if (p.index === this.gp.index) { pad = p; break; } if (!pad) pad = p; }
    const g = this.gp;
    if (!pad) { if (g.connected) { g.connected = false; this.pad = null; } for (let i = 0; i < 18; i++) g.just[i] = false; g.lmag = g.rmag = 0; return; }
    g.connected = true; g.index = pad.index; g.id = pad.id; g.standard = pad.mapping === 'standard'; this.pad = pad;
    const ax = pad.axes || [];
    const radial = (x, y) => { const m = Math.hypot(x, y); if (m < 0.16) return [0, 0, 0]; const s = Math.min(1, (m - 0.16) / 0.84); return [x / m * s, y / m * s, s]; };
    [g.lx, g.ly, g.lmag] = radial(ax[0] || 0, ax[1] || 0);
    [g.rx, g.ry, g.rmag] = radial(ax[2] || 0, ax[3] || 0);
    let activity = g.lmag > 0 || g.rmag > 0;
    const btns = pad.buttons || [];
    for (let i = 0; i < 18; i++) {
      const b = btns[i];
      const v = b == null ? 0 : (typeof b === 'object' ? b.value : b);
      const pressed = b == null ? false : (typeof b === 'object' ? (b.pressed || v > 0.5) : v > 0.5);
      g.just[i] = pressed && !g.buttons[i];
      g.buttons[i] = pressed; g.values[i] = v;
      if (pressed) activity = true;
    }
    if (activity) this.usingGamepad = true;
  }
  requestLock() { if (this.locked) return; try { const r = this.canvas.requestPointerLock({ unadjustedMovement: true }); if (r && r.catch) r.catch(() => { try { this.canvas.requestPointerLock(); } catch (e) { /* */ } }); } catch (e) { try { this.canvas.requestPointerLock(); } catch (e2) { /* */ } } }
  releaseLock() { if (this.locked && document.exitPointerLock) document.exitPointerLock(); }
  consumeGamepad() { for (let i = 0; i < 18; i++) this.gp.just[i] = false; }
  down(action) {
    const b = BINDS[action]; for (let i = 0; i < b.length; i++) if (this.keys[b[i]]) return true;
    if (this.gp.connected) { const gb = GP_BINDS[action] || []; for (let i = 0; i < gb.length; i++) if (this.gp.buttons[gb[i]]) return true; }
    return false;
  }
  pressed(action) {
    const b = BINDS[action]; for (let i = 0; i < b.length; i++) if (this.just[b[i]]) return true;
    if (this.gp.connected) { const gb = GP_BINDS[action] || []; for (let i = 0; i < gb.length; i++) if (this.gp.just[gb[i]]) return true; }
    return false;
  }
  fireDown() { return this.mouse.down || (this.gp.connected && this.gp.values[GP.R2] > 0.5); }
  fireJust() { return this.mouse.justDown || (this.gp.connected && this.gp.just[GP.R2]); }
  aimDown() { return this.mouse.rdown || (this.gp.connected && this.gp.values[GP.L2] > 0.35); }
  // Retour haptique (DualSense : dual-rumble)
  rumble(strong, weak, ms) {
    const p = this.pad; if (!p || !this.usingGamepad) return;
    const act = p.vibrationActuator || (p.hapticActuators && p.hapticActuators[0]);
    if (!act) return;
    try {
      if (act.playEffect) act.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) });
      else if (act.pulse) act.pulse(clamp(Math.max(strong, weak), 0, 1), ms);
    } catch (e) { /* non supporté */ }
  }
  glyph(action) {
    if (this.usingGamepad) { const gb = GP_BINDS[action]; if (gb && gb.length) { const name = Object.keys(GP).find(k => GP[k] === gb[0]); return GP_GLYPH[name] || name; } }
    const k = BINDS[action][0] || '';
    return k.replace('Key', '').replace('Digit', '').replace('ShiftLeft', 'Maj').replace('Space', 'Espace').replace('Escape', 'Échap');
  }
  endFrame() { this.just = Object.create(null); this.mouse.justDown = false; this.mouse.justRDown = false; this.mouse.wheel = 0; this.mouse.dx = 0; this.mouse.dy = 0; }
}
