/* ============================================================
   SONIC_ASCII — 8トーン音響モデム（SANDBOX 標準UI 版）
   ロジック（FREQS / PHASES / buildFrame / synth / Decoder / FrameReader /
   decodeOffline / channelModel / loopbackTest）は Sandbox/Sonic_ASCII/original.html のまま。
   変えたのは DOM の参照先（バーは canvas、速度は セグメントボタン）と画面の文言（英語化）だけ。
   ============================================================ */
// ===== 仕様 =====
const FREQS = [1884, 2034, 2286, 2465, 2777, 2985, 3327, 3445]; // bit0..bit7（bit7=パイロット）
const PILOT = 7;
const FADE_MS = 5;
const DEL = 0x7F, STX = 0x02, ETX = 0x03;
const PHASES = [0, 1.9, 4.1, 0.7, 2.8, 5.3, 3.6, 1.2]; // ピークを抑える固定位相

let speedVal = '80,20'; // SPEED のセグメントボタンの値（既定 NORMAL）。original の select#speed の value 相当
function getTiming(){
  const [t, g] = speedVal.split(',').map(Number);
  return { toneMs: t, gapMs: g };
}

// テキスト → フレームのバイト列（7ビット値）
function buildFrame(text){
  text = text.replace(/\r\n?/g, '\n');
  const body = [];
  let replaced = 0;
  for (const ch of text){
    const c = ch.codePointAt(0);
    if (c === 0x0A || c === 0x09 || (c >= 0x20 && c < 0x7F)) body.push(c);
    else { body.push(0x3F); replaced++; }
  }
  const sum = body.reduce((a, b) => a + b, 0) & 0x7F;
  return { bytes: [DEL, DEL, STX, ...body, ETX, sum], replaced, bodyLen: body.length };
}

// バイト列 → 音声サンプル
function synth(bytes, sr, toneMs, gapMs, vol){
  const toneN = Math.round(sr * toneMs / 1000), gapN = Math.round(sr * gapMs / 1000);
  const fadeN = Math.round(sr * FADE_MS / 1000);
  const lead = Math.round(sr * 0.25), tail = Math.round(sr * 0.3);
  const out = new Float32Array(lead + bytes.length * (toneN + gapN) + tail);
  const amp = vol * 0.95 / 8;
  let pos = lead;
  for (const b7 of bytes){
    const b = b7 | 0x80;
    for (let k = 0; k < 8; k++){
      if (!((b >> k) & 1)) continue;
      const w = 2 * Math.PI * FREQS[k] / sr, ph = PHASES[k];
      for (let n = 0; n < toneN; n++){
        let e = 1;
        if (n < fadeN) e = 0.5 - 0.5 * Math.cos(Math.PI * n / fadeN);
        else if (n >= toneN - fadeN) e = 0.5 - 0.5 * Math.cos(Math.PI * (toneN - 1 - n) / fadeN);
        out[pos + n] += amp * e * Math.sin(w * n + ph);
      }
    }
    pos += toneN + gapN;
  }
  return out;
}

