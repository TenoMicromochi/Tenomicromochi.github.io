/* ============================================================
   FLAKALT — audio.js
   効果音は全部その場で合成する。音声ファイルは持たない。

   発砲音 = 帯域を絞ったノイズの短い減衰 + 低い正弦の打撃音。
   帯域と減衰時間を口径ごとに変えるだけで、7.7mm の乾いた連射と
   20mm の腹に来る発砲がちゃんと別物に聞こえる。

   メニュー音だけは矩形波にしてある（PC スピーカーの音）。
   ============================================================ */

import { lerpByCaliber } from './camera.js';

const SHOT_PRESETS = {
  small: { band: 1900, q: 0.9, decay: 0.055, thump: 150, tgain: 0.22, gain: 0.30 },
  medium: { band: 950, q: 0.8, decay: 0.105, thump: 95, tgain: 0.34, gain: 0.42 },
  large: { band: 430, q: 0.7, decay: 0.230, thump: 58, tgain: 0.50, gain: 0.55 },
  // 40mm ボフォースは 2発/秒で連射するので、大口径にしては減衰を短くしてある。
  // 長い残響を乗せると 0.5 秒間隔の次弾と重なって音が濁る。
  bofors: { band: 320, q: 0.65, decay: 0.34, thump: 50, tgain: 0.62, gain: 0.70 },
  // 高射砲。4 秒に 1 発しか撃たないので残響を長く取れる
  heavy: { band: 180, q: 0.60, decay: 0.90, thump: 32, tgain: 0.75, gain: 0.85 },
};

/* 上の 5 つを口径軸のアンカーとして、その間を対数補間する。

   7.7 / 12.7 / 20 / 40mm の砲はアンカーそのものなので、以前と同じ音が
   1 サンプルも変わらずに出る。13.2mm は medium のほぼ真上、15mm は
   medium と large の間、25mm は large と bofors の間、というふうに
   間の口径だけが自動で埋まる。 */
const ANCHOR_CAL = [7.7, 12.7, 20, 40, 88];
const ANCHOR_KEY = ['small', 'medium', 'large', 'bofors', 'heavy'];

/* 減衰は口径だけでは決まらない。同じ 40mm でもボフォース単装（0.5秒間隔）と
   ポンポン砲 4 連装（0.13秒間隔）では、後者に長い尾を付けると次弾に食い込んで
   濁る。そこで「何発ぶんまで重なってよいか」も口径のアンカーにして、
   decay <= 許容重なり数 x 発射間隔 で頭打ちにする。
   この数値は現行 4 門の実際の重なり具合（decay / 発射間隔）から取ってある
   ので、現行 4 門ではこの頭打ちが働かない。 */
const ANCHOR_OVERLAP = [1.85, 3.9, 3.5, 0.68, 0.5];

function anchorTable(field) {
  return ANCHOR_CAL.map((c, i) => [c, SHOT_PRESETS[ANCHOR_KEY[i]][field]]);
}
const TABLES = {
  band: anchorTable('band'), q: anchorTable('q'), decay: anchorTable('decay'),
  thump: anchorTable('thump'), tgain: anchorTable('tgain'), gain: anchorTable('gain'),
  overlap: ANCHOR_CAL.map((c, i) => [c, ANCHOR_OVERLAP[i]]),
};

/* 砲 1 門ぶんの合成パラメータ。Gun に焼き付けて使い回す。 */
export function shotParams(gun) {
  if (gun.sound && SHOT_PRESETS[gun.sound]) return SHOT_PRESETS[gun.sound];
  const cal = gun.caliber;
  const p = {
    band: lerpByCaliber(TABLES.band, cal, true),
    q: lerpByCaliber(TABLES.q, cal),
    decay: lerpByCaliber(TABLES.decay, cal),
    thump: lerpByCaliber(TABLES.thump, cal, true),
    tgain: lerpByCaliber(TABLES.tgain, cal),
    gain: lerpByCaliber(TABLES.gain, cal),
    // 10mm 未満は乾いた音にしたいので正弦、それ以上は鋸歯
    wave: cal < 10 ? 'sine' : 'sawtooth',
  };
  const interval = gun.shotInterval || 0;
  if (interval > 0) {
    p.decay = Math.min(p.decay, lerpByCaliber(TABLES.overlap, cal) * interval);
  }
  return p;
}

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

  /* 引数は砲そのもの。合成パラメータは口径から作って Gun に焼き付ける。 */
  shot(gun) {
    if (!this.ready || this.muted) return;
    if (this.voices > 16) return; // 連射で詰まらせない
    const p = gun ? (gun.shotSfx || (gun.shotSfx = shotParams(gun))) : SHOT_PRESETS.small;
    this.noiseBurst(p.band * (0.9 + Math.random() * 0.2), p.q, p.decay, p.gain);
    this.tone(p.thump, p.decay * 1.6, p.tgain, p.wave || 'sawtooth');
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
