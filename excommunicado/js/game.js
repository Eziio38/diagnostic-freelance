'use strict';
// ---------------------------------------------------------------------------
// Boucle de jeu, gestion des niveaux, effets, statistiques, menus.
// ---------------------------------------------------------------------------
const DIFFICULTIES = {
  cinema:   { label: 'Cinéma', desc: 'Plus permissif : les tirs à la tête vous laissent une chance, les ennemis visent moins bien.', playerHeadMult: 0.55, playerDmgMult: 0.75, enemySpreadMult: 1.4, enemyReactionMult: 1.3 },
  realiste: { label: 'Réaliste', desc: 'Létalité réelle : trois balles au torse sans protection, une seule à la tête suffit presque.', playerHeadMult: 0.85, playerDmgMult: 1, enemySpreadMult: 1, enemyReactionMult: 1 },
  babayaga: { label: 'Baba Yaga', desc: 'Tirs à la tête létaux pour tout le monde, ennemis vifs et précis. Pas de barre de vie ennemie.', playerHeadMult: 1.0, playerDmgMult: 1.1, enemySpreadMult: 0.85, enemyReactionMult: 0.85 }
};

class Stats {
  constructor() { this.shots = 0; this.hits = 0; this.kills = 0; this.headshots = 0; this.meleeKills = 0; this.executions = 0; this.throws = 0; this.disarms = 0; this.meleeHits = 0; this.damageTaken = 0; this.time = 0; this.wavesSurvived = 0; }
  hitsOn(owner, target) { if (owner && owner.isPlayer && target && !target.isPlayer) this.hits++; }
}

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.input = new Input(this.canvas);
    this.audio = new AudioSys();
    this.renderer = new Renderer(this.canvas);
    this.state = 'menu'; this.levelIndex = 0; this.level = null; this.world = null; this.player = null;
    this.enemies = []; this.bullets = []; this.pickups = []; this.particles = []; this.shells = []; this.flashes = []; this.thrown = []; this.noises = []; this.messages = []; this.dmgIndicators = [];
    this.characters = [];
    this.camera = { x: 0, y: 0 }; this.shakeAmt = 0; this.hurtVignette = 0; this.time = 0; this.last = 0;
    this.visPoly = null; this.nearPickup = null; this.deadT = 0;
    this.wave = 0; this.waveTimer = 0; this.waveQueue = []; this.waveSpawnT = 0;
    const diff = Store.get('difficulty', 'realiste');
    this.settings = { difficulty: diff, crosshair: Store.get('crosshair', true), enemyBars: diff !== 'babayaga', aimAssist: Store.get('aimAssist', true), view: Store.get('view', 'top'), sensitivity: Store.get('sensitivity', 1) };
    this.fp = new FPRenderer(this.renderer); this.ignoreUnlock = false;
    this.input.onLockChange = locked => { if (!locked && this.state === 'playing' && this.fpMode && !this.ignoreUnlock) this.pause(); this.ignoreUnlock = false; };
    this.aimPoint = { x: 0, y: 0 }; this.hintT = 0;
    this.input.onConnect = pad => { this.msg('Manette connectée : ' + (/dualsense|054c/i.test(pad.id) ? 'DualSense' : pad.id.slice(0, 24))); };
    Object.assign(this.settings, DIFFICULTIES[diff]);
    this.stats = new Stats();
    this.unlocked = Store.get('unlocked', 1);
    this.ui = new UI(this);
    requestAnimationFrame(t => this.loop(t));
  }
  get fpMode() { return this.settings.view === 'fp'; }
  setView(v) {
    if (v !== 'fp' && v !== 'top') return;
    const was = this.settings.view; this.settings.view = v; Store.set('view', v);
    if (was === v) return;
    if (v === 'fp') { if (this.state === 'playing' && !this.input.usingGamepad) this.input.requestLock(); }
    else if (this.input.locked) { this.ignoreUnlock = true; this.input.releaseLock(); }
    if (this.player) this.player.pitch = 0;
    if (this.state === 'playing') this.msg(v === 'fp' ? 'Vue à la première personne' : 'Vue du dessus');
  }
  toggleView() { this.setView(this.fpMode ? 'top' : 'fp'); }
  faceOpenDirection() {
    const p = this.player, w = this.world; let best = 0, bestD = -1;
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * TAU;
      const rc = w.raycast(p.x, p.y, p.x + Math.cos(a) * 20 * TILE, p.y + Math.sin(a) * 20 * TILE, (tx, ty) => w.isOpaque(tx, ty));
      const d = dist(p.x, p.y, rc.x, rc.y); if (d > bestD) { bestD = d; best = a; }
    }
    p.angle = best; p.stickAngle = best; p.mouseAngle = best; p.pitch = 0;
  }
  setDifficulty(id) {
    this.settings.difficulty = id; Object.assign(this.settings, DIFFICULTIES[id]); this.settings.enemyBars = id !== 'babayaga'; Store.set('difficulty', id);
  }
  // ------------------------------------------------------------------------
  // Niveaux
  // ------------------------------------------------------------------------
  loadLevel(i) {
    this.levelIndex = i; const L = LEVELS[i]; this.level = L;
    this.world = new World(L);
    this.enemies = []; this.bullets = []; this.pickups = []; this.particles = []; this.shells = []; this.flashes = []; this.thrown = []; this.noises = []; this.messages = []; this.dmgIndicators = [];
    this.time = 0; this.stats = new Stats(); this.deadT = 0; this.hurtVignette = 0; this.shakeAmt = 0;
    this.wave = 0; this.waveTimer = 0; this.waveQueue = []; this.exitReached = false; this.cleared = false;
    const sp = this.world.spawns;
    this.player = new Player(sp.player.x, sp.player.y);
    this.player.setWeapons(L.loadout.map(([id, opts]) => makeWeapon(id, opts || {})));
    this.player.medkits = L.medkits != null ? L.medkits : 1;
    for (const e of sp.enemies) this.enemies.push(new Enemy(e.x, e.y, e.type));
    for (const pk of sp.pickups) {
      if (pk.kind === 'weapon') this.pickups.push(new Pickup('weapon', pk.x, pk.y, { weapon: makeWeapon(pk.weapon, { mags: 2 }) }));
      else if (pk.kind === 'ammo') this.pickups.push(new Pickup('ammo', pk.x, pk.y, { ammoFor: L.loadout[1][0], amount: 2 }));
      else this.pickups.push(new Pickup(pk.kind, pk.x, pk.y));
    }
    this.camera.x = this.player.x; this.camera.y = this.player.y;
    this.aimPoint.x = this.player.x + 3 * TILE; this.aimPoint.y = this.player.y;
    this.fp.setWorld(this.world); this.faceOpenDirection();
    this.characters = [this.player].concat(this.enemies);
    this.state = 'briefing';
    this.ui.showBriefing(L);
  }
  beginPlay() {
    this.audio.init(); this.audio.resume();
    this.state = 'playing'; this.last = performance.now();
    this.audio.startMusic(this.level.music);
    if (this.level.waves) { this.waveTimer = 6; this.msg('Première vague dans 6 secondes'); }
    this.hintT = 12;
    this.ui.hideAll();
    if (this.fpMode && !this.input.usingGamepad) this.input.requestLock();
  }
  pause() { if (this.state !== 'playing') return; this.state = 'paused'; this.ui.show('pause'); if (this.audio.ctx) this.audio.ctx.suspend(); if (this.input.locked) { this.ignoreUnlock = true; this.input.releaseLock(); } }
  resume() { if (this.state !== 'paused') return; this.state = 'playing'; this.ui.hideAll(); this.last = performance.now(); if (this.audio.ctx) this.audio.ctx.resume(); this.input.endFrame(); if (this.fpMode && !this.input.usingGamepad) this.input.requestLock(); }
  toMenu() { if (this.input.locked) { this.ignoreUnlock = true; this.input.releaseLock(); } this.state = 'menu'; this.audio.stopMusic(); if (this.audio.ctx) this.audio.ctx.resume(); this.ui.show('menu'); }
  // ------------------------------------------------------------------------
  // Boucle
  // ------------------------------------------------------------------------
  loop(ts) {
    const dt = clamp((ts - this.last) / 1000 || 0, 0, 0.033); this.last = ts;
    this.input.poll();
    const cursor = this.input.usingGamepad ? 'none' : 'crosshair';
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
    if (this.ui.anyVisible()) this.ui.gamepadNav();
    if (this.state === 'playing' || this.state === 'dead' || this.state === 'complete') this.update(dt);
    if (this.state !== 'menu') { if (this.fpMode && this.world) this.fp.render(this); else this.renderer.render(this); }
    else this.ui.renderMenuBackdrop(this.renderer);
    this.input.endFrame();
    requestAnimationFrame(t => this.loop(t));
  }
  update(dt) {
    this.time += dt; this.stats.time = this.time;
    const p = this.player, input = this.input, world = this.world;
    if (this.state === 'playing') {
      if (input.pressed('pause')) { this.pause(); input.consumeGamepad(); return; }
      if (input.pressed('view')) this.toggleView();
      p.update(dt, this, input);
    } else { p.baseUpdate(dt); }
    this.characters = [p].concat(this.enemies.filter(e => !e.dead));
    for (const e of this.enemies) e.update(dt, this);
    for (const b of this.bullets) b.update(dt, this);
    this.bullets = this.bullets.filter(b => !b.dead);
    for (const t of this.thrown) t.update(dt, this);
    this.thrown = this.thrown.filter(t => !t.dead);
    // Séparation joueur / ennemis
    for (const e of this.enemies) {
      if (e.dead || e.downed > 0) continue;
      const d = dist(p.x, p.y, e.x, e.y), min = p.r + e.r;
      if (d < min && d > 0.01) { const push = (min - d) / 2; const nx = (e.x - p.x) / d, ny = (e.y - p.y) / d; world.moveCircle(e, nx * push, ny * push); if (p.alive) world.moveCircle(p, -nx * push, -ny * push); }
    }
    world.updateDoors(dt, this.characters, this.audio, p);
    // Effets
    for (const pt of this.particles) { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vx *= 0.9; pt.vy *= 0.9; pt.life -= dt; }
    this.particles = this.particles.filter(pt => pt.life > 0);
    for (const s of this.shells) { s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.92; s.vy *= 0.92; s.rot += s.vr * dt; s.life -= dt; if (s.life <= 0) { world.addShell(s.x, s.y, s.rot, s.cls); this.audio.shellDrop(this.panOf(s.x, s.y)); } }
    this.shells = this.shells.filter(s => s.life > 0);
    for (const f of this.flashes) f.t -= dt;
    this.flashes = this.flashes.filter(f => f.t > 0);
    for (const m of this.messages) m.t -= dt;
    this.messages = this.messages.filter(m => m.t > 0);
    for (const d of this.dmgIndicators) d.t -= dt * 0.8;
    this.dmgIndicators = this.dmgIndicators.filter(d => d.t > 0);
    this.noises = this.noises.filter(n => this.time - n.t < 0.5);
    if (this.hurtVignette > 0) this.hurtVignette -= dt * 1.5;
    if (this.hintT > 0) this.hintT -= dt;
    this.shakeAmt *= Math.pow(0.02, dt);
    // Caméra
    const m = this.mouseWorld();
    let lx = (m.x - p.x) * 0.28, ly = (m.y - p.y) * 0.28; const ll = Math.hypot(lx, ly);
    if (ll > 150) { lx *= 150 / ll; ly *= 150 / ll; }
    const tx = p.x + lx, ty = p.y + ly;
    const k = 1 - Math.pow(0.001, dt);
    this.camera.x += (tx - this.camera.x) * k; this.camera.y += (ty - this.camera.y) * k;
    if (this.shakeAmt > 0.2) { this.camera.x += gauss() * this.shakeAmt; this.camera.y += gauss() * this.shakeAmt; }
    // Visibilité
    const range = (this.level.viewRange || 13) * TILE;
    this.visPoly = this.fpMode ? null : world.visibility(p.x, p.y, range);
    for (const e of this.enemies) {
      if (e.dead) { e.visible = true; continue; }
      const d = dist(p.x, p.y, e.x, e.y);
      e.visible = d < range * 1.05 && world.los(p.x, p.y, e.x, e.y);
    }
    // Ramassage à proximité
    this.nearPickup = null; let bd = 26 + p.r;
    for (const pk of this.pickups) { if (pk.dead) continue; const d = dist(p.x, p.y, pk.x, pk.y); if (d < bd) { bd = d; this.nearPickup = pk; } }
    this.pickups = this.pickups.filter(pk => !pk.dead);
    // Fin de niveau / mort
    if (this.state === 'playing') {
      if (this.level.waves) this.updateWaves(dt);
      else {
        const alive = this.aliveEnemies();
        if (alive === 0 && !this.cleared) { this.cleared = true; this.msg('Zone nettoyée — rejoignez la sortie'); }
        const tt = world.get(Math.floor(p.x / TILE), Math.floor(p.y / TILE));
        if (tt === T.EXIT) {
          if (alive === 0) this.completeLevel();
          else if (!this.exitReached) { this.exitReached = true; this.msg('Il reste ' + alive + ' cible(s) à éliminer'); }
        } else this.exitReached = false;
      }
    } else if (this.state === 'dead') {
      this.deadT += dt;
      if (this.deadT > 1.8 && !this.ui.visible('dead')) this.ui.showDead();
    }
  }
  aliveEnemies() { let n = 0; for (const e of this.enemies) if (!e.dead) n++; return n; }
  completeLevel() {
    this.state = 'complete';
    this.audio.stopMusic();
    if (this.levelIndex + 1 < LEVELS.length && this.levelIndex + 2 > this.unlocked) { this.unlocked = Math.min(LEVELS.length, this.levelIndex + 2); Store.set('unlocked', this.unlocked); }
    const best = Store.get('best_' + this.level.id, null);
    if (!best || this.time < best) Store.set('best_' + this.level.id, this.time);
    this.ui.showComplete();
  }
  // ------------------------------------------------------------------------
  // Vagues (mode survie)
  // ------------------------------------------------------------------------
  updateWaves(dt) {
    if (this.waveTimer > 0) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) this.startWave();
      return;
    }
    if (this.waveQueue.length) {
      this.waveSpawnT -= dt;
      if (this.waveSpawnT <= 0) { this.waveSpawnT = 0.7; this.spawnFromQueue(); }
    } else if (this.aliveEnemies() === 0) {
      this.stats.wavesSurvived = this.wave;
      this.waveTimer = 12; this.msg('Vague ' + this.wave + ' repoussée. Réapprovisionnement.');
      for (const w of this.player.weapons) if (w.def.type !== 'melee') weaponAddMags(w, 1);
      if (this.wave % 3 === 0) { this.player.medkits++; this.player.armor.hp = Math.min(this.player.armor.max, this.player.armor.hp + 60); }
    }
  }
  startWave() {
    this.wave++;
    const n = 4 + this.wave * 2; const q = [];
    for (let i = 0; i < n; i++) {
      const r = Math.random(); let t = 'thug';
      if (this.wave >= 6 && r < 0.18) t = 'armored';
      else if (this.wave >= 4 && r < 0.35) t = 'rifleman';
      else if (this.wave >= 2 && r < 0.6) t = 'sicario';
      else if (this.wave >= 2 && r < 0.75) t = 'knife';
      q.push(t);
    }
    if (this.wave % 5 === 0) q.push('boss');
    this.waveQueue = q; this.waveSpawnT = 0;
    this.msg('Vague ' + this.wave + ' — ' + q.length + ' contrats');
    this.audio.shout(0, 0.6);
  }
  spawnFromQueue() {
    const pts = this.world.spawns.waves.filter(s => dist(s.x, s.y, this.player.x, this.player.y) > 9 * TILE && !this.world.los(this.player.x, this.player.y, s.x, s.y));
    const s = pts.length ? choice(pts) : choice(this.world.spawns.waves);
    const e = new Enemy(s.x + gauss() * 10, s.y + gauss() * 10, this.waveQueue.shift());
    e.brain.state = 'alert'; e.brain.mode = e.brain.role === 'melee' ? 'melee' : 'investigate'; e.brain.goal = { x: this.player.x, y: this.player.y };
    e.brain.lastSeen = { x: this.player.x, y: this.player.y, t: this.time, heard: true };
    this.enemies.push(e);
  }
  // ------------------------------------------------------------------------
  // Événements de jeu
  // ------------------------------------------------------------------------
  mouseWorld() { if (this.fpMode || (this.input.usingGamepad && this.input.gp.connected)) return { x: this.aimPoint.x, y: this.aimPoint.y }; const r = this.renderer; return { x: (this.input.mouse.x - r.w / 2) / r.zoom + this.camera.x, y: (this.input.mouse.y - r.h / 2) / r.zoom + this.camera.y }; }
  panOf(x, y) {
    if (this.fpMode && y != null) return clamp(Math.sin(angleDiff(this.player.angle, angleTo(this.player.x, this.player.y, x, y))) * 0.85, -1, 1);
    return clamp((x - this.player.x) / (12 * TILE), -1, 1);
  }
  volOf(x, y) { const d = dist(x, y, this.player.x, this.player.y); return Math.pow(clamp(1 - d / (32 * TILE), 0.03, 1), 1.4); }
  shake(n) { this.shakeAmt = Math.max(this.shakeAmt, n); }
  msg(text) { if (this.messages.length && this.messages[this.messages.length - 1].text === text) { this.messages[this.messages.length - 1].t = 2.2; return; } this.messages.push({ text, t: 2.2 }); if (this.messages.length > 4) this.messages.shift(); }
  noise(x, y, r, source) { this.noises.push({ x, y, r, t: this.time, source }); }
  shoot(shooter, mz, ammo) {
    const w = shooter.weapon;
    const vol = shooter.isPlayer ? 1 : this.volOf(mz.x, mz.y);
    this.audio.gunshot(ammo.cls, shooter.isPlayer ? 0 : this.panOf(mz.x, mz.y), vol);
    const visible = shooter.isPlayer || this.world.los(this.player.x, this.player.y, mz.x, mz.y);
    this.flashes.push({ x: mz.x, y: mz.y, angle: shooter.angle, owner: shooter, t: 0.05, max: 0.05, size: ammo.cls === 'shotgun' ? 16 : ammo.cls === 'rifle' ? 13 : 10, visible });
    this.noise(mz.x, mz.y, w.def.noise * TILE, shooter);
    // Douille éjectée vers la droite du tireur
    const ea = shooter.angle + HALF_PI + rand(-0.4, 0.4); const sp = rand(90, 160);
    this.shells.push({ x: mz.x - Math.cos(shooter.angle) * (w.def.len - 2), y: mz.y - Math.sin(shooter.angle) * (w.def.len - 2), vx: Math.cos(ea) * sp, vy: Math.sin(ea) * sp, rot: rand(0, TAU), vr: rand(-20, 20), life: rand(0.35, 0.5), cls: ammo.cls });
    if (shooter.isPlayer) { this.shake(ammo.cls === 'shotgun' ? 5 : ammo.cls === 'rifle' ? 2.2 : 1.8); this.input.rumble(ammo.cls === 'shotgun' ? 1 : ammo.cls === 'rifle' ? 0.5 : 0.7, ammo.cls === 'shotgun' ? 0.8 : 0.35, ammo.cls === 'shotgun' ? 150 : ammo.cls === 'rifle' ? 60 : 90); }
    // Fumée légère
    for (let i = 0; i < 3; i++) this.particles.push({ x: mz.x, y: mz.y, vx: Math.cos(shooter.angle + gauss() * 0.4) * rand(40, 120), vy: Math.sin(shooter.angle + gauss() * 0.4) * rand(40, 120), life: rand(0.15, 0.35), maxLife: 0.35, color: 'rgba(200,200,200,0.35)', size: rand(1.5, 3), kind: 'smoke' });
  }
  blood(x, y, dir, amount) {
    this.world.addBlood(x, y, dir, amount);
    for (let i = 0; i < 6 + amount * 6; i++) {
      const a = dir + gauss() * 0.7; const sp = rand(60, 220) * (0.6 + amount * 0.4);
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.2, 0.5), maxLife: 0.5, color: 'rgba(150,10,20,0.9)', size: rand(1, 2.5), kind: 'blood' });
    }
  }
  spark(x, y, n) {
    for (let i = 0; i < n; i++) { const a = rand(0, TAU), sp = rand(80, 260); this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.1, 0.3), maxLife: 0.3, color: '#ffd67a', size: 1.5, kind: 'spark' }); }
  }
  impact(x, y, angle, metal) {
    this.world.addImpact(x, y);
    for (let i = 0; i < 5; i++) { const a = angle + Math.PI + gauss() * 1.2, sp = rand(40, 160); this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.15, 0.4), maxLife: 0.4, color: metal ? '#ffd67a' : 'rgba(180,170,150,0.7)', size: rand(1, 2), kind: metal ? 'spark' : 'dust' }); }
  }
  glassFx(x, y, angle) {
    for (let i = 0; i < 12; i++) { const a = angle + gauss() * 1.4, sp = rand(30, 200); this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.3, 0.7), maxLife: 0.7, color: 'rgba(200,240,255,0.8)', size: rand(1, 2), kind: 'glass' }); }
  }
  onPlayerHurt(dmg, shooter) {
    this.stats.damageTaken += dmg;
    this.hurtVignette = 1; this.shake(4); this.audio.hurt(); this.input.rumble(0.9, 0.5, 220);
    if (shooter) this.dmgIndicators.push({ angle: angleTo(this.player.x, this.player.y, shooter.x, shooter.y), t: 1 });
    if (this.player.healing > 0) { this.player.healing = 0; this.msg('Soins interrompus'); }
  }
  kill(target, killer, zone, cls) {
    if (target.dead) return;
    target.dead = true; target.hp = 0; target.downed = 0; target.stagger = 0;
    this.world.addPool(target.x, target.y, 14);
    this.audio.bodyFall(this.panOf(target.x, target.y));
    if (target.isPlayer) {
      this.state = 'dead'; this.deadT = 0; this.audio.stopMusic();
      return;
    }
    // Statistiques
    if (killer && killer.isPlayer) {
      this.stats.kills++;
      if (zone === 'head' && cls !== 'execution' && cls !== 'melee') this.stats.headshots++;
      if (cls === 'melee') this.stats.meleeKills++;
      if (cls === 'execution') this.stats.executions++;
    }
    // L'arme tombe au sol (avec ses munitions restantes)
    if (target.weapon) {
      const w = target.weapon;
      const a = rand(0, TAU);
      this.pickups.push(new Pickup('weapon', target.x + Math.cos(a) * 14, target.y + Math.sin(a) * 14, { weapon: w }));
      target.weapon = null; target.weapons = [];
    }
    if (target.type && target.type.boss) { this.pickups.push(new Pickup('plate', target.x + 20, target.y)); }
    // Les alliés proches sont alertés
    for (const e of this.enemies) {
      if (e.dead || e === target) continue;
      if (dist(e.x, e.y, target.x, target.y) < 7 * TILE && this.world.los(e.x, e.y, target.x, target.y)) {
        const b = e.brain;
        if (b.state === 'idle') { b.state = 'alert'; b.mode = b.role === 'melee' ? 'melee' : 'investigate'; b.goal = { x: target.x, y: target.y }; b.path = null; }
        if (killer && !b.lastSeen) b.lastSeen = { x: killer.x, y: killer.y, t: this.time, heard: true };
      }
    }
  }
  interact() {
    const pk = this.nearPickup, p = this.player; if (!pk) return;
    if (pk.kind === 'weapon') { if (p.addWeapon(pk.weapon, this)) pk.dead = true; }
    else if (pk.kind === 'health') { p.medkits++; pk.dead = true; this.msg('Kit de soins (+1) — ' + (this.input.usingGamepad ? 'D-pad haut' : 'touche H')); this.audio.pickup(); }
    else if (pk.kind === 'plate') { p.armor.hp = Math.min(p.armor.max, p.armor.hp + 90); pk.dead = true; this.msg('Plaque balistique insérée'); this.audio.pickup(); }
    else if (pk.kind === 'ammo') {
      const w = p.weapons.find(x => x.id === pk.ammoFor) || p.weapons.find(x => x.def.type !== 'melee');
      if (w) { weaponAddMags(w, pk.amount); pk.dead = true; this.msg('+' + pk.amount + ' chargeurs ' + w.def.name); this.audio.pickup(); }
    }
  }
}

