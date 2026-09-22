'use strict';
// ---------------------------------------------------------------------------
// Vue 3D à la première personne : raycasting sur la grille du monde.
//  - murs, piliers, portes texturés ; caisses / voitures à mi-hauteur ; vitres translucides
//  - sol et plafond projetés (textures + décals de sang + lightmap couleur)
//  - sprites (ennemis, corps, ramassages, balles, flashs, sang) avec z-buffer
//  - modèle d'arme en vue subjective, recul, rechargement, mêlée, minimap
// ---------------------------------------------------------------------------
const FP = { WALL_H: 2.7, EYE_H: 1.62, COVER_H: 1.05, CAR_H: 1.45, GLASS_H: 2.7, MAX_DIST: 24, HFOV: 72, ADS_FOV: 54, LM: 2 };

function packRGB(r, g, b, a = 255) { return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0; }
function canvasToU32(cv) { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height); return { data: new Uint32Array(d.data.buffer), w: cv.width, h: cv.height }; }
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

// --- Textures procédurales -------------------------------------------------
function makeFPTextures(pal) {
  const T64 = 64, T32 = 32;
  const noiseRect = (c, x, y, w, h, base, amt, seed) => {
    const [r, g, b] = hexToRgb(base);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const s = Math.sin((x + i) * 12.9898 + (y + j) * 78.233 + seed) * 43758.5453; const n = (s - Math.floor(s)) * 2 - 1;
      c.fillStyle = 'rgb(' + clamp(r + n * amt, 0, 255) + ',' + clamp(g + n * amt, 0, 255) + ',' + clamp(b + n * amt, 0, 255) + ')';
      c.fillRect(x + i, y + j, 1, 1);
    }
  };
  const tex = {};
  // Mur : blocs de béton
  { const cv = mkCanvas(T64, T64), c = cv.getContext('2d');
    noiseRect(c, 0, 0, 64, 64, pal.wall || '#4a4d57', 10, 1);
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(0, 31, 64, 2); c.fillRect(0, 63, 64, 1);
    c.fillRect(31, 0, 2, 32); c.fillRect(0, 32, 1, 32); c.fillRect(63, 32, 1, 32);
    c.fillStyle = 'rgba(255,255,255,0.07)'; c.fillRect(0, 0, 64, 1); c.fillRect(0, 33, 64, 1);
    tex.wall = canvasToU32(cv); }
  // Pilier : pierre
  { const cv = mkCanvas(T64, T64), c = cv.getContext('2d');
    noiseRect(c, 0, 0, 64, 64, pal.pillar || '#3b3d46', 8, 2);
    c.fillStyle = 'rgba(0,0,0,0.35)'; for (let y = 0; y < 64; y += 16) c.fillRect(0, y, 64, 1);
    c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(0, 0, 6, 64); c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(58, 0, 6, 64);
    tex.pillar = canvasToU32(cv); }
  // Porte : planches + cadre + poignée
  { const cv = mkCanvas(T64, T64), c = cv.getContext('2d');
    noiseRect(c, 0, 0, 64, 64, pal.door || '#6b4a2b', 9, 3);
    c.fillStyle = 'rgba(0,0,0,0.35)'; for (let x = 12; x < 64; x += 13) c.fillRect(x, 0, 1, 64);
    c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 3; c.strokeRect(1.5, 1.5, 61, 61);
    c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(6, 6, 52, 22); c.fillRect(6, 36, 52, 22);
    c.fillStyle = '#c9a44b'; c.fillRect(50, 32, 6, 3);
    tex.door = canvasToU32(cv); }
  // Caisse
  { const cv = mkCanvas(T64, T64), c = cv.getContext('2d');
    noiseRect(c, 0, 0, 64, 64, pal.cover || '#5a4632', 9, 4);
    c.fillStyle = 'rgba(0,0,0,0.4)'; for (let y = 0; y < 64; y += 16) c.fillRect(0, y, 64, 2);
    c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 4; c.strokeRect(2, 2, 60, 60);
    c.strokeStyle = 'rgba(255,255,255,0.10)'; c.lineWidth = 3; c.beginPath(); c.moveTo(6, 6); c.lineTo(58, 58); c.moveTo(58, 6); c.lineTo(6, 58); c.stroke();
    tex.cover = canvasToU32(cv); }
  // Voiture (flanc)
  { const cv = mkCanvas(T64, T64), c = cv.getContext('2d');
    noiseRect(c, 0, 0, 64, 64, pal.car || '#20242c', 5, 5);
    c.fillStyle = 'rgba(120,170,200,0.35)'; c.fillRect(4, 6, 56, 20);
    c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(0, 28, 64, 3);
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(0, 56, 64, 8); c.fillStyle = '#111'; c.beginPath(); c.arc(14, 60, 7, 0, TAU); c.arc(50, 60, 7, 0, TAU); c.fill();
    tex.car = canvasToU32(cv); }
  // Vitre : cadre + reflet (alpha)
  { const cv = mkCanvas(T64, T64), c = cv.getContext('2d');
    c.fillStyle = 'rgba(150,220,240,0.22)'; c.fillRect(0, 0, 64, 64);
    c.fillStyle = 'rgba(255,255,255,0.28)'; c.beginPath(); c.moveTo(10, 60); c.lineTo(30, 4); c.lineTo(38, 4); c.lineTo(18, 60); c.closePath(); c.fill();
    c.fillStyle = 'rgba(200,240,255,0.85)'; c.fillRect(0, 0, 64, 2); c.fillRect(0, 62, 64, 2); c.fillRect(0, 0, 2, 64); c.fillRect(62, 0, 2, 64);
    tex.glass = canvasToU32(cv); }
  // Sols (32x32)
  const floor = (base, fn) => { const cv = mkCanvas(T32, T32), c = cv.getContext('2d'); noiseRect(c, 0, 0, 32, 32, base, 5, 7); fn(c); return canvasToU32(cv); };
  tex.floor = {};
  tex.floor[T.FLOOR] = floor(pal.floor || '#22242a', c => { c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, 0, 32, 1); c.fillRect(0, 0, 1, 32); });
  tex.floor[T.CARPET] = floor(pal.carpet || '#3a1c20', c => { c.fillStyle = 'rgba(255,255,255,0.04)'; c.fillRect(4, 4, 24, 24); c.fillStyle = 'rgba(0,0,0,0.15)'; c.fillRect(8, 8, 16, 16); });
  tex.floor[T.TILES] = floor(pal.tiles || '#2a3038', c => { c.fillStyle = 'rgba(255,255,255,0.10)'; c.fillRect(0, 0, 32, 1); c.fillRect(0, 0, 1, 32); c.fillRect(0, 16, 32, 1); c.fillRect(16, 0, 1, 32); });
  tex.floor[T.WOOD] = floor(pal.wood || '#3b2a1c', c => { c.fillStyle = 'rgba(0,0,0,0.3)'; for (let i = 0; i < 4; i++) c.fillRect(0, i * 8 + 7, 32, 1); c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(6, 2, 12, 1); c.fillRect(20, 18, 8, 1); });
  tex.floor[T.EXIT] = floor('#1f3a2a', c => { c.fillStyle = 'rgba(80,255,140,0.35)'; c.fillRect(0, 0, 32, 3); c.fillRect(0, 29, 32, 3); c.fillRect(0, 0, 3, 32); c.fillRect(29, 0, 3, 32); });
  tex.floor[T.GLASS_BROKEN] = floor(pal.tiles || '#2a3038', c => { c.fillStyle = 'rgba(200,240,255,0.6)'; for (let i = 0; i < 10; i++) c.fillRect((i * 7) % 30, (i * 11) % 30, 2, 1); });
  tex.floor[T.DOOR] = tex.floor[T.FLOOR]; tex.floor[T.WALL] = tex.floor[T.FLOOR]; tex.floor[T.COVER] = tex.floor[T.FLOOR]; tex.floor[T.PILLAR] = tex.floor[T.FLOOR]; tex.floor[T.GLASS] = tex.floor[T.TILES]; tex.floor[T.CAR] = tex.floor[T.FLOOR];
  // Plafond
  { const cv = mkCanvas(T32, T32), c = cv.getContext('2d'); noiseRect(c, 0, 0, 32, 32, pal.wallDark || '#33303a', 4, 9); c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, 0, 32, 1); c.fillRect(0, 0, 1, 32); c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(2, 2, 28, 28); tex.ceiling = canvasToU32(cv); }
  return tex;
}

