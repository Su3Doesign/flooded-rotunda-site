// The room's sound, synthesized on the spot (nothing is downloaded): stone-room reverb, room tone,
// drips echoing under the dome, bells for the Night of Bells, and the low swell of the water rising a finger.
// Silent until the visitor turns it on (browsers only allow audio after a click anyway).
export class Sound {
  constructor() {
    this.on = false;
    this.ctx = null;
  }

  async toggle() {
    if (this.on) { this.disable(); return false; }
    await this.enable();
    return true;
  }

  async enable() {
    if (!this.ctx) this._build();
    await this.ctx.resume();
    this.on = true;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.9);
    this._scheduleDrip();
  }

  disable() {
    if (!this.ctx) return;
    this.on = false;
    clearTimeout(this._dt);
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
  }

  _build() {
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    // a dark stone room: ~4 s of decaying, low-passed noise as the impulse response
    const len = Math.floor(ctx.sampleRate * 4.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        lp += ((Math.random() * 2 - 1) - lp) * (0.35 - 0.25 * t);
        d[i] = lp * Math.pow(1 - t, 2.6) * (i < 900 ? i / 900 : 1);
      }
    }
    this.verb = ctx.createConvolver();
    this.verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.85;
    this.verb.connect(wet).connect(this.master);
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.45;
    this.dry.connect(this.master);
    this.send = ctx.createGain();
    this.send.connect(this.verb);
    // room tone: brown noise, low-passed, breathing very slowly
    const nb = ctx.createBuffer(1, ctx.sampleRate * 6, ctx.sampleRate), nd = nb.getChannelData(0);
    let last = 0;
    for (let i = 0; i < nd.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; nd[i] = last * 3.2; }
    const src = ctx.createBufferSource();
    src.buffer = nb; src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 320;
    const tone = ctx.createGain();
    tone.gain.value = 0.2;
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    lfo.frequency.value = 0.06; lfoG.gain.value = 0.07;
    lfo.connect(lfoG).connect(tone.gain);
    src.connect(lp).connect(tone);
    tone.connect(this.dry); tone.connect(this.send);
    src.start(); lfo.start();
  }

  drip(pan = Math.random() * 1.6 - 0.8, level = 1) {
    if (!this.on) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner();
    const f0 = 900 + Math.random() * 1500;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.42, t + 0.08);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16 * level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 0.17);
    p.pan.value = pan;
    o.connect(g).connect(p);
    p.connect(this.dry); p.connect(this.send);
    o.start(t); o.stop(t + 0.2);
  }

  _scheduleDrip() {
    if (!this.on) return;
    this.drip();
    clearTimeout(this._dt);
    this._dt = setTimeout(() => this._scheduleDrip(), 1100 + Math.random() * 4200);
  }

  // a cast bronze bell: inharmonic partials (hum, prime, tierce, quint, nominal...) each with its own decay
  bell(base = 98, level = 1, pan = 0) {
    if (!this.on) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.02;
    const out = ctx.createGain(), p = ctx.createStereoPanner();
    out.gain.value = 0.09 * level;
    p.pan.value = pan;
    out.connect(p); p.connect(this.dry); p.connect(this.send);
    const partials = [[0.5, 1.0, 11], [1, 0.75, 8], [1.183, 0.5, 6], [1.506, 0.42, 5], [2, 0.32, 3.6], [2.514, 0.2, 2.6], [3.011, 0.14, 2], [4.166, 0.07, 1.3]];
    for (const [r, a, d] of partials) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = base * r * (1 + (Math.random() - 0.5) * 0.003);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + d + 0.1);
    }
  }

  bells() {
    [[98, 1, -0.3, 0], [73.4, 0.8, 0.4, 2600], [110, 0.55, -0.6, 4900], [82.4, 0.7, 0.2, 7600]]
      .forEach(([f, l, p, ms]) => setTimeout(() => this.bell(f, l, p), ms));
  }

  // the water rising a finger: a low, slow gulp and a few drips
  swell() {
    if (!this.on) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.02;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(64, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 1.8);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.45);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
    o.connect(g); g.connect(this.dry); g.connect(this.send);
    o.start(t); o.stop(t + 2.5);
    for (let i = 0; i < 4; i++) setTimeout(() => this.drip(Math.random() * 0.6 - 0.3, 0.55), 250 + i * 170 + Math.random() * 120);
  }
}