// ===== 受信器 =====
class Decoder {
  // 探索モード：パイロットの立ち上がりを探す → 見つけたら「ロック」して、
  // 以後は1周期ごとの予測位置でシンボルを読み、立ち上がり位置で少しずつ補正するのです。
  constructor(sr, toneMs, gapMs, onSymbol){
    this.sr = sr; this.toneMs = toneMs; this.gapMs = gapMs; this.onSymbol = onSymbol;
    this.N = 1 << 18; this.mask = this.N - 1; this.buf = new Float32Array(this.N);
    this.total = 0; this.cursor = 0;
    this.hop = Math.max(64, Math.round(sr * 0.0025));
    this.detN = Math.round(sr * 0.010);
    this.detWin = hann(this.detN);
    this.period = sr * (toneMs + gapMs) / 1000;
    this.toneN = sr * toneMs / 1000;
    this.noise = null; this.peak = 0; this.lastActive = 0;
    this.hist = []; // [サンプル位置, パイロット電力]（直近のみ）
    this.locked = false; this.nextOnset = 0; this.misses = 0; this.pilotLevel = 0;
    this.ref = null;
    this.levels = new Array(8).fill(0);
    this.winCache = {};
  }
  feed(x){
    for (let i = 0; i < x.length; i++) this.buf[(this.total + i) & this.mask] = x[i];
    this.total += x.length;
    while (this.cursor + this.hop <= this.total){
      this.cursor += this.hop;
      if (this.cursor >= this.detN) this.step(this.cursor);
    }
  }
  power(start, len, f, win){
    const c = Math.cos(2 * Math.PI * f / this.sr), w = 2 * c;
    let s1 = 0, s2 = 0, ws = 0;
    for (let n = 0; n < len; n++){
      const s0 = this.buf[(start + n) & this.mask] * win[n] + w * s1 - s2;
      s2 = s1; s1 = s0; ws += win[n];
    }
    const re = s1 - s2 * c, im = s2 * Math.sin(2 * Math.PI * f / this.sr);
    const a = 2 * Math.sqrt(re * re + im * im) / ws;
    return a * a;
  }
  thr(){ return Math.max(this.noise * 15, 2e-7); }
  step(end){
    const start = end - this.detN;
    const p = this.power(start, this.detN, FREQS[PILOT], this.detWin);
    for (let k = 0; k < 8; k++){
      const pk = k === PILOT ? p : this.power(start, this.detN, FREQS[k], this.detWin);
      this.levels[k] = this.levels[k] * 0.6 + pk * 0.4;
    }
    this.peak = Math.max(this.peak * 0.9995, p);
    // 雑音の平均：信号っぽい値（平均の3倍超）は使わない。長く静かなら少しずつ上げて追従
    this.count = (this.count || 0) + 1;
    if (this.noise === null) this.noise = p;
    const a = Math.max(0.01, 1 / this.count);
    if (this.count < 20 || p < this.noise * 3) this.noise = this.noise * (1 - a) + p * a;
    else if (!this.locked && end - this.lastActive > this.sr) this.noise *= 1.002;
    this.hist.push([end, p]); if (this.hist.length > 64) this.hist.shift();

    if (!this.locked){
      // 雑音の平均がわかるまで（約0.1秒）は待つ。2回続けてしきい値を越えたらロックするのです
      if (this.count > 40 && p > this.thr()){
        if (!this.cand) { this.cand = end; return; }
        this.locked = true; this.misses = 0; this.symbols = 0;
        this.nextOnset = this.cand - this.detN / 2;
        this.cand = 0; this.pilotLevel = 0;
      } else { this.cand = 0; return; }
    }
    // 予測した立ち上がり位置＋トーン長を過ぎたら、そのシンボルを読むのです
    if (end >= this.nextOnset + this.toneN) this.readSymbol();
  }
  refineOnset(pred){
    // 予測位置の前後8 msで、パイロットが「前のシンボルの半分」を越えた最初の点を探すのです
    if (!this.pilotLevel) return pred;
    const lim = this.sr * 0.008, half = this.pilotLevel * 0.5;
    for (let i = 1; i < this.hist.length; i++){
      const [e, p] = this.hist[i], pp = this.hist[i - 1][1];
      const on = e - this.detN / 2;
      if (on < pred - lim) continue;
      if (on > pred + lim) break;
      if (p >= half && pp < half) return on;
    }
    return pred;
  }
  readSymbol(){
    const onset = this.refineOnset(this.nextOnset);
    // 補正は半分だけかけて、ゆっくり追従させるのです
    const corr = Math.max(-this.sr * 0.004, Math.min(this.sr * 0.004, onset - this.nextOnset)) * 0.5;
    const t0 = this.nextOnset + corr;
    this.nextOnset = t0 + this.period;
    const s = Math.round(t0 + Math.max(this.sr * 0.008, this.toneN * 0.2)), e = Math.round(t0 + this.toneN - this.sr * 0.006);
    const len = e - s;
    const win = this.winCache[len] || (this.winCache[len] = hann(len));
    const P = FREQS.map(f => this.power(s, len, f, win));
    const noiseHere = this.noise * this.detN / len;
    if (P[PILOT] < noiseHere * 20 || (this.pilotLevel && P[PILOT] < this.pilotLevel * 0.1)){
      // パイロットがない＝送信が終わった（か途切れた）のです
      if (++this.misses >= 2 || !this.symbols){ this.locked = false; this.misses = 0; }
      return;
    }
    this.misses = 0; this.lastActive = e; this.symbols++;
    this.pilotLevel = this.pilotLevel ? this.pilotLevel * 0.7 + P[PILOT] * 0.3 : P[PILOT];
    const raw = P.map(v => v / P[PILOT]);
    const ref = this.ref || new Array(8).fill(1);
    const lv = raw.map((r, k) => r / ref[k]);
    let b = 0;
    for (let k = 0; k < 7; k++) if (lv[k] > 0.45) b |= 1 << k;
    if (raw.slice(0, 7).every(r => r > 0.04) && (b === DEL || !this.ref)){
      // 較正：DELは全トーンが同じ振幅で鳴っているはずなのです
      this.ref = this.ref ? this.ref.map((v, k) => (v + raw[k]) / 2) : raw.slice();
      b = DEL;
    }
    this.onSymbol(b, lv, s / this.sr);
  }
}
function hann(n){ const w = new Float32Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / n); return w; }

