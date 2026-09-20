'use strict';
// ---------------------------------------------------------------------------
// Armes et munitions. Modèle réaliste :
//  - chaque chargeur a son propre nombre de cartouches (réserve = liste de chargeurs)
//  - cartouche chambrée "+1" conservée lors d'un rechargement tactique
//  - culasse ouverte (slide lock) quand l'arme est vide : rechargement plus long
//  - fusil à pompe rechargé cartouche par cartouche (interruptible)
// ---------------------------------------------------------------------------
const AMMO = {
  '9mm':  { cls: 'pistol',  speed: 11000, dmg: { head: 100, torso: 34, limb: 18 }, pen: 0, range: 45 * TILE, tracer: 'rgba(255,225,150,' },
  '.45':  { cls: 'pistol',  speed: 8800,  dmg: { head: 100, torso: 44, limb: 22 }, pen: 0, range: 40 * TILE, tracer: 'rgba(255,210,140,' },
  '5.56': { cls: 'rifle',   speed: 24000, dmg: { head: 130, torso: 58, limb: 30 }, pen: 1, range: 90 * TILE, tracer: 'rgba(255,240,200,' },
  '12ga': { cls: 'shotgun', speed: 12000, dmg: { head: 32,  torso: 15, limb: 8 },  pen: 0, range: 22 * TILE, pellets: 8, pelletSpread: 3.4, tracer: 'rgba(255,200,120,' }
};

const WEAPONS = {
  knife: { id: 'knife', name: 'Couteau', short: 'CTX', type: 'melee', reach: 30, dmg: { head: 80, torso: 45, limb: 25 }, rate: 0.36, swap: 0.25, len: 9, silent: true },
  p30l:  { id: 'p30l', name: 'P-30L 9mm', short: 'P30L', type: 'pistol', ammo: '9mm', magSize: 15, auto: false, interval: 0.14,
           spread: 1.3, aimSpread: 0.45, moveSpread: 1.5, recoil: 2.2, recoilMax: 8, recoilRecover: 14,
           reloadTac: 1.45, reloadEmpty: 1.95, swap: 0.45, noise: 17, twoHanded: false, aimSpeed: 0.62, len: 14 },
  g34:   { id: 'g34', name: 'G-34 9mm', short: 'G34', type: 'pistol', ammo: '9mm', magSize: 17, auto: false, interval: 0.13,
           spread: 1.0, aimSpread: 0.35, moveSpread: 1.4, recoil: 2.0, recoilMax: 8, recoilRecover: 15,
           reloadTac: 1.5, reloadEmpty: 2.0, swap: 0.45, noise: 17, twoHanded: false, aimSpeed: 0.62, len: 15 },
  g19:   { id: 'g19', name: 'G-19 9mm', short: 'G19', type: 'pistol', ammo: '9mm', magSize: 15, auto: false, interval: 0.15,
           spread: 1.7, aimSpread: 0.6, moveSpread: 1.6, recoil: 2.5, recoilMax: 9, recoilRecover: 13,
           reloadTac: 1.5, reloadEmpty: 2.05, swap: 0.4, noise: 17, twoHanded: false, aimSpeed: 0.62, len: 12 },
  m1911: { id: 'm1911', name: '1911 .45 ACP', short: '1911', type: 'pistol', ammo: '.45', magSize: 8, auto: false, interval: 0.16,
           spread: 1.4, aimSpread: 0.5, moveSpread: 1.6, recoil: 3.4, recoilMax: 10, recoilRecover: 13,
           reloadTac: 1.5, reloadEmpty: 2.0, swap: 0.45, noise: 19, twoHanded: false, aimSpeed: 0.62, len: 14 },
  mp9:   { id: 'mp9', name: 'MP-9 9mm', short: 'MP9', type: 'smg', ammo: '9mm', magSize: 30, auto: true, modes: ['auto', 'semi'], interval: 0.0706,
           spread: 2.4, aimSpread: 1.1, moveSpread: 2.2, recoil: 1.1, recoilMax: 11, recoilRecover: 17,
           reloadTac: 2.0, reloadEmpty: 2.6, swap: 0.6, noise: 18, twoHanded: true, aimSpeed: 0.55, len: 17 },
  tr1:   { id: 'tr1', name: 'TR-1 5.56 Carabine', short: 'TR1', type: 'rifle', ammo: '5.56', magSize: 30, auto: true, modes: ['auto', 'semi'], interval: 0.0857,
           spread: 0.9, aimSpread: 0.25, moveSpread: 2.0, recoil: 1.6, recoilMax: 9, recoilRecover: 18,
           reloadTac: 2.2, reloadEmpty: 2.9, swap: 0.8, noise: 28, twoHanded: true, aimSpeed: 0.5, len: 27 },
  m4s:   { id: 'm4s', name: 'M-4 Tactique 12ga', short: 'M4', type: 'shotgun', ammo: '12ga', magSize: 7, auto: false, interval: 0.3,
           spread: 1.5, aimSpread: 0.8, moveSpread: 1.5, recoil: 6, recoilMax: 12, recoilRecover: 14,
           reloadShell: 0.55, swap: 0.8, noise: 30, twoHanded: true, aimSpeed: 0.5, len: 27 }
};

