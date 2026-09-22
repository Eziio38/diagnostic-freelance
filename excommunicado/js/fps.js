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

// --- Sprites procéduraux : rig de personnage (face / dos / profil), poses et cycle de marche ---
const SPRITE_PPM = 54; // pixels par mètre
const SPRITE_W = 64, SPRITE_H = 96;
// pose : { legs:-1..1, crouch:0..1, lean:-1..1, arms:'hang'|'aim'|'fire'|'reload'|'raise'|'strike'|'out'|'grab'|'kneel', headDown:0..1 }
function drawRig(c, o, pose) {
  const skin = '#cfa887', color = o.color, hair = o.hair;
  const view = o.view; // 'front' | 'back' | 'side'
  const cr = pose.crouch || 0, legs = pose.legs || 0, lean = pose.lean || 0;
  const cx = 32, ground = 96;
  const legLen = 38 * (1 - 0.35 * cr), hipY = ground - legLen, torsoH = 28, torsoTop = hipY - torsoH;
  const headY = torsoTop - 14 + (pose.headDown || 0) * 4;
  c.lineCap = 'round';
  if (view === 'side') {
    // Jambes en ciseaux
    c.strokeStyle = '#1a1a20'; c.lineWidth = 9;
    c.beginPath(); c.moveTo(cx, hipY); c.lineTo(cx - legs * 11, ground - 2); c.stroke();
    c.beginPath(); c.moveTo(cx, hipY); c.lineTo(cx + legs * 11, ground - 2); c.stroke();
    c.fillStyle = '#0d0d10'; c.fillRect(cx + legs * 11 - 4, ground - 4, 12, 4); c.fillRect(cx - legs * 11 - 8, ground - 4, 12, 4);
    // Torse (profil, plus étroit) avec inclinaison
    const tl = lean * 10;
    c.fillStyle = color; c.beginPath(); c.moveTo(cx - 8 + tl, torsoTop); c.lineTo(cx + 8 + tl, torsoTop); c.lineTo(cx + 9, hipY); c.lineTo(cx - 9, hipY); c.closePath(); c.fill();
    if (o.vest) { c.fillStyle = o.heavy ? 'rgba(120,130,120,0.9)' : 'rgba(70,75,80,0.8)'; c.fillRect(cx - 6 + tl * 0.6, torsoTop + 3, 12, 20); }
    // Bras (un seul visible) selon la pose
    c.strokeStyle = color; c.lineWidth = 6;
    const sh = { x: cx + tl, y: torsoTop + 4 };
    let hand = { x: cx + 4, y: hipY - 4 };
    const A = pose.arms;
    if (A === 'aim' || A === 'fire') hand = { x: cx + 22, y: torsoTop + 9 - (A === 'fire' ? 3 : 0) };
    else if (A === 'reload') hand = { x: cx + 6, y: torsoTop + 16 };
    else if (A === 'raise') hand = { x: cx + 10, y: torsoTop - 16 };
    else if (A === 'strike') hand = { x: cx + 26, y: torsoTop + 6 };
    else if (A === 'out') hand = { x: cx - 10, y: torsoTop - 6 };
    else if (A === 'grab') hand = { x: cx + 18, y: torsoTop + 2 };
    else if (A === 'kneel') hand = { x: cx + 6, y: hipY + 4 };
    c.beginPath(); c.moveTo(sh.x, sh.y); c.lineTo(hand.x, hand.y); c.stroke();
    c.fillStyle = skin; c.beginPath(); c.arc(hand.x, hand.y, A === 'strike' ? 5 : 3.5, 0, TAU); c.fill();
    if (o.gun && (A === 'aim' || A === 'fire')) { c.fillStyle = '#17171b'; c.fillRect(hand.x - 2, hand.y - 3, o.long ? 22 : 12, 5); if (o.long) c.fillRect(hand.x - 12, hand.y - 2, 12, 4); }
    else if (o.gun && A !== 'reload') { c.fillStyle = '#17171b'; c.fillRect(hand.x - 2, hand.y - 2, 5, o.long ? 18 : 10); }
    if (o.gun && A === 'reload') { c.save(); c.translate(hand.x, hand.y); c.rotate(-0.6); c.fillStyle = '#17171b'; c.fillRect(-2, -3, o.long ? 20 : 12, 5); c.restore(); }
    if (o.knife && A !== 'hang') { c.save(); c.translate(hand.x, hand.y); c.rotate(A === 'raise' ? -1.2 : 0); c.fillStyle = '#d5d9e0'; c.fillRect(0, -1.5, 13, 3); c.restore(); }
    // Tête de profil
    c.fillStyle = skin; c.beginPath(); c.arc(cx + 2 + tl, headY, 9, 0, TAU); c.fill();
    c.fillStyle = hair; c.beginPath(); c.arc(cx - 1 + tl, headY - 1, 9, Math.PI * 0.6, Math.PI * 1.75); c.lineTo(cx - 1 + tl, headY - 1); c.closePath(); c.fill();
    c.fillStyle = '#2a1e16'; c.fillRect(cx + 7 + tl, headY - 2, 2, 2);
    if (o.beard) { c.fillStyle = '#2b241c'; c.fillRect(cx + 4 + tl, headY + 3, 6, 4); }
    if (o.helmet) { c.fillStyle = '#3a3f3c'; c.beginPath(); c.arc(cx + 1 + tl, headY - 2, 11, Math.PI, TAU); c.fill(); c.fillRect(cx - 10 + tl, headY - 2, 22, 5); }
    return;
  }
  const back = view === 'back';
  // Jambes (face) : la jambe levée est plus courte
  const liftL = Math.max(0, legs) * 7, liftR = Math.max(0, -legs) * 7;
  c.fillStyle = '#1a1a20';
  c.fillRect(cx - 11, hipY, 10, legLen - liftL); c.fillRect(cx + 1, hipY, 10, legLen - liftR);
  c.fillStyle = '#0d0d10'; c.fillRect(cx - 12, ground - 4 - liftL, 12, 4); c.fillRect(cx, ground - 4 - liftR, 12, 4);
  // Torse
  const tl = lean * 8;
  c.fillStyle = color; c.beginPath(); c.moveTo(cx - 16 + tl, torsoTop); c.lineTo(cx + 16 + tl, torsoTop); c.lineTo(cx + 14, hipY + 2); c.lineTo(cx - 14, hipY + 2); c.closePath(); c.fill();
  if (o.vest) { c.fillStyle = o.heavy ? 'rgba(120,130,120,0.9)' : 'rgba(70,75,80,0.8)'; c.fillRect(cx - 10 + tl * 0.6, torsoTop + 3, 20, 20); if (o.heavy) { c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1; c.strokeRect(cx - 9.5 + tl * 0.6, torsoTop + 3.5, 19, 19); } }
  if (o.isPlayerLike && !back) { c.fillStyle = '#e9e6de'; c.fillRect(cx - 3, torsoTop, 6, 10); }
  // Bras
  c.strokeStyle = color; c.lineWidth = 6;
  const shL = { x: cx - 13 + tl, y: torsoTop + 4 }, shR = { x: cx + 13 + tl, y: torsoTop + 4 };
  let hL, hR, handR = 3.5, handL = 3.5;
  const A = pose.arms;
  switch (A) {
    case 'aim': case 'fire': hL = { x: cx - 2, y: torsoTop + 16 - (A === 'fire' ? 4 : 0) }; hR = { x: cx + 2, y: torsoTop + 16 - (A === 'fire' ? 4 : 0) }; break;
    case 'reload': hL = { x: cx - 5, y: torsoTop + 24 }; hR = { x: cx + 6, y: torsoTop + 20 }; break;
    case 'raise': hL = { x: cx - 18, y: torsoTop + 14 }; hR = { x: cx + 18, y: torsoTop - 22 }; break;
    case 'strike': hL = { x: cx - 16, y: torsoTop + 18 }; hR = { x: cx + 6, y: torsoTop + 12 }; handR = 7; break;
    case 'out': hL = { x: cx - 28, y: torsoTop - 6 }; hR = { x: cx + 28, y: torsoTop - 6 }; break;
    case 'grab': hL = { x: cx - 8, y: torsoTop + 4 }; hR = { x: cx + 8, y: torsoTop + 4 }; handL = handR = 5; break;
    case 'kneel': hL = { x: cx - 16, y: hipY + 6 }; hR = { x: cx + 16, y: hipY + 6 }; break;
    default: hL = { x: cx - 18, y: hipY - 2 }; hR = { x: cx + 18, y: hipY - 2 };
  }
  c.beginPath(); c.moveTo(shL.x, shL.y); c.lineTo(hL.x, hL.y); c.stroke();
  c.beginPath(); c.moveTo(shR.x, shR.y); c.lineTo(hR.x, hR.y); c.stroke();
  c.fillStyle = skin; c.beginPath(); c.arc(hL.x, hL.y, handL, 0, TAU); c.fill(); c.beginPath(); c.arc(hR.x, hR.y, handR, 0, TAU); c.fill();
  if (!back) {
    if (o.gun && (A === 'aim' || A === 'fire')) { c.fillStyle = '#17171b'; c.fillRect(cx - 4, hR.y - 8, 8, 8); c.fillStyle = '#000'; c.beginPath(); c.arc(cx, hR.y - 4, A === 'fire' ? 3 : 2.2, 0, TAU); c.fill(); if (o.long) { c.fillStyle = '#17171b'; c.fillRect(cx - 6, hR.y - 2, 12, 6); } }
    else if (o.gun && A === 'reload') { c.save(); c.translate(cx, hR.y - 4); c.rotate(0.9); c.fillStyle = '#17171b'; c.fillRect(-3, -6, 6, o.long ? 18 : 12); c.restore(); }
    else if (o.gun && A === 'hang') { c.fillStyle = '#17171b'; c.fillRect(hR.x - 2, hR.y - 2, 5, o.long ? 18 : 10); }
    if (o.knife && A !== 'hang') { c.save(); c.translate(hR.x, hR.y); c.rotate(A === 'raise' ? -0.4 : A === 'strike' ? 1.2 : 0.3); c.fillStyle = '#d5d9e0'; c.fillRect(-1.5, -14, 3, 14); c.restore(); }
  }
  // Tête
  c.fillStyle = skin; c.beginPath(); c.arc(cx + tl, headY, 9, 0, TAU); c.fill();
  c.fillStyle = hair;
  if (back) { c.beginPath(); c.arc(cx + tl, headY, 9, 0, TAU); c.fill(); }
  else { c.beginPath(); c.arc(cx + tl, headY - 3, 9, Math.PI, TAU); c.fill(); c.fillStyle = '#2a1e16'; c.fillRect(cx - 5 + tl, headY - 1, 3, 2); c.fillRect(cx + 2 + tl, headY - 1, 3, 2); if (o.beard) { c.fillStyle = '#2b241c'; c.beginPath(); c.arc(cx + tl, headY + 4, 6, 0.2, Math.PI - 0.2); c.fill(); } }
  c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(cx - 4 + tl, headY + 8, 8, 6);
  if (o.helmet) { c.fillStyle = '#3a3f3c'; c.beginPath(); c.arc(cx + tl, headY - 2, 11, Math.PI, TAU); c.fill(); c.fillRect(cx - 11 + tl, headY - 2, 22, 5); c.fillStyle = 'rgba(255,255,255,0.15)'; c.beginPath(); c.arc(cx - 3 + tl, headY - 7, 4, 0, TAU); c.fill(); }
}
const POSES = {
  idle:   { arms: 'hang' },
  guard:  { arms: 'aim' },
  walk0:  { arms: 'aim', legs: 1 }, walk1: { arms: 'aim', legs: 0.3 }, walk2: { arms: 'aim', legs: -1 }, walk3: { arms: 'aim', legs: -0.3 },
  run0:   { arms: 'grab', legs: 1, lean: 0.6 }, run1: { arms: 'grab', legs: 0.2, lean: 0.6 }, run2: { arms: 'grab', legs: -1, lean: 0.6 }, run3: { arms: 'grab', legs: -0.2, lean: 0.6 },
  fire:   { arms: 'fire' },
  reload: { arms: 'reload', headDown: 1 },
  flinch: { arms: 'out', lean: -0.7, crouch: 0.1 },
  stagger:{ arms: 'out', lean: -0.9, legs: 0.6, crouch: 0.25 },
  windup: { arms: 'raise', lean: 0.2 },
  strike: { arms: 'strike', lean: 0.5, legs: 0.5 },
  kneel:  { arms: 'kneel', crouch: 0.7, legs: 0.4, headDown: 0.6 },
  fall:   { arms: 'out', crouch: 0.45, lean: -0.5 }
};
function makeRigSprite(e, pose, view, rotDeg, dead, lying) {
  const side = view === 'left' || view === 'right';
  const opts = { color: e.color, hair: e.hair, vest: !!e.armor, heavy: !!(e.armor && e.armor.max >= 200), helmet: !!(e.helmet && e.helmet.hp > 0), gun: e.hasFirearm, long: !!(e.weapon && e.weapon.def.twoHanded), knife: !!(e.weapon && e.weapon.def.type === 'melee'), view: side ? 'side' : view };
  const P = POSES[pose] || POSES.idle;
  let cv, c;
  if (lying) {
    // Corps au sol : figure couchée (tête à gauche), épaisseur écrasée
    cv = mkCanvas(96, 40); c = cv.getContext('2d');
    c.setTransform(0, 40 / 64, 1, 0, 0, 0);
    drawRig(c, opts, P);
  } else if (rotDeg) {
    // En vol (projection) : figure tournée
    cv = mkCanvas(100, 100); c = cv.getContext('2d');
    c.translate(50, 50); c.rotate(rad(rotDeg)); c.translate(-SPRITE_W / 2, -SPRITE_H / 2);
    drawRig(c, opts, P);
  } else {
    cv = mkCanvas(SPRITE_W, SPRITE_H); c = cv.getContext('2d');
    if (view === 'left') { c.translate(SPRITE_W, 0); c.scale(-1, 1); }
    drawRig(c, opts, P);
  }
  if (dead) { c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-atop'; c.fillStyle = 'rgba(25,0,0,0.4)'; c.fillRect(0, 0, cv.width, cv.height); }
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
    case 'helmet': cv = mkCanvas(24, 16); c = cv.getContext('2d'); c.fillStyle = '#3a3f3c'; c.beginPath(); c.arc(12, 11, 11, Math.PI, TAU); c.fill(); c.fillRect(1, 11, 22, 4); c.fillStyle = 'rgba(255,255,255,0.15)'; c.beginPath(); c.arc(8, 6, 4, 0, TAU); c.fill(); break;
    case 'gun': cv = mkCanvas(28, 14); c = cv.getContext('2d'); c.translate(14, 7); c.rotate(-0.7); c.fillStyle = '#17171b'; c.fillRect(-12, -3, 24, 5); c.fillRect(-6, 1, 5, 7); break;
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
    for (const k of ['weapon', 'health', 'plate', 'ammo', 'dot', 'flash', 'text', 'thrown', 'helmet', 'gun']) this.misc[k] = makeMiscSprite(k);
    this.lastShots = 0; this.casings = []; this.smoke = [];
    this.exits = []; for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) if (world.get(x, y) === T.EXIT) this.exits.push({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
  }
  // Pose d'un ennemi selon son état (priorité décroissante)
  enemyPose(e) {
    if (e.dead) { const t = e.deadT; if (t < 0.12) return { pose: 'stagger' }; if (t < 0.28) return { pose: 'fall' }; if (t < 0.42) return { pose: 'kneel' }; return { pose: 'fall', lying: true, dead: true }; }
    if (e.thrownT > 0) { const k = clamp(1 - e.thrownT / 0.5, 0, 1); return { pose: 'fall', rot: -(30 + Math.round(k * 2) * 30), flying: true, k }; }
    if (e.downed > 0) { if (e.downed < 0.45) return { pose: 'kneel' }; return { pose: 'fall', lying: true }; }
    if (e.hurtFlash > 0.06) return { pose: 'flinch' };
    if (e.meleeAnim > 0) return { pose: 'strike' };
    if (e.brain && e.brain.windup > 0) return { pose: 'windup' };
    if (e.stagger > 0) return { pose: 'stagger' };
    if (e.weapon && e.weapon.reloading) return { pose: 'reload' };
    if (e.fireAnim > 0) return { pose: 'fire' };
    if (e.moving > 0.05) { const f = Math.floor(e.walkPhase) % 4; const run = e.speed > 120 || (e.brain && e.brain.mode === 'melee'); return { pose: (run ? 'run' : 'walk') + f }; }
    return { pose: (e.brain && e.brain.state !== 'idle' && e.hasFirearm) ? 'guard' : 'idle' };
  }
  enemySprite(e, view, ps) {
    const key = e.typeId + ':' + ps.pose + ':' + view + ':' + (ps.rot || 0) + (ps.lying ? 'L' : '') + (ps.dead ? 'D' : '') + ':' + (e.helmet && e.helmet.hp > 0 ? 'h' : '') + (e.hasFirearm ? (e.weapon.def.twoHanded ? 'G' : 'g') : e.weapon ? 'k' : 'n');
    let img = this.spriteCache.get(key);
    if (!img) { img = makeRigSprite(e, ps.pose, view, ps.rot || 0, !!ps.dead, !!ps.lying); this.spriteCache.set(key, img); }
    return img;
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
      const ps = this.enemyPose(e);
      const rel = angleDiff(angleTo(e.x, e.y, p.x, p.y), e.angle), ar = Math.abs(rel);
      const view = (ps.lying || ps.flying) ? 'front' : ar < Math.PI / 4 ? 'front' : ar > 3 * Math.PI / 4 ? 'back' : rel < 0 ? 'right' : 'left';
      const img = this.enemySprite(e, view, ps);
      const tint = e.hurtFlash > 0 && !e.dead ? 1 : 0;
      if (ps.lying) push(e.x, e.y, 0, 0.5, 1.78, img, { tint });
      else if (ps.flying) push(e.x, e.y, 0.4 * Math.sin(ps.k * Math.PI), 1.85, 1.85, img, { tint });
      else push(e.x, e.y, 0, 1.8, 1.2, img, { tint });
    }
    for (const fx of game.fxSprites) push(fx.x, fx.y, fx.z, fx.kind === 'helmet' ? 0.28 : 0.22, fx.kind === 'helmet' ? 0.42 : 0.5, this.misc[fx.kind], { alpha: clamp(fx.life * 2, 0, 1) });
    for (const pk of game.pickups) if (!pk.dead) push(pk.x, pk.y, 0.02, pk.kind === 'plate' ? 0.32 : 0.22, pk.kind === 'weapon' ? 0.55 : 0.34, this.misc[pk.kind]);
    for (const th of game.thrown) push(th.x, th.y, 1.1 + Math.sin(th.life * 8) * 0.2, 0.18, 0.4, this.misc.thrown);
    for (const f of game.flashes) if (f.owner !== p) push(f.x, f.y, 1.25, 0.45 * (f.t / f.max + 0.5), 0.45 * (f.t / f.max + 0.5), this.misc.flash, { add: true });
    for (const b of game.bullets) if (b.owner !== p) push(b.x, b.y, 1.35, 0.1, 0.1, this.misc.dot, { add: true });
    for (const pt of game.particles) {
      if (pt.kind === 'smoke') continue;
      const age = pt.maxLife - pt.life;
      let z;
      if (pt.kind === 'blood') z = Math.max(0.02, (pt.z0 || 1.15) + (pt.vz || 0) * age - 4.9 * age * age);
      else z = (pt.kind === 'glass' ? 1.3 : 1.0) + age * 0.2;
      const sz = pt.kind === 'blood' ? 0.05 + 0.05 * (pt.size || 1) / 2.5 : 0.07;
      push(pt.x, pt.y, z, sz, sz, this.misc.dot, { tint: pt.kind === 'blood' ? 2 : pt.kind === 'spark' ? 3 : 4, alpha: pt.life / pt.maxLife });
    }
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
    const roll = this.cameraRoll(game);
    ctx.save();
    if (Math.abs(roll) > 0.001) { ctx.translate(sw / 2, sh / 2); ctx.rotate(roll); ctx.scale(1.08, 1.08); ctx.translate(-sw / 2, -sh / 2); }
    ctx.drawImage(this.off, 0, 0, sw, sh);
    this.drawViewModel(ctx, game, sw, sh);
    ctx.restore();
    this.r.renderHUD(game);
    this.drawMinimap(ctx, game, sw, sh);
  }
  // Roulis de caméra : esquive, projection, coup reçu, course
  cameraRoll(game) {
    const p = game.player; let roll = 0;
    if (p.dodgeT > 0) { const k = 1 - p.dodgeT / 0.34; const lat = Math.sin(angleDiff(p.angle, p.dodgeDir)); roll += -lat * 0.12 * Math.sin(k * Math.PI); }
    if (p.meleeAnim > 0 && p.meleeKind === 'throw') { const k = 1 - p.meleeAnim / p.meleeAnimDur; roll += 0.2 * Math.sin(k * Math.PI); }
    if (p.hurtFlash > 0) roll += 0.035 * Math.sin(p.hurtFlash * 45) * (p.hurtFlash / 0.18);
    if (p.sprinting) roll += Math.sin(game.time * 6.5) * 0.012;
    return roll;
  }
  // ------------------------------------------------------------------------
  // Modèle d'arme en vue subjective : recul, culasse, douilles, fumée,
  // rechargements en phases, gun-fu, couteau, exécution, soins.
  // ------------------------------------------------------------------------
  onShot(wpn) {
    const cls = AMMO[wpn.def.ammo].cls;
    const port = wpn.def.type === 'pistol' ? { x: 22, y: -262 } : wpn.def.type === 'shotgun' ? { x: 40, y: -250 } : { x: 34, y: -230 };
    this.casings.push({ x: port.x, y: port.y, vx: rand(500, 900), vy: rand(-900, -600), rot: rand(0, TAU), vr: rand(-25, 25), life: 0.55, cls });
    for (let i = 0; i < (cls === 'shotgun' ? 6 : 3); i++) this.smoke.push({ x: rand(-10, 10), y: (wpn.def.type === 'pistol' ? -330 : -440) + rand(-10, 10), vx: rand(-40, 40), vy: rand(-140, -60), r: rand(10, 22), life: rand(0.35, 0.6), max: 0.6 });
  }
  updateOverlayFx(game) {
    const dt = 1 / 60;
    for (const c of this.casings) { c.life -= dt; c.vy += 2600 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.vr * dt; }
    this.casings = this.casings.filter(c => c.life > 0);
    for (const sm of this.smoke) { sm.life -= dt; sm.x += sm.vx * dt; sm.y += sm.vy * dt; sm.r += 30 * dt; }
    this.smoke = this.smoke.filter(sm => sm.life > 0);
  }
  reloadAnim(wpn) {
    const out = { tilt: 0, magDrop: 0, newMag: null, handL: null, slide: 0, shell: null, handle: 0 };
    if (!wpn || !wpn.reloading) return out;
    const ease = k => 1 - (1 - k) * (1 - k);
    const ph = clamp(wpn.reloadT / wpn.reloadDur, 0, 1);
    if (wpn.def.type === 'shotgun') {
      if (ph < 0.4) { const k = ph / 0.4; out.handL = { x: -70 - 40 * k, y: 190 * ease(k) }; }
      else if (ph < 0.82) { const k = (ph - 0.4) / 0.42; out.handL = { x: -110 + 90 * ease(k), y: 190 - 200 * ease(k) }; out.shell = { k: 0 }; }
      else { const k = (ph - 0.82) / 0.18; out.handL = { x: -20 + 10 * k, y: -10 }; out.shell = { k }; }
      out.tilt = 0.12 * Math.sin(ph * Math.PI);
      return out;
    }
    const empty = wpn.reloadKind === 'empty';
    if (ph < 0.25) { const k = ph / 0.25; out.tilt = 0.3 * ease(k); out.magDrop = 280 * k * k; out.handL = { x: -20 - 70 * k, y: 240 * ease(k) }; }
    else if (ph < 0.62) { const k = (ph - 0.25) / 0.37; out.tilt = 0.3; out.magDrop = -1; out.newMag = 1 - ease(k); out.handL = { x: -90 + 70 * ease(k), y: 240 * (1 - ease(k)) }; }
    else if (empty && ph < 0.86) { const k = (ph - 0.62) / 0.24; const b = Math.sin(k * Math.PI); out.tilt = 0.3 * (1 - k * 0.6); out.newMag = 0; out.slide = b; out.handle = b; out.handL = { x: 10 + 14 * b, y: -150 + 40 * b }; }
    else { const k = (ph - (empty ? 0.86 : 0.62)) / (empty ? 0.14 : 0.38); out.tilt = 0.3 * (empty ? 0.4 : 1) * (1 - ease(k)); out.newMag = 0; }
    return out;
  }
  slideFromShot(wpn) {
    if (!wpn || wpn.cooldown <= 0) return 0;
    const k = 1 - clamp(wpn.cooldown / wpn.def.interval, 0, 1);
    return k < 0.35 ? k / 0.35 : 1 - (k - 0.35) / 0.65;
  }
  hand(ctx, x, y, rx, ry, rot, skin) { ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); ctx.fill(); }
  palm(ctx, x, y, k, skin) {
    // main ouverte (frappe de paume) : paume + doigts
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.3 + k * 0.2); ctx.fillStyle = skin;
    ctx.beginPath(); ctx.ellipse(0, 0, 44, 52, 0, 0, TAU); ctx.fill();
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(-30 + i * 20, -62, 9, 26, (i - 1.5) * 0.12, 0, TAU); ctx.fill(); }
    ctx.beginPath(); ctx.ellipse(-46, -18, 10, 24, 0.7, 0, TAU); ctx.fill();
    ctx.restore();
  }
  drawViewModel(ctx, game, w, h) {
    const p = game.player; if (!p || p.dead) return;
    const wpn = p.weapon; const t = game.time; const s = h / 720;
    if (game.stats.shots !== this.lastShots) { if (game.stats.shots > this.lastShots && wpn && wpn.def.type !== 'melee') this.onShot(wpn); this.lastShots = game.stats.shots; }
    this.updateOverlayFx(game);
    const mv = p.moving > 0 && p.dodgeT <= 0 ? p.moving : 0;
    const bob = Math.sin(t * (p.sprinting ? 13 : 8.5)) * (p.sprinting ? 14 : 6) * mv;
    const bobX = Math.cos(t * (p.sprinting ? 6.5 : 4.25)) * 6 * mv;
    let ox = w * (p.aiming ? 0.5 : 0.6) + bobX * s, oy = h + bob * s;
    const rec = wpn ? (wpn.recoil || 0) : 0; oy += rec * 5 * s; ox += rec * 1.2 * s;
    if (p.sprinting) { oy += 110 * s; ox += 50 * s; }
    if (p.swapT > 0) oy += p.swapT * 400 * s;
    if (p.dodgeT > 0) oy += 60 * s;
    if (p.throwAnim > 0) { const k = 1 - p.throwAnim / 0.32; oy -= 220 * Math.sin(k * Math.PI) * s; ox -= 120 * k * s; }
    const skin = '#d6b08f', dark = '#17171b', mid = '#2b2b33', cuff = '#0c0c10';
    ctx.save();
    // --- Soins : mains + bandage
    if (p.healing > 0) {
      ctx.translate(w * 0.5, h); ctx.scale(s, s);
      const k = Math.sin(t * 6) * 10;
      ctx.fillStyle = cuff; ctx.fillRect(-140, -120, 90, 160); ctx.fillRect(50, -130, 90, 170);
      this.hand(ctx, -90 + k, -140, 46, 60, 0.3, skin); this.hand(ctx, 90 - k, -150, 46, 60, -0.3, skin);
      ctx.fillStyle = '#e8e8e8'; ctx.fillRect(-40, -175, 80, 30); ctx.fillStyle = '#c62828'; ctx.fillRect(-10, -172, 20, 6);
      ctx.restore(); return;
    }
    const type = wpn ? wpn.def.type : 'none';
    const meleeK = p.meleeAnim > 0 ? 1 - p.meleeAnim / p.meleeAnimDur : -1; // progression 0..1
    const kind = p.meleeKind;
    const flash = game.flashes.find(f => f.owner === p);
    // --- Couteau
    if (type === 'melee') {
      const parity = game.stats.meleeHits % 2;
      let hx = ox + 60 * s, hy = oy, rot = -0.25, trail = 0;
      if (meleeK >= 0) {
        const b = Math.sin(meleeK * Math.PI);
        const dir = parity ? 1 : -1;
        hx = ox + 60 * s + dir * (-260 * b) * s; hy = oy - 300 * b * s + 40 * s; rot = -0.25 + dir * 1.3 * b; trail = b;
      }
      if (trail > 0.15) { ctx.strokeStyle = 'rgba(255,255,255,' + (0.35 * trail) + ')'; ctx.lineWidth = 26 * s; ctx.lineCap = 'round'; ctx.beginPath(); const dir = parity ? 1 : -1; ctx.moveTo(ox + 60 * s + dir * 60 * s, oy - 120 * s); ctx.quadraticCurveTo(ox + 60 * s - dir * 60 * s, oy - 330 * s, hx, hy - 220 * s); ctx.stroke(); }
      ctx.translate(hx, hy); ctx.scale(s, s); ctx.rotate(rot);
      ctx.fillStyle = cuff; ctx.fillRect(-46, -40, 92, 160);
      this.hand(ctx, 0, -80, 44, 52, 0, skin);
      ctx.fillStyle = '#2a2a2e'; ctx.fillRect(-10, -130, 20, 50);
      ctx.fillStyle = '#d5d9e0'; ctx.beginPath(); ctx.moveTo(-10, -130); ctx.lineTo(10, -130); ctx.lineTo(4, -300); ctx.lineTo(-6, -262); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(-2, -280, 3, 130);
      ctx.restore(); return;
    }
    // --- Gun-fu : paume, saisie / désarmement, projection, exécution (avec l'arme à feu en main)
    if (meleeK >= 0 && (kind === 'miss' || kind === 'strike' || kind === 'disarm' || kind === 'throw')) {
      const b = Math.sin(meleeK * Math.PI);
      if (kind === 'miss' || kind === 'strike') {
        // paume gauche qui part du bas-gauche vers le centre
        this.palm(ctx, w * 0.3 + b * w * 0.18, h + 60 * s - b * 330 * s, b, skin);
        ctx.translate(ox + 30 * b * s, oy + 40 * b * s); ctx.scale(s, s); ctx.rotate(0.25 * b);
        this.drawGun(ctx, wpn, p, game, { tilt: 0, handL: { x: -400, y: 300 }, flash: null, skin, dark, mid, cuff });
      } else if (kind === 'disarm') {
        // les deux mains montent saisir l'arme adverse, torsion, retour
        const twist = meleeK < 0.5 ? 0 : Math.sin((meleeK - 0.5) * 2 * Math.PI);
        ctx.save(); ctx.translate(w * 0.42 + b * w * 0.06, h + 40 * s - b * 380 * s); ctx.scale(s, s); ctx.rotate(-0.4 * twist);
        ctx.fillStyle = cuff; ctx.fillRect(-46, -30, 92, 160); this.hand(ctx, 0, -70, 42 + 6 * b, 50, 0.2, skin);
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; for (let i = -1; i <= 1; i++) ctx.fillRect(-28 + i * 20, -105, 3, 28);
        ctx.restore();
        ctx.translate(ox - 60 * b * s, oy - 240 * b * s); ctx.scale(s, s); ctx.rotate(-0.9 * b + 0.5 * twist);
        this.drawGun(ctx, wpn, p, game, { tilt: 0, handL: { x: -400, y: 300 }, flash: null, skin, dark, mid, cuff });
      } else {
        // projection : saisie haute puis balayage vers le bas-gauche
        const grab = clamp(meleeK / 0.3, 0, 1), sweep = clamp((meleeK - 0.3) / 0.5, 0, 1), rel = clamp((meleeK - 0.8) / 0.2, 0, 1);
        const gx = w * 0.45 + (grab - sweep) * 20 * s - sweep * w * 0.35, gy = h + 40 * s - grab * 400 * s + sweep * 500 * s - rel * 100 * s;
        ctx.save(); ctx.translate(gx, gy); ctx.scale(s, s); ctx.rotate(-0.3 * grab + 0.9 * sweep);
        ctx.fillStyle = cuff; ctx.fillRect(-46, -30, 92, 170); this.hand(ctx, 0, -70, 46, 52, 0.2, skin);
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; for (let i = -1; i <= 1; i++) ctx.fillRect(-28 + i * 20, -105, 3, 28);
        ctx.restore();
        ctx.translate(ox - 30 * grab * s - sweep * w * 0.25, oy - 260 * grab * s + sweep * 420 * s - rel * 80 * s); ctx.scale(s, s); ctx.rotate(-0.5 * grab + 1.1 * sweep);
        this.drawGun(ctx, wpn, p, game, { tilt: 0, handL: { x: -400, y: 300 }, flash: null, skin, dark, mid, cuff });
      }
      ctx.restore(); return;
    }
    // --- Exécution : l'arme plonge vers la cible au sol, coup de feu à la fin
    if (p.executing > 0 || (meleeK >= 0 && kind === 'execute')) {
      const k = p.executing > 0 ? 1 - p.executing / 0.55 : 1;
      ctx.translate(w * 0.5 + (ox - w * 0.5) * (1 - k), oy - 40 * k * s); ctx.scale(s * (1 + 0.15 * k), s * (1 + 0.15 * k)); ctx.rotate(0.1 * k);
      this.drawGun(ctx, wpn, p, game, { tilt: 0, handL: null, flash, skin, dark, mid, cuff });
      ctx.restore(); return;
    }
    // --- Arme à feu en main
    ctx.translate(ox, oy); ctx.scale(s, s);
    const ra = this.reloadAnim(wpn);
    this.drawGun(ctx, wpn, p, game, { tilt: ra.tilt, handL: ra.handL, magDrop: ra.magDrop, newMag: ra.newMag, slideExtra: ra.slide, handle: ra.handle, shell: ra.shell, flash, skin, dark, mid, cuff });
    ctx.restore();
    // --- Douilles et fumée (espace écran, ancrés sur l'arme)
    ctx.save(); ctx.translate(ox, oy); ctx.scale(s, s);
    for (const sm of this.smoke) { ctx.globalAlpha = 0.28 * (sm.life / sm.max); ctx.fillStyle = '#c8c8c8'; ctx.beginPath(); ctx.arc(sm.x, sm.y, sm.r, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
    for (const c of this.casings) { ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot); ctx.fillStyle = c.cls === 'shotgun' ? '#b0352d' : '#d4b45a'; ctx.fillRect(-9, -3, 18, 6); ctx.fillStyle = '#e8d08a'; ctx.fillRect(-9, -3, 4, 6); ctx.restore(); }
    ctx.restore();
  }
  // Dessine l'arme à feu courante dans le repère (0,0) = base de l'arme, échelle 720p
  drawGun(ctx, wpn, p, game, st) {
    const { skin, dark, mid, cuff } = st;
    const type = wpn.def.type;
    const empty = weaponRounds(wpn) === 0 && !wpn.reloading;
    const slide = Math.max(st.slideExtra || 0, this.slideFromShot(wpn), empty ? 1 : 0);
    ctx.save(); ctx.rotate(-(st.tilt || 0));
    const magAt = (x, y, w, h) => {
      if (st.magDrop === -1 && st.newMag == null) return; // puits vide
      if (st.magDrop > 0) { ctx.globalAlpha = clamp(1 - st.magDrop / 260, 0, 1); ctx.fillStyle = dark; ctx.fillRect(x, y + st.magDrop, w, h); ctx.globalAlpha = 1; return; }
      if (st.newMag != null && st.newMag > 0) return; // le nouveau chargeur est encore dans la main
      ctx.fillStyle = dark; ctx.fillRect(x, y, w, h); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x + 2, y + 2, w - 4, 3);
    };
    const leftHandWithMag = (mx, my, mw, mh) => {
      if (!st.handL) return false;
      const hx = st.handL.x, hy = st.handL.y;
      ctx.fillStyle = cuff; ctx.fillRect(hx - 60, hy - 60, 90, 220);
      if (st.newMag != null && st.newMag > 0) { ctx.fillStyle = dark; ctx.fillRect(hx - mw / 2, hy - mh + 10, mw, mh); }
      if (st.shell) { ctx.fillStyle = '#b0352d'; ctx.fillRect(hx - 8, hy - 34 + st.shell.k * 30, 16, 40 * (1 - st.shell.k * 0.7)); ctx.fillStyle = '#c9a44b'; ctx.fillRect(hx - 8, hy + 2 - st.shell.k * 8, 16, 6); }
      this.hand(ctx, hx, hy, 34, 46, 0.25, skin);
      return true;
    };
    if (type === 'pistol') {
      ctx.fillStyle = cuff; ctx.fillRect(-30, -70, 90, 200);
      magAt(-11, -120, 22, 56);
      ctx.fillStyle = dark; ctx.fillRect(-16, -190, 32, 80); // crosse
      ctx.fillStyle = '#23232a'; ctx.fillRect(-20, -200, 40, 14); // pontet / carcasse
      const sy = slide * 30;
      ctx.fillStyle = mid; ctx.fillRect(-26, -300 + sy, 52, 110 - sy * 0.3); // culasse
      ctx.fillStyle = dark; ctx.fillRect(-26, -215 + sy, 52, 8);
      if (slide > 0.2) { ctx.fillStyle = '#4a4a55'; ctx.fillRect(-9, -300, 18, sy + 4); ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, -298, 9, 0, TAU); ctx.fill(); } // canon découvert
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, -298 + sy, 9, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e8e8e8'; ctx.fillRect(-2, -318 + sy, 4, 8); ctx.fillRect(-16, -300 + sy, 4, 6); ctx.fillRect(12, -300 + sy, 4, 6);
      ctx.fillStyle = '#3a3a44'; ctx.fillRect(18, -268 + sy, 8, 16); // fenêtre d'éjection
      this.hand(ctx, 24, -126, 32, 46, -0.2, skin); // main droite
      if (!leftHandWithMag(0, 0, 22, 56)) this.hand(ctx, -20, -118, 32, 46, 0.25, skin);
      if (st.flash) this.muzzle(ctx, 0, -330, 90 * (st.flash.t / st.flash.max), 'pistol');
    } else if (type === 'shotgun') {
      ctx.fillStyle = cuff; ctx.fillRect(-70, -90, 140, 220);
      ctx.fillStyle = mid; ctx.fillRect(-60, -230, 120, 140);
      ctx.fillStyle = '#3a3a44'; ctx.fillRect(-14, -150, 28, 30); // fenêtre de chargement
      ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(-22, -420); ctx.lineTo(22, -420); ctx.lineTo(34, -200); ctx.lineTo(-34, -200); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3a3a44'; ctx.fillRect(-30, -330, 60, 50);
      ctx.fillStyle = '#4a4a55'; ctx.fillRect(38, -262 - slide * 30, 10, 30); // culasse (levier) qui recule
      this.hand(ctx, 30, -140, 34, 48, -0.3, skin);
      if (!leftHandWithMag()) this.hand(ctx, -4, -310, 32, 42, 0, skin);
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, -418, 12, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e8e8e8'; ctx.fillRect(-2, -436, 4, 8);
      if (st.flash) this.muzzle(ctx, 0, -440, 130 * (st.flash.t / st.flash.max), 'shotgun');
    } else {
      const len = type === 'rifle' ? 470 : 380;
      ctx.fillStyle = cuff; ctx.fillRect(-70, -90, 140, 220);
      ctx.fillStyle = mid; ctx.fillRect(-46, -240, 92, 150);
      magAt(-14, -220, 28, 90);
      ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(-14, -len); ctx.lineTo(14, -len); ctx.lineTo(26, -220); ctx.lineTo(-26, -220); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3a3a44'; ctx.fillRect(-24, -len + 90, 48, 110);
      ctx.fillStyle = '#4a4a55'; ctx.fillRect(40, -238 + (st.handle || 0) * 40, 12, 26); // levier d'armement
      ctx.fillStyle = '#3a3a44'; ctx.fillRect(28, -232 + slide * 20, 8, 18); // fenêtre / culasse
      this.hand(ctx, 30, -150, 34, 48, -0.3, skin);
      if (!leftHandWithMag(0, 0, 28, 90)) this.hand(ctx, -2, -len + 150, 32, 42, 0, skin);
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, -len + 2, 8, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e8e8e8'; ctx.fillRect(-2, -len - 14, 4, 8); ctx.fillRect(-12, -250, 3, 10); ctx.fillRect(9, -250, 3, 10);
      if (st.flash) this.muzzle(ctx, 0, -len - 20, 110 * (st.flash.t / st.flash.max), 'rifle');
    }
    ctx.restore();
  }
  muzzle(ctx, x, y, r, cls) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,250,220,0.95)'); g.addColorStop(0.3, 'rgba(255,190,80,0.8)'); g.addColorStop(1, 'rgba(255,120,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    // étoile
    ctx.save(); ctx.translate(x, y); ctx.rotate(rand(0, TAU)); ctx.fillStyle = 'rgba(255,240,180,0.85)';
    const n = cls === 'shotgun' ? 7 : 5; ctx.beginPath();
    for (let i = 0; i < n * 2; i++) { const a = i / (n * 2) * TAU; const rr = i % 2 ? r * 0.35 : r * (1.1 + rand(0, 0.5)); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill(); ctx.restore();
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
