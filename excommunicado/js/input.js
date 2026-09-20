'use strict';
// ---------------------------------------------------------------------------
// Entrées clavier / souris. Utilise event.code (position physique) : les
// touches ZQSD (AZERTY) et WASD (QWERTY) fonctionnent sans configuration.
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
  next: ['Tab']
};
class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = Object.create(null);
    this.just = Object.create(null);
    this.mouse = { x: 0, y: 0, down: false, rdown: false, justDown: false, justRDown: false, wheel: 0 };
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys[e.code] = true; this.just[e.code] = true;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = Object.create(null); this.mouse.down = false; this.mouse.rdown = false; });
    window.addEventListener('mousemove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    window.addEventListener('mousedown', e => {
      if (e.target !== canvas) return;
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
  }
  down(action) { const b = BINDS[action]; for (let i = 0; i < b.length; i++) if (this.keys[b[i]]) return true; return false; }
  pressed(action) { const b = BINDS[action]; for (let i = 0; i < b.length; i++) if (this.just[b[i]]) return true; return false; }
  endFrame() { this.just = Object.create(null); this.mouse.justDown = false; this.mouse.justRDown = false; this.mouse.wheel = 0; }
}