// Crée une instance d'arme. opts : { mags: nb de chargeurs de réserve, rounds: cartouches dans le chargeur }
function makeWeapon(id, opts = {}) {
  const def = WEAPONS[id];
  if (!def) throw new Error('Arme inconnue : ' + id);
  const w = { def, id, cooldown: 0, recoil: 0, reloading: false, reloadT: 0, reloadDur: 0, reloadKind: null, mode: def.modes ? def.modes[0] : null, swapT: 0 };
  if (def.type === 'melee') return w;
  const rounds = opts.rounds != null ? opts.rounds : def.magSize;
  if (def.type === 'shotgun') {
    w.mag = Math.min(rounds, def.magSize); w.chamber = rounds > 0 ? 1 : 0;
    if (w.chamber && w.mag === def.magSize) w.mag = def.magSize; // 7+1
    w.shells = opts.shells != null ? opts.shells : (opts.mags != null ? opts.mags * def.magSize : 14);
    w.mags = null;
  } else {
    w.mag = Math.max(0, Math.min(rounds, def.magSize)); w.chamber = rounds > 0 ? 1 : 0;
    w.mags = [];
    const n = opts.mags != null ? opts.mags : 2;
    for (let i = 0; i < n; i++) w.mags.push(def.magSize);
  }
  return w;
}
function weaponRounds(w) { return w.def.type === 'melee' ? 0 : w.mag + w.chamber; }
function weaponReserve(w) { if (w.def.type === 'melee') return 0; return w.def.type === 'shotgun' ? w.shells : w.mags.reduce((a, b) => a + b, 0); }
function weaponCanReload(w) {
  if (w.def.type === 'melee' || w.reloading) return false;
  if (w.def.type === 'shotgun') return w.shells > 0 && (w.mag + w.chamber) < w.def.magSize + 1;
  return w.mags.length > 0 && !(w.mag === w.def.magSize && w.chamber === 1);
}
function weaponIsEmpty(w) { return w.def.type !== 'melee' && w.mag + w.chamber === 0; }
// Démarre un rechargement. Retourne {kind, dur} ou null.
function weaponStartReload(w) {
  if (!weaponCanReload(w)) return null;
  w.reloading = true; w.reloadT = 0;
  if (w.def.type === 'shotgun') { w.reloadKind = 'shell'; w.reloadDur = w.def.reloadShell; }
  else if (w.mag + w.chamber === 0) { w.reloadKind = 'empty'; w.reloadDur = w.def.reloadEmpty; }
  else { w.reloadKind = 'tac'; w.reloadDur = w.def.reloadTac; }
  return { kind: w.reloadKind, dur: w.reloadDur };
}
function weaponCancelReload(w) { if (w.reloading) { w.reloading = false; w.reloadT = 0; } }
// Fait avancer les timers ; renvoie true si un rechargement vient d'aboutir (une cartouche pour le fusil).
function weaponUpdate(w, dt) {
  let done = false;
  if (w.cooldown > 0) w.cooldown -= dt;
  if (w.swapT > 0) w.swapT -= dt;
  if (w.recoil > 0) w.recoil = Math.max(0, w.recoil - (w.def.recoilRecover || 10) * dt);
  if (w.reloading) {
    w.reloadT += dt;
    if (w.reloadT >= w.reloadDur) {
      done = true;
      if (w.def.type === 'shotgun') {
        if (w.shells > 0) {
          w.shells--;
          if (w.chamber === 0) w.chamber = 1; else w.mag = Math.min(w.def.magSize, w.mag + 1);
        }
        w.reloadT = 0;
        if (!(w.shells > 0 && (w.mag + w.chamber) < w.def.magSize + 1)) w.reloading = false;
      } else {
        // On prend le chargeur le plus plein ; le chargeur partiel est conservé (rétention).
        w.mags.sort((a, b) => b - a);
        const fresh = w.mags.shift();
        if (w.mag > 0) { w.mags.push(w.mag); w.mags.sort((a, b) => b - a); }
        w.mag = fresh;
        if (w.chamber === 0 && w.mag > 0) { w.chamber = 1; w.mag--; } // culasse relâchée : on chambre
        w.reloading = false; w.reloadT = 0;
      }
    }
  }
  return done;
}
// Tire une cartouche (décrémente). Renvoie false si vide.
function weaponFireRound(w) {
  if (w.chamber === 0) return false;
  w.chamber = 0;
  if (w.mag > 0) { w.mag--; w.chamber = 1; } // cycle automatique
  w.cooldown = w.def.interval;
  w.recoil = Math.min(w.def.recoilMax, w.recoil + w.def.recoil);
  return true;
}
function weaponToggleMode(w) { if (!w.def.modes) return null; const i = w.def.modes.indexOf(w.mode); w.mode = w.def.modes[(i + 1) % w.def.modes.length]; return w.mode; }
function weaponModeLabel(w) { if (!w.def.modes) return w.def.type === 'melee' ? 'MÊLÉE' : 'SEMI'; return w.mode === 'auto' ? 'AUTO' : 'SEMI'; }
function weaponAddMags(w, n) { if (w.def.type === 'shotgun') w.shells += n * w.def.magSize; else for (let i = 0; i < n; i++) w.mags.push(w.def.magSize); }
function weaponRefill(w) {
  if (w.def.type === 'melee') return;
  if (w.def.type === 'shotgun') { w.mag = w.def.magSize; w.chamber = 1; w.shells = Math.max(w.shells, 14); }
  else { w.mag = w.def.magSize; w.chamber = 1; w.mags = w.mags.map(() => w.def.magSize); while (w.mags.length < 2) w.mags.push(w.def.magSize); }
}
