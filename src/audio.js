// ============================================================
// audio.js — 100% procedural sound via the Web Audio API.
// No asset files: every gunshot, bell, whisper-hiss and the
// droning autumn wind is synthesised at runtime. Keeps the game
// a self-contained, asset-free single project.
// ============================================================

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.windGain = null;
    this.droneGain = null;
    this.enabled = false;
  }

  // Must be resumed from a user gesture (the DESCEND button).
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);

    this._startWind();
    this._startDrone();
    this.enabled = true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  _noiseBuffer(seconds = 2) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Looping filtered noise -> wind through corn / over graves.
  _startWind() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(4);
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.7;
    const g = this.ctx.createGain(); g.gain.value = 0.12;
    src.connect(lp).connect(g).connect(this.master);
    src.start();
    this.windGain = g; this.windLP = lp;

    // slow LFO so the wind breathes
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 0.06;
    lfo.connect(lfoGain).connect(g.gain); lfo.start();
  }

  // Low sine drone — the unease bed. Volume scales with Dread.
  _startDrone() {
    const o1 = this.ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 48;
    const o2 = this.ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 55.5;
    const g = this.ctx.createGain(); g.gain.value = 0.0;
    o1.connect(g); o2.connect(g); g.connect(this.master);
    o1.start(); o2.start();
    this.droneGain = g;
  }

  setDread(d01) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    this.droneGain.gain.setTargetAtTime(0.015 + d01 * 0.11, t, 1.5);
    this.windLP.frequency.setTargetAtTime(420 + d01 * 380, t, 1.5);
  }
  setRegionWind(v) {
    if (!this.enabled) return;
    this.windGain.gain.setTargetAtTime(v, this.ctx.currentTime, 2);
  }

  _env(node, peak, attack, decay, t0) {
    const t = t0 ?? this.ctx.currentTime;
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  // ---- one-shots ----
  gunshot() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuffer(0.4);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'lowpass';
    bp.frequency.setValueAtTime(2400, t); bp.frequency.exponentialRampToValueAtTime(180, t + 0.18);
    const g = this.ctx.createGain(); this._env(g, 0.9, 0.002, 0.22, t);
    src.connect(bp).connect(g).connect(this.master); src.start(t); src.stop(t + 0.4);
    // body thump
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const og = this.ctx.createGain(); this._env(og, 0.5, 0.002, 0.13, t);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + 0.16);
  }

  reloadClick() { this._click(0.05, 1400); }
  _click(dur = 0.04, freq = 1200) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
    const g = this.ctx.createGain(); this._env(g, 0.18, 0.001, dur, t);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  // Witchfire bolt — descending zap.
  spell() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.3);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 6;
    const g = this.ctx.createGain(); this._env(g, 0.4, 0.004, 0.32, t);
    o.connect(bp).connect(g).connect(this.master); o.start(t); o.stop(t + 0.36);
  }

  // Lantern Flare — bright airy whoosh.
  flare() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuffer(0.7);
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass';
    hp.frequency.setValueAtTime(300, t); hp.frequency.exponentialRampToValueAtTime(3000, t + 0.5);
    const g = this.ctx.createGain(); this._env(g, 0.5, 0.01, 0.6, t);
    src.connect(hp).connect(g).connect(this.master); src.start(t); src.stop(t + 0.7);
  }

  hurt() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.25);
    const g = this.ctx.createGain(); this._env(g, 0.4, 0.003, 0.28, t);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.3);
  }

  // Wet impact for hitting straw / pumpkin / flesh.
  thud(freq = 90) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const g = this.ctx.createGain(); this._env(g, 0.3, 0.002, 0.12, t);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.15);
  }

  pickup() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    [660, 880, 1320].forEach((f, i) => {
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = this.ctx.createGain(); this._env(g, 0.12, 0.005, 0.18, t + i * 0.06);
      o.connect(g).connect(this.master); o.start(t + i * 0.06); o.stop(t + i * 0.06 + 0.2);
    });
  }

  // Church bell — the thirteen tolls of Hallow's Eve.
  bell(freq = 220) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    [1, 2.0, 2.76, 5.4].forEach((mult, i) => {
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * mult;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3 / (i + 1), t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + 2.5);
    });
  }

  // Ghostly breath / dread sting.
  ghostHiss() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuffer(1.4); src.loop = false;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 3;
    const g = this.ctx.createGain(); this._env(g, 0.18, 0.4, 1.0, t);
    src.connect(bp).connect(g).connect(this.master); src.start(t); src.stop(t + 1.4);
  }

  bossRoar() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(38, t + 1.2);
    const dist = this.ctx.createWaveShaper(); dist.curve = this._distCurve(40);
    const g = this.ctx.createGain(); this._env(g, 0.7, 0.05, 1.4, t);
    o.connect(dist).connect(g).connect(this.master); o.start(t); o.stop(t + 1.5);
  }
  _distCurve(amount) {
    const n = 256, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; c[i] = (1 + amount) * x / (1 + amount * Math.abs(x)); }
    return c;
  }
}
