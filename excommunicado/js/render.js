'use strict';
// ---------------------------------------------------------------------------
// Rendu : caméra, carte statique, décals, entités, éclairage, brouillard de
// vision (polygone de visibilité), effets et HUD.
// ---------------------------------------------------------------------------
class Renderer {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.w = 0; this.h = 0; this.dpr = 1; this.zoom = 1;
    this.light = document.createElement('canvas'); this.lctx = this.light.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  resize() {
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(this.w * this.dpr); this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px'; this.canvas.style.height = this.h + 'px';
    this.light.width = this.w; this.light.height = this.h;
    this.zoom = clamp(this.w / (34 * TILE), 1, 1.75);
  }
  toScreen(cam, x, y) { return { x: (x - cam.x) * this.zoom + this.w / 2, y: (y - cam.y) * this.zoom + this.h / 2 }; }
  render(game) {
    const ctx = this.ctx, w = this.w, h = this.h, z = this.zoom;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#050507'; ctx.fillRect(0, 0, w, h);
    if (!game.world) return;
    const world = game.world, cam = game.camera, p = game.player;
    ctx.save();
    ctx.translate(w / 2, h / 2); ctx.scale(z, z); ctx.translate(-cam.x, -cam.y);
    // Zone visible en coordonnées monde
    const vx0 = Math.max(0, cam.x - w / 2 / z - TILE), vy0 = Math.max(0, cam.y - h / 2 / z - TILE);
    const vx1 = Math.min(world.w * TILE, cam.x + w / 2 / z + TILE), vy1 = Math.min(world.h * TILE, cam.y + h / 2 / z + TILE);
    // Hors de la carte : masse du bâtiment
    ctx.fillStyle = (world.level.palette && world.level.palette.wallDark) || '#2c2a30';
    ctx.fillRect(cam.x - w / z, cam.y - h / z, w * 2 / z, h * 2 / z);
    if (vx1 > vx0 && vy1 > vy0) {
      ctx.drawImage(world.static, vx0, vy0, vx1 - vx0, vy1 - vy0, vx0, vy0, vx1 - vx0, vy1 - vy0);
      ctx.drawImage(world.decals, vx0, vy0, vx1 - vx0, vy1 - vy0, vx0, vy0, vx1 - vx0, vy1 - vy0);
    }
    // Lumières colorées (teinte additive)
    ctx.globalCompositeOperation = 'lighter';
    for (const L of world.spawns.lights) {
      if (L.x < vx0 - L.radius || L.x > vx1 + L.radius || L.y < vy0 - L.radius || L.y > vy1 + L.radius) continue;
      const g = ctx.createRadialGradient(L.x, L.y, 4, L.x, L.y, L.radius);
      const c = L.color; const a = (c[0] === 255 && c[1] > 180) ? 0.10 : 0.16;
      g.addColorStop(0, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(L.x - L.radius, L.y - L.radius, L.radius * 2, L.radius * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    // Corps
    for (const e of game.enemies) if (e.dead) this.drawCharacter(ctx, e, game);
    // Ramassages
    for (const pk of game.pickups) if (!pk.dead) this.drawPickup(ctx, pk, game);
    // Douilles en vol
    ctx.fillStyle = '#d4b45a';
    for (const s of game.shells) { ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.rot); ctx.fillRect(-2.5, -1, 5, 2); ctx.restore(); }
    // Ennemis visibles, à terre
    for (const e of game.enemies) if (!e.dead && e.visible) this.drawCharacter(ctx, e, game);
    // Objets lancés
    for (const t of game.thrown) { ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(t.rot); ctx.fillStyle = '#1a1a1e'; ctx.fillRect(-8, -2, 16, 4); ctx.restore(); }
    // Joueur
    if (p) this.drawCharacter(ctx, p, game);
    // Balles (traceurs)
    ctx.lineCap = 'round';
    for (const b of game.bullets) {
      const a = b.ammo.cls === 'rifle' ? 0.75 : 0.55;
      ctx.strokeStyle = b.ammo.tracer + a + ')'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(b.px, b.py); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    // Particules
    for (const pt of game.particles) {
      const t = pt.life / pt.maxLife;
      ctx.globalAlpha = clamp(t, 0, 1);
      ctx.fillStyle = pt.color;
      if (pt.kind === 'spark') { ctx.fillRect(pt.x - 1, pt.y - 0.5, 3, 1); }
      else { ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size, 0, TAU); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    // Flashs de bouche
    for (const f of game.flashes) {
      if (!f.visible) continue;
      const t = f.t / f.max; const s = f.size * (0.6 + t);
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.angle);
      ctx.globalAlpha = t; ctx.fillStyle = '#fff3c4';
      ctx.beginPath(); ctx.moveTo(0, -s * 0.35); ctx.lineTo(s * 1.6, 0); ctx.lineTo(0, s * 0.35); ctx.lineTo(-s * 0.2, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(s * 0.3, 0, s * 0.4, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // Cible d'exécution / indicateur de portée de mêlée
    if (p && p.alive && p.executing <= 0) {
      for (const e of game.enemies) if (!e.dead && e.visible && e.downed > 0 && dist(p.x, p.y, e.x, e.y) < 60) {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(e.x, e.y, 16, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // Éclairage (obscurité + trous de lumière), en espace écran
    ctx.restore();
    this.renderLighting(game);
    // Brouillard de vision : tout ce qui est hors du polygone visible est assombri
    if (game.visPoly && p) {
      ctx.save();
      ctx.translate(w / 2, h / 2); ctx.scale(z, z); ctx.translate(-cam.x, -cam.y);
      ctx.beginPath();
      ctx.rect(cam.x - w / z, cam.y - h / z, w * 2 / z, h * 2 / z);
      const pts = game.visPoly;
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.closePath();
      ctx.fillStyle = 'rgba(3,3,6,0.68)'; ctx.fill('evenodd');
      ctx.restore();
    }
    this.renderHUD(game);
  }
  renderLighting(game) {
    const lc = this.lctx, w = this.w, h = this.h, z = this.zoom, cam = game.camera, world = game.world;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = 'source-over';
    lc.clearRect(0, 0, w, h);
    lc.fillStyle = 'rgba(0,0,0,' + (1 - world.ambient) + ')'; lc.fillRect(0, 0, w, h);
    lc.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, a) => {
      const s = this.toScreen(cam, x, y); const rr = r * z;
      if (s.x < -rr || s.y < -rr || s.x > w + rr || s.y > h + rr) return;
      const g = lc.createRadialGradient(s.x, s.y, 0, s.x, s.y, rr);
      g.addColorStop(0, 'rgba(0,0,0,' + a + ')'); g.addColorStop(0.5, 'rgba(0,0,0,' + a * 0.5 + ')'); g.addColorStop(1, 'rgba(0,0,0,0)');
      lc.fillStyle = g; lc.fillRect(s.x - rr, s.y - rr, rr * 2, rr * 2);
    };
    for (const L of world.spawns.lights) hole(L.x, L.y, L.radius, 0.95);
    for (const f of game.flashes) if (f.visible) hole(f.x, f.y, 5 * TILE * (f.t / f.max), 0.9);
    if (game.player) hole(game.player.x, game.player.y, 4.5 * TILE, 0.55); // lumière ambiante autour du joueur
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.drawImage(this.light, 0, 0);
  }
  drawCharacter(ctx, c, game) {
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.angle);
    const down = c.dead || c.downed > 0;
    const body = c.isPlayer ? '#0c0c10' : c.color, hair = c.isPlayer ? '#16130f' : c.hair, skin = c.isPlayer ? '#d6b08f' : '#cfa887';
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(2, 2, 12, 9, 0, 0, TAU); ctx.fill();
    if (down) {
      if (c.dead) ctx.globalAlpha = 0.92;
      ctx.strokeStyle = skin; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-2, -6); ctx.lineTo(4, -15); ctx.moveTo(-2, 6); ctx.lineTo(-7, 14); ctx.stroke();
      ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(-4, 0, 16, 8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(11, 0, 6, 0, TAU); ctx.fill();
      ctx.fillStyle = hair; ctx.beginPath(); ctx.arc(13, 0, 5, 0, TAU); ctx.fill();
      if (c.helmet && c.helmet.hp > 0) { ctx.fillStyle = '#3a3f3c'; ctx.beginPath(); ctx.arc(12, 0, 7, 0, TAU); ctx.fill(); }
      if (!c.dead) { // à terre, se débat
        const t = Math.sin(game.time * 12) * 0.5;
        ctx.strokeStyle = body; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-14, -3); ctx.lineTo(-24, -8 + t * 4); ctx.moveTo(-14, 3); ctx.lineTo(-24, 8 - t * 4); ctx.stroke();
      }
      ctx.restore(); return;
    }
    const w = c.weapon; const two = w && w.def.twoHanded; const gunLen = w && w.def.type !== 'melee' ? w.def.len : 0;
    const punch = c.meleeAnim > 0 ? Math.sin((c.meleeAnim / 0.22) * Math.PI) : 0;
    ctx.strokeStyle = body; ctx.lineWidth = 5; ctx.lineCap = 'round';
    if (w && w.def.type !== 'melee' && (!c.isPlayer || c.executing <= 0 || true)) {
      const kick = w.recoil * 0.35;
      const hx = 12 - kick + (c.aiming ? 2 : 0), hy = two ? 3 : 4;
      const lx = two ? hx + 9 : hx - 2, ly = two ? hy - 1 : hy - 1.5;
      ctx.beginPath(); ctx.moveTo(0, 9); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(lx, ly); ctx.stroke();
      ctx.fillStyle = '#17171b'; ctx.fillRect(hx - 2, hy - 1.6, gunLen + 4, 3.2);
      if (two) ctx.fillRect(hx - 7, hy - 1, 9, 5);
      ctx.fillStyle = '#34343c'; ctx.fillRect(hx + gunLen - 1, hy - 1.6, 3, 3.2);
      if (w.reloading) { ctx.fillStyle = '#2a2a30'; ctx.fillRect(hx + 1, hy + 2, 3, 6 * (1 - w.reloadT / w.reloadDur) + 1); }
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(hx, hy, 2.6, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(lx, ly, 2.6, 0, TAU); ctx.fill();
    } else {
      const ext = punch * 11;
      ctx.beginPath(); ctx.moveTo(0, 9); ctx.lineTo(10 + ext, 5 - punch * 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(8, -6); ctx.stroke();
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(10 + ext, 5 - punch * 5, 2.8, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(8, -6, 2.8, 0, TAU); ctx.fill();
      if (w && w.def.type === 'melee') { ctx.fillStyle = '#d5d9e0'; ctx.fillRect(10 + ext, 4 - punch * 5, 11, 1.8); ctx.fillStyle = '#2a2a2e'; ctx.fillRect(8 + ext, 3.5 - punch * 5, 3, 3); }
    }
    ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(0, 0, 8, 11, 0, 0, TAU); ctx.fill();
    if (c.isPlayer) { ctx.fillStyle = '#e9e6de'; ctx.beginPath(); ctx.moveTo(4, -3); ctx.lineTo(7, 0); ctx.lineTo(4, 3); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#2a2a2e'; ctx.fillRect(5, -1, 2, 2); }
    if (c.armor && !c.isPlayer && c.armor.max >= 200 && c.armor.hp > 0) { ctx.strokeStyle = 'rgba(140,150,140,0.85)'; ctx.lineWidth = 2; ctx.strokeRect(-6, -7, 10, 14); }
    else if (c.armor && !c.isPlayer && c.armor.hp > 0) { ctx.strokeStyle = 'rgba(90,95,100,0.7)'; ctx.lineWidth = 1.5; ctx.strokeRect(-5, -6, 8, 12); }
    ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(1, 0, 6.2, 0, TAU); ctx.fill();
    ctx.fillStyle = hair; ctx.beginPath(); ctx.arc(-0.5, 0, 5.4, 0, TAU); ctx.fill();
    if (c.isPlayer) { ctx.fillStyle = '#2b241c'; ctx.beginPath(); ctx.arc(3.5, 0, 3.2, -1.2, 1.2); ctx.fill(); } // barbe
    if (c.helmet && c.helmet.hp > 0) { ctx.fillStyle = '#3a3f3c'; ctx.beginPath(); ctx.arc(0.5, 0, 7.3, 0, TAU); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.beginPath(); ctx.arc(-1.5, -1.5, 3.5, 0, TAU); ctx.fill(); }
    if (c.hurtFlash > 0) { ctx.fillStyle = 'rgba(255,40,40,' + Math.min(0.6, c.hurtFlash * 3) + ')'; ctx.beginPath(); ctx.ellipse(0, 0, 9, 12, 0, 0, TAU); ctx.fill(); }
    ctx.restore();
    // Barre de vie discrète pour les ennemis blessés visibles
    if (!c.isPlayer && c.hp < c.maxHp && game.settings.enemyBars) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(c.x - 12, c.y - 20, 24, 3);
      ctx.fillStyle = '#c33'; ctx.fillRect(c.x - 12, c.y - 20, 24 * clamp(c.hp / c.maxHp, 0, 1), 3);
    }
  }
  drawPickup(ctx, pk, game) {
    ctx.save(); ctx.translate(pk.x, pk.y);
    const pulse = 0.6 + 0.4 * Math.sin(game.time * 3 + pk.t);
    if (pk.kind === 'weapon') {
      ctx.rotate(pk.t);
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(-9, -2, 20, 6);
      ctx.fillStyle = '#26262c'; const len = pk.weapon.def.type === 'melee' ? 12 : pk.weapon.def.len + 4;
      ctx.fillRect(-len / 2, -1.8, len, 3.6);
      if (pk.weapon.def.type !== 'melee') { ctx.fillRect(-len / 2 + 3, 1, 3, 5); }
      else { ctx.fillStyle = '#d5d9e0'; ctx.fillRect(-2, -1, 8, 2); }
      ctx.strokeStyle = 'rgba(255,255,255,' + 0.25 * pulse + ')'; ctx.lineWidth = 1; ctx.strokeRect(-len / 2 - 1, -3, len + 2, 7);
    } else if (pk.kind === 'health') {
      ctx.fillStyle = '#e8e8e8'; ctx.fillRect(-7, -5, 14, 10);
      ctx.fillStyle = '#c62828'; ctx.fillRect(-1.5, -3.5, 3, 7); ctx.fillRect(-3.5, -1.5, 7, 3);
      ctx.strokeStyle = 'rgba(255,255,255,' + 0.3 * pulse + ')'; ctx.strokeRect(-8, -6, 16, 12);
    } else if (pk.kind === 'plate') {
      ctx.fillStyle = '#4a4f52'; ctx.fillRect(-6, -8, 12, 16); ctx.fillStyle = '#6a7074'; ctx.fillRect(-4, -6, 8, 12);
      ctx.strokeStyle = 'rgba(255,255,255,' + 0.3 * pulse + ')'; ctx.strokeRect(-7, -9, 14, 18);
    } else if (pk.kind === 'ammo') {
      ctx.fillStyle = '#3b3a2c'; ctx.fillRect(-7, -5, 14, 10); ctx.fillStyle = '#c9a44b'; ctx.fillRect(-5, -3, 3, 6); ctx.fillRect(-1, -3, 3, 6); ctx.fillRect(3, -3, 3, 6);
      ctx.strokeStyle = 'rgba(255,255,255,' + 0.3 * pulse + ')'; ctx.strokeRect(-8, -6, 16, 12);
    }
    ctx.restore();
  }
  // ------------------------------------------------------------------------
  // HUD
  // ------------------------------------------------------------------------
  renderHUD(game) {
    const ctx = this.ctx, w = this.w, h = this.h, p = game.player; if (!p) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.textBaseline = 'alphabetic';
    // Vignette de dégâts
    if (game.hurtVignette > 0) {
      const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.75);
      g.addColorStop(0, 'rgba(120,0,0,0)'); g.addColorStop(1, 'rgba(140,0,0,' + (0.65 * game.hurtVignette) + ')');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    if (p.hp < 35 && p.alive) {
      const a = (35 - p.hp) / 35 * (0.25 + 0.15 * Math.sin(game.time * 4));
      const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.8);
      g.addColorStop(0, 'rgba(90,0,0,0)'); g.addColorStop(1, 'rgba(90,0,0,' + a + ')'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    // Vignette cinéma
    const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, h * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
    // Indicateurs de direction des dégâts
    for (const d of game.dmgIndicators) {
      const s = this.toScreen(game.camera, p.x, p.y);
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(d.angle); ctx.globalAlpha = d.t;
      ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 58, -0.35, 0.35); ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    const font = (sz, weight = 500) => { ctx.font = weight + ' ' + sz + 'px "Segoe UI", Roboto, Helvetica, Arial, sans-serif'; };
    // --- Bas gauche : santé / costume / endurance
    const bx = 28, by = h - 34;
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(bx - 12, by - 62, 264, 84);
    font(11, 600); ctx.fillStyle = '#bbb'; ctx.textAlign = 'left';
    ctx.fillText('SANTÉ', bx, by - 44);
    ctx.fillStyle = '#2a2a2e'; ctx.fillRect(bx, by - 38, 240, 10);
    ctx.fillStyle = p.hp > 35 ? '#c62828' : '#ff3b3b'; ctx.fillRect(bx, by - 38, 240 * clamp(p.hp / p.maxHp, 0, 1), 10);
    ctx.fillStyle = '#bbb'; ctx.fillText('COSTUME BALISTIQUE', bx, by - 16);
    ctx.fillStyle = '#2a2a2e'; ctx.fillRect(bx, by - 11, 240, 6);
    ctx.fillStyle = p.armor.hp > 0 ? '#8a98a8' : '#553'; ctx.fillRect(bx, by - 11, 240 * clamp(p.armor.hp / p.armor.max, 0, 1), 6);
    ctx.fillStyle = '#2a2a2e'; ctx.fillRect(bx, by + 2, 240, 3);
    ctx.fillStyle = p.stamina < 20 ? '#d08a2a' : '#6a9a6a'; ctx.fillRect(bx, by + 2, 240 * clamp(p.stamina / 100, 0, 1), 3);
    // Kits de soins
    for (let i = 0; i < p.medkits; i++) { ctx.fillStyle = '#e8e8e8'; ctx.fillRect(bx + 208 + i * 16, by - 60, 12, 10); ctx.fillStyle = '#c62828'; ctx.fillRect(bx + 213 + i * 16, by - 58, 2, 6); ctx.fillRect(bx + 211 + i * 16, by - 56, 6, 2); }
    if (p.healing > 0) { ctx.fillStyle = '#e8e8e8'; ctx.fillRect(bx, by + 8, 240 * (1 - p.healing / 3), 2); }
    // --- Bas droite : arme
    const wpn = p.weapon; const rx = w - 28, ry = h - 34;
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(rx - 268, ry - 62, 280, 84);
    ctx.textAlign = 'right';
    if (wpn) {
      font(13, 600); ctx.fillStyle = '#ddd'; ctx.fillText(wpn.def.name.toUpperCase(), rx, ry - 44);
      font(10, 500); ctx.fillStyle = '#999'; ctx.fillText(weaponModeLabel(wpn) + (wpn.def.type !== 'melee' ? '  ·  ' + AMMO[wpn.def.ammo].cls.toUpperCase() : ''), rx, ry - 30);
      if (wpn.def.type !== 'melee') {
        const rounds = weaponRounds(wpn);
        font(30, 700); ctx.fillStyle = rounds === 0 ? '#ff5252' : (rounds <= 3 ? '#ffb74d' : '#fff');
        const txt = wpn.mag + (wpn.chamber ? '+1' : '');
        ctx.fillText(txt, rx, ry + 2);
        // Réserve : chargeurs individuels
        const mags = wpn.def.type === 'shotgun' ? null : wpn.mags;
        font(10, 500); ctx.fillStyle = '#aaa'; ctx.textAlign = 'left';
        if (mags) {
          let mx = rx - 262;
          ctx.fillText('CHARGEURS', mx, ry - 16);
          const sorted = mags.slice().sort((a, b) => b - a);
          for (let i = 0; i < sorted.length && i < 8; i++) {
            const hgt = 22, fill = sorted[i] / wpn.def.magSize;
            ctx.fillStyle = '#2a2a2e'; ctx.fillRect(mx + i * 16, ry - 10, 12, hgt);
            ctx.fillStyle = fill >= 0.99 ? '#c9a44b' : '#8f7a3f'; ctx.fillRect(mx + i * 16, ry - 10 + hgt * (1 - fill), 12, hgt * fill);
            ctx.fillStyle = '#111'; font(9, 700); ctx.textAlign = 'center'; ctx.fillText(sorted[i], mx + i * 16 + 6, ry + 6); ctx.textAlign = 'left'; font(10, 500);
          }
          if (!sorted.length) { ctx.fillStyle = '#ff5252'; ctx.fillText('AUCUN', mx, ry + 4); }
        } else {
          ctx.fillText('CARTOUCHES : ' + wpn.shells, rx - 262, ry - 16);
          for (let i = 0; i < Math.min(wpn.shells, 14); i++) { ctx.fillStyle = '#b0352d'; ctx.fillRect(rx - 262 + i * 9, ry - 8, 6, 14); ctx.fillStyle = '#c9a44b'; ctx.fillRect(rx - 262 + i * 9, ry - 8, 6, 3); }
        }
        if (wpn.reloading) { ctx.fillStyle = '#2a2a2e'; ctx.fillRect(rx - 120, ry + 10, 120, 3); ctx.fillStyle = '#fff'; ctx.fillRect(rx - 120, ry + 10, 120 * (wpn.reloadT / wpn.reloadDur), 3); }
        else if (rounds === 0) { font(10, 600); ctx.fillStyle = '#ff5252'; ctx.textAlign = 'right'; ctx.fillText(wpn.def.type === 'shotgun' ? 'VIDE' : 'CULASSE OUVERTE', rx, ry + 16); }
      } else { font(30, 700); ctx.fillStyle = '#fff'; ctx.fillText('—', rx, ry + 2); }
    }
    // Inventaire (emplacements)
    ctx.textAlign = 'left'; font(10, 600);
    for (let i = 0; i < p.weapons.length; i++) {
      const ww = p.weapons[i]; const sx = rx - 268 + i * 62, sy = ry - 78;
      ctx.fillStyle = i === p.current ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.4)'; ctx.fillRect(sx, sy, 58, 14);
      ctx.fillStyle = i === p.current ? '#fff' : '#888'; ctx.fillText((i + 1) + ' ' + ww.def.short + (ww.def.type !== 'melee' ? ' ' + weaponRounds(ww) : ''), sx + 4, sy + 10);
    }
    // --- Haut gauche : objectif
    ctx.textAlign = 'left';
    font(13, 700); ctx.fillStyle = '#fff'; ctx.fillText(game.level.title.toUpperCase(), 28, 34);
    font(12, 500); ctx.fillStyle = '#bbb';
    if (game.level.waves) ctx.fillText('Vague ' + game.wave + '  ·  ennemis restants : ' + game.aliveEnemies() + (game.waveTimer > 0 ? '  ·  prochaine vague dans ' + Math.ceil(game.waveTimer) + 's' : ''), 28, 54);
    else ctx.fillText((game.aliveEnemies() > 0 ? 'Cibles restantes : ' + game.aliveEnemies() : 'Zone nettoyée — rejoignez la sortie'), 28, 54);
    // --- Haut droite : chrono / éliminations
    ctx.textAlign = 'right'; font(12, 500); ctx.fillStyle = '#bbb';
    ctx.fillText(fmtTime(game.time) + '   ·   ' + game.stats.kills + ' éliminations   ·   ' + game.stats.headshots + ' têtes', w - 28, 34);
    // --- Messages
    ctx.textAlign = 'center';
    let my = h - 132;
    for (const m of game.messages) { font(14, 600); ctx.globalAlpha = clamp(m.t, 0, 1); ctx.fillStyle = '#000'; ctx.fillText(m.text, w / 2 + 1, my + 1); ctx.fillStyle = '#fff'; ctx.fillText(m.text, w / 2, my); my -= 20; }
    ctx.globalAlpha = 1;
    // --- Rappel des commandes (début de niveau)
    if (game.hintT > 0 && p.alive) {
      const gpm = game.input.usingGamepad && game.input.gp.connected;
      const hint = gpm ? 'R2 tirer · L2 viser · R1 mêlée / désarmer / projeter / exécuter · ✕ esquive · □ recharger · △ ramasser · L1 lancer · ↑ soins · ←→ armes · L3 courir · Options pause'
                       : 'Clic tirer · Clic droit viser · F mêlée / désarmer / projeter / exécuter · Espace esquive · R recharger · E ramasser · G lancer · H soins · 1-4 armes · Maj courir · Échap pause';
      font(12, 500); ctx.textAlign = 'center'; ctx.globalAlpha = clamp(game.hintT, 0, 1) * 0.85;
      ctx.fillStyle = '#000'; ctx.fillText(hint, w / 2 + 1, h - 105); ctx.fillStyle = '#ddd'; ctx.fillText(hint, w / 2, h - 106);
      ctx.globalAlpha = 1;
    }
    // --- Invite d'interaction
    if (game.nearPickup && p.alive) {
      const s = this.toScreen(game.camera, game.nearPickup.x, game.nearPickup.y);
      font(12, 600); ctx.fillStyle = 'rgba(0,0,0,0.6)'; const txt = '[' + game.input.glyph('interact') + '] ' + game.nearPickup.label(); const tw = ctx.measureText(txt).width;
      ctx.fillRect(s.x - tw / 2 - 6, s.y - 34, tw + 12, 18); ctx.fillStyle = '#fff'; ctx.fillText(txt, s.x, s.y - 21);
    }
    // --- Réticule
    if (game.settings.crosshair && p.alive && game.state === 'playing') {
      const usingGp = game.input.usingGamepad && game.input.gp.connected;
      const ap = usingGp ? this.toScreen(game.camera, game.aimPoint.x, game.aimPoint.y) : game.input.mouse;
      const mx = ap.x, my2 = ap.y;
      const ps = this.toScreen(game.camera, p.x, p.y);
      const d = Math.max(30, dist(ps.x, ps.y, mx, my2));
      const gap = clamp(Math.tan(rad(p.spread)) * d + 4, 4, 80);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5;
      if (wpn && wpn.def.type === 'melee') { ctx.beginPath(); ctx.arc(mx, my2, 5, 0, TAU); ctx.stroke(); }
      else {
        ctx.beginPath();
        ctx.moveTo(mx - gap - 7, my2); ctx.lineTo(mx - gap, my2); ctx.moveTo(mx + gap, my2); ctx.lineTo(mx + gap + 7, my2);
        ctx.moveTo(mx, my2 - gap - 7); ctx.lineTo(mx, my2 - gap); ctx.moveTo(mx, my2 + gap); ctx.lineTo(mx, my2 + gap + 7);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(mx - 1, my2 - 1, 2, 2);
      }
    }
  }
}
