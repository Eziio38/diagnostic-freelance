'use strict';
// ---------------------------------------------------------------------------
// Audio entièrement synthétisé (Web Audio API) : aucun fichier externe.
// ---------------------------------------------------------------------------
class AudioSys {
  constructor() {
    this.ctx = null; this.master = null; this.musicBus = null;
    this.volume = Store.get('volume', 0.7);
    this.musicOn = Store.get('music', true);
    this.noiseBuf = null;
    this.music = null; // { type, next, timer }
  }
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(this.ctx.destination);
    // Bus musique étouffé (musique entendue "à travers les murs")
    this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = 0.5;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    this.musicBus.connect(lp); lp.connect(this.master);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setVolume(v) { this.volume = v; Store.set('volume', v); if (this.master) this.master.gain.value = v; }
  panner(p) {
    if (this.ctx.createStereoPanner) { const s = this.ctx.createStereoPanner(); s.pan.value = clamp(p, -1, 1); return s; }
    return this.ctx.createGain();
  }
  noise(o) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (o.delay || 0);
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    src.loopStart = Math.random() * 0.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, o.gain), t + (o.attack || 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let node = src;
    if (o.filter) {
      const f = this.ctx.createBiquadFilter(); f.type = o.filter.type; f.frequency.setValueAtTime(o.filter.freq, t); f.Q.value = o.filter.q || 0.8;
      if (o.filter.sweep) f.frequency.exponentialRampToValueAtTime(o.filter.sweep, t + o.dur);
      node.connect(f); node = f;
    }
    node.connect(g);
    const pan = this.panner(o.pan || 0); g.connect(pan); pan.connect(o.bus || this.master);
    src.start(t); src.stop(t + o.dur + 0.05);
  }
  tone(o) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (o.delay || 0);
    const osc = this.ctx.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + o.dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, o.gain), t + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let node = osc;
    if (o.filter) { const f = this.ctx.createBiquadFilter(); f.type = o.filter.type; f.frequency.value = o.filter.freq; node.connect(f); node = f; }
    node.connect(g);
    const pan = this.panner(o.pan || 0); g.connect(pan); pan.connect(o.bus || this.master);
    osc.start(t); osc.stop(t + o.dur + 0.05);
  }
  // --- Sons de jeu ---------------------------------------------------------
  gunshot(cls, pan = 0, vol = 1) {
    if (!this.ctx || vol <= 0.01) return;
    if (cls === 'shotgun') {
      this.noise({ dur: 0.24, gain: 1.0 * vol, filter: { type: 'lowpass', freq: 2200, sweep: 180 }, pan });
      this.tone({ freq: 75, slide: 28, dur: 0.22, gain: 0.8 * vol, pan });
    } else if (cls === 'rifle') {
      this.noise({ dur: 0.03, gain: 0.7 * vol, filter: { type: 'highpass', freq: 2500 }, pan });
      this.noise({ dur: 0.13, gain: 0.85 * vol, filter: { type: 'lowpass', freq: 4200, sweep: 500 }, pan });
      this.tone({ freq: 95, slide: 34, dur: 0.11, gain: 0.55 * vol, pan });
    } else if (cls === 'smg') {
      this.noise({ dur: 0.06, gain: 0.7 * vol, filter: { type: 'lowpass', freq: 2800, sweep: 500 }, pan });
      this.tone({ freq: 120, slide: 45, dur: 0.06, gain: 0.35 * vol, pan });
    } else {
      this.noise({ dur: 0.09, gain: 0.85 * vol, filter: { type: 'lowpass', freq: 2600, sweep: 380 }, pan });
      this.tone({ freq: 125, slide: 40, dur: 0.08, gain: 0.45 * vol, pan });
    }
  }
  dryFire(pan = 0) { this.noise({ dur: 0.025, gain: 0.3, filter: { type: 'bandpass', freq: 2500, q: 2 }, pan }); }
  click(delay = 0, pan = 0, gain = 0.3, freq = 1800) { this.noise({ dur: 0.03, gain, filter: { type: 'bandpass', freq, q: 1.5 }, pan, delay }); }
  reload(kind, dur, pan = 0) {
    if (kind === 'shell') { this.click(0, pan, 0.25, 1400); return; }
    this.click(0.05, pan, 0.3, 1600);          // chargeur retiré
    this.click(dur * 0.55, pan, 0.35, 2200);   // chargeur inséré
    if (kind === 'empty') this.noise({ dur: 0.05, gain: 0.4, filter: { type: 'bandpass', freq: 1200, q: 1 }, pan, delay: dur * 0.85 }); // culasse relâchée
  }
  swap(pan = 0) { this.click(0, pan, 0.18, 1200); this.click(0.12, pan, 0.14, 900); }
  swish(pan = 0) { this.noise({ dur: 0.1, gain: 0.14, filter: { type: 'bandpass', freq: 1100, sweep: 300, q: 0.7 }, pan }); }
  meleeHit(pan = 0, heavy = false) {
    this.noise({ dur: heavy ? 0.12 : 0.07, gain: heavy ? 0.7 : 0.45, filter: { type: 'lowpass', freq: 500, sweep: 120 }, pan });
    this.tone({ freq: heavy ? 70 : 95, slide: 40, dur: 0.08, gain: 0.4, pan });
  }
  bodyFall(pan = 0) { this.noise({ dur: 0.18, gain: 0.5, filter: { type: 'lowpass', freq: 320, sweep: 90 }, pan }); }
  hurt() { this.tone({ freq: 60, slide: 35, dur: 0.14, gain: 0.55 }); this.noise({ dur: 0.1, gain: 0.3, filter: { type: 'lowpass', freq: 400 } }); }
  fleshHit(pan = 0, vol = 1) { this.noise({ dur: 0.05, gain: 0.35 * vol, filter: { type: 'lowpass', freq: 700, sweep: 200 }, pan }); }
  impact(pan = 0, vol = 1) { this.noise({ dur: 0.04, gain: 0.3 * vol, filter: { type: 'bandpass', freq: 3000, q: 1 }, pan }); }
  ricochet(pan = 0, vol = 1) { this.tone({ freq: 3200, slide: 900, dur: 0.12, gain: 0.12 * vol, type: 'triangle', pan }); }
  glass(pan = 0, vol = 1) {
    this.noise({ dur: 0.3, gain: 0.5 * vol, filter: { type: 'highpass', freq: 3200 }, pan });
    for (let i = 0; i < 4; i++) this.tone({ freq: rand(2500, 6000), dur: 0.12, gain: 0.08 * vol, type: 'triangle', pan, delay: rand(0, 0.12) });
  }
  helmet(pan = 0, vol = 1) { this.tone({ freq: 2300, slide: 1700, dur: 0.22, gain: 0.25 * vol, pan }); this.tone({ freq: 3600, slide: 2900, dur: 0.15, gain: 0.15 * vol, pan }); }
  footstep(vol = 0.08, pan = 0) { this.noise({ dur: 0.045, gain: vol, filter: { type: 'lowpass', freq: 520 }, pan }); }
  door(pan = 0) { this.noise({ dur: 0.16, gain: 0.18, filter: { type: 'lowpass', freq: 300 }, pan }); this.tone({ freq: 260, slide: 190, dur: 0.14, gain: 0.04, type: 'triangle', pan }); }
  pickup() { this.tone({ freq: 620, slide: 980, dur: 0.09, gain: 0.14, type: 'triangle' }); }
  heal() { this.noise({ dur: 0.25, gain: 0.12, filter: { type: 'bandpass', freq: 1800, q: 0.5 } }); }
  shout(pan = 0, vol = 1) { this.tone({ freq: 190, slide: 130, dur: 0.2, gain: 0.09 * vol, type: 'sawtooth', filter: { type: 'lowpass', freq: 700 }, pan }); }
  throwWhoosh(pan = 0) { this.noise({ dur: 0.18, gain: 0.2, filter: { type: 'bandpass', freq: 700, sweep: 250, q: 0.8 }, pan }); }
  shellDrop(pan = 0) { this.tone({ freq: rand(3800, 5200), slide: 2500, dur: 0.05, gain: 0.04, type: 'triangle', pan, delay: rand(0.25, 0.45) }); }
  // --- Musique d'ambiance --------------------------------------------------
  startMusic(type) {
    this.stopMusic();
    if (!this.ctx || !this.musicOn || !type) return;
    this.music = { type, beat: 0, next: this.ctx.currentTime + 0.1, timer: null };
    if (type === 'drone' || type === 'continental') {
      const base = type === 'drone' ? 55 : 41.2;
      const o1 = this.ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = base;
      const o2 = this.ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = base * 2.005;
      const g = this.ctx.createGain(); g.gain.value = type === 'drone' ? 0.16 : 0.12;
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.07;
      const lfoG = this.ctx.createGain(); lfoG.gain.value = 0.06; lfo.connect(lfoG); lfoG.connect(g.gain);
      o1.connect(g); o2.connect(g); g.connect(this.musicBus);
      o1.start(); o2.start(); lfo.start();
      this.music.nodes = [o1, o2, lfo];
    }
    this.music.timer = setInterval(() => this.scheduleMusic(), 90);
  }
  scheduleMusic() {
    const m = this.music; if (!m || !this.ctx) return;
    const ahead = this.ctx.currentTime + 0.25;
    while (m.next < ahead) {
      const t = m.next - this.ctx.currentTime;
      if (m.type === 'club') {
        const bpm = 126, step = 60 / bpm / 2; // croches
        if (m.beat % 2 === 0) this.tone({ freq: 160, slide: 42, dur: 0.28, gain: 0.9, delay: t, bus: this.musicBus });
        else this.noise({ dur: 0.04, gain: 0.35, filter: { type: 'highpass', freq: 6000 }, delay: t, bus: this.musicBus });
        if (m.beat % 8 === 4) this.tone({ freq: 55, dur: 0.4, gain: 0.5, type: 'square', delay: t, bus: this.musicBus });
        if (m.beat % 16 === 14) this.tone({ freq: 220, slide: 165, dur: 0.3, gain: 0.25, type: 'sawtooth', delay: t, bus: this.musicBus });
        m.next += step;
      } else if (m.type === 'continental') {
        if (m.beat % 8 === 0) this.tone({ freq: choice([164.8, 196, 246.9, 220]), dur: 2.4, gain: 0.35, type: 'triangle', attack: 0.6, delay: t, bus: this.musicBus });
        m.next += 0.5;
      } else {
        if (m.beat % 12 === 0) this.tone({ freq: 110, dur: 3, gain: 0.25, type: 'triangle', attack: 1.2, delay: t, bus: this.musicBus });
        m.next += 0.5;
      }
      m.beat++;
    }
  }
  stopMusic() {
    if (!this.music) return;
    if (this.music.timer) clearInterval(this.music.timer);
    if (this.music.nodes) this.music.nodes.forEach(n => { try { n.stop(); } catch (e) { /* */ } });
    this.music = null;
  }
  toggleMusic(on) { this.musicOn = on; Store.set('music', on); if (!on) this.stopMusic(); }
}
