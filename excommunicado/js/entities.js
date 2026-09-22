'use strict';
// ---------------------------------------------------------------------------
// Entités : personnages, joueur, ennemis (IA), balles, ramassages, effets.
// ---------------------------------------------------------------------------
const ENEMY_TYPES = {
  thug:     { name: 'Voyou', hp: 100, speed: 92, weapon: 'g19', mags: 1, armor: null, helmet: false, color: '#2b3556', hair: '#151515',
              skill: { reaction: 0.6, spread: 6.5, burst: [2, 3], pause: [0.6, 1.1], view: 12, aim: 0.7 }, pref: [3, 7], role: 'assault' },
  sicario:  { name: 'Sicaire', hp: 100, speed: 98, weapon: 'mp9', mags: 1, armor: { hp: 90, reduce: { pistol: 0.45, rifle: 0.15, shotgun: 0.35, melee: 0.2 } }, helmet: false, color: '#4d4d52', hair: '#241a12',
              skill: { reaction: 0.45, spread: 4.8, burst: [3, 6], pause: [0.5, 0.9], view: 13, aim: 0.8 }, pref: [4, 8], role: 'assault' },
  rifleman: { name: 'Tireur', hp: 100, speed: 90, weapon: 'tr1', mags: 1, armor: { hp: 110, reduce: { pistol: 0.5, rifle: 0.2, shotgun: 0.4, melee: 0.2 } }, helmet: false, color: '#3a4a3a', hair: '#2a2a2a',
              skill: { reaction: 0.42, spread: 3.4, burst: [3, 5], pause: [0.7, 1.2], view: 15, aim: 0.85 }, pref: [6, 11], role: 'assault' },
  knife:    { name: 'Lame', hp: 90, speed: 138, weapon: 'knife', mags: 0, armor: null, helmet: false, color: '#5c1f1f', hair: '#111',
              skill: { reaction: 0.3, spread: 8, burst: [1, 1], pause: [1, 1], view: 13, aim: 0.5 }, pref: [0, 0], role: 'melee' },
  armored:  { name: 'Mercenaire blindé', hp: 110, speed: 80, weapon: 'tr1', mags: 2, armor: { hp: 260, reduce: { pistol: 0.85, rifle: 0.5, shotgun: 0.6, melee: 0.5 } }, helmet: true, color: '#1e2a22', hair: '#3c4440',
              skill: { reaction: 0.4, spread: 3.2, burst: [3, 6], pause: [0.6, 1.0], view: 15, aim: 0.85 }, pref: [5, 10], role: 'assault' },
  boss:     { name: 'Le Contrat', hp: 170, speed: 108, weapon: 'm1911', mags: 4, armor: { hp: 220, reduce: { pistol: 0.75, rifle: 0.45, shotgun: 0.6, melee: 0.4 } }, helmet: false, color: '#0d0d10', hair: '#0a0a0a',
              skill: { reaction: 0.22, spread: 2.2, burst: [2, 3], pause: [0.35, 0.6], view: 16, aim: 0.95 }, pref: [3, 7], role: 'assault', boss: true }
};

class Character {
  constructor(x, y, team) {
    this.x = x; this.y = y; this.r = 11; this.angle = 0;
    this.hp = 100; this.maxHp = 100; this.speed = 95;
    this.team = team; this.dead = false; this.deadT = 0;
    this.downed = 0; this.stagger = 0; this.slowT = 0; this.hurtFlash = 0;
    this.weapon = null; this.weapons = []; this.armor = null; this.helmet = null;
    this.vx = 0; this.vy = 0; this.moving = 0; this.stepDist = 0;
    this.meleeAnim = 0; this.lastHitBy = null; this.lastHitT = -99; this.isPlayer = false;
    this.name = '?';
  }
  get alive() { return !this.dead; }
  get canAct() { return !this.dead && this.downed <= 0 && this.stagger <= 0; }
  get hasFirearm() { return this.weapon && this.weapon.def.type !== 'melee'; }
  muzzle() {
    const len = this.r + (this.weapon ? this.weapon.def.len : 8);
    const side = this.weapon && this.weapon.def.twoHanded ? 2 : 4;
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    return { x: this.x + c * len - s * side, y: this.y + s * len + c * side };
  }
  baseUpdate(dt) {
    if (this.stagger > 0) this.stagger -= dt;
    if (this.downed > 0) this.downed -= dt;
    if (this.slowT > 0) this.slowT -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.meleeAnim > 0) this.meleeAnim -= dt;
    if (this.dead) this.deadT += dt;
  }
}

// ---------------------------------------------------------------------------
// Application des dégâts (balles, mêlée). Modèle par zone + protections.
// ---------------------------------------------------------------------------
function applyHit(game, target, dmgTable, zone, opts) {
  // opts : { cls:'pistol'|'rifle'|'shotgun'|'melee', pen, scale, shooter, dir, silent }
  if (target.dead) return 0;
  const scale = opts.scale || 1;
  let dmg = 0; let helmetSaved = false;
  if (zone === 'head') {
    if (target.helmet && target.helmet.hp > 0 && (opts.pen || 0) < 1 && opts.cls !== 'melee') {
      dmg = 22 * scale; target.helmet.hp = 0; helmetSaved = true;
      target.stagger = Math.max(target.stagger, 0.7);
      game.audio.helmet(game.panOf(target.x, target.y), game.volOf(target.x, target.y));
      game.spark(target.x, target.y, 6);
      if (opts.shooter && opts.shooter.isPlayer) game.msg('Casque brisé !');
    } else {
      dmg = dmgTable.head * scale;
      if (target.isPlayer) dmg *= game.settings.playerHeadMult;
    }
  } else if (zone === 'torso') {
    dmg = dmgTable.torso * scale;
    if (target.armor && target.armor.hp > 0) {
      const red = target.armor.reduce[opts.cls] != null ? target.armor.reduce[opts.cls] : 0.3;
      target.armor.hp -= dmg * 0.5;
      dmg *= (1 - red);
      if (target.armor.hp <= 0) { target.armor.hp = 0; if (target.isPlayer) game.msg('Costume balistique déchiré'); }
      if (opts.cls !== 'melee') game.spark(target.x, target.y, 2);
    }
  } else {
    dmg = dmgTable.limb * scale;
    target.slowT = Math.max(target.slowT, 0.5);
  }
  if (target.isPlayer) dmg *= game.settings.playerDmgMult;
  dmg = Math.round(dmg);
  target.hp -= dmg;
  target.lastHitBy = opts.shooter || null; target.lastHitT = game.time; target.hurtFlash = 0.18;
  if (dmg > 0 && !helmetSaved) {
    game.blood(target.x, target.y, opts.dir != null ? opts.dir : rand(0, TAU), zone === 'head' ? 2 : 1);
    if (!target.isPlayer) game.audio.fleshHit(game.panOf(target.x, target.y), game.volOf(target.x, target.y));
  }
  if (target.isPlayer) { game.onPlayerHurt(dmg, opts.shooter); }
  if (target.hp <= 0) { game.kill(target, opts.shooter, zone, opts.cls); }
  else if (dmg >= 25 && !target.isPlayer) target.stagger = Math.max(target.stagger, 0.22);
  return dmg;
}
// Zone touchée en vue subjective : hauteur du point d'impact (m) + écart latéral
function hitZone3D(hz, d, r, downed) {
  if (downed) { if (hz < 0.02 || hz > 0.45 || d > r) return null; return d < r * 0.45 ? 'torso' : 'limb'; }
  if (hz < 0.02 || hz > 1.85 || d > r) return null;   // passe au-dessus / à côté
  if (hz > 1.55) return d < r * 0.5 ? 'head' : null;   // la tête est plus étroite que les épaules
  if (hz > 0.95) return 'torso';
  return 'limb';
}
// Zone touchée selon la distance perpendiculaire de la trajectoire au centre
function hitZone(d, r, isPlayerTarget) {
  const head = isPlayerTarget ? 0.22 : 0.3, torso = isPlayerTarget ? 0.7 : 0.74;
  if (d < r * head) return 'head';
  if (d < r * torso) return 'torso';
  return 'limb';
}