// フレームの状態機械
class FrameReader {
  constructor(ui){ this.ui = ui; this.state = 'IDLE'; this.text = ''; this.sum = 0; this.last = 0; }
  symbol(b, t){
    this.last = performance.now();
    this.ui.hex(b);
    if (b === DEL){ if (this.state !== 'TEXT' && this.state !== 'CHK'){ this.state = 'SYNC'; this.ui.status('Sync (DEL) received. Calibrated', 'meta'); } return; }
    if (this.state === 'IDLE' || this.state === 'SYNC'){
      if (b === STX){ this.state = 'TEXT'; this.text = ''; this.sum = 0; this.ui.setText(''); this.ui.status('Receiving...', 'warn'); }
      return;
    }
    if (this.state === 'TEXT'){
      if (b === ETX){ this.state = 'CHK'; return; }
      this.text += (b === 0x0A || b === 0x09 || (b >= 0x20 && b < 0x7F)) ? String.fromCharCode(b) : '·';
      this.sum = (this.sum + b) & 0x7F;
      this.ui.setText(this.text);
      return;
    }
    if (this.state === 'CHK'){
      const ok = b === this.sum;
      this.ui.status(ok ? `Received ${this.text.length} chars, checksum OK` : `Checksum mismatch`, ok ? 'ok' : 'ng');
      this.ui.done && this.ui.done(ok, this.text);
      this.state = 'IDLE';
    }
  }
  tick(periodMs){
    if (this.state === 'TEXT' || this.state === 'CHK'){
      if (performance.now() - this.last > periodMs * 4 + 400){
        this.ui.status('Signal lost (no ETX)', 'ng');
        this.state = 'IDLE';
      }
    }
  }
}

// ===== UI =====
const $ = id => document.getElementById(id);

// バー（canvas、論理 224x40。1本 28px 幅）とラベル。original は DOM の <i> の高さだったのを canvas に置き換えた
const BAR_W = 224, BAR_H = 40, BAR_PITCH = 28, BAR_BODY = 20;
const barsCv = $('bars'), barsCtx = barsCv.getContext('2d');
const cssVar = name => getComputedStyle(document.body).getPropertyValue(name).trim();
const barVals = new Array(8).fill(0);   // 0..1
function drawBars(){
  barsCtx.fillStyle = cssVar('--sb-screen-bg');
  barsCtx.fillRect(0, 0, BAR_W, BAR_H);
  for (let k = 0; k < 8; k++){
    barsCtx.fillStyle = cssVar(k === PILOT ? '--sb-yellow' : '--accent');
    const h = Math.round(barVals[k] * BAR_H);
    barsCtx.fillRect(k * BAR_PITCH + (BAR_PITCH - BAR_BODY) / 2, BAR_H - h, BAR_BODY, h);
  }
}
FREQS.forEach((f, k) => {
  const d = document.createElement('div'); d.className = k === PILOT ? 'pilot' : '';
  d.textContent = `${k === PILOT ? 'P ' : 'b' + k + ' '}${f}`;
  $('barLabels').appendChild(d);
  const s = document.createElement('span'); s.className = 'tone' + (k === PILOT ? ' pilot' : '');
  s.textContent = `${k === PILOT ? 'bit7 pilot' : 'bit' + k} ${f}Hz`;
  $('specTable').appendChild(s);
});
drawBars();

