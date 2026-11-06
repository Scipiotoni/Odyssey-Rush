// Procedural rain, wind and thunder built from physical models (no samples):
//  - rain = thousands of individual drop impacts (short broadband transients on leaves/ground + Minnaert
//    bubble resonances — the rising "plink" a drop makes when it hits water), pre-rendered into long stereo
//    loops of different lengths so the texture never audibly repeats, over a shaped pink-noise wash
//  - under a roof the open-sky layers fade and a dull, low-passed "roof patter" layer takes over
//  - wind = band-passed noise with slowly wandering gusts
//  - thunder = a crack (close strikes) followed by a long rolling rumble of many overlapping swells of
//    brown noise, low-passed more the farther away it is, arriving at the speed of sound
const rnd = Math.random;
const logn = (m, s) => Math.exp(Math.log(m) + s * (rnd() + rnd() + rnd() - 1.5));

function dropsBuffer(ctx, secs, rate, kind) {
  const sr = ctx.sampleRate, n = Math.floor(secs * sr);
  const buf = ctx.createBuffer(2, n, sr), L = buf.getChannelData(0), R = buf.getChannelData(1);
  const count = Math.floor(secs * rate);
  for (let d = 0; d < count; d++) {
    const t0 = Math.floor(rnd() * n), pan = rnd(), gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
    const amp = Math.min(1, logn(kind === 'light' ? 0.22 : 0.08, 1.2));
    const write = (i, v) => { const j = (t0 + i) % n; L[j] += v * gl; R[j] += v * gr; };
    if (kind === 'roof') {
      // dull thud on a roof / tarp: resonant low-mid knock
      const f = 300 + rnd() * 900, dec = 0.006 + rnd() * 0.014, len = Math.floor(dec * 5 * sr);
      let ph = 0;
      for (let i = 0; i < len; i++) { const t = i / sr, e = Math.exp(-t / dec); ph += (2 * Math.PI * f) / sr; write(i, amp * 0.9 * e * (Math.sin(ph) * 0.7 + (rnd() * 2 - 1) * 0.3 * Math.exp(-t / 0.001))); }
      continue;
    }
    // impact transient: a 1-3 ms click, high-passed by differencing noise
    const cl = Math.floor((0.0006 + rnd() * 0.0025) * sr);
    let prev = 0;
    for (let i = 0; i < cl; i++) { const w = rnd() * 2 - 1, hp = w - prev; prev = w; write(i, amp * hp * Math.exp(-i / (cl * 0.35))); }
    // some drops land in water and ring: Minnaert bubble with a rising chirp
    if (rnd() < (kind === 'light' ? 0.35 : 0.22)) {
      const f0 = 1100 + rnd() * 3200, chirp = 18 + rnd() * 70, dec = 0.004 + rnd() * 0.012, len = Math.floor(dec * 6 * sr);
      let ph = 0;
      for (let i = 0; i < len; i++) { const t = i / sr; ph += (2 * Math.PI * f0 * (1 + chirp * t)) / sr; write(i + Math.floor(sr * 0.002), amp * 0.5 * Math.exp(-t / dec) * Math.sin(ph)); }
    }
  }
  // gentle normalisation
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const k = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < n; i++) { L[i] *= k; R[i] *= k; }
  return buf;
}
function pinkBuffer(ctx, secs) {
  const sr = ctx.sampleRate, n = Math.floor(secs * sr), buf = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) { // Paul Kellet's pink filter
      const w = rnd() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
  }
  return buf;
}
function thunderBuffer(ctx, dist, energy) {
  const sr = ctx.sampleRate, dur = 4 + Math.min(9, dist / 300) + rnd() * 3, n = Math.floor(dur * sr);
  const buf = ctx.createBuffer(2, n, sr), L = buf.getChannelData(0), R = buf.getChannelData(1);
  // envelope: a handful of rolls (the channel's many segments reaching you at different times)
  const rolls = [];
  const nr = 4 + Math.floor(rnd() * 6);
  for (let k = 0; k < nr; k++) rolls.push({ t: k === 0 ? 0 : rnd() * dur * 0.55, a: (k === 0 ? 1 : 0.35 + rnd() * 0.65) * (1 - k * 0.05), at: 0.04 + rnd() * 0.25, dec: 0.6 + rnd() * 2.2 });
  const env = (t) => { let e = 0; for (const r of rolls) if (t >= r.t) { const u = t - r.t; e += r.a * (u < r.at ? u / r.at : Math.exp(-(u - r.at) / r.dec)); } return e; };
  // brown noise rumble + slow random modulation, stereo decorrelated
  let bl = 0, br = 0, m = 1, mt = 0, envV = 0;
  const close = dist < 450;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (i % 512 === 0) { mt = 0.6 + rnd() * 0.8; }
    m += (mt - m) * 0.002;
    bl = (bl + (rnd() * 2 - 1) * 0.03) * 0.996; br = (br + (rnd() * 2 - 1) * 0.03) * 0.996;
    if ((i & 63) === 0) envV = env(t);
    const e = envV * m;
    L[i] = bl * e * 6; R[i] = br * e * 6;
  }
  // the crack: a sharp broadband tear in the first ~0.25 s of a close strike, with a few aftershocks
  if (close) {
    const strength = 1 - dist / 450;
    for (let c = 0; c < 3 + Math.floor(rnd() * 3); c++) {
      const t0 = Math.floor((c === 0 ? 0 : rnd() * 0.28) * sr), len = Math.floor((0.04 + rnd() * 0.12) * sr), a = (c === 0 ? 1 : 0.4 + rnd() * 0.4) * strength;
      for (let i = 0; i < len && t0 + i < n; i++) { const e = Math.exp(-i / (len * 0.25)) * a; L[t0 + i] += (rnd() * 2 - 1) * e * 0.9; R[t0 + i] += (rnd() * 2 - 1) * e * 0.9; }
    }
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const k = peak > 0 ? 0.95 / peak : 1;
  for (let i = 0; i < n; i++) { L[i] *= k; R[i] *= k; }
  return buf;
}