// ---------------------------------------------------------------------------
// Balle
// ---------------------------------------------------------------------------
class Bullet {
  constructor(x, y, angle, ammo, owner, opts = {}) {
    this.x = x; this.y = y; this.px = x; this.py = y;
    const sp = ammo.speed;
    this.vx = Math.cos(angle) * sp; this.vy = Math.sin(angle) * sp; this.angle = angle;
    this.ammo = ammo; this.owner = owner; this.team = owner.team;
    this.scale = opts.scale || 1; this.pen = ammo.pen; this.travel = 0; this.dead = false;
    this.hit = new Set(); this.life = 0;
    this.pitch = opts.pitch != null ? opts.pitch : null; this.z0 = 1.62;
  }
  update(dt, game) {
    const world = game.world;
    this.px = this.x; this.py = this.y;
    let x0 = this.x, y0 = this.y;
    let x1 = x0 + this.vx * dt, y1 = y0 + this.vy * dt;
    const segLen = Math.hypot(x1 - x0, y1 - y0);
    this.travel += segLen; this.life += dt;
    if (this.travel > this.ammo.range) { this.dead = true; }
    const dirx = this.vx / (segLen / dt || 1), diry = this.vy / (segLen / dt || 1);
    for (let iter = 0; iter < 6; iter++) {
      const rc = world.raycast(x0, y0, x1, y1, (tx, ty) => world.isBulletRelevant(tx, ty));
      const tEnd = rc.hit ? rc.t : 1;
      // personnages
      let best = null, bestT = 2, bestZone = null;
      const chars = game.characters;
      for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        if (c === this.owner || c.dead || this.hit.has(c)) continue;
        const rr = c.downed > 0 ? c.r * 0.8 : c.r;
        const t = segCircle(x0, y0, x1, y1, c.x, c.y, rr);
        if (t < 0 || t > tEnd || t >= bestT) continue;
        const d = lineDistToPoint(x0, y0, x1, y1, c.x, c.y);
        let zone;
        if (this.pitch != null) {
          // Vue subjective : la hauteur visée décide de la zone (tête / torse / jambes) ou d'un tir qui passe au-dessus
          const hx = x0 + (x1 - x0) * t, hy = y0 + (y1 - y0) * t;
          const distAt = (this.travel - segLen) + Math.hypot(hx - this.px, hy - this.py);
          const hz = this.z0 + Math.tan(this.pitch) * distAt / TILE;
          zone = hitZone3D(hz, d, c.r, c.downed > 0);
          if (!zone) { this.hit.add(c); continue; }
        } else zone = c.downed > 0 ? (d < c.r * 0.45 ? 'torso' : 'limb') : hitZone(d, c.r, c.isPlayer);
        bestT = t; best = c; bestZone = zone;
      }
      if (best) {
        const hx = x0 + (x1 - x0) * bestT, hy = y0 + (y1 - y0) * bestT;
        const zone = bestZone;
        this.hit.add(best);
        game.stats.hitsOn(this.owner, best);
        applyHit(game, best, this.ammo.dmg, zone, { cls: this.ammo.cls, pen: this.pen, scale: this.scale, shooter: this.owner, dir: this.angle });
        if (this.pen > 0) { this.pen--; this.scale *= 0.6; x0 = hx + dirx * 2; y0 = hy + diry * 2; continue; }
        this.x = hx; this.y = hy; this.dead = true; return;
      }
      if (rc.hit) {
        const t = world.get(rc.tx, rc.ty);
        const pan = game.panOf(rc.x, rc.y), vol = game.volOf(rc.x, rc.y);
        if (t === T.WALL || t === T.PILLAR || t === T.CAR) {
          game.impact(rc.x, rc.y, this.angle, t === T.CAR);
          if (Math.random() < 0.25) game.audio.ricochet(pan, vol); else game.audio.impact(pan, vol);
          this.x = rc.x; this.y = rc.y; this.dead = true; return;
        }
        if (t === T.GLASS) {
          world.breakGlass(rc.tx, rc.ty); game.audio.glass(pan, vol); game.glassFx(rc.x, rc.y, this.angle);
          this.scale *= 0.9;
          x0 = rc.x + dirx * 3; y0 = rc.y + diry * 3; continue;
        }
        if (t === T.COVER) {
          if (this.pen > 0) {
            this.pen--; this.scale *= 0.55; game.impact(rc.x, rc.y, this.angle, false); game.audio.impact(pan, vol * 0.7);
            // on ressort de la tuile
            let ex = rc.x, ey = rc.y, n = 0;
            while (n++ < 40 && Math.floor(ex / TILE) === rc.tx && Math.floor(ey / TILE) === rc.ty) { ex += dirx * 2; ey += diry * 2; }
            x0 = ex; y0 = ey; continue;
          }
          game.impact(rc.x, rc.y, this.angle, false); game.audio.impact(pan, vol);
          this.x = rc.x; this.y = rc.y; this.dead = true; return;
        }
        if (t === T.DOOR) {
          // porte en bois : les balles traversent avec perte d'énergie
          this.scale *= this.ammo.cls === 'rifle' ? 0.85 : 0.6;
          game.impact(rc.x, rc.y, this.angle, false); game.audio.impact(pan, vol * 0.8);
          let ex = rc.x, ey = rc.y, n = 0;
          while (n++ < 40 && Math.floor(ex / TILE) === rc.tx && Math.floor(ey / TILE) === rc.ty) { ex += dirx * 2; ey += diry * 2; }
          x0 = ex; y0 = ey; continue;
        }
        this.x = rc.x; this.y = rc.y; this.dead = true; return;
      }
      this.x = x1; this.y = y1;
      return;
    }
    this.dead = true;
  }
}

// ---------------------------------------------------------------------------
// Objet lancé (arme jetée à la tête d'un ennemi)
// ---------------------------------------------------------------------------
class Thrown {
  constructor(x, y, angle, weapon, owner) {
    this.x = x; this.y = y; this.vx = Math.cos(angle) * 620; this.vy = Math.sin(angle) * 620;
    this.weapon = weapon; this.owner = owner; this.rot = 0; this.life = 0; this.dead = false; this.r = 6;
  }
  update(dt, game) {
    this.life += dt; this.rot += dt * 18;
    const nx = this.x + this.vx * dt, ny = this.y + this.vy * dt;
    const rc = game.world.raycast(this.x, this.y, nx, ny, (tx, ty) => game.world.isSolid(tx, ty));
    if (rc.hit) { this.x = rc.x - Math.sign(this.vx) * 4; this.y = rc.y - Math.sign(this.vy) * 4; this.land(game); return; }
    for (const c of game.characters) {
      if (c === this.owner || c.dead || c.team === this.owner.team) continue;
      if (segCircle(this.x, this.y, nx, ny, c.x, c.y, c.r + 4) >= 0) {
        const isKnife = this.weapon.def.type === 'melee';
        const dmgT = isKnife ? { head: 90, torso: 60, limb: 30 } : { head: 30, torso: 14, limb: 8 };
        applyHit(game, c, dmgT, isKnife ? 'torso' : 'head', { cls: isKnife ? 'melee' : 'melee', scale: 1, shooter: this.owner, dir: Math.atan2(this.vy, this.vx) });
        if (!c.dead) { c.stagger = Math.max(c.stagger, isKnife ? 0.8 : 1.3); if (c.brain) c.brain.windup = 0; }
        game.audio.meleeHit(game.panOf(c.x, c.y), true);
        this.x = c.x - Math.sign(this.vx) * 10; this.y = c.y - Math.sign(this.vy) * 10;
        this.land(game); return;
      }
    }
    this.x = nx; this.y = ny;
    this.vx *= 0.985; this.vy *= 0.985;
    if (this.life > 0.55) this.land(game);
  }
  land(game) { this.dead = true; game.pickups.push(new Pickup('weapon', this.x, this.y, { weapon: this.weapon })); }
}

