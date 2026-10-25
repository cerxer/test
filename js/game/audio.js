// Procedural sound effects synthesised with the Web Audio API (no audio files needed).

const MATERIAL = {
  stone: { freq: 2300, q: 1.2, type: 'bandpass', dur: 0.09, vol: 0.5 },
  grass: { freq: 900, q: 0.6, type: 'lowpass', dur: 0.11, vol: 0.55 },
  gravel: { freq: 1400, q: 0.8, type: 'bandpass', dur: 0.12, vol: 0.55 },
  sand: { freq: 1800, q: 0.5, type: 'highpass', dur: 0.1, vol: 0.35 },
  wood: { freq: 650, q: 2.5, type: 'bandpass', dur: 0.09, vol: 0.7, knock: 180 },
  glass: { freq: 4200, q: 3, type: 'bandpass', dur: 0.08, vol: 0.4 },
  wool: { freq: 500, q: 0.5, type: 'lowpass', dur: 0.1, vol: 0.45 },
  snow: { freq: 1100, q: 0.4, type: 'lowpass', dur: 0.09, vol: 0.4 },
};

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.volume = 0.6;
  }

  ensure() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    } catch (e) {
      return false;
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  ready() {
    return this.ctx && this.ctx.state === 'running' && this.volume > 0;
  }

  noise({ freq = 1000, q = 1, type = 'bandpass', dur = 0.1, vol = 0.5, attack = 0.005, freqEnd, delay = 0 }) {
    if (!this.ready()) return;
    const c = this.ctx, t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  tone({ freq = 440, freqEnd, dur = 0.1, type = 'square', vol = 0.2, attack = 0.005, delay = 0, vibrato = 0 }) {
    if (!this.ready()) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (vibrato) {
      const lfo = c.createOscillator();
      const lg = c.createGain();
      lfo.frequency.value = vibrato;
      lg.gain.value = freq * 0.04;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = Math.max(800, freq * 4);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  dig(material, broken) {
    const m = MATERIAL[material] || MATERIAL.stone;
    const k = broken ? 1.6 : 1;
    this.noise({ freq: m.freq * (0.85 + Math.random() * 0.3), q: m.q, type: m.type, dur: m.dur * k, vol: m.vol * (broken ? 0.9 : 0.5) });
    if (m.knock) this.tone({ freq: m.knock * (0.9 + Math.random() * 0.2), freqEnd: m.knock * 0.7, dur: 0.07, type: 'triangle', vol: broken ? 0.3 : 0.15 });
    if (broken && material === 'glass') {
      for (let i = 0; i < 4; i++) this.tone({ freq: 2500 + Math.random() * 2500, dur: 0.06, type: 'sine', vol: 0.08, delay: i * 0.03 });
    }
  }

  place(material) {
    const m = MATERIAL[material] || MATERIAL.stone;
    this.noise({ freq: m.freq * 0.7, q: m.q, type: m.type, dur: m.dur * 1.2, vol: m.vol * 0.8 });
    this.tone({ freq: 140, freqEnd: 90, dur: 0.06, type: 'triangle', vol: 0.12 });
  }

  step(material, vol = 0.6) {
    const m = MATERIAL[material] || MATERIAL.stone;
    this.noise({ freq: m.freq * 0.8, q: m.q, type: m.type, dur: m.dur * 0.8, vol: m.vol * 0.35 * vol });
  }

  hurt() {
    this.tone({ freq: 260, freqEnd: 150, dur: 0.18, type: 'square', vol: 0.18 });
    this.noise({ freq: 700, dur: 0.12, vol: 0.25, type: 'lowpass' });
  }

  pickup() {
    this.tone({ freq: 700 + Math.random() * 300, freqEnd: 1400, dur: 0.07, type: 'sine', vol: 0.18 });
  }

  eat() {
    this.noise({ freq: 1300 + Math.random() * 600, q: 1.5, dur: 0.07, vol: 0.4 });
  }

  burp() {
    this.tone({ freq: 170, freqEnd: 80, dur: 0.3, type: 'sawtooth', vol: 0.18, vibrato: 30 });
  }

  click() {
    this.tone({ freq: 900, freqEnd: 600, dur: 0.04, type: 'square', vol: 0.08 });
  }

  toolBreak() {
    this.tone({ freq: 1800, freqEnd: 400, dur: 0.2, type: 'square', vol: 0.15 });
    this.noise({ freq: 3000, dur: 0.15, vol: 0.3 });
  }

  explosion(dist = 0) {
    const v = Math.max(0.15, 1 - dist / 40);
    this.noise({ freq: 600, freqEnd: 60, type: 'lowpass', dur: 1.4, vol: 1.0 * v, attack: 0.01 });
    this.tone({ freq: 70, freqEnd: 30, dur: 0.8, type: 'sine', vol: 0.6 * v });
  }

  fuse(dist) {
    const v = Math.max(0, 1 - dist / 16);
    if (v > 0) this.noise({ freq: 5000, type: 'highpass', dur: 1.4, vol: 0.25 * v, attack: 0.05 });
  }

  bow(dist) {
    const v = Math.max(0, 1 - dist / 24);
    if (v > 0) this.noise({ freq: 1500, freqEnd: 400, type: 'bandpass', dur: 0.15, vol: 0.3 * v });
  }

  mob(kind, event, dist = 0) {
    const v = Math.max(0, 1 - dist / 24);
    if (v <= 0) return;
    const hurt = event === 'hurt';
    const p = hurt ? 1.25 : 1;
    switch (kind) {
      case 'cow':
        this.tone({ freq: 120 * p, freqEnd: 95 * p, dur: hurt ? 0.3 : 0.8, type: 'sawtooth', vol: 0.2 * v, attack: 0.08, vibrato: 6 });
        break;
      case 'pig':
        this.tone({ freq: 320 * p, freqEnd: 210, dur: 0.12, type: 'square', vol: 0.12 * v });
        this.tone({ freq: 300 * p, freqEnd: 190, dur: 0.12, type: 'square', vol: 0.12 * v, delay: 0.16 });
        break;
      case 'sheep':
        this.tone({ freq: 430 * p, freqEnd: 380, dur: 0.5, type: 'sawtooth', vol: 0.12 * v, attack: 0.04, vibrato: 18 });
        break;
      case 'chicken':
        this.tone({ freq: 1300 * p, freqEnd: 900, dur: 0.06, type: 'square', vol: 0.08 * v });
        this.tone({ freq: 1200 * p, freqEnd: 850, dur: 0.06, type: 'square', vol: 0.08 * v, delay: 0.09 });
        break;
      case 'zombie':
        this.tone({ freq: 95 * p, freqEnd: 70, dur: hurt ? 0.3 : 0.9, type: 'sawtooth', vol: 0.22 * v, attack: 0.1, vibrato: 4 });
        this.noise({ freq: 400, type: 'lowpass', dur: 0.6, vol: 0.15 * v });
        break;
      case 'skeleton':
        for (let i = 0; i < 4; i++) this.noise({ freq: 3000, q: 4, dur: 0.03, vol: 0.25 * v, delay: i * 0.07 });
        break;
      case 'spider':
        this.noise({ freq: 2600, q: 2, dur: hurt ? 0.2 : 0.4, vol: 0.2 * v, attack: 0.05 });
        break;
      case 'creeper':
        if (hurt) this.noise({ freq: 900, dur: 0.15, vol: 0.2 * v });
        break;
      default:
        break;
    }
  }
}
