'use strict';
// ---------------------------------------------------------------------------
// Utilitaires mathématiques et structures partagées
// ---------------------------------------------------------------------------
const TILE = 32;            // 1 tuile = 1 mètre = 32 px
const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }
function dist2(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; }
function angleTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }
function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
  return d;
}
function rad(d) { return d * Math.PI / 180; }
function rand(a = 0, b = 1) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
// Approximation d'une loi normale bornée dans [-1, 1]
function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }
function choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function fmtTime(s) { const m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ':' + (r < 10 ? '0' : '') + r; }

// Intersection segment / cercle : renvoie t dans [0,1] du premier contact, -1 sinon.
function segCircle(x0, y0, x1, y1, cx, cy, r) {
  const dx = x1 - x0, dy = y1 - y0;
  const fx = x0 - cx, fy = y0 - cy;
  const a = dx * dx + dy * dy;
  if (a === 0) return (fx * fx + fy * fy <= r * r) ? 0 : -1;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  const t2 = (-b + disc) / (2 * a);
  if (t1 < 0 && t2 >= 0) return 0; // départ à l'intérieur du cercle
  return -1;
}
// Distance perpendiculaire entre la droite (x0,y0)-(x1,y1) et le point (px,py)
function lineDistToPoint(x0, y0, x1, y1, px, py) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs(dx * (py - y0) - dy * (px - x0)) / len;
}

// Tas binaire minimal (pour A*)
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a; a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

// Stockage local (progression / options)
const Store = {
  get(key, def) { try { const v = localStorage.getItem('exco_' + key); return v === null ? def : JSON.parse(v); } catch (e) { return def; } },
  set(key, val) { try { localStorage.setItem('exco_' + key, JSON.stringify(val)); } catch (e) { /* ignore */ } }
};