// ---------------------------------------------------------------------------
// Ramassage
// ---------------------------------------------------------------------------
class Pickup {
  constructor(kind, x, y, data = {}) {
    this.kind = kind; this.x = x; this.y = y; this.dead = false; this.t = rand(0, TAU);
    this.weapon = data.weapon || null; this.weaponId = data.weaponId || null; this.amount = data.amount || 1; this.ammoFor = data.ammoFor || null;
  }
  label() {
    if (this.kind === 'weapon') { const w = this.weapon; return w.def.name + (w.def.type === 'melee' ? '' : ' (' + weaponRounds(w) + ' | ' + weaponReserve(w) + ')'); }
    if (this.kind === 'health') return 'Kit de soins';
    if (this.kind === 'plate') return 'Plaque balistique';
    if (this.kind === 'ammo') return 'Munitions ' + (this.ammoFor ? WEAPONS[this.ammoFor].name : '');
    return '?';
  }
}

// ---------------------------------------------------------------------------
// Joueur
// ---------------------------------------------------------------------------
class Player extends Character {
  constructor(x, y) {
    super(x, y, 'player');
    this.isPlayer = true; this.name = 'Vous';
    this.hp = 100; this.maxHp = 100; this.speed = 96;
    this.stamina = 100; this.staminaDelay = 0;
    this.aiming = false; this.sprinting = false;
    this.dodgeT = 0; this.dodgeDir = 0; this.dodgeCd = 0;
    this.meleeT = 0; this.combo = 0; this.comboT = -9;
    this.executing = 0; this.execTarget = null;
    this.healing = 0; this.medkits = 1;
    this.armor = { hp: 160, max: 160, reduce: { pistol: 0.7, rifle: 0.4, shotgun: 0.55, melee: 0.35 } };
    this.current = 0; this.swapT = 0; this.wantFire = false; this.fireHeld = false; this.mouseAngle = 0;
    this.footT = 0; this.lastShotT = -9;
    this.velX = 0; this.velY = 0; this.stickAngle = null; this.pitch = 0;
  }
  setWeapons(list) { this.weapons = list; this.current = Math.min(1, list.length - 1); this.weapon = list[this.current]; }
  selectWeapon(i, game) {
    if (i < 0 || i >= this.weapons.length || i === this.current) return;
    if (this.weapon) weaponCancelReload(this.weapon);
    this.current = i; this.weapon = this.weapons[i];
    this.swapT = this.weapon.def.swap; this.healing = 0;
    game.audio.swap();
  }
  get spread() {
    const w = this.weapon; if (!w || w.def.type === 'melee') return 0;
    let s = this.aiming ? w.def.aimSpread : w.def.spread;
    s += w.recoil;
    if (this.moving > 0.1) s += w.def.moveSpread * (this.sprinting ? 2.5 : 1) * this.moving;
    if (this.dodgeT > 0) s += 6;
    if (this.stamina < 25) s += (25 - this.stamina) / 25 * 2.5; // essoufflé : la main tremble
    return s;
  }
  update(dt, game, input) {
    this.baseUpdate(dt);
    if (this.dead) return;
    const w = this.weapon;
    if (w) { const done = weaponUpdate(w, dt); if (done) { if (w.def.type === 'shotgun') game.audio.reload('shell', 0); input.rumble(0.12, 0.3, 40); } }
    if (this.swapT > 0) this.swapT -= dt;
    if (this.meleeT > 0) this.meleeT -= dt;
    if (this.dodgeCd > 0) this.dodgeCd -= dt;
    if (this.staminaDelay > 0) this.staminaDelay -= dt; else this.stamina = Math.min(100, this.stamina + 22 * dt);
    const gpMode = input.usingGamepad && input.gp.connected;
    this.aiming = input.aimDown() && this.hasFirearm && this.dodgeT <= 0;
    // --- Intention de déplacement : clavier (tout ou rien) ou stick gauche (analogique)
    let mx = 0, my = 0;
    if (input.down('forward')) my -= 1; if (input.down('back')) my += 1;
    if (input.down('left')) mx -= 1; if (input.down('right')) mx += 1;
    let mag = (mx || my) ? 1 : 0;
    if (!mag && input.gp.connected && input.gp.lmag > 0) { mx = input.gp.lx; my = input.gp.ly; mag = input.gp.lmag; }
    const len = Math.hypot(mx, my); if (len > 0) { mx /= len; my /= len; }
    // --- Visée : vue subjective (souris verrouillée ou stick droit), sinon souris (instantanée) ou stick droit
    const lockGate = game.fpMode && !gpMode && !input.locked;
    if (lockGate && input.mouse.justDown) { input.requestLock(); }
    if (lockGate && game.state === 'playing') game.msg('Cliquez pour capturer la souris');
    if (game.fpMode) {
      const sens = 0.0022 * (game.settings.sensitivity || 1) * (this.aiming ? 0.6 : 1);
      if (this.executing <= 0) {
        if (gpMode) {
          const curve = v => Math.sign(v) * Math.pow(Math.abs(v), 1.7);
          this.angle += curve(input.gp.rx) * 3.6 * (this.aiming ? 0.5 : 1) * dt;
          this.pitch -= curve(input.gp.ry) * 2.4 * (this.aiming ? 0.5 : 1) * dt;
          if (game.settings.aimAssist && input.gp.rmag < 0.85) { const a2 = this.aimAssist(game, this.angle); this.angle += angleDiff(this.angle, a2) * Math.min(1, dt * 7); }
        } else if (input.locked) { this.angle += input.mouse.dx * sens; this.pitch -= input.mouse.dy * sens; }
      }
      this.pitch = clamp(this.pitch, -0.85, 0.85);
      if (this.angle > Math.PI) this.angle -= TAU; else if (this.angle < -Math.PI) this.angle += TAU;
      this.mouseAngle = this.angle;
      game.aimPoint.x = this.x + Math.cos(this.angle) * 5 * TILE; game.aimPoint.y = this.y + Math.sin(this.angle) * 5 * TILE;
      // Déplacement relatif au regard : avant / arrière et pas chassés
      const f = -my, sd = mx, ca = Math.cos(this.angle), sa = Math.sin(this.angle);
      mx = ca * f - sa * sd; my = sa * f + ca * sd;
    } else if (gpMode) {
      if (input.gp.rmag > 0.05) this.stickAngle = Math.atan2(input.gp.ry, input.gp.rx);
      else if (this.stickAngle == null) this.stickAngle = this.angle;
      let target = this.stickAngle;
      if (input.gp.rmag > 0.05) { if (game.settings.aimAssist) target = this.aimAssist(game, target); }
      else if (mag > 0 && !input.fireDown() && !this.aiming) { target = Math.atan2(my, mx); this.stickAngle = target; }
      if (this.executing <= 0) { const d = angleDiff(this.angle, target); const maxTurn = 15 * dt; this.angle += clamp(d, -maxTurn, maxTurn); }
      this.mouseAngle = this.angle;
      const reach = (3 + 3.5 * input.gp.rmag) * TILE;
      game.aimPoint.x = this.x + Math.cos(this.angle) * reach; game.aimPoint.y = this.y + Math.sin(this.angle) * reach;
    } else {
      const m = game.mouseWorld();
      this.mouseAngle = angleTo(this.x, this.y, m.x, m.y);
      if (this.executing <= 0) this.angle = this.mouseAngle;
    }
    // Exécution en cours
    if (this.executing > 0) {
      this.executing -= dt;
      if (this.execTarget && !this.execTarget.dead) this.angle = angleTo(this.x, this.y, this.execTarget.x, this.execTarget.y);
      if (this.executing <= 0) this.finishExecution(game);
      this.moving = 0; this.velX = this.velY = 0; this.vx = this.vy = 0; return;
    }
    // Soins
    if (this.healing > 0) {
      this.healing -= dt;
      if (this.healing <= 0) { this.medkits--; this.hp = Math.min(this.maxHp, this.hp + 50); game.msg('Soins appliqués'); game.audio.pickup(); }
    }
    this.sprinting = input.down('sprint') && mag > 0 && this.stamina > 0 && !this.aiming && this.healing <= 0 && !(w && w.reloading && w.def.type !== 'shotgun');
    let speed = this.speed * (mag < 1 ? lerp(0.3, 1, mag) : 1);
    if (this.sprinting) { speed *= 2.0; this.stamina -= 18 * dt; this.staminaDelay = 0.7; if (this.stamina < 0) this.stamina = 0; }
    if (this.aiming) speed *= w.def.aimSpeed;
    if (w && w.def.weight) speed *= w.def.weight;
    if (this.healing > 0) speed *= 0.4;
    if (this.slowT > 0) speed *= 0.6;
    if (this.stagger > 0) speed *= 0.3;
    // Esquive
    if (input.pressed('dodge') && this.dodgeT <= 0 && this.dodgeCd <= 0 && this.stamina >= 20 && this.stagger <= 0) {
      this.dodgeT = 0.34; this.dodgeCd = 0.6; this.stamina -= 20; this.staminaDelay = 0.8; this.healing = 0;
      this.dodgeDir = mag > 0 ? Math.atan2(my, mx) : this.angle + Math.PI;
      if (w) weaponCancelReload(w);
      game.audio.swish(); input.rumble(0.2, 0.4, 60);
    }
    let dx, dy;
    if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      const sp = 330 * (0.5 + this.dodgeT / 0.34);
      this.velX = Math.cos(this.dodgeDir) * sp; this.velY = Math.sin(this.dodgeDir) * sp;
      dx = this.velX * dt; dy = this.velY * dt;
      this.moving = 1;
    } else {
      // Inertie : on accélère vers la vitesse voulue, on freine plus vite qu'on n'accélère
      const tx = mx * speed, ty = my * speed;
      const accel = (mag > 0 ? 1100 : 1800) * dt;
      const ddx = tx - this.velX, ddy = ty - this.velY; const dl = Math.hypot(ddx, ddy);
      if (dl <= accel || dl < 1e-6) { this.velX = tx; this.velY = ty; } else { this.velX += ddx / dl * accel; this.velY += ddy / dl * accel; }
      dx = this.velX * dt; dy = this.velY * dt;
      const sp = Math.hypot(this.velX, this.velY);
      this.moving = sp > 4 ? clamp(sp / this.speed, 0.3, 1.6) : 0;
    }
    if (dx || dy) {
      const x0 = this.x, y0 = this.y;
      game.world.moveCircle(this, dx, dy);
      // la vitesse réelle tient compte des murs (on ne "pousse" pas contre un mur)
      this.velX = (this.x - x0) / dt; this.velY = (this.y - y0) / dt;
      this.stepDist += Math.hypot(this.x - x0, this.y - y0);
      const stepLen = this.sprinting ? 34 : 26;
      if (this.stepDist > stepLen) { this.stepDist = 0; game.audio.footstep(this.sprinting ? 0.11 : 0.04 + 0.03 * this.moving); if (this.sprinting) game.noise(this.x, this.y, 5 * TILE, this); }
    }
    this.vx = this.velX; this.vy = this.velY;
    // Armes
    if (input.mouse.wheel !== 0) this.selectWeapon((this.current + (input.mouse.wheel > 0 ? 1 : -1) + this.weapons.length) % this.weapons.length, game);
    if (input.pressed('next')) this.selectWeapon((this.current + 1) % this.weapons.length, game);
    if (input.pressed('prev')) this.selectWeapon((this.current - 1 + this.weapons.length) % this.weapons.length, game);
    for (let i = 0; i < 4; i++) if (input.pressed('slot' + (i + 1))) this.selectWeapon(i, game);
    if (input.pressed('reload') && w && this.dodgeT <= 0) this.reload(game);
    if (input.pressed('mode') && w && w.def.modes) { const md = weaponToggleMode(w); game.msg('Mode : ' + (md === 'auto' ? 'automatique' : 'semi-automatique')); game.audio.click(0, 0, 0.2, 1500); }
    if (input.pressed('heal')) this.heal(game);
    if (input.pressed('throw')) this.throwWeapon(game);
    if (input.pressed('melee')) this.melee(game);
    if (input.pressed('interact')) game.interact();
    // Tir
    const canShoot = w && w.def.type !== 'melee' && this.swapT <= 0 && this.dodgeT <= 0 && this.meleeT <= 0 && this.healing <= 0 && this.stagger <= 0;
    const auto = w && w.def.auto && w.mode !== 'semi';
    const fireJust = input.fireJust() && !lockGate, fireDown = input.fireDown() && !lockGate;
    const trigger = auto ? fireDown : fireJust;
    if (w && w.def.type === 'melee') { if (fireJust) this.melee(game); }
    else if (trigger && canShoot) this.tryFire(game);
    this.fireHeld = fireDown;
  }
  // Aide à la visée (manette) : légère attraction vers l'ennemi visible le plus proche de l'axe
  aimAssist(game, angle) {
    let bestDiff = null, bestAbs = rad(9);
    for (const e of game.enemies) {
      if (e.dead || !e.visible || e.downed > 0) continue;
      const d = dist(this.x, this.y, e.x, e.y); if (d > 13 * TILE || d < 20) continue;
      const diff = angleDiff(angle, angleTo(this.x, this.y, e.x, e.y));
      const tol = Math.min(rad(9), Math.atan2(e.r * 2.4, d));
      if (Math.abs(diff) < tol && Math.abs(diff) < bestAbs) { bestAbs = Math.abs(diff); bestDiff = diff; }
    }
    return bestDiff != null ? angle + bestDiff * 0.6 : angle;
  }
  reload(game) {
    const w = this.weapon; if (!w || w.def.type === 'melee') return;
    if (w.reloading) return;
    if (!weaponCanReload(w)) { if ((w.def.type === 'shotgun' ? w.shells : w.mags.length) === 0) game.msg('Plus de chargeur'); return; }
    const r = weaponStartReload(w); this.healing = 0;
    if (r) { game.audio.reload(r.kind, r.dur); if (r.kind === 'empty') game.msg('Rechargement (culasse ouverte)'); }
  }
  tryFire(game) {
    const w = this.weapon;
    if (w.cooldown > 0) return;
    if (w.reloading) { if (w.def.type === 'shotgun' && weaponRounds(w) > 0) weaponCancelReload(w); else return; }
    if (weaponRounds(w) === 0) { game.audio.dryFire(); w.cooldown = 0.25; game.msg(w.def.type === 'shotgun' ? 'Vide — rechargez (R)' : 'Culasse ouverte — rechargez (R)'); return; }
    this.fire(game);
  }
  fire(game) {
    const w = this.weapon; const ammo = AMMO[w.def.ammo];
    const spread = rad(this.spread);
    const mz = this.muzzle();
    weaponFireRound(w);
    const n = ammo.pellets || 1;
    for (let i = 0; i < n; i++) {
      let a = this.angle + gauss() * spread;
      if (ammo.pellets) a += gauss() * rad(ammo.pelletSpread);
      game.bullets.push(new Bullet(mz.x, mz.y, a, ammo, this, game.fpMode ? { pitch: this.pitch + gauss() * spread * 0.7 } : {}));
    }
    game.stats.shots++;
    game.shoot(this, mz, ammo);
    this.lastShotT = game.time;
  }
  heal(game) {
    if (this.healing > 0 || this.medkits <= 0 || this.hp >= this.maxHp) { if (this.medkits <= 0) game.msg('Aucun kit de soins'); return; }
    this.healing = 3.0; if (this.weapon) weaponCancelReload(this.weapon);
    game.audio.heal(); game.msg('Soins... restez à couvert');
  }
  throwWeapon(game) {
    const w = this.weapon; if (!w || this.swapT > 0 || this.meleeT > 0) return;
    if (w.def.type === 'melee' && this.weapons.length === 1) return;
    weaponCancelReload(w);
    const mz = this.muzzle();
    game.thrown.push(new Thrown(mz.x, mz.y, this.angle, w, this));
    this.weapons.splice(this.current, 1);
    if (this.weapons.length === 0) { this.weapons.push(makeWeapon('knife')); }
    this.current = Math.min(this.current, this.weapons.length - 1);
    // On passe à l'arme à feu la plus chargée
    let best = this.current, bestR = -1;
    for (let i = 0; i < this.weapons.length; i++) { const r = weaponRounds(this.weapons[i]); if (r > bestR) { bestR = r; best = i; } }
    this.current = best; this.weapon = this.weapons[best]; this.swapT = 0.25;
    game.audio.throwWhoosh(); game.msg('Arme lancée');
  }
  // Mêlée façon gun-fu : frappe → désarmement → projection → exécution
  melee(game) {
    if (this.meleeT > 0 || this.executing > 0 || this.dodgeT > 0 || this.stagger > 0) return;
    const w = this.weapon; const isKnife = w && w.def.type === 'melee';
    const reach = (isKnife ? w.def.reach : 24) + this.r;
    let target = null, bestD = 1e9;
    for (const e of game.enemies) {
      if (e.dead) continue;
      const d = dist(this.x, this.y, e.x, e.y) - e.r;
      if (d > reach) continue;
      const ad = Math.abs(angleDiff(this.angle, angleTo(this.x, this.y, e.x, e.y)));
      if (ad > rad(75)) continue;
      if (d < bestD) { bestD = d; target = e; }
    }
    this.meleeT = isKnife ? w.def.rate : 0.4; this.meleeAnim = 0.22;
    if (this.weapon) weaponCancelReload(this.weapon);
    this.healing = 0;
    if (!target) { game.audio.swish(); return; }
    if (target.downed > 0) { this.startExecution(target, game); return; }
    const dir = angleTo(this.x, this.y, target.x, target.y);
    if (target.brain) target.brain.windup = 0; // interrompt son attaque
    if (target.type && target.type.boss && Math.random() < 0.45 && target.stagger <= 0) {
      // Le boss contre la frappe
      this.stagger = 0.6; game.msg('Contré !'); game.audio.meleeHit(0, true); this.combo = 0;
      applyHit(game, this, { head: 15, torso: 12, limb: 8 }, 'torso', { cls: 'melee', shooter: target, dir: dir + Math.PI });
      return;
    }
    if (isKnife) {
      game.stats.meleeHits++; game.input.rumble(0.4, 0.2, 60);
      applyHit(game, target, w.def.dmg, 'torso', { cls: 'melee', shooter: this, dir });
      if (!target.dead) target.stagger = Math.max(target.stagger, 0.35);
      game.audio.meleeHit(game.panOf(target.x, target.y), false);
      return;
    }
    game.stats.meleeHits++; game.input.rumble(0.45, 0.25, 70);
    this.combo = (game.time - this.comboT < 1.4) ? this.combo + 1 : 1; this.comboT = game.time;
    if (this.combo === 1) {
      applyHit(game, target, { head: 12, torso: 10, limb: 6 }, 'torso', { cls: 'melee', shooter: this, dir });
      if (!target.dead) target.stagger = Math.max(target.stagger, 0.5);
      game.audio.meleeHit(game.panOf(target.x, target.y), false);
    } else if (this.combo === 2) {
      applyHit(game, target, { head: 12, torso: 10, limb: 6 }, 'torso', { cls: 'melee', shooter: this, dir });
      if (!target.dead) target.stagger = Math.max(target.stagger, 0.55);
      game.audio.meleeHit(game.panOf(target.x, target.y), false);
      if (target.hasFirearm) this.disarm(target, game);
    } else {
      // Projection (judo)
      applyHit(game, target, { head: 18, torso: 16, limb: 10 }, 'torso', { cls: 'melee', shooter: this, dir });
      if (!target.dead) {
        target.downed = 2.6; target.stagger = 0;
        const nx = target.x + Math.cos(dir) * 26, ny = target.y + Math.sin(dir) * 26;
        if (!game.world.raycast(target.x, target.y, nx, ny, (tx, ty) => game.world.isSolid(tx, ty)).hit) { target.x = nx; target.y = ny; }
        target.angle = dir + HALF_PI;
        game.msg('Projection !'); game.audio.bodyFall(game.panOf(target.x, target.y)); game.shake(4); game.input.rumble(0.7, 0.3, 120);
        game.stats.throws++;
      }
      this.combo = 0;
    }
  }
  disarm(target, game) {
    const w = target.weapon; if (!w || w.def.type === 'melee') return;
    target.weapons = target.weapons.filter(x => x !== w);
    target.weapon = target.weapons[0] || null;
    if (target.brain) { target.brain.mode = 'melee'; target.brain.burstLeft = 0; }
    const firearms = this.weapons.filter(x => x.def.type !== 'melee').length;
    if (firearms < 3) { this.weapons.push(w); game.msg('Désarmé ! Vous récupérez : ' + w.def.name); }
    else { game.pickups.push(new Pickup('weapon', this.x + Math.cos(this.angle) * 14, this.y + Math.sin(this.angle) * 14, { weapon: w })); game.msg('Désarmé ! Arme au sol'); }
    game.stats.disarms++;
    game.audio.click(0, game.panOf(target.x, target.y), 0.3, 1200);
  }
  startExecution(target, game) {
    this.executing = 0.55; this.execTarget = target; this.combo = 0;
    if (target.brain) target.brain.executed = true;
    target.downed = Math.max(target.downed, 1.0);
    game.msg('Exécution');
  }
  finishExecution(game) {
    const t = this.execTarget; this.execTarget = null;
    if (!t || t.dead) return;
    const w = this.weapon;
    if (w && w.def.type !== 'melee' && weaponRounds(w) > 0) {
      weaponFireRound(w);
      const mz = this.muzzle();
      game.shoot(this, mz, AMMO[w.def.ammo]);
      game.stats.shots++; game.stats.hits++;
      t.hp = 0; game.blood(t.x, t.y, this.angle, 2); game.kill(t, this, 'head', 'execution');
    } else {
      const knife = this.weapons.find(x => x.def.type === 'melee');
      game.audio.meleeHit(game.panOf(t.x, t.y), true);
      t.hp = 0; game.blood(t.x, t.y, this.angle, knife ? 2 : 1); game.kill(t, this, knife ? 'head' : 'torso', 'execution');
    }
  }
  addWeapon(w, game) {
    const same = this.weapons.find(x => x.id === w.id && x.def.type !== 'melee');
    if (same) {
      // Même modèle : on récupère ses munitions (chargeur + réserve)
      if (w.def.type === 'shotgun') same.shells += w.shells + weaponRounds(w);
      else { if (weaponRounds(w) > 0) same.mags.push(weaponRounds(w)); for (const m of w.mags) same.mags.push(m); }
      game.msg('Munitions récupérées : ' + w.def.name); game.audio.pickup(); return true;
    }
    const firearms = this.weapons.filter(x => x.def.type !== 'melee').length;
    if (w.def.type === 'melee') { if (this.weapons.find(x => x.def.type === 'melee')) return false; this.weapons.unshift(w); this.current++; game.audio.pickup(); return true; }
    if (firearms >= 3) {
      // On échange avec l'arme en main
      const cur = this.weapon;
      if (!cur || cur.def.type === 'melee') { game.msg('Inventaire plein (3 armes à feu)'); return false; }
      game.pickups.push(new Pickup('weapon', this.x, this.y, { weapon: cur }));
      this.weapons[this.current] = w; this.weapon = w; this.swapT = w.def.swap;
      game.msg('Échange : ' + w.def.name); game.audio.pickup(); return true;
    }
    this.weapons.push(w); this.selectWeapon(this.weapons.length - 1, game);
    game.msg('Ramassé : ' + w.def.name); game.audio.pickup();
    return true;
  }
}

