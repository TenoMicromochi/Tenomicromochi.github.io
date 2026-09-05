// ============================================================ 帯エディタ（UI）
// 発光帯・吸収帯を可視光の帯の上でマウス編集するキャンバス部品。
// **転換前の js/band-editor.js からの純粋コピー（ロジック無変更）。**
// sample では LIGHT / GLASS A / GLASS B の3つを main.js が生成して使う
// （転換前は LIGHT / MATERIAL の2つだった）。
//
// アプリの再描画（sync）と警告表示（flash）は呼び出し側の責務なので、
// ここでは持たずコンストラクタで受け取ったフックを呼ぶだけにしてある。

import { waveColor, gauss } from './spectrum.js';

export const MAXP = 8;
const DRAG = { none:0, move:1, q:2 };

export class BandEditor {
  constructor(canvasId, maxY, stroke, hooks = {}){
    this.cv = document.getElementById(canvasId);
    this.ctx = this.cv.getContext('2d');
    this.maxY = maxY;
    this.stroke = stroke;
    this.peaks = [];
    this.sel = -1;
    this.mode = DRAG.none;
    this.q0 = 1; this.x0 = 0;
    this.onChange = hooks.onChange || (() => {});
    this.onFlash  = hooks.onFlash  || (() => {});
    this.cv.addEventListener('contextmenu', e => e.preventDefault());
    this.cv.addEventListener('mousedown', e => this.onDown(e));
    window.addEventListener('mousemove', e => this.onMove(e));
    window.addEventListener('mouseup', () => { this.mode = DRAG.none; });
    this.cv.addEventListener('dblclick', e => this.onDbl(e));
    this.cv.addEventListener('wheel', e => this.onWheel(e), { passive:false });
  }
  // --- 座標
  get W(){ return this.cv.clientWidth; }
  get H(){ return this.cv.clientHeight; }
  get padT(){ return 10; }
  get strip(){ return 18; }
  get plotH(){ return this.H - this.padT - this.strip; }
  X(l){ return (l - 380) / 400 * this.W; }
  Lm(x){ return Math.max(380, Math.min(780, 380 + x / this.W * 400)); }
  Y(v){ return this.padT + this.plotH * (1 - v / this.maxY); }
  Vl(y){ return Math.max(0, Math.min(this.maxY, this.maxY * (1 - (y - this.padT) / this.plotH))); }
  pos(e){ const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  hit(x, y){
    for (let i = this.peaks.length - 1; i >= 0; i--){
      const p = this.peaks[i];
      if (Math.abs(this.X(p.l) - x) < 9 && Math.abs(this.Y(p.a) - y) < 9) return i;
    }
    return -1;
  }
  // --- 入力
  onDown(e){
    const [x, y] = this.pos(e);
    let i = this.hit(x, y);
    if (e.button === 2){                                   // 右ドラッグ = Q
      if (i < 0) return;
      this.sel = i; this.mode = DRAG.q;
      this.q0 = this.peaks[i].q; this.x0 = x;
      e.preventDefault(); this.onChange(); return;
    }
    if (e.button !== 0) return;
    if (i < 0){                                            // 空きをクリック = 追加
      if (this.peaks.length >= MAXP){ this.onFlash('peaks are capped at ' + MAXP); return; }
      // 振幅0で置くと見えないピンになるので、下端で掴んでも最低限の高さは与える
      this.peaks.push({ l: Math.round(this.Lm(x)), a: Math.max(this.maxY * 0.06, this.Vl(y)), q: 6 });
      i = this.peaks.length - 1;
    }
    this.sel = i; this.mode = DRAG.move; this.onChange();
  }
  onMove(e){
    if (this.mode === DRAG.none || this.sel < 0) return;
    const [x, y] = this.pos(e), p = this.peaks[this.sel];
    if (this.mode === DRAG.move){ p.l = Math.round(this.Lm(x)); p.a = this.Vl(y); }
    else { p.q = Math.max(0.4, Math.min(600, this.q0 * Math.exp((x - this.x0) / 55))); }
    this.onChange();
  }
  onDbl(e){
    const i = this.hit(...this.pos(e));
    if (i >= 0){ this.peaks.splice(i, 1); this.sel = -1; this.onChange(); }
  }
  // ホイールは「ピンの上にいるときだけ」Q を動かす。
  // 選択中のピンにフォールバックすると、キャンバス上でページをスクロールした
  // だけで Q が変わってしまう（実際に踏んだ）。外しているときは素通しさせる。
  onWheel(e){
    const i = this.hit(...this.pos(e));
    if (i < 0) return;
    e.preventDefault();
    const p = this.peaks[i];
    p.q = Math.max(0.4, Math.min(600, p.q * Math.exp(-e.deltaY / 400)));
    this.sel = i; this.onChange();
  }
  baseAt(){ return 0; }        // 連続光／ベースライン。main.js 側で差し替える
  // --- 描画
  draw(){
    const c = this.ctx, W = this.W, H = this.H;
    if (W <= 0 || H <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (this.cv.width !== Math.round(W*dpr) || this.cv.height !== Math.round(H*dpr)){
      this.cv.width = Math.round(W*dpr); this.cv.height = Math.round(H*dpr);
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);

    // 可視光の帯
    for (let x = 0; x < W; x++){
      c.fillStyle = waveColor(this.Lm(x + 0.5));
      c.fillRect(x, H - this.strip, 1, this.strip);
    }
    // グリッド（50nm）
    c.strokeStyle = '#2a2a2e'; c.lineWidth = 1;
    c.fillStyle = '#666'; c.font = '9px monospace';
    for (let l = 400; l <= 750; l += 50){
      const x = this.X(l);
      c.beginPath(); c.moveTo(x, this.padT); c.lineTo(x, H - this.strip); c.stroke();
      if (l % 100 === 0) c.fillText(l, x + 2, this.padT + 9);
    }
    // 各帯（薄く）
    for (const p of this.peaks){
      c.strokeStyle = 'rgba(150,150,160,.35)'; c.lineWidth = 1;
      c.beginPath();
      for (let x = 0; x <= W; x += 2){
        const v = p.a * gauss(this.Lm(x), p);
        if (x === 0) c.moveTo(x, this.Y(v)); else c.lineTo(x, this.Y(v));
      }
      c.stroke();
    }
    // 合計
    c.strokeStyle = this.stroke; c.lineWidth = 1.6;
    c.beginPath();
    for (let x = 0; x <= W; x++){
      const l = this.Lm(x);
      let v = this.baseAt(l);
      for (const p of this.peaks) v += p.a * gauss(l, p);
      if (x === 0) c.moveTo(x, this.Y(v)); else c.lineTo(x, this.Y(v));
    }
    c.stroke();
    // ピン + FWHM のひげ（Q が見た目で分かるように）
    this.peaks.forEach((p, i) => {
      const x = this.X(p.l), y = this.Y(p.a), fw = p.l / Math.max(0.2, p.q);
      const on = i === this.sel;
      c.strokeStyle = on ? '#fff' : 'rgba(200,200,210,.5)';
      c.lineWidth = on ? 1.5 : 1;
      c.beginPath();
      c.moveTo(this.X(p.l - fw/2), y); c.lineTo(this.X(p.l + fw/2), y);
      c.moveTo(x, y); c.lineTo(x, this.Y(0));
      c.stroke();
      c.fillStyle = on ? '#fff' : '#999';
      c.fillRect(x - 3.5, y - 3.5, 7, 7);
      if (on){
        c.fillStyle = '#fff'; c.font = '10px monospace';
        const t = Math.round(p.l) + 'nm  Q=' + p.q.toFixed(1) + '  fwhm=' + fw.toFixed(1) + 'nm';
        c.fillText(t, Math.min(x + 8, W - 150), Math.max(y - 7, this.padT + 9));
      }
    });
    c.fillStyle = '#555'; c.font = '9px monospace';
    c.fillText(this.maxY.toFixed(1), 2, this.padT + 9);
  }
}
