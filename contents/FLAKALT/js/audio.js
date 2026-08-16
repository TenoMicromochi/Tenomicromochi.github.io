/* ============================================================
   FLAKALT — audio.js
   効果音は全部その場で合成する。音声ファイルは持たない。

   発砲音 = 帯域を絞ったノイズの短い減衰 + 低い正弦の打撃音。
   帯域と減衰時間を口径ごとに変えるだけで、7.7mm の乾いた連射と
   20mm の腹に来る発砲がちゃんと別物に聞こえる。

   メニュー音だけは矩形波にしてある（PC スピーカーの音）。
   ============================================================ */

const SHOT_PRESETS = {
  small: { band: 1900, q: 0.9, decay: 0.055, thump: 150, tgain: 0.22, gain: 0.30 },
  medium: { band: 950, q: 0.8, decay: 0.105, thump: 95, tgain: 0.34, gain: 0.42 },
  large: { band: 430, q: 0.7, decay: 0.230, thump: 58, tgain: 0.50, gain: 0.55 },
  flak: { band: 240, q: 0.6, decay: 0.62, thump: 38, tgain: 0.70, gain: 0.80 },
};

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.voices = 0;
    this.ready = false;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // ノイズ源は 1 秒ぶん作って使い回す
    const n = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, n, n);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;

    this.startWind();
    this.ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  get t() { return this.ctx.currentTime; }

  /* 常時鳴っている風。無音だと画面が死んで見える */
  startWind() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const g = this.ctx.createGain();
    g.gain.value = 0.035;
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start();

    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = this.ctx.createGain();
    lg.gain.value = 0.02;
    lfo.connect(lg); lg.connect(g.gain);
    lfo.start();
  }

  noiseBurst(band, q, decay, gain, type = 'bandpass') {
    const t = this.t;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = band;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.8);
    src.stop(t + decay + 0.02);
    this.voices++;
    src.onended = () => { this.voices--; };
    return { src, f, g, t };
  }

  tone(freq, decay, gain, type = 'sine') {
    const t = this.t;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.45), t + decay);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    o.connect(g); g.connect(this.master);
    o.start(t);
    o.stop(t + decay + 0.02);
  }

  shot(kind) {
    if (!this.ready || this.muted) return;
    if (this.voices > 16) return; // 連射で詰まらせない
    const p = SHOT_PRESETS[kind] || SHOT_PRESETS.small;
    this.noiseBurst(p.band * (0.9 + Math.random() * 0.2), p.q, p.decay, p.gain);
    this.tone(p.thump, p.decay * 1.6, p.tgain, kind === 'small' ? 'sine' : 'sawtooth');
    // 大砲は谷に反響が返ってくる
    if (kind === 'flak') {
      setTimeout(() => {
        if (this.ready && !this.muted) this.noiseBurst(180, 0.5, 1.1, 0.20, 'lowpass');
      }, 230);
    }
    // 薬莢の跳ねる音をたまに混ぜる
    if (Math.random() < 0.22) {
      setTimeout(() => {
        if (this.ready && !this.muted) this.noiseBurst(3400, 6, 0.05, 0.05);
      }, 120 + Math.random() * 180);
    }
  }

  hit() {
    if (!this.ready || this.muted) return;
    this.noiseBurst(3000, 4, 0.05, 0.16);
  }

  explode(size = 1) {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.6;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1500 * size, t);
    f.frequency.exponentialRampToValueAtTime(90, t + 0.7 * size);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.55 * size, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.9 * size);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + size + 0.05);
    this.tone(52, 0.5 * size, 0.4 * size, 'sine');
  }

  reload() { this.beep(320, 0.05, 'square', 0.10); setTimeout(() => this.beep(220, 0.09, 'square', 0.10), 90); }
  overheat() { this.beep(180, 0.28, 'sawtooth', 0.14); }
  empty() { this.beep(120, 0.06, 'square', 0.08); }

  beep(freq, dur, type = 'square', gain = 0.07) {
    if (!this.ready || this.muted) return;
    const t = this.t;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.setValueAtTime(gain, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.01);
  }
}
