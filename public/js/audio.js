// Tiny synthesized sound engine (no audio assets needed).
export class Audio {
  constructor() { this.ctx = null; this.volume = 0.6; }
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = this.volume;
      // everything passes through a lowpass that closes when your head goes under water
      this.uw = this.ctx.createBiquadFilter(); this.uw.type = 'lowpass'; this.uw.frequency.value = 22000; this.uw.Q.value = 0.7;
      this.master.connect(this.uw); this.uw.connect(this.ctx.destination);
      this.uwLevel = 0;
      const len = this.ctx.sampleRate * 1.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch { this.ctx = null; }
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  get ok() { return !!this.ctx && this.ctx.state === 'running'; }
  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }

  _noise(dur, { freq = 1000, q = 1, type = 'lowpass', gain = 0.5, attack = 0.002, decay = dur, dist = 0, sweep = 0 } = {}) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    const g = this.ctx.createGain();
    const att = 1 / (1 + dist * 0.03);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain * att, t + attack); g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }
  _tone(freq, dur, { type = 'sine', gain = 0.3, slide = 1, attack = 0.005, at = 0 } = {}) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  shot(weapon, dist = 0) {
    if (weapon === 'quiet') { this._noise(0.12, { freq: 900, q: 1.2, type: 'bandpass', gain: 0.22 / (1 + dist * 0.05), dist }); return this._tone(220, 0.05, { type: 'triangle', gain: 0.06, slide: 0.5 }); }
    if (weapon === 'bow') return this._noise(0.18, { freq: 700, q: 2, type: 'bandpass', gain: 0.25, dist });
    const big = weapon === 'shotgun' || weapon === 'rifle';
    this._noise(big ? 0.45 : 0.3, { freq: big ? 1600 : 2200, gain: big ? 0.9 : 0.7, dist, sweep: 0.15 });
    this._tone(big ? 90 : 140, 0.18, { type: 'triangle', gain: 0.4 / (1 + dist * 0.03), slide: 0.4 });
  }
  swing() { this._noise(0.15, { freq: 900, q: 1.5, type: 'bandpass', gain: 0.12, sweep: 2 }); }
  chop() { this._noise(0.12, { freq: 500, q: 3, type: 'bandpass', gain: 0.5 }); this._tone(180, 0.08, { type: 'square', gain: 0.08, slide: 0.6 }); }
  mine() { this._noise(0.1, { freq: 3000, q: 4, type: 'bandpass', gain: 0.4 }); this._tone(900, 0.12, { type: 'triangle', gain: 0.12, slide: 0.8 }); }
  hitFlesh() { this._noise(0.1, { freq: 400, q: 1, gain: 0.5 }); }
  hitStruct() { this._noise(0.12, { freq: 1200, q: 2, type: 'bandpass', gain: 0.35 }); }
  hitmark() { this._tone(1800, 0.05, { type: 'square', gain: 0.06 }); }
  explosion(dist = 0) { this._noise(1.4, { freq: 600, gain: 1.4, dist: dist * 0.5, decay: 1.4, sweep: 0.1 }); this._tone(55, 0.9, { type: 'sine', gain: 0.8 / (1 + dist * 0.01), slide: 0.5 }); }
  beep() { this._tone(2200, 0.06, { type: 'square', gain: 0.05 }); }
  door() { this._noise(0.25, { freq: 300, q: 4, type: 'bandpass', gain: 0.3 }); }
  spray() { this._noise(0.35, { freq: 5000, q: 0.6, type: 'highpass', gain: 0.18 }); }
  // ---- ambience (quiet, procedural)
  birdsong(v = Math.random()) {
    const base = 2600 + v * 1800, n = 2 + Math.floor(v * 5);
    for (let i = 0; i < n; i++) this._tone(base * (0.9 + Math.random() * 0.25), 0.07 + Math.random() * 0.06, { gain: 0.018, slide: Math.random() < 0.5 ? 1.35 : 0.75, at: i * (0.09 + v * 0.05), attack: 0.01 });
  }
  cricket() { for (let i = 0; i < 3; i++) this._tone(4300 + Math.random() * 300, 0.035, { type: 'square', gain: 0.006, at: i * 0.055 }); }
  owl() { this._tone(380, 0.35, { gain: 0.03, slide: 0.92, attack: 0.06 }); this._tone(360, 0.5, { gain: 0.03, slide: 0.88, attack: 0.08, at: 0.55 }); }
  gull() { for (let i = 0; i < 3; i++) this._tone(1500 - i * 120, 0.16, { type: 'triangle', gain: 0.015, slide: 0.7, at: i * 0.2 }); }
  wave() { this._noise(1.4, { freq: 520, q: 0.4, gain: 0.07, attack: 0.6, decay: 1.4, sweep: 0.5 }); }
  drip() { const f = 1800 + Math.random() * 1400; this._tone(f, 0.08, { gain: 0.03, slide: 0.55 }); this._tone(f * 0.7, 0.12, { gain: 0.015, slide: 0.6, at: 0.09 }); }
  click() { this._tone(900, 0.03, { type: 'square', gain: 0.04 }); }
  pickup() { this._tone(600, 0.06, { gain: 0.08, slide: 1.5 }); }
  hurt() { this._tone(220, 0.25, { type: 'sawtooth', gain: 0.08, slide: 0.6 }); }
  step(surface) {
    const f = { sand: 900, snow: 1500, mud: 300, grass: 1200, dirt: 700, rock: 2500, concrete: 2800, water: 500, ice: 3400 }[surface] || 1000;
    this._noise(0.08, { freq: f, q: 1.2, type: 'bandpass', gain: surface === 'water' ? 0.12 : 0.06 });
  }
  dig(dist = 0) { this._noise(0.22, { freq: 350, q: 0.8, gain: 0.45, dist, sweep: 0.5 }); this._noise(0.08, { freq: 1800, q: 3, type: 'bandpass', gain: 0.15, dist }); }
  // body hitting the water: a slap, a churn of bubbles and falling droplets
  splash(k = 0.6) {
    this._noise(0.12, { freq: 2600, q: 0.6, gain: 0.25 * k + 0.08, sweep: 0.4 });
    this._noise(0.6 + k * 0.5, { freq: 1100, q: 0.5, gain: 0.3 * k + 0.08, attack: 0.02, sweep: 0.25 });
    for (let i = 0; i < 4 + k * 8; i++) this._tone(500 + Math.random() * 900, 0.05, { gain: 0.012 + k * 0.012, slide: 1.8, at: 0.05 + Math.random() * (0.4 + k * 0.4) });
  }
  swimStroke(under) {
    if (under) { this._noise(0.55, { freq: 260, q: 0.8, gain: 0.16, attack: 0.15, sweep: 0.6 }); return; }
    this._noise(0.45, { freq: 900, q: 0.9, type: 'bandpass', gain: 0.1, attack: 0.12, sweep: 0.55 });
    this._noise(0.3, { freq: 2400, q: 1.5, type: 'bandpass', gain: 0.025, attack: 0.1, sweep: 0.7 });
    for (let i = 0; i < 3; i++) this._tone(700 + Math.random() * 700, 0.04, { gain: 0.008, slide: 1.6, at: 0.25 + Math.random() * 0.3 });
  }
  bubbles() { const n = 3 + Math.floor(Math.random() * 5); for (let i = 0; i < n; i++) this._tone(260 + Math.random() * 500, 0.06 + Math.random() * 0.05, { gain: 0.035, slide: 1.9, at: i * (0.05 + Math.random() * 0.08), attack: 0.004 }); }
  // ice: a sharp crack, the slab "singing" with falling chirps; breaking through adds the shatter and splash
  iceCrack(final = false, dist = 0) {
    const a = 1 / (1 + dist * 0.04);
    this._noise(0.07, { freq: 4200, q: 1.5, type: 'bandpass', gain: 0.5 * a, dist });
    this._noise(0.25, { freq: 220, q: 0.8, gain: 0.35 * a, dist });
    for (let i = 0; i < 3; i++) this._tone(3800 - i * 900 + Math.random() * 500, 0.35 + i * 0.1, { gain: 0.025 * a, slide: 0.35, at: 0.02 + i * 0.07 });
    if (final) {
      this._noise(0.9, { freq: 3000, q: 0.7, type: 'bandpass', gain: 0.35 * a, sweep: 0.3, dist });
      this._tone(70, 0.6, { gain: 0.3 * a, slide: 0.6 });
      for (let i = 0; i < 8; i++) this._tone(2500 + Math.random() * 3000, 0.04, { type: 'triangle', gain: 0.03 * a, slide: 0.7, at: 0.05 + Math.random() * 0.5 });
      setTimeout(() => this.splash(0.5 * a), 180);
    }
  }
  // long gliding moans and upsweeps, far away
  whaleSong() {
    if (!this.ok) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const at = t0 + i * 2.6 + Math.random() * 0.8, f = 180 + Math.random() * 220, dur = 1.6 + Math.random() * 1.4;
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f, at);
      o.frequency.exponentialRampToValueAtTime(f * (Math.random() < 0.5 ? 1.8 : 0.55), at + dur);
      const vib = this.ctx.createOscillator(); vib.frequency.value = 5; const vg = this.ctx.createGain(); vg.gain.value = f * 0.02; vib.connect(vg); vg.connect(o.frequency);
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.05, at + dur * 0.3); g.gain.linearRampToValueAtTime(0, at + dur);
      o.connect(g); g.connect(this.master); o.start(at); vib.start(at); o.stop(at + dur + 0.1); vib.stop(at + dur + 0.1);
    }
  }
  // the hull groaning under pressure
  creak() { this._tone(70 + Math.random() * 40, 1.2, { type: 'sawtooth', gain: 0.06, slide: 0.7, attack: 0.3 }); this._noise(0.9, { freq: 300, q: 4, type: 'bandpass', gain: 0.12, attack: 0.2, sweep: 0.5 }); this._tone(1800 + Math.random() * 900, 0.15, { type: 'triangle', gain: 0.02, slide: 0.5, at: 0.4 }); }
  gasp() { this._noise(0.45, { freq: 1300, q: 0.9, type: 'bandpass', gain: 0.16, attack: 0.08, sweep: 1.6 }); this._noise(0.6, { freq: 700, q: 0.7, type: 'bandpass', gain: 0.07, attack: 0.3, sweep: 0.6 }); }
  // 0 = in air, 1 = head under water
  setUnderwater(k, deep = 0) {
    if (!this.ctx) return;
    const key = k > 0.5 ? 1 + Math.round(deep * 4) : 0;
    if (key === this.uwLevel) return;
    this.uwLevel = key;
    const t = this.ctx.currentTime;
    this.uw.frequency.setTargetAtTime(k > 0.5 ? 420 - deep * 200 : 22000, t, 0.05);
    if (k > 0.5 && !this.uwHum) {
      // the pressure hum of being under water
      const src = this.ctx.createBufferSource(); src.buffer = this.noise; src.loop = true; src.playbackRate.value = 0.5;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 160;
      const g = this.ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(0.5, t, 0.2);
      src.connect(f); f.connect(g); g.connect(this.ctx.destination); src.start();
      this.uwHum = { src, g };
    } else if (k <= 0.5 && this.uwHum) {
      const h = this.uwHum; this.uwHum = null;
      h.g.gain.setTargetAtTime(0, t, 0.08); setTimeout(() => h.src.stop(), 600);
    }
  }
  craftDone() { this._tone(520, 0.08, { gain: 0.08 }); setTimeout(() => this._tone(780, 0.1, { gain: 0.08 }), 80); }
  growl() { this._tone(90, 0.5, { type: 'sawtooth', gain: 0.15, slide: 0.7 }); }

  // continuous engine voice
  engine() {
    if (!this.ok) return null;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    const o2 = this.ctx.createOscillator(); o2.type = 'square';
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
    const g = this.ctx.createGain(); g.gain.value = 0;
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
    o.start(); o2.start();
    return {
      set: (rpm, load) => {
        const t = this.ctx.currentTime;
        o.frequency.setTargetAtTime(35 + rpm * 110, t, 0.05);
        o2.frequency.setTargetAtTime((35 + rpm * 110) * 0.5, t, 0.05);
        f.frequency.setTargetAtTime(300 + load * 900 + rpm * 400, t, 0.05);
        g.gain.setTargetAtTime(0.05 + load * 0.07, t, 0.05);
      },
      stop: () => { const t = this.ctx.currentTime; g.gain.setTargetAtTime(0, t, 0.1); setTimeout(() => { o.stop(); o2.stop(); }, 500); },
    };
  }
}
export const audio = new Audio();