export { dropsBuffer, pinkBuffer, thunderBuffer };
export class RainAudio {
  constructor(audio) { this.a = audio; this.ready = false; this.cur = { rain: 0, storm: 0, wind: 0, cover: 0, cave: 0 }; }
  init() {
    const a = this.a;
    if (this.ready || !a.ctx) return;
    const ctx = a.ctx;
    this.ready = true;
    // bus: everything weather -> muffling filter (roof / cave) -> master
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 18000; this.muffle.Q.value = 0.5;
    this.bus = ctx.createGain(); this.bus.gain.value = 1;
    this.bus.connect(this.muffle); this.muffle.connect(a.master);
    // thunder goes through a compressor so a crack right overhead doesn't clip
    this.thunderBus = ctx.createDynamicsCompressor(); this.thunderBus.threshold.value = -14; this.thunderBus.ratio.value = 6; this.thunderBus.connect(a.master);
    const loop = (buf, rate = 1) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(ctx.currentTime + rnd() * 0.1, rnd() * buf.duration); return s; };
    const chain = (src, nodes, gain) => { let n = src; for (const f of nodes) { n.connect(f); n = f; } const g = ctx.createGain(); g.gain.value = 0; n.connect(g); g.connect(gain || this.bus); return g; };
    const bq = (type, f, q = 0.7, gain = 0) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = gain; return b; };
    // build the buffers a little later so starting a storm never hitches a frame
    setTimeout(() => {
      const pink = pinkBuffer(ctx, 7.3);
      // continuous wash: pink noise shaped into the "sssh" of distant rainfall
      this.wash = chain(loop(pink), [bq('highpass', 350), bq('lowpass', 7500), bq('peaking', 2600, 0.8, 4)]);
      // heavy rain body: low rumble of a downpour hitting everything at once
      this.body = chain(loop(pink, 0.85), [bq('lowpass', 900), bq('highpass', 70)]);
      // wind: band-passed noise with a wandering centre frequency
      this.windF = bq('bandpass', 380, 0.6);
      this.wind = chain(loop(pink, 0.6), [bq('lowpass', 1400), this.windF]);
      setTimeout(() => {
        this.dense = chain(loop(dropsBuffer(ctx, 6.1, 1400, 'dense')), [bq('highpass', 500), bq('lowshelf', 900, 0.7, -4)]);
        this.light = chain(loop(dropsBuffer(ctx, 8.7, 140, 'light')), [bq('highpass', 300)]);
        this.roof = chain(loop(dropsBuffer(ctx, 5.3, 900, 'roof')), [bq('lowpass', 2200), bq('peaking', 700, 1, 5)], a.master); // not muffled again
      }, 30);
    }, 0);
    this.gust = 0; this.gustT = 0;
  }
  // rain, storm, wind: 0..1; cover 0 (open sky) .. 1 (under a roof); cave: 0..1
  update(dt, w) {
    if (!this.a.ctx || this.a.ctx.state !== 'running') return;
    if (w.rain < 0.01 && w.wind < 0.4 && !this.ready) return;
    this.init();
    const c = this.cur, ease = (k, v, r) => (c[k] += (v - c[k]) * Math.min(1, dt * r));
    ease('rain', w.rain, 0.6); ease('storm', w.storm, 0.5); ease('wind', w.wind, 0.4); ease('cover', w.cover, 3); ease('cave', w.cave, 2);
    const t = this.a.ctx.currentTime, set = (g, v) => g && g.gain.setTargetAtTime(v, t, 0.25);
    // wandering gusts
    this.gustT -= dt;
    if (this.gustT <= 0) { this.gustT = 1.5 + rnd() * 4; this.gustTarget = rnd(); }
    this.gust += ((this.gustTarget || 0) - this.gust) * Math.min(1, dt * 0.6);
    const open = (1 - c.cover * 0.75) * (1 - c.cave), r = c.rain;
    set(this.wash, r * 0.36 * open);
    set(this.body, r * r * 0.32 * open);
    set(this.dense, Math.pow(r, 0.8) * 0.33 * open);
    set(this.light, (r > 0.02 ? 0.25 + (1 - r) * 0.3 : 0) * Math.min(1, r * 6) * open);
    set(this.roof, r * c.cover * (1 - c.cave) * 0.5);
    set(this.wind, (0.03 + c.wind * c.wind * 0.35) * (0.5 + this.gust * 0.8) * (1 - c.cave * 0.9) * (1 - c.cover * 0.5));
    if (this.windF) this.windF.frequency.setTargetAtTime(220 + this.gust * 520 + c.storm * 160, t, 0.6);
    this.muffle.frequency.setTargetAtTime(c.cave > 0.5 ? 260 : 18000 - c.cover * 15500, t, 0.3);
  }
  // play thunder `dist` metres away (already delayed by the caller), pan -1..1
  thunder(dist, energy = 1, pan = 0, cave = false) {
    const a = this.a;
    if (!a.ctx || a.ctx.state !== 'running') return;
    this.init();
    const ctx = a.ctx;
    const src = ctx.createBufferSource(); src.buffer = thunderBuffer(ctx, dist, energy);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cave ? 140 : Math.max(160, 5200 / (1 + dist / 180)); lp.Q.value = 0.4;
    const sub = ctx.createBiquadFilter(); sub.type = 'lowshelf'; sub.frequency.value = 90; sub.gain.value = 6;
    const g = ctx.createGain(); g.gain.value = energy * Math.min(1.25, 2.2 / (1 + dist / 380)) * (cave ? 0.35 : 1);
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-0.85, Math.min(0.85, pan));
    src.connect(lp); lp.connect(sub); sub.connect(g); g.connect(p); p.connect(this.thunderBus);
    src.start();
  }
}