// 整数倍フィット：stage の幅・高さに収まる最大の整数（最低 1、最大 3）。ラベル列も同じ幅に揃える
function fitBars(){
  const stage = document.querySelector('.sb-stage');
  const cs = getComputedStyle(stage);
  const aw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const ah = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const s = Math.max(1, Math.min(3, Math.floor(aw / BAR_W), Math.floor((ah * 0.4 - 38) / BAR_H)));
  barsCv.style.width = BAR_W * s + 'px';
  barsCv.style.height = BAR_H * s + 'px';
  $('barLabels').style.width = BAR_W * s + 'px';
}
new ResizeObserver(fitBars).observe(document.querySelector('.sb-stage'));
fitBars();

let hexBuf = [];
const ui = {
  status(msg, cls){ $('rxStatus').innerHTML = `<span class="${cls}">${msg}</span>`; },
  setText(t){ $('rxText').textContent = t; },
  hex(b){ hexBuf.push(b.toString(16).padStart(2, '0')); if (hexBuf.length > 400) hexBuf.shift(); $('rxHex').textContent = hexBuf.join(' '); $('rxHex').scrollTop = $('rxHex').scrollHeight; },
};

// SPEED：SEND と RECEIVE の両方のセグメントボタンを同じ値に連動させる
document.querySelectorAll('.sx-speed button').forEach(b => b.addEventListener('click', () => {
  speedVal = b.dataset.speed;
  document.querySelectorAll('.sx-speed button').forEach(x => x.classList.toggle('is-active', x.dataset.speed === speedVal));
}));

let ctx = null;
function getCtx(){ if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); return ctx; }

// 送信
let srcNode = null;
$('send').onclick = () => {
  const c = getCtx();
  const { toneMs, gapMs } = getTiming();
  const fr = buildFrame($('txt').value);
  const data = synth(fr.bytes, c.sampleRate, toneMs, gapMs, +$('vol').value);
  const ab = c.createBuffer(1, data.length, c.sampleRate);
  ab.copyToChannel(data, 0);
  srcNode = c.createBufferSource(); srcNode.buffer = ab; srcNode.connect(c.destination);
  srcNode.onended = () => { $('send').disabled = false; $('stop').disabled = true; $('sendStatus').textContent = 'Sent'; srcNode = null; };
  srcNode.start();
  $('send').disabled = true; $('stop').disabled = false;
  const sec = (data.length / c.sampleRate).toFixed(1);
  $('sendStatus').innerHTML = `Sending... (${fr.bodyLen} chars, ~${sec} s)` + (fr.replaced ? ` <span class="warn">Non-ASCII chars replaced with ?: ${fr.replaced}</span>` : '');
};
$('stop').onclick = () => { if (srcNode) srcNode.stop(); };