// ---------------------------------------------------------------------------
// Interface HTML (menus)
// ---------------------------------------------------------------------------
class UI {
  constructor(game) {
    this.game = game;
    this.screens = {};
    document.querySelectorAll('.screen').forEach(el => { this.screens[el.id] = el; });
    document.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', () => this.action(btn.dataset.action, btn)));
    this.buildLevels(); this.buildOptions();
    this.show('menu');
    // Empêche Échap de rester bloqué dans les menus
    window.addEventListener('keydown', e => {
      if (e.code === 'Escape' || e.code === 'KeyP') { if (game.state === 'paused') { game.resume(); e.preventDefault(); } }
      if (e.code === 'Enter' && game.state === 'briefing') game.beginPlay();
      if (e.code === 'Enter' && game.state === 'dead' && this.visible('dead')) this.action('retry');
      if (e.code === 'Enter' && game.state === 'complete') this.action('next');
    });
  }
  anyVisible() { return !document.getElementById('ui').classList.contains('hidden'); }
  currentScreen() { for (const k in this.screens) if (!this.screens[k].classList.contains('hidden')) return this.screens[k]; return null; }
  gamepadNav() {
    const g = this.game, inp = g.input, gp = inp.gp; if (!gp.connected) return;
    const screen = this.currentScreen(); if (!screen) return;
    const items = Array.from(screen.querySelectorAll('button:not(.locked), select, input')).filter(el => el.offsetParent !== null);
    if (!items.length) return;
    if (this.navScreen !== screen) { this.navScreen = screen; this.focusIdx = 0; this.navT = 0; }
    const now = performance.now();
    let dir = 0;
    if (gp.just[GP.UP] || gp.just[GP.LEFT]) dir = -1;
    if (gp.just[GP.DOWN] || gp.just[GP.RIGHT]) dir = 1;
    if (Math.abs(gp.ly) > 0.6 && now - this.navT > 230) { dir = gp.ly > 0 ? 1 : -1; this.navT = now; }
    if (dir) { this.focusIdx = (this.focusIdx + dir + items.length) % items.length; inp.usingGamepad = true; }
    if (this.focusIdx >= items.length) this.focusIdx = 0;
    items.forEach((el, i) => el.classList.toggle('gp-focus', i === this.focusIdx));
    const el = items[this.focusIdx];
    if (dir && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    let acted = false;
    if (gp.just[GP.CROSS]) {
      acted = true;
      if (el.tagName === 'SELECT') { el.selectedIndex = (el.selectedIndex + 1) % el.options.length; el.dispatchEvent(new Event('change')); }
      else if (el.type === 'checkbox') { el.checked = !el.checked; el.dispatchEvent(new Event('change')); }
      else if (el.type === 'range') { const v = parseFloat(el.value) + 0.1; el.value = (v > 1 ? 0 : v).toFixed(2); el.dispatchEvent(new Event('input')); }
      else el.click();
    } else if (gp.just[GP.CIRCLE]) {
      acted = true;
      const back = screen.querySelector('[data-action="back"], [data-action="resume"], [data-action="menu"]'); if (back) back.click();
    } else if (gp.just[GP.OPTIONS] && g.state === 'paused') { acted = true; g.resume(); }
    if (acted) inp.consumeGamepad();
  }
  show(id) { this.hideAll(); this.screens[id].classList.remove('hidden'); document.getElementById('ui').classList.remove('hidden'); }
  hideAll() { for (const k in this.screens) this.screens[k].classList.add('hidden'); document.getElementById('ui').classList.add('hidden'); }
  visible(id) { return !this.screens[id].classList.contains('hidden'); }
  action(a, btn) {
    const g = this.game; g.audio.init(); g.audio.resume();
    switch (a) {
      case 'start': g.loadLevel(0); break;
      case 'levels': this.buildLevels(); this.show('levels'); break;
      case 'controls': this.show('controls'); break;
      case 'options': this.show('options'); break;
      case 'back': this.show(g.state === 'paused' ? 'pause' : 'menu'); break;
      case 'begin': g.beginPlay(); break;
      case 'resume': g.resume(); break;
      case 'restart': g.loadLevel(g.levelIndex); break;
      case 'retry': g.loadLevel(g.levelIndex); break;
      case 'menu': g.toMenu(); break;
      case 'next': if (g.levelIndex + 1 < LEVELS.length) g.loadLevel(g.levelIndex + 1); else g.toMenu(); break;
      case 'level': g.loadLevel(parseInt(btn.dataset.level, 10)); break;
    }
  }
  buildLevels() {
    const box = document.getElementById('level-list'); box.innerHTML = '';
    LEVELS.forEach((L, i) => {
      const locked = i + 1 > this.game.unlocked;
      const b = document.createElement('button');
      b.className = 'level' + (locked ? ' locked' : '');
      const best = Store.get('best_' + L.id, null);
      b.innerHTML = '<span class="num">' + (i + 1) + '</span><span class="name">' + L.title + '</span><span class="sub">' + L.subtitle + (best ? ' · meilleur temps ' + fmtTime(best) : '') + '</span>';
      if (!locked) { b.dataset.action = 'level'; b.dataset.level = i; b.addEventListener('click', () => this.action('level', b)); }
      box.appendChild(b);
    });
  }
  buildOptions() {
    const g = this.game;
    const sel = document.getElementById('difficulty');
    for (const k in DIFFICULTIES) { const o = document.createElement('option'); o.value = k; o.textContent = DIFFICULTIES[k].label; sel.appendChild(o); }
    sel.value = g.settings.difficulty;
    const desc = document.getElementById('difficulty-desc'); desc.textContent = DIFFICULTIES[g.settings.difficulty].desc;
    sel.addEventListener('change', () => { g.setDifficulty(sel.value); desc.textContent = DIFFICULTIES[sel.value].desc; });
    const vol = document.getElementById('volume'); vol.value = g.audio.volume; vol.addEventListener('input', () => g.audio.setVolume(parseFloat(vol.value)));
    const mus = document.getElementById('music'); mus.checked = g.audio.musicOn; mus.addEventListener('change', () => g.audio.toggleMusic(mus.checked));
    const ch = document.getElementById('crosshair'); ch.checked = g.settings.crosshair; ch.addEventListener('change', () => { g.settings.crosshair = ch.checked; Store.set('crosshair', ch.checked); });
    const view = document.getElementById('view'); view.value = g.settings.view; view.addEventListener('change', () => g.setView(view.value));
    const sens = document.getElementById('sensitivity'); sens.value = g.settings.sensitivity; sens.addEventListener('input', () => { g.settings.sensitivity = parseFloat(sens.value); Store.set('sensitivity', g.settings.sensitivity); });
    const res = document.getElementById('fpres'); res.value = String(g.fp.quality); res.addEventListener('change', () => g.fp.setQuality(parseInt(res.value, 10)));
    const aa = document.getElementById('aimassist'); aa.checked = g.settings.aimAssist; aa.addEventListener('change', () => { g.settings.aimAssist = aa.checked; Store.set('aimAssist', aa.checked); });
    const reset = document.getElementById('reset-progress'); reset.addEventListener('click', () => { Store.set('unlocked', 1); g.unlocked = 1; LEVELS.forEach(L => Store.set('best_' + L.id, null)); this.buildLevels(); reset.textContent = 'Progression effacée'; });
  }
  showBriefing(L) {
    document.getElementById('brief-title').textContent = L.title;
    document.getElementById('brief-sub').textContent = L.subtitle;
    document.getElementById('brief-text').textContent = L.brief;
    document.getElementById('brief-obj').textContent = L.objective;
    const lo = L.loadout.map(([id]) => WEAPONS[id].name).join(' · ');
    document.getElementById('brief-loadout').textContent = 'Équipement : ' + lo + ' · Kits de soins : ' + (L.medkits != null ? L.medkits : 1) + ' · Costume balistique';
    this.show('briefing');
  }
  statsHtml() {
    const s = this.game.stats; const acc = s.shots ? Math.round(100 * s.hits / s.shots) : 0;
    const rows = [['Temps', fmtTime(s.time)], ['Éliminations', s.kills], ['Tirs à la tête', s.headshots], ['Précision', acc + ' % (' + s.hits + '/' + s.shots + ')'], ['Mêlée : coups / projections / désarmements', s.meleeHits + ' / ' + s.throws + ' / ' + s.disarms], ['Exécutions', s.executions], ['Dégâts subis', Math.round(s.damageTaken)]];
    if (this.game.level.waves) rows.unshift(['Vagues repoussées', s.wavesSurvived]);
    return rows.map(r => '<div class="row"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>').join('');
  }
  showDead() { document.getElementById('dead-stats').innerHTML = this.statsHtml(); this.show('dead'); }
  showComplete() {
    document.getElementById('complete-title').textContent = this.game.level.title + ' — terminé';
    document.getElementById('complete-stats').innerHTML = this.statsHtml();
    const nextBtn = document.getElementById('next-btn');
    nextBtn.textContent = this.game.levelIndex + 1 < LEVELS.length ? 'Niveau suivant' : 'Retour au menu';
    this.show('complete');
  }
  renderMenuBackdrop(r) {
    const ctx = r.ctx; ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
    ctx.fillStyle = '#07070a'; ctx.fillRect(0, 0, r.w, r.h);
    const t = performance.now() / 1000;
    const g = ctx.createRadialGradient(r.w * 0.5, r.h * 0.4, 20, r.w * 0.5, r.h * 0.4, r.h * 0.9);
    g.addColorStop(0, 'rgba(120,20,30,' + (0.18 + 0.05 * Math.sin(t)) + ')'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, r.w, r.h);
  }
}

window.addEventListener('DOMContentLoaded', () => { window.game = new Game(); });
