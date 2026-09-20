'use strict';
// ---------------------------------------------------------------------------
// Monde : grille de tuiles, collisions, rayons (vision / balles), A*, portes,
// vitres, rendu statique hors écran et décals persistants.
// ---------------------------------------------------------------------------
const T = { FLOOR: 0, WALL: 1, COVER: 2, PILLAR: 3, GLASS: 4, DOOR: 5, CARPET: 6, EXIT: 7, GLASS_BROKEN: 8, TILES: 9, WOOD: 10, CAR: 11 };
const TILE_CHARS = { '#': T.WALL, '.': T.FLOOR, ',': T.CARPET, ':': T.TILES, '~': T.WOOD, 'x': T.COVER, 'o': T.PILLAR, 'g': T.GLASS, '+': T.DOOR, 'X': T.EXIT, 'c': T.CAR };
const ENTITY_CHARS = { P: 'player', t: 'thug', s: 'sicario', r: 'rifleman', k: 'knife', a: 'armored', B: 'boss', w: 'weapon', h: 'health', m: 'ammo', v: 'plate', L: 'light', R: 'light', C: 'light', M: 'light', G: 'light', S: 'spawn' };
const LIGHT_COLORS = { L: [255, 205, 140], R: [255, 40, 60], C: [60, 220, 255], M: [255, 60, 220], G: [120, 255, 140] };