// 受信（マイク）
let micStream = null, proc = null, micDec = null, reader = null, tickTimer = null, rafId = null;
function startBars(dec){
  cancelAnimationFrame(rafId);
  const loop = () => {
    const p = dec.levels[PILOT];
    const ref = Math.max(dec.peak, 1e-9);
    barVals.forEach((_, k) => { barVals[k] = Math.max(0, Math.min(1, (10 * Math.log10(dec.levels[k] / ref + 1e-9) + 40) / 40)); });
    drawBars();
    rafId = requestAnimationFrame(loop);
  };
  loop();
}
$('mic').onclick = async () => {
  if (micStream){ stopMic(); return; }
  try {
    const c = getCtx();
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
    const src = c.createMediaStreamSource(micStream);
    proc = c.createScriptProcessor(2048, 1, 1);
    const { toneMs, gapMs } = getTiming();
    reader = new FrameReader(ui);
    micDec = new Decoder(c.sampleRate, toneMs, gapMs, (b, lv, t) => reader.symbol(b, t));
    proc.onaudioprocess = e => micDec.feed(new Float32Array(e.inputBuffer.getChannelData(0)));
    const mute = c.createGain(); mute.gain.value = 0;
    src.connect(proc); proc.connect(mute); mute.connect(c.destination);
    tickTimer = setInterval(() => reader.tick(toneMs + gapMs), 200);
    startBars(micDec);
    $('mic').textContent = 'MIC STOP';
    ui.status(`Listening (${c.sampleRate} Hz). Waiting for signal`, 'meta');
  } catch (err){
    micStream = null;
    ui.status('Mic unavailable: ' + err.message, 'ng');
  }
};
function stopMic(){
  micStream.getTracks().forEach(t => t.stop()); micStream = null;
  if (proc) proc.disconnect(); proc = null;
  clearInterval(tickTimer); cancelAnimationFrame(rafId);
  $('mic').textContent = 'MIC START';
  ui.status('Stopped', 'meta');
}

// オフラインでデコード（ループバック／ファイル）
function decodeOffline(x, sr, toneMs, gapMs){
  const r = new FrameReader(ui);
  let result = null; ui.done = (ok, text) => { result = { ok, text }; };
  const d = new Decoder(sr, toneMs, gapMs, (b) => r.symbol(b));
  for (let i = 0; i < x.length; i += 2048) d.feed(x.subarray(i, Math.min(i + 2048, x.length)));
  const pad = new Float32Array(Math.round(sr * 0.3)); d.feed(pad);
  ui.done = null;
  if (!result && r.state !== 'IDLE') ui.status('Incomplete (no ETX or checksum)', 'ng');
  if (!result && r.state === 'IDLE' && !hexBuf.length) ui.status('No signal found', 'ng');
  return result;
}
function channelModel(x, sr, snrDb, drive){
  // 残響（いくつかの反射）→ スピーカーの歪み（tanh）→ 白色雑音
  const y = new Float32Array(x.length);
  const taps = [[0, 1], [0.0073, 0.45], [0.019, 0.3], [0.031, 0.2], [0.047, 0.12], [0.068, 0.07]];
  for (const [dt, g] of taps){ const o = Math.round(dt * sr); for (let i = o; i < x.length; i++) y[i] += g * x[i - o]; }
  let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v));
  let ps = 0;
  for (let i = 0; i < y.length; i++){ y[i] = Math.tanh(drive * y[i] / pk) / Math.tanh(drive) * 0.5; ps += y[i] * y[i]; }
  ps /= y.length;
  const sigma = Math.sqrt(ps / Math.pow(10, snrDb / 10));
  for (let i = 0; i < y.length; i++){ const u = Math.random() || 1e-9, v = Math.random(); y[i] += sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  return y;
}
function loopbackTest(text, snrDb = 10, drive = 1.5, sr = 48000){
  const { toneMs, gapMs } = getTiming();
  const fr = buildFrame(text);
  const x = synth(fr.bytes, sr, toneMs, gapMs, 0.5);
  const y = channelModel(x, sr, snrDb, drive);
  hexBuf = []; ui.setText('');
  return decodeOffline(y, sr, toneMs, gapMs);
}
window.__loopbackTest = loopbackTest;
$('loop').onclick = () => {
  const r = loopbackTest($('txt').value);
  if (r) ui.status((r.ok ? 'Test OK' : 'Test: checksum mismatch') + ' (SNR 10 dB, reverb, distortion)', r.ok ? 'ok' : 'ng');
};
$('file').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const c = getCtx();
    const ab = await c.decodeAudioData(await f.arrayBuffer());
    const { toneMs, gapMs } = getTiming();
    hexBuf = []; ui.setText('');
    const r = decodeOffline(ab.getChannelData(0), ab.sampleRate, toneMs, gapMs);
  } catch (err){ ui.status('Could not read file: ' + err.message, 'ng'); }
  e.target.value = '';
};