// --- Lightmap statique (couleur, avec ombres portées par les murs) -------------
function buildLightmap(world) {
  const LM = FP.LM, W = world.w * LM, H = world.h * LM;
  const lr = new Float32Array(W * H), lg = new Float32Array(W * H), lb = new Float32Array(W * H);
  const amb = world.ambient * 0.85;
  lr.fill(amb); lg.fill(amb); lb.fill(amb);
  const pred = (tx, ty) => { const t = world.get(tx, ty); return t === T.WALL || t === T.PILLAR; };
  for (const L of world.spawns.lights) {
    const R = L.radius / TILE; const cr = L.color[0] / 255, cg = L.color[1] / 255, cb = L.color[2] / 255;
    const lx = L.x / TILE, ly = L.y / TILE;
    const x0 = Math.max(0, Math.floor((lx - R) * LM)), x1 = Math.min(W - 1, Math.ceil((lx + R) * LM));
    const y0 = Math.max(0, Math.floor((ly - R) * LM)), y1 = Math.min(H - 1, Math.ceil((ly + R) * LM));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const px = (cx + 0.5) / LM, py = (cy + 0.5) / LM;
      const d = Math.hypot(px - lx, py - ly); if (d >= R) continue;
      const ctx = Math.floor(px), cty = Math.floor(py);
      const rc = world.raycast(L.x, L.y, px * TILE, py * TILE, pred);
      if (rc.hit && !(rc.tx === ctx && rc.ty === cty)) continue; // à l'ombre
      const I = Math.pow(1 - d / R, 1.5) * 1.5;
      const i = cy * W + cx; lr[i] += I * cr; lg[i] += I * cg; lb[i] += I * cb;
    }
  }
  return { lr, lg, lb, W, H };
}