// ---------------------------------------------------------------------------
// Ennemi + IA
// ---------------------------------------------------------------------------
class Enemy extends Character {
  constructor(x, y, typeId) {
    super(x, y, 'enemy');
    const t = ENEMY_TYPES[typeId]; this.type = t; this.typeId = typeId; this.name = t.name;
    this.hp = t.hp; this.maxHp = t.hp; this.speed = t.speed;
    this.color = t.color; this.hair = t.hair;
    this.armor = t.armor ? { hp: t.armor.hp, max: t.armor.hp, reduce: t.armor.reduce } : null;
    this.helmet = t.helmet ? { hp: 1 } : null;
    const wpn = makeWeapon(t.weapon, { mags: t.mags });
    this.weapons = [wpn]; this.weapon = wpn;
    this.skill = t.skill; this.fov = rad(130); this.viewRange = t.skill.view * TILE;
    this.angle = rand(0, TAU);
    this.brain = {
      state: 'idle', mode: t.role === 'melee' ? 'melee' : 'engage', lastSeen: null, sees: false, seesT: 0,
      reactT: 0, burstLeft: 0, shotT: 0, pauseT: 0, path: null, pathT: 0, goal: null,
      coverPos: null, peekPos: null, coverT: 0, strafe: 0, strafeT: 0, searchT: 0, searchPt: null,
      windup: 0, meleeCd: 0, lastNoiseT: 0, percT: rand(0, 0.1), role: t.role, flank: Math.random() < 0.35, executed: false,
      retrieve: null, idleLook: rand(0, TAU), idleT: rand(1, 4), stuckT: 0, lastPos: { x, y }, fearT: 0, alertShout: false
    };
  }
  get pref() { return this.type.pref; }
  update(dt, game) {
    this.baseUpdate(dt);
    if (this.dead) return;
    const b = this.brain; const p = game.player; const world = game.world;
    if (this.weapon && this.weapon.def.type !== 'melee') weaponUpdate(this.weapon, dt);
    if (b.meleeCd > 0) b.meleeCd -= dt;
    if (b.fearT > 0) b.fearT -= dt;
    // -- Perception (10 Hz)
    b.percT -= dt;
    if (b.percT <= 0) { b.percT = 0.1; this.perceive(game); }
    // -- Bruits
    for (const n of game.noises) {
      if (n.t <= b.lastNoiseT || n.source === this) continue;
      const d = dist(this.x, this.y, n.x, n.y);
      const eff = world.los(this.x, this.y, n.x, n.y) ? n.r : n.r * 0.6;
      if (d < eff && n.source && n.source.team !== this.team) {
        if (b.state === 'idle') { b.state = 'alert'; b.mode = b.role === 'melee' ? 'melee' : 'investigate'; b.goal = { x: n.x, y: n.y }; b.path = null; }
        b.lastSeen = { x: n.x, y: n.y, t: game.time, heard: true };
      }
    }
    b.lastNoiseT = game.time;
    if (this.downed > 0) { this.moving = 0; return; }
    if (this.stagger > 0) { this.moving = 0; return; }
    // -- Décision
    if (b.state === 'idle') this.idle(dt, game);
    else if (b.mode === 'melee') this.meleeBehaviour(dt, game);
    else this.combatBehaviour(dt, game);
    // Anti-blocage
    if (dist2(this.x, this.y, b.lastPos.x, b.lastPos.y) < 4 && b.path) b.stuckT += dt; else b.stuckT = 0;
    b.lastPos.x = this.x; b.lastPos.y = this.y;
    if (b.stuckT > 1.2) { b.path = null; b.stuckT = 0; b.strafe = choice([-1, 1]); b.strafeT = 0.5; }
  }
  perceive(game) {
    const b = this.brain; const p = game.player; const world = game.world;
    let sees = false;
    if (p.alive) {
      const d = dist(this.x, this.y, p.x, p.y);
      const range = this.viewRange * (b.state === 'idle' ? 1 : 1.35);
      if (d < range) {
        const ad = Math.abs(angleDiff(this.angle, angleTo(this.x, this.y, p.x, p.y)));
        if (ad < this.fov / 2 || d < 2.5 * TILE) sees = world.los(this.x, this.y, p.x, p.y);
      }
    }
    if (sees) {
      if (!b.sees) { b.seesT = game.time; if (b.state !== 'combat') b.reactT = this.skill.reaction * game.settings.enemyReactionMult * rand(0.8, 1.35); }
      if (b.state !== 'combat') { b.state = 'combat'; if (b.mode === 'investigate' || b.mode === 'search') b.mode = b.role === 'melee' ? 'melee' : 'engage'; this.shout(game); }
      b.lastSeen = { x: p.x, y: p.y, t: game.time, vx: p.vx, vy: p.vy };
    } else if (b.sees && b.state === 'combat') {
      b.lastSeen = { x: p.x, y: p.y, t: game.time, vx: p.vx, vy: p.vy }; // dernière position connue
    }
    b.sees = sees;
  }
  shout(game) {
    const b = this.brain; if (b.alertShout) return; b.alertShout = true;
    game.audio.shout(game.panOf(this.x, this.y), game.volOf(this.x, this.y));
    for (const e of game.enemies) {
      if (e === this || e.dead) continue;
      if (dist(this.x, this.y, e.x, e.y) < 11 * TILE) {
        const eb = e.brain;
        if (eb.state === 'idle') { eb.state = 'alert'; eb.mode = eb.role === 'melee' ? 'melee' : 'investigate'; eb.goal = { x: game.player.x, y: game.player.y }; eb.path = null; }
        eb.lastSeen = { x: game.player.x, y: game.player.y, t: game.time, heard: true };
      }
    }
  }
  onHurt(game, shooter) {
    const b = this.brain;
    if (shooter && shooter.team !== this.team) {
      b.lastSeen = { x: shooter.x, y: shooter.y, t: game.time };
      if (b.state !== 'combat') { b.state = 'combat'; b.reactT = this.skill.reaction * 0.6; this.shout(game); this.angle = angleTo(this.x, this.y, shooter.x, shooter.y); }
      if (b.mode === 'investigate' || b.mode === 'search') b.mode = b.role === 'melee' ? 'melee' : 'engage';
      // Sous le feu : chercher un couvert
      if (this.hasFirearm && b.mode === 'engage' && Math.random() < (this.hp < 60 ? 0.7 : 0.35)) this.seekCover(game);
    }
  }
  idle(dt, game) {
    const b = this.brain;
    b.idleT -= dt; this.moving = 0;
    if (b.idleT <= 0) { b.idleT = rand(2, 5); b.idleLook = this.angle + rand(-1.2, 1.2); }
    this.angle += angleDiff(this.angle, b.idleLook) * Math.min(1, dt * 2);
  }
  // Suit un chemin vers goal ; renvoie true si arrivé
  moveTo(dt, game, gx, gy, speedMul = 1, arriveDist = 10) {
    const b = this.brain; const world = game.world;
    if (dist(this.x, this.y, gx, gy) < arriveDist) { this.moving = 0; return true; }
    b.pathT -= dt;
    if (!b.path || b.pathT <= 0 || !b.goal || dist2(b.goal.x, b.goal.y, gx, gy) > (TILE * 1.2) ** 2) {
      b.goal = { x: gx, y: gy }; b.pathT = 0.45 + Math.random() * 0.2;
      if (world.walkable(this.x, this.y, gx, gy, this.r + 2)) b.path = [{ x: gx, y: gy }];
      else { const p = world.findPath(this.x, this.y, gx, gy); b.path = p; if (p && p.length > 1) p.shift(); if (p && p.length) p[p.length - 1] = { x: gx, y: gy }; }
    }
    if (!b.path || !b.path.length) { this.moving = 0; return false; }
    // lissage
    while (b.path.length > 1 && world.walkable(this.x, this.y, b.path[1].x, b.path[1].y, this.r + 1)) b.path.shift();
    const wp = b.path[0];
    if (dist(this.x, this.y, wp.x, wp.y) < 6) { b.path.shift(); if (!b.path.length) { this.moving = 0; return true; } }
    const a = angleTo(this.x, this.y, wp.x, wp.y);
    let sp = this.speed * speedMul * (this.slowT > 0 ? 0.6 : 1);
    let dx = Math.cos(a) * sp * dt, dy = Math.sin(a) * sp * dt;
    // évitement des alliés
    for (const e of game.enemies) {
      if (e === this || e.dead) continue;
      const d = dist(this.x, this.y, e.x, e.y);
      if (d < this.r * 2.2 && d > 0.01) { dx += (this.x - e.x) / d * 40 * dt; dy += (this.y - e.y) / d * 40 * dt; }
    }
    world.moveCircle(this, dx, dy);
    this.moving = 1; this.stepDist += Math.hypot(dx, dy);
    if (this.stepDist > 28) { this.stepDist = 0; game.audio.footstep(0.05 * game.volOf(this.x, this.y), game.panOf(this.x, this.y)); }
    return false;
  }
  faceTarget(dt, x, y, rate = 12) { const a = angleTo(this.x, this.y, x, y); this.angle += angleDiff(this.angle, a) * Math.min(1, dt * rate); }
  // Trouve un couvert : tuile praticable proche sans ligne de tir depuis la menace, avec une tuile voisine exposée (pour "peeker")
  seekCover(game) {
    const b = this.brain; const world = game.world; const th = b.lastSeen || { x: game.player.x, y: game.player.y };
    const ctx = Math.floor(this.x / TILE), cty = Math.floor(this.y / TILE);
    let best = null, bestScore = 1e9;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const tx = ctx + dx, ty = cty + dy;
      if (!world.isWalkable(tx, ty) || world.get(tx, ty) === T.DOOR) continue;
      const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
      const dth = dist(cx, cy, th.x, th.y);
      if (dth < 2.2 * TILE) continue;
      if (world.losCover(cx, cy, th.x, th.y)) continue; // exposé
      // tuile voisine d'où tirer
      let peek = null;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const px = (tx + ox + 0.5) * TILE, py = (ty + oy + 0.5) * TILE;
        if (world.isWalkable(tx + ox, ty + oy) && world.losCover(px, py, th.x, th.y) && world.los(px, py, th.x, th.y)) { peek = { x: px, y: py }; break; }
      }
      if (!peek) continue;
      const score = dist(this.x, this.y, cx, cy) + Math.abs(dth - this.pref[1] * TILE) * 0.4;
      if (score < bestScore) { bestScore = score; best = { cover: { x: cx, y: cy }, peek }; }
    }
    if (best) { b.coverPos = best.cover; b.peekPos = best.peek; b.mode = 'cover'; b.coverT = rand(0.9, 1.8); b.path = null; return true; }
    return false;
  }
  allyInLine(game, tx, ty) {
    for (const e of game.enemies) {
      if (e === this || e.dead) continue;
      const d = dist(this.x, this.y, e.x, e.y); if (d > dist(this.x, this.y, tx, ty)) continue;
      if (segCircle(this.x, this.y, tx, ty, e.x, e.y, e.r + 5) >= 0) return true;
    }
    return false;
  }
  combatBehaviour(dt, game) {
    const b = this.brain; const p = game.player; const world = game.world; const w = this.weapon;
    // Sans arme à feu : récupérer une arme au sol ou passer en mêlée
    if (!this.hasFirearm) { b.mode = 'melee'; return; }
    if (b.reactT > 0) b.reactT -= dt;
    const rounds = weaponRounds(w);
    const reserve = weaponReserve(w);
    if (rounds === 0 && reserve === 0) {
      // Arme vide et plus de chargeur : on la lâche, on cherche une autre arme
      game.pickups.push(new Pickup('weapon', this.x, this.y, { weapon: w }));
      this.weapons = this.weapons.filter(x => x !== w); this.weapon = this.weapons[0] || null;
      b.mode = 'melee'; return;
    }
    if (rounds === 0 && !w.reloading) {
      if (b.mode !== 'cover' && b.sees && this.seekCover(game)) { /* on va recharger à couvert */ }
      else weaponStartReload(w);
    }
    if (w.reloading && (rounds > 0 || b.mode !== 'cover') && !b.sees) { /* recharge en avançant */ }
    const known = b.lastSeen; const sees = b.sees && p.alive;
    const tx = sees ? p.x : (known ? known.x : this.x), ty = sees ? p.y : (known ? known.y : this.y);
    const d = dist(this.x, this.y, p.x, p.y);
    if (b.strafeT > 0) b.strafeT -= dt;
    // --- Modes
    if (b.mode === 'cover') {
      if (!b.coverPos) { b.mode = 'engage'; return; }
      const arrived = this.moveTo(dt, game, b.coverPos.x, b.coverPos.y, 1.1, 8);
      if (arrived) {
        if (weaponCanReload(w) && (rounds < w.def.magSize * 0.4)) weaponStartReload(w);
        b.coverT -= dt;
        this.faceTarget(dt, tx, ty);
        if (b.coverT <= 0 && !w.reloading) { b.mode = 'peek'; b.path = null; b.coverT = rand(1.2, 2.2); }
      } else this.faceTarget(dt, tx, ty, 6);
      if (sees && d < 2.5 * TILE) b.mode = 'engage'; // trop près, on se bat
      return;
    }
    if (b.mode === 'peek') {
      if (!b.peekPos) { b.mode = 'engage'; return; }
      this.moveTo(dt, game, b.peekPos.x, b.peekPos.y, 1.0, 8);
      this.faceTarget(dt, tx, ty, 14);
      if (sees) this.fireControl(dt, game, d);
      b.coverT -= dt;
      if (b.coverT <= 0 || (rounds === 0)) { if (b.coverPos && (this.hp < 70 || rounds < 4 || Math.random() < 0.5)) { b.mode = 'cover'; b.coverT = rand(0.8, 1.6); b.path = null; } else { b.mode = 'engage'; } }
      if (!sees && game.time - (known ? known.t : 0) > 3) b.mode = 'engage';
      return;
    }
    if (b.mode === 'investigate') {
      const g = b.goal || (known ? { x: known.x, y: known.y } : null);
      if (!g) { b.mode = 'engage'; return; }
      const arrived = this.moveTo(dt, game, g.x, g.y, 0.8, 24);
      if (this.moving) this.angle = angleTo(this.x, this.y, g.x, g.y);
      if (arrived) { b.mode = 'search'; b.searchT = rand(5, 8); b.searchPt = null; }
      return;
    }
    if (b.mode === 'search') {
      b.searchT -= dt;
      if (!b.searchPt || dist(this.x, this.y, b.searchPt.x, b.searchPt.y) < 16) {
        const base = known || this; const a = rand(0, TAU), r = rand(2, 5) * TILE;
        b.searchPt = { x: base.x + Math.cos(a) * r, y: base.y + Math.sin(a) * r }; b.path = null;
      }
      this.moveTo(dt, game, b.searchPt.x, b.searchPt.y, 0.7, 12);
      if (this.moving) this.angle = angleTo(this.x, this.y, b.searchPt.x, b.searchPt.y);
      else this.angle += dt * 1.5;
      if (b.searchT <= 0) { b.state = 'alert'; b.mode = 'investigate'; b.goal = { x: this.x, y: this.y }; b.searchT = 0; if (Math.random() < 0.5) { b.state = 'idle'; } }
      return;
    }
    // --- engage
    if (sees) {
      this.faceTarget(dt, p.x, p.y, 16);
      const [pmin, pmax] = this.pref;
      const dT = d / TILE;
      let moved = false;
      // Flanqueur : cherche une position décalée
      if (b.flank && dT > 4 && dT < 12 && !b.sees === false) {
        const side = (this.brain.role === 'assault' && (this.x + this.y) % 2 < 1) ? 1 : -1;
        const a = angleTo(p.x, p.y, this.x, this.y) + side * 0.9;
        const gx = p.x + Math.cos(a) * pmin * TILE * 1.2, gy = p.y + Math.sin(a) * pmin * TILE * 1.2;
        if (world.isWalkable(Math.floor(gx / TILE), Math.floor(gy / TILE))) { this.moveTo(dt, game, gx, gy, 0.8, 20); moved = this.moving > 0; }
      } else if (dT > pmax) { this.moveTo(dt, game, p.x, p.y, 0.85, pmax * TILE * 0.9); moved = this.moving > 0; }
      else if (dT < pmin && b.role !== 'melee') {
        // recule en tirant
        const a = angleTo(p.x, p.y, this.x, this.y);
        const nx = this.x + Math.cos(a) * this.speed * 0.5 * dt, ny = this.y + Math.sin(a) * this.speed * 0.5 * dt;
        world.moveCircle(this, nx - this.x, ny - this.y); this.moving = 0.5; moved = true;
      } else if (b.strafeT > 0) {
        const a = angleTo(this.x, this.y, p.x, p.y) + HALF_PI * b.strafe;
        world.moveCircle(this, Math.cos(a) * this.speed * 0.55 * dt, Math.sin(a) * this.speed * 0.55 * dt); this.moving = 0.5; moved = true;
      } else this.moving = 0;
      this.faceTarget(dt, p.x, p.y, 16);
      this.fireControl(dt, game, d, moved);
      // Sous pression : couvert
      if (game.time - this.lastHitT < 0.4 && this.hp < 55 && Math.random() < 0.02) this.seekCover(game);
    } else {
      // Cible perdue : avancer vers la dernière position connue, puis fouiller
      if (known && game.time - known.t < 8) {
        const arrived = this.moveTo(dt, game, known.x, known.y, 0.85, 20);
        if (this.moving) this.angle = angleTo(this.x, this.y, known.x, known.y);
        if (arrived) { b.mode = 'search'; b.searchT = rand(5, 8); b.searchPt = null; }
        if (w.reloading === false && weaponCanReload(w) && rounds < w.def.magSize * 0.5 && arrived) weaponStartReload(w);
      } else { b.mode = 'search'; b.searchT = rand(4, 7); }
    }
  }
  fireControl(dt, game, d, moving = false) {
    const b = this.brain; const w = this.weapon; const p = game.player;
    if (b.reactT > 0 || w.reloading || weaponRounds(w) === 0 || !p.alive) return;
    if (b.shotT > 0) b.shotT -= dt;
    if (b.pauseT > 0) { b.pauseT -= dt; return; }
    if (b.burstLeft <= 0) { b.burstLeft = randInt(this.skill.burst[0], this.skill.burst[1]); if (w.def.type === 'shotgun') b.burstLeft = 1; }
    if (b.shotT > 0) return;
    if (Math.abs(angleDiff(this.angle, angleTo(this.x, this.y, p.x, p.y))) > rad(8)) return;
    if (this.allyInLine(game, p.x, p.y)) { b.strafe = choice([-1, 1]); b.strafeT = 0.5; return; }
    // Précision : compétence, mouvement de la cible, propre mouvement, tir réflexe
    const targetSpeed = Math.hypot(p.vx, p.vy);
    let spread = this.skill.spread * (1 + targetSpeed / 150);
    if (moving) spread += 2.5;
    if (game.time - b.seesT < 0.5) spread += 3; // tir réflexe
    if (this.hurtFlash > 0) spread += 2;
    if (p.dodgeT > 0) spread += 4;
    spread += w.recoil * 0.6;
    spread *= game.settings.enemySpreadMult;
    const ammo = AMMO[w.def.ammo];
    const mz = this.muzzle();
    weaponFireRound(w);
    const n = ammo.pellets || 1;
    // anticipation (lead) approximative
    const lead = clamp(d / ammo.speed, 0, 0.12) * this.skill.aim;
    const aimA = angleTo(mz.x, mz.y, p.x + p.vx * lead, p.y + p.vy * lead);
    for (let i = 0; i < n; i++) {
      let a = aimA + gauss() * rad(spread);
      if (ammo.pellets) a += gauss() * rad(ammo.pelletSpread);
      game.bullets.push(new Bullet(mz.x, mz.y, a, ammo, this));
    }
    game.shoot(this, mz, ammo);
    b.burstLeft--;
    b.shotT = w.def.type === 'pistol' ? rand(0.22, 0.34) : w.def.interval * rand(1, 1.3);
    if (b.burstLeft <= 0) { b.pauseT = rand(this.skill.pause[0], this.skill.pause[1]); if (Math.random() < 0.5) { b.strafe = choice([-1, 1]); b.strafeT = rand(0.3, 0.7); } }
  }
  meleeBehaviour(dt, game) {
    const b = this.brain; const p = game.player; const world = game.world;
    // S'il a une arme à feu (rôle assaut désarmé qui a récupéré une arme), retour au combat
    if (this.hasFirearm) { b.mode = 'engage'; return; }
    // Chercher une arme au sol proche
    if (b.role !== 'melee' && !this.weapon) {
      if (!b.retrieve || b.retrieve.dead) {
        let best = null, bd = 8 * TILE;
        for (const pk of game.pickups) { if (pk.dead || pk.kind !== 'weapon' || pk.weapon.def.type === 'melee' || weaponRounds(pk.weapon) + weaponReserve(pk.weapon) === 0) continue; const dd = dist(this.x, this.y, pk.x, pk.y); if (dd < bd) { bd = dd; best = pk; } }
        b.retrieve = best;
      }
      if (b.retrieve && !b.retrieve.dead) {
        const arrived = this.moveTo(dt, game, b.retrieve.x, b.retrieve.y, 1.1, 12);
        if (this.moving) this.angle = angleTo(this.x, this.y, b.retrieve.x, b.retrieve.y);
        if (arrived) { const w = b.retrieve.weapon; b.retrieve.dead = true; this.weapons.push(w); this.weapon = w; b.retrieve = null; b.mode = 'engage'; b.reactT = 0.3; game.audio.click(0, game.panOf(this.x, this.y), 0.2, 1200); }
        return;
      }
    }
    if (!p.alive) { this.moving = 0; return; }
    const known = b.lastSeen; const sees = b.sees;
    const d = dist(this.x, this.y, p.x, p.y);
    const knife = this.weapon && this.weapon.def.type === 'melee';
    const reach = (knife ? this.weapon.def.reach : 20) + this.r + p.r;
    if (b.windup > 0) {
      b.windup -= dt; this.faceTarget(dt, p.x, p.y, 20); this.moving = 0;
      if (b.windup <= 0) {
        b.meleeCd = knife ? 0.9 : 1.1; this.meleeAnim = 0.2;
        if (d < reach + 6 && Math.abs(angleDiff(this.angle, angleTo(this.x, this.y, p.x, p.y))) < rad(50) && p.dodgeT <= 0) {
          const dmg = knife ? { head: 45, torso: 30, limb: 18 } : { head: 12, torso: 9, limb: 6 };
          applyHit(game, p, dmg, Math.random() < 0.8 ? 'torso' : 'limb', { cls: 'melee', shooter: this, dir: angleTo(this.x, this.y, p.x, p.y) });
          game.audio.meleeHit(0, knife); game.shake(knife ? 5 : 3);
          if (!knife) p.stagger = Math.max(p.stagger, 0.25);
        } else game.audio.swish(game.panOf(this.x, this.y));
      }
      return;
    }
    if (sees || (known && game.time - known.t < 10)) {
      const tx = sees ? p.x : known.x, ty = sees ? p.y : known.y;
      if (sees && d < reach) {
        this.faceTarget(dt, p.x, p.y, 20); this.moving = 0;
        if (b.meleeCd <= 0 && b.reactT <= 0) b.windup = knife ? 0.42 : 0.5;
        if (b.reactT > 0) b.reactT -= dt;
      } else {
        // approche en zigzag pour être plus dur à toucher
        let gx = tx, gy = ty;
        if (sees && d > 3 * TILE) { const a = angleTo(this.x, this.y, p.x, p.y) + HALF_PI; const zz = Math.sin(game.time * 5 + this.x) * 0.9 * TILE; gx += Math.cos(a) * zz; gy += Math.sin(a) * zz; }
        const arrived = this.moveTo(dt, game, gx, gy, 1.0, sees ? reach - 8 : 20);
        if (this.moving) this.angle = angleTo(this.x, this.y, gx, gy);
        if (arrived && !sees) { b.mode = 'search'; b.searchT = rand(4, 7); b.searchPt = null; if (b.role === 'melee') { b.mode = 'melee'; b.state = 'alert'; b.lastSeen = null; } }
      }
    } else { this.moving = 0; b.state = 'alert'; this.angle += dt * 0.8; }
  }
}