class World {
  constructor(level) {
    this.level = level;
    const rows = level.map;
    this.h = rows.length; this.w = rows[0].length;
    for (const r of rows) if (r.length !== this.w) throw new Error('Carte irrégulière : ' + r);
    this.tiles = new Uint8Array(this.w * this.h);
    this.doors = new Map(); // key -> {tx,ty,open,timer,horizontal}
    this.spawns = { player: null, enemies: [], pickups: [], lights: [], waves: [] };
    let weaponIdx = 0;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const ch = rows[y][x];
      let t = T.FLOOR;
      if (ch in TILE_CHARS) t = TILE_CHARS[ch];
      else if (ch in ENTITY_CHARS) {
        t = level.floorChar ? TILE_CHARS[level.floorChar] : T.FLOOR;
        // Le sol sous une entité prend la texture majoritaire des voisins
        t = this.guessFloor(rows, x, y);
        const kind = ENTITY_CHARS[ch];
        const wx = (x + 0.5) * TILE, wy = (y + 0.5) * TILE;
        if (kind === 'player') this.spawns.player = { x: wx, y: wy };
        else if (kind === 'light') this.spawns.lights.push({ x: wx, y: wy, color: LIGHT_COLORS[ch], radius: (level.lightRadius || 6) * TILE });
        else if (kind === 'spawn') this.spawns.waves.push({ x: wx, y: wy });
        else if (kind === 'weapon') { this.spawns.pickups.push({ kind: 'weapon', x: wx, y: wy, weapon: (level.weapons || [])[weaponIdx] || 'g19' }); weaponIdx++; }
        else if (kind === 'health' || kind === 'ammo' || kind === 'plate') this.spawns.pickups.push({ kind, x: wx, y: wy });
        else this.spawns.enemies.push({ type: kind, x: wx, y: wy });
      }
      this.tiles[y * this.w + x] = t;
    }
    // Portes
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.tiles[y * this.w + x] === T.DOOR) {
      const horizontal = this.get(x - 1, y) === T.WALL && this.get(x + 1, y) === T.WALL;
      this.doors.set(y * this.w + x, { tx: x, ty: y, open: false, timer: 0, horizontal, anim: 0 });
    }
    this.ambient = level.ambient != null ? level.ambient : 0.45;
    this.buildStatic();
    this.decals = document.createElement('canvas');
    this.decals.width = this.w * TILE; this.decals.height = this.h * TILE;
    this.dctx = this.decals.getContext('2d');
    this.decalCount = 0;
    this.pathCache = new Map();
    this.pathCacheT = 0;
  }
  guessFloor(rows, x, y) {
    const counts = {};
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const r = rows[y + dy]; if (!r) continue; const c = r[x + dx];
      if (c === '.' || c === ',' || c === ':' || c === '~') counts[c] = (counts[c] || 0) + 1;
    }
    let best = '.', bn = 0; for (const k in counts) if (counts[k] > bn) { bn = counts[k]; best = k; }
    return TILE_CHARS[best];
  }
  get(tx, ty) { if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return T.WALL; return this.tiles[ty * this.w + tx]; }
  set(tx, ty, v) { if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return; this.tiles[ty * this.w + tx] = v; this.drawTile(tx, ty); }
  door(tx, ty) { return this.doors.get(ty * this.w + tx); }
  // Bloque le déplacement ?
  isSolid(tx, ty) {
    const t = this.get(tx, ty);
    if (t === T.DOOR) return !this.door(tx, ty).open;
    return t === T.WALL || t === T.COVER || t === T.PILLAR || t === T.GLASS || t === T.CAR;
  }
  // Bloque la vue ?
  isOpaque(tx, ty) {
    const t = this.get(tx, ty);
    if (t === T.DOOR) return !this.door(tx, ty).open;
    return t === T.WALL || t === T.PILLAR;
  }
  // Bloque les balles de pistolet (utilisé pour la recherche de couvert par l'IA) ?
  isCover(tx, ty) {
    const t = this.get(tx, ty);
    if (t === T.DOOR) return !this.door(tx, ty).open;
    return t === T.WALL || t === T.PILLAR || t === T.COVER || t === T.CAR;
  }
  // Une balle doit-elle interagir avec cette tuile ?
  isBulletRelevant(tx, ty) {
    const t = this.get(tx, ty);
    if (t === T.DOOR) return !this.door(tx, ty).open;
    return t === T.WALL || t === T.PILLAR || t === T.COVER || t === T.GLASS || t === T.CAR;
  }
  // Praticable pour le pathfinding (les portes s'ouvrent à l'approche)
  isWalkable(tx, ty) {
    const t = this.get(tx, ty);
    return t === T.FLOOR || t === T.CARPET || t === T.TILES || t === T.WOOD || t === T.EXIT || t === T.DOOR || t === T.GLASS_BROKEN;
  }
  // Lancer de rayon sur la grille (Amanatides & Woo). pred(tx,ty) -> bool
  raycast(x0, y0, x1, y1, pred, maxSteps = 400) {
    const dx = x1 - x0, dy = y1 - y0;
    let tx = Math.floor(x0 / TILE), ty = Math.floor(y0 / TILE);
    if (pred(tx, ty)) return { hit: true, x: x0, y: y0, tx, ty, t: 0 };
    if (dx === 0 && dy === 0) return { hit: false, x: x1, y: y1, t: 1 };
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(TILE / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(TILE / dy) : Infinity;
    let tMaxX = dx !== 0 ? ((dx > 0 ? (tx + 1) * TILE - x0 : x0 - tx * TILE) / Math.abs(dx)) : Infinity;
    let tMaxY = dy !== 0 ? ((dy > 0 ? (ty + 1) * TILE - y0 : y0 - ty * TILE) / Math.abs(dy)) : Infinity;
    let t = 0;
    for (let i = 0; i < maxSteps; i++) {
      if (tMaxX < tMaxY) { t = tMaxX; tMaxX += tDeltaX; tx += stepX; }
      else { t = tMaxY; tMaxY += tDeltaY; ty += stepY; }
      if (t > 1) return { hit: false, x: x1, y: y1, t: 1 };
      if (pred(tx, ty)) return { hit: true, x: x0 + dx * t, y: y0 + dy * t, tx, ty, t };
    }
    return { hit: false, x: x1, y: y1, t: 1 };
  }
  los(x0, y0, x1, y1) { return !this.raycast(x0, y0, x1, y1, (tx, ty) => this.isOpaque(tx, ty)).hit; }
  losCover(x0, y0, x1, y1) { return !this.raycast(x0, y0, x1, y1, (tx, ty) => this.isCover(tx, ty)).hit; }
  // Ligne praticable pour un cercle de rayon r (3 rayons parallèles)
  walkable(x0, y0, x1, y1, r) {
    const a = angleTo(x0, y0, x1, y1); const nx = -Math.sin(a) * r, ny = Math.cos(a) * r;
    const pred = (tx, ty) => this.isSolid(tx, ty) && this.get(tx, ty) !== T.DOOR;
    return !this.raycast(x0, y0, x1, y1, pred).hit && !this.raycast(x0 + nx, y0 + ny, x1 + nx, y1 + ny, pred).hit && !this.raycast(x0 - nx, y0 - ny, x1 - nx, y1 - ny, pred).hit;
  }
  // Déplacement d'un cercle avec résolution de collision axe par axe
  moveCircle(e, dx, dy) {
    if (dx !== 0) { e.x += dx; this.resolveCircle(e); }
    if (dy !== 0) { e.y += dy; this.resolveCircle(e); }
  }
  resolveCircle(e) {
    const r = e.r;
    const minTx = Math.floor((e.x - r) / TILE), maxTx = Math.floor((e.x + r) / TILE);
    const minTy = Math.floor((e.y - r) / TILE), maxTy = Math.floor((e.y + r) / TILE);
    for (let ty = minTy; ty <= maxTy; ty++) for (let tx = minTx; tx <= maxTx; tx++) {
      if (!this.isSolid(tx, ty)) continue;
      const cx = clamp(e.x, tx * TILE, (tx + 1) * TILE), cy = clamp(e.y, ty * TILE, (ty + 1) * TILE);
      let vx = e.x - cx, vy = e.y - cy; const d = Math.hypot(vx, vy);
      if (d >= r) continue;
      if (d < 0.0001) {
        // centre à l'intérieur : on pousse vers le bord le plus proche
        const left = e.x - tx * TILE, right = (tx + 1) * TILE - e.x, top = e.y - ty * TILE, bottom = (ty + 1) * TILE - e.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) e.x -= left + r; else if (m === right) e.x += right + r; else if (m === top) e.y -= top + r; else e.y += bottom + r;
      } else { e.x += vx / d * (r - d); e.y += vy / d * (r - d); }
    }
  }
  // A* sur la grille (8 directions, sans couper les coins). Retourne des centres de tuiles.
  findPath(sx, sy, gx, gy) {
    const stx = clamp(Math.floor(sx / TILE), 0, this.w - 1), sty = clamp(Math.floor(sy / TILE), 0, this.h - 1);
    let gtx = clamp(Math.floor(gx / TILE), 0, this.w - 1), gty = clamp(Math.floor(gy / TILE), 0, this.h - 1);
    if (!this.isWalkable(gtx, gty)) { const n = this.nearestWalkable(gtx, gty); if (!n) return null; gtx = n.tx; gty = n.ty; }
    const key = stx + ',' + sty + '>' + gtx + ',' + gty;
    const cached = this.pathCache.get(key);
    if (cached) return cached.slice();
    const W = this.w, H = this.h;
    const g = new Float32Array(W * H).fill(Infinity);
    const from = new Int32Array(W * H).fill(-1);
    const closed = new Uint8Array(W * H);
    const start = sty * W + stx, goal = gty * W + gtx;
    const h = (i) => { const x = i % W, y = (i / W) | 0; const dx = Math.abs(x - gtx), dy = Math.abs(y - gty); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    const open = new MinHeap();
    g[start] = 0; open.push({ i: start, f: h(start) });
    let found = false, iter = 0;
    while (open.size && iter++ < 20000) {
      const cur = open.pop().i;
      if (cur === goal) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % W, cy = (cur / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (!this.isWalkable(nx, ny)) continue;
        if (dx && dy && (!this.isWalkable(cx + dx, cy) || !this.isWalkable(cx, cy + dy))) continue;
        const ni = ny * W + nx;
        if (closed[ni]) continue;
        let cost = (dx && dy) ? 1.414 : 1;
        if (this.get(nx, ny) === T.DOOR) cost += 0.8;
        const ng = g[cur] + cost;
        if (ng < g[ni]) { g[ni] = ng; from[ni] = cur; open.push({ i: ni, f: ng + h(ni) }); }
      }
    }
    if (!found) return null;
    const path = [];
    for (let i = goal; i !== -1; i = from[i]) path.push({ x: (i % W + 0.5) * TILE, y: (((i / W) | 0) + 0.5) * TILE });
    path.reverse();
    if (this.pathCache.size > 200) this.pathCache.clear();
    this.pathCache.set(key, path.slice());
    return path;
  }
  nearestWalkable(tx, ty) {
    for (let r = 1; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (this.isWalkable(tx + dx, ty + dy)) return { tx: tx + dx, ty: ty + dy };
    return null;
  }
  // Polygone de visibilité par lancer de rayons
  visibility(x, y, maxDist, nRays = 360) {
    const pts = new Float32Array(nRays * 2);
    const pred = (tx, ty) => this.isOpaque(tx, ty);
    for (let i = 0; i < nRays; i++) {
      const a = i / nRays * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      const r = this.raycast(x, y, x + ca * maxDist, y + sa * maxDist, pred);
      // On prolonge légèrement dans le mur touché pour éclairer sa face visible
      const ext = r.hit ? 14 : 0;
      pts[i * 2] = r.x + ca * ext; pts[i * 2 + 1] = r.y + sa * ext;
    }
    return pts;
  }
  // Portes : s'ouvrent quand quelqu'un est proche, se referment ensuite.
  updateDoors(dt, chars, audio, listener) {
    for (const d of this.doors.values()) {
      const cx = (d.tx + 0.5) * TILE, cy = (d.ty + 0.5) * TILE;
      let near = false;
      for (const c of chars) { if (!c.alive) continue; if (dist2(c.x, c.y, cx, cy) < (1.35 * TILE) ** 2) { near = true; break; } }
      if (near) {
        if (!d.open) { d.open = true; this.drawTile(d.tx, d.ty); if (audio) audio.door(clamp((cx - listener.x) / (12 * TILE), -1, 1)); }
        d.timer = 1.4;
      } else if (d.open) {
        d.timer -= dt;
        if (d.timer <= 0) {
          let blocked = false;
          for (const c of chars) if (c.alive && dist2(c.x, c.y, cx, cy) < (TILE * 0.9) ** 2) { blocked = true; break; }
          if (!blocked) { d.open = false; this.drawTile(d.tx, d.ty); }
        }
      }
    }
  }
  breakGlass(tx, ty) { if (this.get(tx, ty) === T.GLASS) { this.set(tx, ty, T.GLASS_BROKEN); return true; } return false; }
  // ------------------------------------------------------------------------
  // Rendu statique
  // ------------------------------------------------------------------------
  buildStatic() {
    this.static = document.createElement('canvas');
    this.static.width = this.w * TILE; this.static.height = this.h * TILE;
    this.sctx = this.static.getContext('2d');
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.drawTile(x, y);
  }
  drawTile(tx, ty) {
    const ctx = this.sctx; if (!ctx) return;
    const t = this.get(tx, ty); const px = tx * TILE, py = ty * TILE;
    const pal = this.level.palette || {};
    ctx.save(); ctx.beginPath(); ctx.rect(px, py, TILE, TILE); ctx.clip();
    const seed = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
    const n = (seed % 1000) / 1000;
    // sol
    const drawFloor = (kind) => {
      if (kind === T.CARPET) {
        ctx.fillStyle = pal.carpet || '#3a1c20'; ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = 'rgba(255,255,255,0.03)'; if ((tx + ty) % 2) ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
      } else if (kind === T.TILES) {
        ctx.fillStyle = pal.tiles || '#2a3038'; ctx.fillRect(px, py, TILE, TILE);
        ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, 16, 16); ctx.strokeRect(px + 16.5, py + 16.5, 16, 16); ctx.strokeRect(px + 16.5, py + 0.5, 16, 16); ctx.strokeRect(px + 0.5, py + 16.5, 16, 16);
      } else if (kind === T.WOOD) {
        ctx.fillStyle = pal.wood || '#3b2a1c'; ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = 'rgba(0,0,0,0.18)'; for (let i = 0; i < 4; i++) ctx.fillRect(px, py + i * 8 + 7, TILE, 1);
        ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(px + (seed % 20), py + ((seed >> 4) % 4) * 8, 8, 1);
      } else {
        ctx.fillStyle = pal.floor || '#22242a'; ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(px, py, TILE, 1); ctx.fillRect(px, py, 1, TILE);
        ctx.fillStyle = 'rgba(255,255,255,' + (0.015 + n * 0.02) + ')'; ctx.fillRect(px + 3 + (seed % 20), py + 3 + ((seed >> 5) % 20), 3, 2);
      }
    };
    const floorUnder = () => {
      // sol sous un objet : texture majoritaire du voisinage
      let best = T.FLOOR, bn = 0; const cnt = {};
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = this.get(tx + dx, ty + dy); if (k === T.FLOOR || k === T.CARPET || k === T.TILES || k === T.WOOD) { cnt[k] = (cnt[k] || 0) + 1; if (cnt[k] > bn) { bn = cnt[k]; best = k; } } }
      drawFloor(best);
    };
    switch (t) {
      case T.FLOOR: case T.CARPET: case T.TILES: case T.WOOD: drawFloor(t); break;
      case T.WALL: {
        ctx.fillStyle = pal.wall || '#4a4d57'; ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = pal.wallDark || '#383b44'; ctx.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
        // arêtes claires côté sol
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        if (!this.isOpaque(tx, ty - 1) && this.get(tx, ty - 1) !== T.WALL) ctx.fillRect(px, py, TILE, 2);
        if (!this.isOpaque(tx, ty + 1) && this.get(tx, ty + 1) !== T.WALL) ctx.fillRect(px, py + TILE - 2, TILE, 2);
        if (!this.isOpaque(tx - 1, ty) && this.get(tx - 1, ty) !== T.WALL) ctx.fillRect(px, py, 2, TILE);
        if (!this.isOpaque(tx + 1, ty) && this.get(tx + 1, ty) !== T.WALL) ctx.fillRect(px + TILE - 2, py, 2, TILE);
        break;
      }
      case T.COVER: {
        floorUnder();
        ctx.fillStyle = pal.cover || '#5a4632'; ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.strokeRect(px + 3, py + 3, TILE - 6, TILE - 6);
        ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px + 4, py + 4); ctx.lineTo(px + TILE - 4, py + TILE - 4); ctx.moveTo(px + TILE - 4, py + 4); ctx.lineTo(px + 4, py + TILE - 4); ctx.stroke();
        break;
      }
      case T.CAR: {
        floorUnder();
        ctx.fillStyle = pal.car || '#20242c'; ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(px + 2, py + 2, TILE - 4, 6);
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2; ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
        break;
      }
      case T.PILLAR: {
        floorUnder();
        ctx.fillStyle = pal.pillar || '#3b3d46'; ctx.beginPath(); ctx.arc(px + 16, py + 16, 14, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.arc(px + 13, py + 13, 8, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px + 16, py + 16, 14, 0, TAU); ctx.stroke();
        break;
      }
      case T.GLASS: {
        floorUnder();
        const horizontal = this.get(tx - 1, ty) === T.GLASS || this.get(tx + 1, ty) === T.GLASS || this.get(tx - 1, ty) === T.WALL || this.get(tx + 1, ty) === T.WALL;
        ctx.fillStyle = 'rgba(150,220,240,0.22)';
        if (horizontal && !(this.get(tx, ty - 1) === T.GLASS || this.get(tx, ty + 1) === T.GLASS)) ctx.fillRect(px, py + 11, TILE, 10); else if (!horizontal) ctx.fillRect(px + 11, py, 10, TILE); else ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
        ctx.strokeStyle = 'rgba(200,240,255,0.7)'; ctx.lineWidth = 1.5;
        if (horizontal && !(this.get(tx, ty - 1) === T.GLASS || this.get(tx, ty + 1) === T.GLASS)) ctx.strokeRect(px, py + 11.5, TILE, 9); else if (!horizontal) ctx.strokeRect(px + 11.5, py, 9, TILE); else ctx.strokeRect(px + 4.5, py + 4.5, TILE - 9, TILE - 9);
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(px + 6, py + 14, 6, 1);
        break;
      }
      case T.GLASS_BROKEN: {
        floorUnder();
        ctx.fillStyle = 'rgba(200,240,255,0.5)';
        for (let i = 0; i < 9; i++) { const sx = px + ((seed * (i + 3)) % 28) + 2, sy = py + ((seed * (i + 7) >> 3) % 28) + 2; ctx.fillRect(sx, sy, 2, 1); }
        break;
      }
      case T.DOOR: {
        floorUnder();
        const d = this.door(tx, ty);
        ctx.fillStyle = pal.door || '#6b4a2b';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1;
        if (d.horizontal) {
          if (d.open) { ctx.fillRect(px + 2, py - 20, 6, 30); ctx.strokeRect(px + 2.5, py - 19.5, 6, 30); }
          else { ctx.fillRect(px, py + 12, TILE, 8); ctx.strokeRect(px + 0.5, py + 12.5, TILE - 1, 7); ctx.fillStyle = '#c9a44b'; ctx.fillRect(px + 25, py + 15, 3, 2); }
        } else {
          if (d.open) { ctx.fillRect(px - 20, py + 2, 30, 6); ctx.strokeRect(px - 19.5, py + 2.5, 30, 6); }
          else { ctx.fillRect(px + 12, py, 8, TILE); ctx.strokeRect(px + 12.5, py + 0.5, 7, TILE - 1); ctx.fillStyle = '#c9a44b'; ctx.fillRect(px + 15, py + 25, 2, 3); }
        }
        break;
      }
      case T.EXIT: {
        drawFloor(T.FLOOR);
        ctx.fillStyle = 'rgba(80,255,140,0.13)'; ctx.fillRect(px, py, TILE, TILE);
        ctx.strokeStyle = 'rgba(80,255,140,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(px + 2.5, py + 2.5, TILE - 5, TILE - 5);
        break;
      }
    }
    ctx.restore();
  }
  // ------------------------------------------------------------------------
  // Décals persistants (sang, douilles, corps)
  // ------------------------------------------------------------------------
  addBlood(x, y, dir, amount = 1) {
    const c = this.dctx;
    c.save(); c.translate(x, y); c.rotate(dir);
    for (let i = 0; i < 4 + amount * 4; i++) {
      const d = rand(0, 14 + amount * 12), s = rand(1, 2.5 + amount);
      const off = gauss() * (4 + d * 0.35);
      c.fillStyle = 'rgba(' + randInt(90, 140) + ',' + randInt(0, 12) + ',' + randInt(8, 20) + ',' + rand(0.55, 0.9) + ')';
      c.beginPath(); c.ellipse(d, off, s * 1.6, s, 0, 0, TAU); c.fill();
    }
    c.restore();
    this.decalCount++;
  }
  addPool(x, y, r) {
    const c = this.dctx;
    c.fillStyle = 'rgba(95,6,14,0.8)';
    for (let i = 0; i < 5; i++) { c.beginPath(); c.ellipse(x + gauss() * r * 0.5, y + gauss() * r * 0.5, r * rand(0.5, 1), r * rand(0.4, 0.8), rand(0, TAU), 0, TAU); c.fill(); }
  }
  addShell(x, y, a, cls) {
    const c = this.dctx;
    c.save(); c.translate(x, y); c.rotate(a);
    c.fillStyle = cls === 'shotgun' ? '#b0352d' : '#c9a44b';
    if (cls === 'shotgun') c.fillRect(-4, -1.5, 8, 3); else c.fillRect(-2.5, -1, 5, 2);
    c.fillStyle = cls === 'shotgun' ? '#c9a44b' : '#e8d08a'; c.fillRect(cls === 'shotgun' ? -4 : -2.5, -1, 1.5, 2);
    c.restore();
  }
  addImpact(x, y) { const c = this.dctx; c.fillStyle = 'rgba(0,0,0,0.5)'; c.beginPath(); c.arc(x, y, 1.6, 0, TAU); c.fill(); c.fillStyle = 'rgba(255,255,255,0.08)'; c.beginPath(); c.arc(x, y, 3, 0, TAU); c.fill(); }
}