// --- Sprites procéduraux ----------------------------------------------------
const SPRITE_PPM = 54; // pixels par mètre
function drawHumanoid(c, type, pose, opts) {
  // Repère 48x96, 1 m = 54 px ; pieds en y=96, tête en haut
  const color = opts.color, hair = opts.hair, skin = '#cfa887';
  const back = pose === 'back';
  // jambes
  c.fillStyle = '#1a1a20'; c.fillRect(13, 58, 10, 38); c.fillRect(25, 58, 10, 38);
  c.fillStyle = '#0d0d10'; c.fillRect(12, 92, 12, 4); c.fillRect(24, 92, 12, 4);
  // torse
  c.fillStyle = color; c.beginPath(); c.moveTo(8, 34); c.lineTo(40, 34); c.lineTo(38, 62); c.lineTo(10, 62); c.closePath(); c.fill();
  if (opts.vest) { c.fillStyle = opts.heavy ? 'rgba(120,130,120,0.9)' : 'rgba(70,75,80,0.8)'; c.fillRect(14, 37, 20, 22); if (opts.heavy) { c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1; c.strokeRect(14.5, 37.5, 19, 21); } }
  if (opts.isPlayerLike) { c.fillStyle = '#e9e6de'; c.fillRect(21, 34, 6, 10); }
  // bras
  c.strokeStyle = color; c.lineWidth = 6; c.lineCap = 'round';
  if (!back && opts.gun) {
    c.beginPath(); c.moveTo(11, 38); c.lineTo(22, 50); c.moveTo(37, 38); c.lineTo(26, 50); c.stroke();
    c.fillStyle = skin; c.beginPath(); c.arc(22, 51, 3.5, 0, TAU); c.arc(26, 51, 3.5, 0, TAU); c.fill();
    c.fillStyle = '#17171b'; c.fillRect(20, 44, 8, 7); c.fillStyle = '#000'; c.beginPath(); c.arc(24, 47, 2.2, 0, TAU); c.fill();
  } else if (!back && opts.knife) {
    c.beginPath(); c.moveTo(11, 38); c.lineTo(6, 58); c.moveTo(37, 38); c.lineTo(42, 52); c.stroke();
    c.fillStyle = skin; c.beginPath(); c.arc(6, 59, 3.5, 0, TAU); c.arc(42, 53, 3.5, 0, TAU); c.fill();
    c.fillStyle = '#d5d9e0'; c.fillRect(41, 40, 3, 12);
  } else {
    c.beginPath(); c.moveTo(11, 38); c.lineTo(8, 60); c.moveTo(37, 38); c.lineTo(40, 60); c.stroke();
    c.fillStyle = skin; c.beginPath(); c.arc(8, 61, 3.5, 0, TAU); c.arc(40, 61, 3.5, 0, TAU); c.fill();
  }
  // tête
  c.fillStyle = skin; c.beginPath(); c.arc(24, 20, 9, 0, TAU); c.fill();
  c.fillStyle = hair; if (back) { c.beginPath(); c.arc(24, 20, 9, 0, TAU); c.fill(); } else { c.beginPath(); c.arc(24, 17, 9, Math.PI, TAU); c.fill(); }
  if (!back) { c.fillStyle = '#2a1e16'; c.fillRect(19, 19, 3, 2); c.fillRect(26, 19, 3, 2); if (opts.beard) { c.fillStyle = '#2b241c'; c.beginPath(); c.arc(24, 24, 6, 0.2, Math.PI - 0.2); c.fill(); } }
  c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(20, 28, 8, 6); // cou
  if (opts.helmet) { c.fillStyle = '#3a3f3c'; c.beginPath(); c.arc(24, 18, 11, Math.PI, TAU); c.fill(); c.fillRect(13, 18, 22, 5); c.fillStyle = 'rgba(255,255,255,0.15)'; c.beginPath(); c.arc(21, 13, 4, 0, TAU); c.fill(); }
}
function makeEnemySprite(e, pose) {
  const opts = { color: e.color, hair: e.hair, vest: !!e.armor, heavy: !!(e.armor && e.armor.max >= 200), helmet: !!(e.helmet && e.helmet.hp > 0), gun: e.hasFirearm, knife: e.weapon && e.weapon.def.type === 'melee' };
  if (pose === 'down' || pose === 'dead') {
    const cv = mkCanvas(96, 48), c = cv.getContext('2d');
    c.translate(48, 24); c.rotate(-HALF_PI); c.translate(-24, -48);
    drawHumanoid(c, e.type, 'front', opts);
    if (pose === 'dead') { c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-atop'; c.fillStyle = 'rgba(20,0,0,0.35)'; c.fillRect(0, 0, 96, 48); }
    return canvasToU32(cv);
  }
  const cv = mkCanvas(48, 96), c = cv.getContext('2d');
  drawHumanoid(c, e.type, pose, opts);
  return canvasToU32(cv);
}
function makeMiscSprite(kind, label) {
  let cv, c;
  switch (kind) {
    case 'weapon': cv = mkCanvas(32, 16); c = cv.getContext('2d'); c.fillStyle = '#26262c'; c.fillRect(2, 4, 26, 5); c.fillRect(6, 8, 5, 7); c.fillStyle = '#44444c'; c.fillRect(24, 4, 4, 5); break;
    case 'health': cv = mkCanvas(24, 16); c = cv.getContext('2d'); c.fillStyle = '#e8e8e8'; c.fillRect(1, 2, 22, 13); c.fillStyle = '#c62828'; c.fillRect(10, 4, 4, 9); c.fillRect(7, 6.5, 10, 4); break;
    case 'plate': cv = mkCanvas(20, 24); c = cv.getContext('2d'); c.fillStyle = '#4a4f52'; c.fillRect(2, 1, 16, 22); c.fillStyle = '#6a7074'; c.fillRect(5, 4, 10, 16); break;
    case 'ammo': cv = mkCanvas(24, 16); c = cv.getContext('2d'); c.fillStyle = '#3b3a2c'; c.fillRect(1, 2, 22, 13); c.fillStyle = '#c9a44b'; c.fillRect(4, 5, 4, 8); c.fillRect(10, 5, 4, 8); c.fillRect(16, 5, 4, 8); break;
    case 'dot': cv = mkCanvas(8, 8); c = cv.getContext('2d'); { const g = c.createRadialGradient(4, 4, 0, 4, 4, 4); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 8, 8); } break;
    case 'flash': cv = mkCanvas(24, 24); c = cv.getContext('2d'); { const g = c.createRadialGradient(12, 12, 0, 12, 12, 12); g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(0.35, 'rgba(255,200,90,0.9)'); g.addColorStop(1, 'rgba(255,120,0,0)'); c.fillStyle = g; c.fillRect(0, 0, 24, 24); } break;
    case 'text': cv = mkCanvas(128, 32); c = cv.getContext('2d'); c.fillStyle = 'rgba(0,40,20,0.7)'; c.fillRect(0, 0, 128, 32); c.font = 'bold 22px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#6dff9a'; c.fillText(label || 'SORTIE', 64, 16); c.strokeStyle = '#6dff9a'; c.lineWidth = 2; c.strokeRect(1, 1, 126, 30); break;
    case 'thrown': cv = mkCanvas(24, 12); c = cv.getContext('2d'); c.fillStyle = '#1a1a1e'; c.fillRect(0, 3, 24, 6); c.fillRect(5, 7, 5, 5); break;
  }
  return canvasToU32(cv);
}

class FPRenderer {
  constructor(renderer) {
    this.r = renderer; this.W = 0; this.H = 0; this.buf = null; this.pix = null; this.zbuf = null; this.lowZ = null; this.lowTop = null;
    this.off = mkCanvas(2, 2); this.octx = this.off.getContext('2d');
    this.textures = null; this.world = null; this.lightmap = null; this.decal = null; this.decalCount = -1; this.decalT = 0;
    this.spriteCache = new Map(); this.misc = {};
    this.quality = Store.get('fpRes', 640);
    this.sprites = []; this.fov = FP.HFOV; this.focalScreen = 400;
    this.setup();
    window.addEventListener('resize', () => this.setup());
  }
  setQuality(q) { this.quality = q; Store.set('fpRes', q); this.setup(); }
  setup() {
    const W = this.quality; const aspect = Math.max(1, this.r.w / Math.max(1, this.r.h)); const H = Math.max(180, Math.round(W / aspect));
    this.W = W; this.H = H; this.off.width = W; this.off.height = H;
    this.buf = this.octx.createImageData(W, H); this.pix = new Uint32Array(this.buf.data.buffer);
    this.zbuf = new Float32Array(W); this.lowZ = new Float32Array(W); this.lowTop = new Int16Array(W);
    this.hitD = new Float32Array(12); this.hitT = new Uint8Array(12); this.hitX = new Uint8Array(12); this.hitS = new Uint8Array(12); this.hitPx = new Float32Array(12); this.hitPy = new Float32Array(12);
  }
  setWorld(world) {
    this.world = world; this.textures = makeFPTextures(world.level.palette || {});
    this.lightmap = buildLightmap(world); this.decal = null; this.decalCount = -1; this.spriteCache.clear();
    for (const k of ['weapon', 'health', 'plate', 'ammo', 'dot', 'flash', 'text', 'thrown']) this.misc[k] = makeMiscSprite(k);
    this.exits = []; for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) if (world.get(x, y) === T.EXIT) this.exits.push({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
  }
  enemySprite(e, facingAway) {
    const pose = e.dead ? 'dead' : e.downed > 0 ? 'down' : facingAway ? 'back' : 'front';
    const key = e.typeId + ':' + pose + ':' + (e.helmet && e.helmet.hp > 0 ? 'h' : '') + (e.hasFirearm ? 'g' : e.weapon ? 'k' : 'n');
    let s = this.spriteCache.get(key); if (!s) { s = makeEnemySprite(e, pose); this.spriteCache.set(key, s); }
    return s;
  }
  refreshDecals(game) {
    const w = this.world;
    if (w.decalCount !== this.decalCount && game.time - this.decalT > 0.3) {
      this.decalT = game.time; this.decalCount = w.decalCount;
      const d = w.dctx.getImageData(0, 0, w.decals.width, w.decals.height);
      this.decal = new Uint32Array(d.data.buffer); this.decalW = w.decals.width; this.decalH = w.decals.height;
    }
  }
  // ------------------------------------------------------------------------
  render(game) {
    const p = game.player, world = game.world; if (!world || !p) return;
    if (this.world !== world) this.setWorld(world);
    this.refreshDecals(game);
    const W = this.W, H = this.H, pix = this.pix, zbuf = this.zbuf, lowZ = this.lowZ, lowTop = this.lowTop;
    const tiles = world.tiles, mw = world.w, mh = world.h;
    const targetFov = p.aiming ? FP.ADS_FOV : FP.HFOV;
    this.fov += (targetFov - this.fov) * 0.25;
    const tanH = Math.tan(rad(this.fov) / 2);
    const focal = (W / 2) / tanH; this.focalScreen = focal * (this.r.w / W);
    const posX = p.x / TILE, posY = p.y / TILE;
    const dirX = Math.cos(p.angle), dirY = Math.sin(p.angle);
    const planeX = -dirY * tanH, planeY = dirX * tanH;
    const pitch = p.pitch || 0;
    let bobY = p.moving > 0 && p.dodgeT <= 0 ? Math.sin(game.time * (p.sprinting ? 13 : 8.5)) * (p.sprinting ? 5 : 2.5) * p.moving * (H / 360) : 0;
    if (p.dodgeT > 0) bobY += 10 * (H / 360);
    const horizon = H / 2 + Math.tan(pitch) * focal + bobY;
    const lm = this.lightmap, LM = FP.LM, LW = lm.W, lr = lm.lr, lg = lm.lg, lb = lm.lb;
    let flash = 0; for (const f of game.flashes) if (f.owner === p || (Math.hypot(f.x - p.x, f.y - p.y) < 2 * TILE)) flash = Math.max(flash, f.t / f.max);
    const hurt = p.hurtFlash > 0 ? 0.35 : 0;
    const maxD = FP.MAX_DIST;
    const tex = this.textures; const floorTex = tex.floor; const ceilTex = tex.ceiling;
    const decal = this.decal, decalW = this.decalW || 0;
    const eye = FP.EYE_H;
    // ---- Sol et plafond
    const hz = Math.round(horizon);
    for (let y = 0; y < H; y++) {
      const isFloor = y > hz;
      const dy = isFloor ? (y - horizon) : (horizon - y);
      if (dy < 0.5) { const row = y * W; for (let x = 0; x < W; x++) pix[row + x] = 0xff000000; continue; }
      const rowDist = (isFloor ? eye : (FP.WALL_H - eye)) * focal / dy;
      if (rowDist > maxD * 1.5) { const row = y * W; for (let x = 0; x < W; x++) pix[row + x] = 0xff030305; continue; }
      const fog = clamp(1.1 - rowDist / maxD, 0, 1) * clamp(1.1 - rowDist / maxD, 0, 1);
      const pl = 0.35 * Math.max(0, 1 - rowDist / 4.5) + flash * 0.9 * Math.max(0, 1 - rowDist / 8);
      let fx = posX + rowDist * (dirX - planeX), fy = posY + rowDist * (dirY - planeY);
      const stepX = rowDist * 2 * planeX / W, stepY = rowDist * 2 * planeY / W;
      let idx = y * W;
      const t2 = isFloor ? floorTex : null;
      for (let x = 0; x < W; x++, idx++, fx += stepX, fy += stepY) {
        const tx = fx | 0, ty = fy | 0;
        if (fx < 0 || fy < 0 || tx >= mw || ty >= mh) { pix[idx] = 0xff000000; continue; }
        let c;
        if (isFloor) {
          const t = tiles[ty * mw + tx]; const tt = t2[t] || t2[T.FLOOR];
          c = tt.data[(((fy - ty) * 32) | 0) * 32 + (((fx - tx) * 32) | 0)];
          if (decal) { const dp = decal[((fy * 32) | 0) * decalW + ((fx * 32) | 0)]; const a = dp >>> 24; if (a > 20) { const k = a / 255; c = packRGB(((c & 255) * (1 - k) + (dp & 255) * k) | 0, (((c >> 8) & 255) * (1 - k) + ((dp >> 8) & 255) * k) | 0, (((c >> 16) & 255) * (1 - k) + ((dp >> 16) & 255) * k) | 0); } }
        } else c = ceilTex.data[(((fy - ty) * 32) | 0) * 32 + (((fx - tx) * 32) | 0)];
        const li = ((fy * LM) | 0) * LW + ((fx * LM) | 0);
        const br = (lr[li] + pl) * fog, bg = (lg[li] + pl) * fog * (1 - hurt * 0.5), bb = (lb[li] + pl) * fog * (1 - hurt * 0.5);
        pix[idx] = (0xff000000 | (Math.min(255, ((c >> 16) & 255) * bb) << 16) | (Math.min(255, ((c >> 8) & 255) * bg) << 8) | Math.min(255, (c & 255) * br)) >>> 0;
      }
    }
    // ---- Murs (DDA par colonne, plusieurs impacts : vitres et couverts bas)
    const hitD = this.hitD, hitT = this.hitT, hitX = this.hitX, hitS = this.hitS, hitPx = this.hitPx, hitPy = this.hitPy;
    for (let x = 0; x < W; x++) {
      const camX = 2 * x / W - 1;
      const rdx = dirX + planeX * camX, rdy = dirY + planeY * camX;
      let mapX = posX | 0, mapY = posY | 0;
      const dDX = rdx === 0 ? 1e30 : Math.abs(1 / rdx), dDY = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
      let stepX, stepY, sdX, sdY;
      if (rdx < 0) { stepX = -1; sdX = (posX - mapX) * dDX; } else { stepX = 1; sdX = (mapX + 1 - posX) * dDX; }
      if (rdy < 0) { stepY = -1; sdY = (posY - mapY) * dDY; } else { stepY = 1; sdY = (mapY + 1 - posY) * dDY; }
      let n = 0, side = 0, dist = 0; zbuf[x] = 1e9; lowZ[x] = 1e9; lowTop[x] = H;
      for (let it = 0; it < 96; it++) {
        if (sdX < sdY) { sdX += dDX; mapX += stepX; side = 0; dist = sdX - dDX; } else { sdY += dDY; mapY += stepY; side = 1; dist = sdY - dDY; }
        if (dist > maxD) break;
        let t = (mapX < 0 || mapY < 0 || mapX >= mw || mapY >= mh) ? T.WALL : tiles[mapY * mw + mapX];
        if (t === T.DOOR && world.door(mapX, mapY).open) continue;
        if (t === T.WALL || t === T.PILLAR || t === T.DOOR || t === T.COVER || t === T.CAR || t === T.GLASS) {
          if (n < 12) {
            let wx = side === 0 ? posY + dist * rdy : posX + dist * rdx; wx -= Math.floor(wx);
            let txx = (wx * 64) | 0; if ((side === 0 && rdx > 0) || (side === 1 && rdy < 0)) txx = 63 - txx;
            hitD[n] = dist; hitT[n] = t; hitX[n] = txx; hitS[n] = side; hitPx[n] = posX + dist * rdx; hitPy[n] = posY + dist * rdy; n++;
          }
          if (t === T.WALL || t === T.PILLAR || t === T.DOOR) { zbuf[x] = dist; break; }
        }
      }
      // rendu du plus loin au plus proche
      for (let i = n - 1; i >= 0; i--) {
        const d = hitD[i], t = hitT[i];
        const hTop = t === T.COVER ? FP.COVER_H : t === T.CAR ? FP.CAR_H : FP.WALL_H;
        const scale = focal / d;
        const yTop = horizon - (hTop - eye) * scale, yBot = horizon + eye * scale;
        const y0 = Math.max(0, yTop | 0), y1 = Math.min(H - 1, yBot | 0);
        if (y1 < y0) continue;
        const tt = t === T.WALL ? tex.wall : t === T.PILLAR ? tex.pillar : t === T.DOOR ? tex.door : t === T.COVER ? tex.cover : t === T.CAR ? tex.car : tex.glass;
        // lumière au point d'impact (côté observateur)
        const sx = hitPx[i] - rdx * 0.08, sy = hitPy[i] - rdy * 0.08;
        const li = clamp((sy * LM) | 0, 0, lm.H - 1) * LW + clamp((sx * LM) | 0, 0, LW - 1);
        const fog = clamp(1.1 - d / maxD, 0, 1); const f2 = fog * fog * (hitS[i] === 1 ? 0.78 : 1);
        const pl = 0.35 * Math.max(0, 1 - d / 4.5) + flash * 0.9 * Math.max(0, 1 - d / 8);
        const br = (lr[li] + pl) * f2, bg = (lg[li] + pl) * f2 * (1 - hurt * 0.5), bb = (lb[li] + pl) * f2 * (1 - hurt * 0.5);
        const txx = hitX[i]; const span = yBot - yTop; const texScale = 64 / span;
        const glass = t === T.GLASS;
        if (t === T.COVER || t === T.CAR) { if (d < lowZ[x]) { lowZ[x] = d; lowTop[x] = y0; } }
        let idx = y0 * W + x;
        for (let y = y0; y <= y1; y++, idx += W) {
          let ty = ((y - yTop) * texScale) | 0; if (ty > 63) ty = 63; else if (ty < 0) ty = 0;
          const c = tt.data[ty * 64 + txx];
          if (glass) {
            const a = (c >>> 24) / 255; if (a < 0.02) continue;
            const o = pix[idx];
            const r = (o & 255) * (1 - a) + (c & 255) * a * br, g = ((o >> 8) & 255) * (1 - a) + ((c >> 8) & 255) * a * bg, b = ((o >> 16) & 255) * (1 - a) + ((c >> 16) & 255) * a * bb;
            pix[idx] = (0xff000000 | (Math.min(255, b) << 16) | (Math.min(255, g) << 8) | Math.min(255, r)) >>> 0;
          } else {
            pix[idx] = (0xff000000 | (Math.min(255, ((c >> 16) & 255) * bb) << 16) | (Math.min(255, ((c >> 8) & 255) * bg) << 8) | Math.min(255, (c & 255) * br)) >>> 0;
          }
        }
      }
    }
    // ---- Sprites
    const sprites = this.sprites; sprites.length = 0;
    const invDet = 1 / (planeX * dirY - dirX * planeY);
    const push = (wx, wy, z0, h, w, img, opts) => {
      const dx = wx / TILE - posX, dy = wy / TILE - posY;
      const depth = invDet * (-planeY * dx + planeX * dy);
      if (depth < 0.12 || depth > maxD) return;
      const tX = invDet * (dirY * dx - dirX * dy);
      const sxp = (W / 2) * (1 + tX / depth);
      sprites.push({ depth, sx: sxp, z0, h, w, img, tint: opts && opts.tint, alpha: opts && opts.alpha, add: opts && opts.add, lx: wx / TILE, ly: wy / TILE });
    };
    for (const e of game.enemies) {
      const away = !e.dead && e.downed <= 0 && Math.abs(angleDiff(e.angle, angleTo(e.x, e.y, p.x, p.y))) > rad(100);
      const img = this.enemySprite(e, away);
      if (e.dead || e.downed > 0) push(e.x, e.y, 0, 0.42, 1.85, img, { tint: e.hurtFlash > 0 ? 1 : 0 });
      else push(e.x, e.y, 0, 1.8, 0.9, img, { tint: e.hurtFlash > 0 ? 1 : 0 });
    }
    for (const pk of game.pickups) if (!pk.dead) push(pk.x, pk.y, 0.02, pk.kind === 'plate' ? 0.32 : 0.22, pk.kind === 'weapon' ? 0.55 : 0.34, this.misc[pk.kind]);
    for (const th of game.thrown) push(th.x, th.y, 1.1 + Math.sin(th.life * 8) * 0.2, 0.18, 0.4, this.misc.thrown);
    for (const f of game.flashes) if (f.owner !== p) push(f.x, f.y, 1.25, 0.45 * (f.t / f.max + 0.5), 0.45 * (f.t / f.max + 0.5), this.misc.flash, { add: true });
    for (const b of game.bullets) if (b.owner !== p) push(b.x, b.y, 1.35, 0.1, 0.1, this.misc.dot, { add: true });
    for (const pt of game.particles) { if (pt.kind === 'smoke') continue; const zb = pt.kind === 'blood' ? 1.15 : pt.kind === 'glass' ? 1.3 : 1.0; push(pt.x, pt.y, zb + (pt.maxLife - pt.life) * (pt.kind === 'blood' ? -0.8 : 0.2), 0.07, 0.07, this.misc.dot, { tint: pt.kind === 'blood' ? 2 : pt.kind === 'spark' ? 3 : 4, alpha: pt.life / pt.maxLife }); }
    for (const ex of this.exits) push(ex.x, ex.y, 2.05, 0.32, 1.25, this.misc.text, { add: true });
    sprites.sort((a, b) => b.depth - a.depth);
    for (const s of sprites) {
      const scale = focal / s.depth;
      const wPx = s.w * scale, hPx = s.h * scale;
      const yBot = horizon + (eye - s.z0) * scale, yTop = yBot - hPx;
      const xL = s.sx - wPx / 2;
      const x0 = Math.max(0, xL | 0), x1 = Math.min(W - 1, (s.sx + wPx / 2) | 0);
      const y0 = Math.max(0, yTop | 0), y1 = Math.min(H - 1, yBot | 0);
      if (x1 < x0 || y1 < y0) continue;
      const img = s.img, iw = img.w, ih = img.h, data = img.data;
      const li = clamp((s.ly * LM) | 0, 0, lm.H - 1) * LW + clamp((s.lx * LM) | 0, 0, LW - 1);
      const fog = clamp(1.1 - s.depth / maxD, 0, 1); const f2 = fog * fog;
      const pl = 0.35 * Math.max(0, 1 - s.depth / 4.5) + flash * 0.9 * Math.max(0, 1 - s.depth / 8);
      let br = (lr[li] + pl) * f2, bg = (lg[li] + pl) * f2, bb = (lb[li] + pl) * f2;
      if (s.add) { br = bg = bb = 1; }
      if (s.tint === 1) { br = br * 1.6 + 0.4; bg *= 0.5; bb *= 0.5; }
      else if (s.tint === 2) { br = 0.75; bg = 0.05; bb = 0.08; } else if (s.tint === 3) { br = 1; bg = 0.85; bb = 0.45; } else if (s.tint === 4) { br = 0.8; bg = 0.95; bb = 1; }
      const alpha = s.alpha != null ? s.alpha : 1;
      const uScale = iw / wPx, vScale = ih / hPx;
      for (let x = x0; x <= x1; x++) {
        if (s.depth >= zbuf[x]) continue;
        const hidden = lowZ[x] < s.depth ? lowTop[x] : H;
        const u = ((x - xL) * uScale) | 0; if (u < 0 || u >= iw) continue;
        let idx = y0 * W + x;
        for (let y = y0; y <= y1; y++, idx += W) {
          if (y >= hidden) break;
          const v = ((y - yTop) * vScale) | 0; if (v < 0 || v >= ih) continue;
          const c = data[v * iw + u]; const a = (c >>> 24) * alpha / 255; if (a < 0.08) continue;
          const o = pix[idx];
          const r = (c & 255) * br, g = ((c >> 8) & 255) * bg, b = ((c >> 16) & 255) * bb;
          if (a >= 0.98) pix[idx] = (0xff000000 | (Math.min(255, b) << 16) | (Math.min(255, g) << 8) | Math.min(255, r)) >>> 0;
          else pix[idx] = (0xff000000 | (Math.min(255, ((o >> 16) & 255) * (1 - a) + b * a) << 16) | (Math.min(255, ((o >> 8) & 255) * (1 - a) + g * a) << 8) | Math.min(255, (o & 255) * (1 - a) + r * a)) >>> 0;
        }
      }
    }
    // ---- Composition à l'écran
    this.octx.putImageData(this.buf, 0, 0);
    const ctx = this.r.ctx, sw = this.r.w, sh = this.r.h;
    ctx.setTransform(this.r.dpr, 0, 0, this.r.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.off, 0, 0, sw, sh);
    this.drawViewModel(ctx, game, sw, sh);
    this.r.renderHUD(game);
    this.drawMinimap(ctx, game, sw, sh);
  }
  // ------------------------------------------------------------------------
  // Modèle d'arme en vue subjective
  // ------------------------------------------------------------------------
  drawViewModel(ctx, game, w, h) {
    const p = game.player; if (!p || p.dead) return;
    const wpn = p.weapon; const t = game.time; const s = h / 720;
    const mv = p.moving > 0 && p.dodgeT <= 0 ? p.moving : 0;
    const bob = Math.sin(t * (p.sprinting ? 13 : 8.5)) * (p.sprinting ? 14 : 6) * mv;
    const bobX = Math.cos(t * (p.sprinting ? 6.5 : 4.25)) * 6 * mv;
    let ox = w * (p.aiming ? 0.5 : 0.6) + bobX * s, oy = h + bob * s;
    const rec = wpn ? (wpn.recoil || 0) : 0; oy += rec * 5 * s; ox += rec * 1.2 * s;
    if (wpn && wpn.reloading) oy += Math.sin(wpn.reloadT / wpn.reloadDur * Math.PI) * 170 * s;
    if (p.sprinting) { oy += 110 * s; ox += 50 * s; }
    if (p.swapT > 0) oy += p.swapT * 400 * s;
    if (p.executing > 0) oy += 30 * s;
    if (p.dodgeT > 0) oy += 60 * s;
    const skin = '#d6b08f', dark = '#17171b', mid = '#2b2b33', cuff = '#0c0c10';
    ctx.save();
    // Soins : mains + bandage
    if (p.healing > 0) {
      ctx.translate(w * 0.5, h); ctx.scale(s, s);
      ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(-90 + Math.sin(t * 6) * 10, -140, 46, 60, 0.3, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(90 - Math.sin(t * 6) * 10, -150, 46, 60, -0.3, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e8e8e8'; ctx.fillRect(-40, -175, 80, 30);
      ctx.restore(); return;
    }
    // Mêlée : poing gauche
    if (p.meleeAnim > 0 || (wpn && wpn.def.type === 'melee')) {
      const k = p.meleeAnim > 0 ? Math.sin((p.meleeAnim / 0.22) * Math.PI) : 0;
      ctx.save(); ctx.translate(w * 0.32 + k * w * 0.16, h + 40 * s - k * 220 * s); ctx.scale(s, s);
      ctx.fillStyle = cuff; ctx.fillRect(-46, -60, 92, 140);
      ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(0, -90, 44 + k * 10, 50, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = -1; i <= 1; i++) ctx.fillRect(-30 + i * 22, -125, 3, 30);
      ctx.restore();
      if (wpn && wpn.def.type === 'melee') {
        // Couteau : main droite avec la lame
        ctx.translate(ox + 40 * s, oy); ctx.scale(s, s);
        ctx.fillStyle = cuff; ctx.fillRect(-46, -40, 92, 140);
        ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(0, -80, 44, 52, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#2a2a2e'; ctx.fillRect(-10, -130, 20, 50);
        ctx.fillStyle = '#d5d9e0'; ctx.beginPath(); ctx.moveTo(-10, -130); ctx.lineTo(10, -130); ctx.lineTo(4, -300 - k * 40); ctx.lineTo(-6, -260 - k * 40); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(-2, -280 - k * 40, 3, 130);
        ctx.restore(); return;
      }
      if (!wpn) { ctx.restore(); return; }
    }
    ctx.translate(ox, oy); ctx.scale(s, s);
    const type = wpn.def.type;
    const flash = game.flashes.find(f => f.owner === p);
    if (type === 'pistol') {
      // bras / mains
      ctx.fillStyle = cuff; ctx.fillRect(-60, -70, 120, 200);
      ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(-22, -120, 40, 56, 0.25, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.ellipse(26, -128, 40, 56, -0.2, 0, TAU); ctx.fill();
      // crosse + culasse
      ctx.fillStyle = dark; ctx.fillRect(-16, -190, 32, 80);
      ctx.fillStyle = mid; ctx.beginPath(); ctx.moveTo(-26, -300); ctx.lineTo(26, -300); ctx.lineTo(26, -190); ctx.lineTo(-26, -190); ctx.closePath(); ctx.fill();
      ctx.fillStyle = dark; ctx.fillRect(-26, -215, 52, 8);
      if (wpn.mag + wpn.chamber === 0 && !wpn.reloading) { ctx.fillStyle = '#3a3a44'; ctx.fillRect(-26, -300, 52, 22); } // culasse ouverte
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, -298, 9, 0, TAU); ctx.fill();
      // organes de visée
      ctx.fillStyle = '#e8e8e8'; ctx.fillRect(-2, -318, 4, 8); ctx.fillRect(-16, -300, 4, 6); ctx.fillRect(12, -300, 4, 6);
      if (flash) this.muzzle(ctx, 0, -330, 90 * (flash.t / flash.max));
    } else if (type === 'shotgun') {
      ctx.fillStyle = cuff; ctx.fillRect(-70, -90, 140, 220);
      ctx.fillStyle = mid; ctx.fillRect(-60, -230, 120, 140); // crosse / carcasse
      ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(-22, -420); ctx.lineTo(22, -420); ctx.lineTo(34, -200); ctx.lineTo(-34, -200); ctx.closePath(); ctx.fill(); // canon
      ctx.fillStyle = '#3a3a44'; ctx.fillRect(-30, -330, 60, 50); // pompe / garde-main
      ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(-4, -310 + (wpn.reloading ? Math.sin(wpn.reloadT / wpn.reloadDur * TAU) * 20 : 0), 38, 46, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(30, -140, 40, 56, -0.3, 0, TAU); ctx.fill();
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, -418, 12, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e8e8e8'; ctx.fillRect(-2, -436, 4, 8);
      if (flash) this.muzzle(ctx, 0, -440, 130 * (flash.t / flash.max));
    } else { // rifle / smg
      const len = type === 'rifle' ? 470 : 380;
      ctx.fillStyle = cuff; ctx.fillRect(-70, -90, 140, 220);
      ctx.fillStyle = mid; ctx.fillRect(-46, -240, 92, 150);
      ctx.fillStyle = dark; ctx.fillRect(-14, -220, 28, 90); // chargeur
      ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(-14, -len); ctx.lineTo(14, -len); ctx.lineTo(26, -220); ctx.lineTo(-26, -220); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3a3a44'; ctx.fillRect(-24, -len + 90, 48, 110); // garde-main
      ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(-2, -len + 150, 36, 46, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(30, -150, 40, 56, -0.3, 0, TAU); ctx.fill();
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, -len + 2, 8, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e8e8e8'; ctx.fillRect(-2, -len - 14, 4, 8); ctx.fillRect(-12, -250, 3, 10); ctx.fillRect(9, -250, 3, 10);
      if (flash) this.muzzle(ctx, 0, -len - 20, 110 * (flash.t / flash.max));
    }
    ctx.restore();
  }
  muzzle(ctx, x, y, r) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,250,220,0.95)'); g.addColorStop(0.3, 'rgba(255,190,80,0.8)'); g.addColorStop(1, 'rgba(255,120,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  // ------------------------------------------------------------------------
  drawMinimap(ctx, game, w, h) {
    const p = game.player, world = game.world; const size = 150, sc = 5; // px par tuile
    const mx = w - 28 - size, my = 48;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(mx - 2, my - 2, size + 4, size + 4);
    ctx.beginPath(); ctx.rect(mx, my, size, size); ctx.clip();
    const tilesSpan = size / sc; const srcW = tilesSpan * TILE;
    const sx = p.x - srcW / 2, sy = p.y - srcW / 2;
    ctx.globalAlpha = 0.85;
    ctx.drawImage(world.static, sx, sy, srcW, srcW, mx, my, size, size);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(mx, my, size, size);
    for (const e of game.enemies) {
      if (e.dead || !e.visible) continue;
      const ex = mx + (e.x - sx) / TILE * sc, ey = my + (e.y - sy) / TILE * sc;
      ctx.fillStyle = '#ff4040'; ctx.beginPath(); ctx.arc(ex, ey, 3, 0, TAU); ctx.fill();
    }
    ctx.translate(mx + size / 2, my + size / 2); ctx.rotate(p.angle);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 60, -rad(this.fov / 2), rad(this.fov / 2)); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.strokeRect(mx - 0.5, my - 0.5, size + 1, size + 1);
  }
}
