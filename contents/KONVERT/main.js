/* ============================================================
   KONVERT — main.js（第6段：ENCODE と DECODE を 1 画面に）

   画面の処理。重い処理（デコード・プレビュー・エンコード・復号）は js/worker.js、
   画像の実体（RGBA とファイルのバイト列）も Worker が持つ（slot: 'encode' | 'decode'）。
   ここは表示・マスク・操作だけ。画素は canvas から読み戻さない（putImageData で書くだけ）。
   ============================================================ */
import { addRect, countMask } from './js/core/mask.js';
import { HINT_MAX } from './js/core/payload.js';
import { WEAK } from './js/core/render.js';
import { brushShape } from './js/brush.js';

const $ = (id) => document.getElementById(id);

/* ---------- 部品：スライダー + 数値入力 / セグメントボタン / トースト ---------- */
function paintSlider(range) {
  const pct = ((range.value - range.min) / (range.max - range.min)) * 100;
  range.style.setProperty('--pct', pct + '%');
}

function linkSlider(rangeId, numberId, onChange) {
  const range = $(rangeId), num = $(numberId);
  paintSlider(range);
  range.addEventListener('input', () => { num.value = range.value; paintSlider(range); onChange(); });
  num.addEventListener('input', () => {
    if (num.value === '' || num.value === '-') return;
    const v = Math.min(+range.max, Math.max(+range.min, Math.round(+num.value)));
    range.value = v; paintSlider(range);
    if (+num.value !== v) num.value = v; // 範囲外は丸める
    onChange();
  });
  num.addEventListener('blur', () => { num.value = range.value; });
}

function linkSegment(groupId, onChange) {
  const group = $(groupId);
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('.view-btn');
    if (!btn || btn.disabled) return;
    group.querySelectorAll('.view-btn').forEach((b) => b.classList.toggle('active', b === btn));
    onChange(btn.dataset);
  });
}

function setSegment(groupId, key, value) {
  $(groupId).querySelectorAll('.view-btn').forEach((b) => b.classList.toggle('active', b.dataset[key] === value));
}

function toast(msg, kind = 'ok', ms = 2400) {
  const t = $('okToast');
  t.textContent = msg;
  t.className = 'alt-toast ' + kind;
  t.style.display = 'block';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.style.display = 'none'; }, ms);
}

/* ---------- 状態 ---------- */
const UNDO_BYTES = 256 * 2 ** 20; // EXE（spoiler-png の renderer/app.js）と同じ
const S = {
  busy: 0,
  tool: 'rect',   // rect | square | round | erase
  brush: 8,
  format: 'png',      // ENCODE の書き出し形式
  decFormat: 'png',   // DECODE の保存形式
  space: false,
  lastTouched: 'encode', // 最後に触った列（Ctrl+S）
  hoverCol: 'encode',    // ポインタが最後にあった列（+ - 0）
};
const E = { image: null, mask: null, maskCount: 0, maskVersion: 0, view: 'mask', preview: null, undo: [], redo: [], maskImage: null };
const D = { image: null, revealed: null, view: 'spoiler', locked: false };

/* ---------- Worker ----------
   Worker が落ちたとき（読み込み失敗・例外・terminate）は、待っている呼び出しを全部失敗にして
   busy を 0 に戻す。応答が来ないまま busy が残ることはない。 */
const worker = new Worker('js/worker.js', { type: 'module' });
const pending = new Map();
let nextId = 1;
let workerDead = false;

worker.onmessage = (e) => {
  const m = e.data;
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  setBusy(-1);
  if (m.type === 'error') {
    const err = new Error(m.message);
    err.reason = m.reason;
    p.reject(err);
  } else {
    p.resolve(m);
  }
};

function workerFailed(message) {
  workerDead = true;
  const err = new Error(message);
  err.reason = 'worker';
  const all = [...pending.values()];
  pending.clear();
  S.busy = 0;
  updateBusyChips();
  for (const p of all) p.reject(err);
  updateButtons();
  toast(message, 'error', 6000);
}

worker.onerror = (e) => { e.preventDefault?.(); workerFailed('The worker stopped: ' + (e.message || 'unknown error') + '. Reload the page.'); };
worker.onmessageerror = () => workerFailed('The worker sent data that could not be read. Reload the page.');
// terminate() は黙って止まるだけなので、呼ばれたら失敗として扱う（テストでもこれで確かめる）
const terminateWorker = worker.terminate.bind(worker);
worker.terminate = () => { terminateWorker(); workerFailed('The worker was stopped. Reload the page.'); };

function call(type, body = {}, transfer = []) {
  if (workerDead) return Promise.reject(Object.assign(new Error('The worker is not running. Reload the page.'), { reason: 'worker' }));
  const id = nextId++;
  setBusy(1);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      worker.postMessage({ id, type, ...body }, transfer);
    } catch (e) {
      pending.delete(id);
      setBusy(-1);
      reject(e);
    }
  });
}

function setBusy(d) {
  S.busy += d;
  updateBusyChips();
  updateButtons();
}

function updateBusyChips() {
  $('encWorking').hidden = $('decWorking').hidden = S.busy === 0;
}

/* ============================================================
   Stage：画像の枠（表示位置・倍率・パン・拡大縮小）
   倍率 z は「x1 を 1 とした比」。x1 = 画像 1 画素 = 画面の実ピクセル（dpr の整数部）1 個ぶん。
   z >= 1 は整数（1 2 3 4 6 8 12 16、または FIT の整数倍）で補間なし。
   z < 1 は連続値の縮小で、そこだけ補間あり（Kaname の判断）。FIT より小さくはしない。
   ============================================================ */
const dpr = () => window.devicePixelRatio || 1;
const unit = () => Math.max(1, Math.floor(dpr())) / dpr(); // x1 の CSS px
const LEVELS = [1, 2, 3, 4, 6, 8, 12, 16];
const STEP_BELOW = 1.25;

class Stage {
  constructor(slot, el, layers, emptyEl) {
    this.slot = slot; this.el = el; this.layers = layers; this.emptyEl = emptyEl;
    this.w = 0; this.h = 0;
    this.z = 1; this.ox = 0; this.oy = 0;
    this.fit = true;
    this.ctx = layers[0].getContext('2d');
    new ResizeObserver(() => this.onResize()).observe(el);
  }

  get has() { return this.w > 0; }
  get sw() { return this.el.clientWidth; }
  get sh() { return this.el.clientHeight; }
  get scale() { return this.z * unit(); } // CSS px / 画像の画素

  setImage(w, h) {
    this.w = w; this.h = h;
    for (const c of this.layers) { c.width = w; c.height = h; c.hidden = false; }
    this.el.classList.add('has-image');
    this.refit();
  }

  clear() {
    this.w = this.h = 0;
    for (const c of this.layers) c.hidden = true;
    this.el.classList.remove('has-image');
    this.onChange?.();
  }

  paint(rgba) {
    this.ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), this.w, this.h), 0, 0);
  }

  // 全体が枠に収まる倍率。大きい画像は自由な値（滑らか）、小さい画像は収まる最大の整数倍
  fitZ() {
    const W = this.sw, H = this.sh, u = unit();
    if (!W || !H || !this.has) return this.z;
    if (this.w * u <= W && this.h * u <= H) return Math.max(1, Math.floor(Math.min(W / (this.w * u), H / (this.h * u))));
    return Math.min(W / (this.w * u), H / (this.h * u));
  }

  refit() {
    if (!this.has) return;
    this.z = this.fitZ();
    this.fit = true;
    this.apply();
  }

  onResize() {
    if (!this.has || !this.sw) return;
    if (this.fit) { this.refit(); return; }
    this.z = Math.min(Math.max(this.z, this.fitZ()), Math.max(16, this.fitZ()));
    this.apply();
  }

  // 位置を収め（小さければ中央、大きければ枠から画像がはみ出さない範囲）、実ピクセルに丸めて当てる
  apply() {
    if (!this.has) return;
    const s = this.scale, cw = this.w * s, ch = this.h * s, W = this.sw, H = this.sh;
    this.ox = cw <= W ? (W - cw) / 2 : Math.min(0, Math.max(W - cw, this.ox));
    this.oy = ch <= H ? (H - ch) / 2 : Math.min(0, Math.max(H - ch, this.oy));
    const d = dpr();
    this.ox = Math.round(this.ox * d) / d;
    this.oy = Math.round(this.oy * d) / d;
    for (const c of this.layers) {
      c.style.width = cw + 'px';
      c.style.height = ch + 'px';
      c.style.transform = `translate(${this.ox}px, ${this.oy}px)`;
      c.classList.toggle('smooth', this.z < 1);
    }
    this.onChange?.();
  }

  // (cx, cy) = 枠の中の位置。そこが動かないように倍率を変える
  zoomAt(nz, cx, cy) {
    const s0 = this.scale;
    this.z = nz;
    const s1 = this.scale;
    this.ox = cx - ((cx - this.ox) * s1) / s0;
    this.oy = cy - ((cy - this.oy) * s1) / s0;
    this.fit = Math.abs(nz - this.fitZ()) < 1e-9;
    this.apply();
  }

  // dir > 0 で 1 段拡大、< 0 で 1 段縮小
  step(dir, cx = this.sw / 2, cy = this.sh / 2) {
    if (!this.has) return;
    const min = this.fitZ(), max = Math.max(16, min);
    let nz = this.z;
    if (dir > 0) {
      if (nz < 1) { nz *= STEP_BELOW; if (nz > 1 - 1e-6) nz = 1; }
      else nz = LEVELS.find((l) => l > nz + 1e-9) ?? nz;
    } else if (nz > 1) {
      nz = [...LEVELS].reverse().find((l) => l < nz - 1e-9) ?? 1;
    } else {
      nz = nz / STEP_BELOW;
    }
    nz = Math.min(max, Math.max(min, nz));
    if (Math.abs(nz - this.z) > 1e-9) this.zoomAt(nz, cx, cy);
  }

  panBy(dx, dy) { this.ox += dx; this.oy += dy; this.apply(); }

  // 画面の位置 → 枠の中の位置
  local(e) {
    const r = this.el.getBoundingClientRect();
    return [e.clientX - r.left - this.el.clientLeft, e.clientY - r.top - this.el.clientTop];
  }

  // 画面の位置 → 画像の画素
  pixelAt(e, clamp) {
    const [lx, ly] = this.local(e), s = this.scale;
    let x = Math.floor((lx - this.ox) / s), y = Math.floor((ly - this.oy) / s);
    if (clamp) { x = Math.min(this.w - 1, Math.max(0, x)); y = Math.min(this.h - 1, Math.max(0, y)); }
    return [x, y];
  }

  zoomLabel() {
    if (!this.has) return '-';
    return this.z >= 1 ? 'x' + (Number.isInteger(this.z) ? this.z : this.z.toFixed(1)) : Math.round(this.z * 100) + '%';
  }
}

const stages = {
  encode: new Stage('encode', $('encStage'), [$('encDisp'), $('encMask')], $('encEmpty')),
  decode: new Stage('decode', $('decStage'), [$('decDisp')], $('decEmpty')),
};
const ST = stages.encode;
const SD = stages.decode;
ST.onChange = () => { updateStatus('encode'); hideCursors(); };
SD.onChange = () => updateStatus('decode');
$('encZoom').addEventListener('click', () => ST.refit());
$('decZoom').addEventListener('click', () => SD.refit());

function updateStatus(slot) {
  const st = stages[slot], img = slot === 'encode' ? E.image : D.image;
  const p = slot === 'encode' ? 'enc' : 'dec';
  $(p + 'Name').textContent = img ? img.name : '-';
  $(p + 'Name').title = img ? img.name : '';
  $(p + 'Size').textContent = img ? `${img.width}x${img.height}` : '-';
  $(p + 'Zoom').querySelector('strong').textContent = st.zoomLabel();
  if (slot === 'encode') {
    $('encMaskN').textContent = E.image ? E.maskCount.toLocaleString('en-US') : '-';
  }
}

/* ---------- ENCODE：マスクの表示 ---------- */
const mctx = $('encMask').getContext('2d');

function accentRgb() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const n = parseInt(v.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function ensureMaskImage() {
  if (E.maskImage) return;
  const { width, height } = E.image;
  const [r, g, b] = accentRgb();
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < E.mask.length; i++) {
    if (!E.mask[i]) continue;
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 150;
  }
  E.maskImage = new ImageData(data, width, height);
}

function paintMask() {
  ensureMaskImage();
  mctx.putImageData(E.maskImage, 0, 0);
}

// 変えた範囲 [x0, y0, x1, y1)（画素）だけ描き直す。画像全体は塗り直さない
function paintMaskRegion(x0, y0, x1, y1) {
  ensureMaskImage();
  const { width } = E.image;
  const [r, g, b] = accentRgb();
  const d = E.maskImage.data;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * width + x, o = i * 4;
      if (E.mask[i]) { d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 150; }
      else { d[o] = d[o + 1] = d[o + 2] = d[o + 3] = 0; }
    }
  }
  mctx.putImageData(E.maskImage, 0, 0, x0, y0, x1 - x0, y1 - y0);
}

function renderEncode() {
  if (!E.image) return;
  let rgba = E.image.rgba;
  const overlay = E.view === 'mask';
  if (E.view === 'preview' && E.maskCount > 0 && E.preview) rgba = E.preview.rgba;
  ST.paint(rgba);
  $('encMask').hidden = !overlay;
  if (overlay) paintMask();
  ST.el.classList.add('pen');
}

function renderDecode() {
  if (!D.image) return;
  SD.paint(D.view === 'original' && D.revealed ? D.revealed : D.image.rgba);
}

/* ---------- HIDE（STYLE） ---------- */
function currentRender() {
  const style = document.querySelector('#styleGroup .active').dataset.style;
  if (style === 'fill') return { mode: 'fill', color: $('fillColor').value };
  if (style === 'mosaic') return { mode: 'mosaic', block: +$('blockR').value };
  return { mode: 'blur', radius: +$('radiusR').value };
}

function onStyleChange() {
  const r = currentRender();
  $('rowFill').hidden = r.mode !== 'fill';
  $('rowMosaic').hidden = r.mode !== 'mosaic';
  $('rowBlur').hidden = r.mode !== 'blur';
  $('weakHint').hidden = !((r.mode === 'mosaic' && r.block < WEAK.mosaic) || (r.mode === 'blur' && r.radius < WEAK.blur));
  schedulePreview();
}

linkSegment('styleGroup', onStyleChange);
linkSlider('blockR', 'blockN', onStyleChange);
linkSlider('radiusR', 'radiusN', onStyleChange);
$('fillColor').addEventListener('input', onStyleChange);

/* ---------- LOCK / HINT / MORE ---------- */
const passMatch = () => $('pass1').value === $('pass2').value;
$('pass1').addEventListener('input', onPassInput);
$('pass2').addEventListener('input', onPassInput);
function onPassInput() {
  $('pass2').classList.toggle('bad', !passMatch() && $('pass2').value.length > 0);
  updateButtons();
}
// SHOW PASSWORD（状態は保存しない。読み直すと OFF）
$('showPass').addEventListener('change', () => {
  for (const id of ['pass1', 'pass2']) $(id).type = $('showPass').checked ? 'text' : 'password';
});
$('decShow').addEventListener('change', () => { $('decPass').type = $('decShow').checked ? 'text' : 'password'; });
// FORMAT（PNG / WEBP LOSSLESS / WEBP LOSSY）と QUALITY
linkSegment('fmtGroup', (d) => {
  S.format = d.fmt;
  $('rowQuality').hidden = $('lossyHint').hidden = d.fmt !== 'webp-lossy';
});
linkSlider('qualR', 'qualN', () => {});
linkSegment('decFmtGroup', (d) => {
  S.decFormat = d.fmt;
  $('decRowQuality').hidden = d.fmt !== 'webp-lossy';
});
linkSlider('decQualR', 'decQualN', () => {});
const FORMAT_LABEL = { png: 'PNG', 'webp-lossless': 'WEBP LOSSLESS', 'webp-lossy': 'WEBP LOSSY' };

const hintTooLong = () => new TextEncoder().encode($('hintInput').value).length > HINT_MAX;
$('hintInput').addEventListener('input', () => {
  $('hintInput').classList.toggle('bad', hintTooLong());
  updateButtons();
});

/* ---------- PREVIEW（連続で変えたら最後の 1 回だけ） ---------- */
let previewTimer = 0;
let previewSeq = 0;

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = 0;
  if (!E.image || E.view !== 'preview' || E.maskCount === 0) { renderEncode(); return; }
  previewTimer = setTimeout(() => { previewTimer = 0; runPreview(); }, 60);
}

async function runPreview() {
  const seq = ++previewSeq;
  const render = currentRender();
  const mask = E.mask.slice();
  try {
    const r = await call('preview', { mask, render }, [mask.buffer]);
    if (r.skipped || seq !== previewSeq) return;
    E.preview = { rgba: r.rgba };
    renderEncode();
  } catch (e) {
    if (seq === previewSeq) toast(e.message, 'error', 5000);
  }
}

// ブラシのドラッグ中：PREVIEW なら一定の間隔でプレビューを作り直す（間引き）
function previewTick() {
  if (E.view !== 'preview' || previewTimer) return;
  previewTimer = setTimeout(() => {
    previewTimer = 0;
    E.maskCount = countMask(E.mask);
    updateStatus('encode');
    if (E.maskCount > 0) runPreview(); else renderEncode();
  }, 120);
}

function setView(v) {
  E.view = v;
  setSegment('viewGroup', 'view', v);
  hideCursors();
  renderEncode();
  if (v === 'preview') schedulePreview();
}
linkSegment('viewGroup', (d) => setView(d.view));

/* ---------- PEN（RECT / SQUARE / ROUND / ERASE）、UNDO / REDO ----------
   ブラシの補間（Bresenham）・UNDO の上限は EXE（spoiler-png/src/renderer/app.js）の line / pushUndo と同じ。
   丸ブラシの形は js/brush.js（SPEC 28.1）。 */
const ghost = $('ghost'), brushCursor = $('brushCursor');

function setTool(tool) {
  S.tool = tool;
  setSegment('penGroup', 'tool', tool);
  $('rowSize').hidden = tool === 'rect';
  hideCursors();
}
linkSegment('penGroup', (d) => setTool(d.tool));

function setBrush(v) {
  S.brush = Math.max(1, Math.min(128, Math.round(v) || 1));
  $('sizeR').value = S.brush;
  $('sizeN').value = S.brush;
  paintSlider($('sizeR'));
}
linkSlider('sizeR', 'sizeN', () => { S.brush = +$('sizeR').value; });
setBrush(8);
setTool('rect');

const undoLimit = () => Math.max(5, Math.min(50, Math.floor(UNDO_BYTES / E.mask.length)));

function pushUndo(snapshot) {
  E.undo.push(snapshot);
  if (E.undo.length > undoLimit()) E.undo.shift();
  E.redo = [];
}

function undoRedo(from, to) {
  if (!E.image || !from.length) return;
  to.push(E.mask);
  E.mask = from.pop();
  maskChanged();
}
$('undoBtn').addEventListener('click', () => undoRedo(E.undo, E.redo));
$('redoBtn').addEventListener('click', () => undoRedo(E.redo, E.undo));

function maskChanged(keepImage = false) {
  E.maskCount = countMask(E.mask);
  E.maskVersion++;
  if (!keepImage) { E.maskImage = null; if (E.view === 'mask') paintMask(); }
  updateStatus('encode');
  updateButtons();
  schedulePreview();
}

$('clearBtn').addEventListener('click', () => {
  if (!E.image || E.maskCount === 0) return;
  pushUndo(E.mask.slice());
  E.mask.fill(0);
  maskChanged();
});

const rectOf = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]) + 1, Math.abs(a[1] - b[1]) + 1];

// 枠（ghost / ブラシカーソル）を、画像の画素 [x0,y0,x1,y1) の位置に置く。画像の外は切る
function placeBox(el, x0, y0, x1, y1, opts = {}) {
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(ST.w, x1); y1 = Math.min(ST.h, y1);
  if (x0 >= x1 || y0 >= y1) { el.hidden = true; return; }
  const s = ST.scale;
  Object.assign(el.style, {
    left: ST.ox + x0 * s + 'px', top: ST.oy + y0 * s + 'px',
    width: (x1 - x0) * s + 'px', height: (y1 - y0) * s + 'px',
  });
  el.classList.toggle('erase', !!opts.erase);
  el.classList.toggle('round', !!opts.round);
  el.hidden = false;
}

function hideCursors() { ghost.hidden = true; brushCursor.hidden = true; }

function showBrushCursor(p) {
  const s = S.brush, x0 = p[0] - ((s - 1) >> 1), y0 = p[1] - ((s - 1) >> 1);
  placeBox(brushCursor, x0, y0, x0 + s, y0 + s, { erase: S.tool === 'erase', round: S.tool === 'round' });
}

const canDraw = () => !!E.image; // MASK でも PREVIEW でも描ける

// ブラシ（EXE の stamp / line）。塗った範囲を dirty に足す
function stamp(x, y, value, round, dirty) {
  const { width, height } = E.image;
  const s = S.brush, sx = x - ((s - 1) >> 1), sy = y - ((s - 1) >> 1);
  const x0 = Math.max(0, sx), y0 = Math.max(0, sy), x1 = Math.min(width, sx + s), y1 = Math.min(height, sy + s);
  if (x0 >= x1 || y0 >= y1) return;
  const shape = brushShape(s, round);
  for (let yy = y0; yy < y1; yy++) {
    const row = (yy - sy) * s - sx, base = yy * width;
    for (let xx = x0; xx < x1; xx++) if (shape[row + xx]) E.mask[base + xx] = value;
  }
  dirty[0] = Math.min(dirty[0], x0); dirty[1] = Math.min(dirty[1], y0);
  dirty[2] = Math.max(dirty[2], x1); dirty[3] = Math.max(dirty[3], y1);
}

function line(ax, ay, bx, by, value, round) {
  const dirty = [Infinity, Infinity, -Infinity, -Infinity];
  const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay), sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    stamp(ax, ay, value, round, dirty);
    if (ax === bx && ay === by) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; ax += sx; }
    if (e2 <= dx) { err += dx; ay += sy; }
  }
  if (dirty[2] > dirty[0]) paintMaskRegion(...dirty);
}

/* ---------- 枠の操作：描く・パン・ピンチ・ホイール ----------
   左ドラッグ / 1 本指 … ENCODE の MASK 表示では PEN で描く。それ以外（PREVIEW・DECODE）はパン。
   右ドラッグ・中ボタン・Space＋左ドラッグ … パン。2 本指 … ピンチとパン（描きかけの筆は取り消す）。 */
function bindStage(slot) {
  const st = stages[slot], el = st.el;
  const ptrs = new Map();
  let mode = null;   // 'draw' | 'pan' | 'pinch' | 'ignore'
  let drag = null;   // 描いている最中
  let pan = null;
  let g = null;      // ピンチ
  let wheelAcc = 0;

  const grab = (e) => { try { el.setPointerCapture(e.pointerId); } catch { /* 合成イベントなど */ } };
  const isEnc = slot === 'encode';

  function cancelDraw() {
    if (!drag) return;
    E.mask = drag.snap; // その手を取り消してドラッグ前に戻す
    drag = null;
    ghost.hidden = true;
    maskChanged();
  }

  function pinchState() {
    const [a, b] = [...ptrs.values()];
    const r = el.getBoundingClientRect();
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2 - r.left - el.clientLeft, my: (a.y + b.y) / 2 - r.top - el.clientTop };
  }

  el.addEventListener('pointerdown', (e) => {
    S.lastTouched = slot;
    if (!st.has || e.target === st.emptyEl) return;
    if (ptrs.size >= 2) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    grab(e);
    e.preventDefault();
    if (ptrs.size === 2) {
      if (mode === 'draw') cancelDraw();
      mode = 'pinch';
      el.classList.remove('panning');
      g = pinchState();
      return;
    }
    if (mode === 'ignore') return;
    const mouse = e.pointerType === 'mouse';
    if (mouse && (e.button === 1 || e.button === 2 || (e.button === 0 && S.space))) { startPan(e); return; }
    if (mouse && e.button !== 0) { ptrs.delete(e.pointerId); return; }
    if (isEnc && canDraw()) startDraw(e); else startPan(e);
  });

  function startPan(e) {
    mode = 'pan';
    pan = { x: e.clientX, y: e.clientY };
    el.classList.add('panning');
  }

  function startDraw(e) {
    mode = 'draw';
    const erase = S.tool === 'erase', round = S.tool === 'round';
    drag = { kind: S.tool === 'rect' ? 'rect' : 'brush', erase, round, snap: E.mask.slice() };
    if (drag.kind === 'rect') {
      drag.start = st.pixelAt(e, true);
      placeBox(ghost, drag.start[0], drag.start[1], drag.start[0] + 1, drag.start[1] + 1);
    } else {
      drag.last = st.pixelAt(e);
      line(drag.last[0], drag.last[1], drag.last[0], drag.last[1], erase ? 0 : 1, round);
      showBrushCursor(drag.last);
    }
  }

  el.addEventListener('pointermove', (e) => {
    S.hoverCol = slot;
    const p = ptrs.get(e.pointerId);
    if (p) { p.x = e.clientX; p.y = e.clientY; }
    if (mode === 'pinch' && ptrs.size === 2) {
      const n = pinchState();
      st.panBy(n.mx - g.mx, n.my - g.my);
      g.mx = n.mx; g.my = n.my;
      const ratio = n.d / g.d;
      if (ratio >= 1.25) { st.step(1, n.mx, n.my); g.d = n.d; }
      else if (ratio <= 0.8) { st.step(-1, n.mx, n.my); g.d = n.d; }
      return;
    }
    if (mode === 'pan' && p) {
      st.panBy(e.clientX - pan.x, e.clientY - pan.y);
      pan.x = e.clientX; pan.y = e.clientY;
      return;
    }
    if (mode === 'draw' && drag && p) {
      if (drag.kind === 'rect') {
        const r = rectOf(drag.start, st.pixelAt(e, true));
        placeBox(ghost, r[0], r[1], r[0] + r[2], r[1] + r[3], { erase: drag.erase });
      } else {
        const pts = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        for (const ev of pts.length ? pts : [e]) {
          const q = st.pixelAt(ev);
          line(drag.last[0], drag.last[1], q[0], q[1], drag.erase ? 0 : 1, drag.round);
          drag.last = q;
        }
        showBrushCursor(drag.last);
        previewTick();
      }
      return;
    }
    // ドラッグしていないとき：ブラシカーソルがポインタに付いてくる（マウス）
    if (isEnc && e.pointerType === 'mouse' && !mode && canDraw() && S.tool !== 'rect' && st.has) showBrushCursor(st.pixelAt(e));
    else if (isEnc && !mode) brushCursor.hidden = true;
  });

  function endPointer(e, cancelled) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (mode === 'pinch') {
      mode = ptrs.size ? 'ignore' : null; // 残った指では描かない
      g = null;
    } else if (mode === 'pan') {
      mode = null; pan = null;
      el.classList.remove('panning');
    } else if (mode === 'draw' && drag) {
      mode = null;
      finishDraw(e, cancelled);
    } else if (mode === 'ignore' && !ptrs.size) {
      mode = null;
    }
    if (!ptrs.size && mode === 'ignore') mode = null;
    if (e.pointerType !== 'mouse') brushCursor.hidden = true;
  }

  function finishDraw(e, cancelled) {
    const d = drag;
    drag = null;
    ghost.hidden = true;
    if (cancelled) { E.mask = d.snap; maskChanged(); return; }
    if (d.kind === 'rect') {
      addRect(E.mask, E.image.width, E.image.height, rectOf(d.start, st.pixelAt(e, true)), d.erase ? 0 : 1);
    }
    // 何も変わらなかった手は記録しない
    let changed = false;
    for (let i = 0; i < E.mask.length; i++) if (E.mask[i] !== d.snap[i]) { changed = true; break; }
    if (!changed) return;
    pushUndo(d.snap);
    maskChanged(d.kind === 'brush');
  }

  el.addEventListener('pointerup', (e) => endPointer(e, false));
  el.addEventListener('pointercancel', (e) => endPointer(e, true));
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !mode) brushCursor.hidden = true; });
  el.addEventListener('pointerenter', () => { S.hoverCol = slot; });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });

  // ホイール：カーソル位置を中心に 1 ノッチで 1 段。ページはスクロールしない
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!st.has) return;
    wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    const [cx, cy] = st.local(e);
    let n = 0;
    while (Math.abs(wheelAcc) >= 100 && n < 3) {
      st.step(wheelAcc < 0 ? 1 : -1, cx, cy);
      wheelAcc -= Math.sign(wheelAcc) * 100;
      n++;
    }
  }, { passive: false });

  // 空の枠はクリックでファイル選択
  st.emptyEl.addEventListener('click', () => pickFile(slot));
}
bindStage('encode');
bindStage('decode');
document.addEventListener('pointerdown', (e) => {
  const col = e.target.closest?.('.col');
  if (col) S.lastTouched = col.dataset.slot;
}, true);
document.addEventListener('focusin', (e) => {
  const col = e.target.closest?.('.col');
  if (col) S.lastTouched = col.dataset.slot;
});

/* ---------- タブ（768px 未満） ---------- */
function setTab(tab) {
  document.body.dataset.tab = tab;
  setSegment('colTabs', 'tab', tab);
}
linkSegment('colTabs', (d) => setTab(d.tab));
const narrow = () => matchMedia('(max-width: 767px)').matches;

/* ---------- 開く：枠・OPEN・PASTE・ドロップ・Ctrl+V・Ctrl+O ----------
   列の中で開いたらその列へ。それ以外は、復元データ（knVt / KNVT）があれば DECODE、無ければ ENCODE に振り分ける。 */
function pickFile(slot) {
  const input = $('fileInput');
  input.dataset.slot = slot || '';
  input.click();
}
$('fileInput').addEventListener('change', (e) => {
  const f = e.target.files[0];
  const slot = e.target.dataset.slot || null;
  e.target.value = '';
  openFile(f, slot);
});
$('encOpen').addEventListener('click', () => pickFile('encode'));
$('decOpen').addEventListener('click', () => pickFile('decode'));

async function openFile(file, forced) {
  if (!file) return;
  const buf = await file.arrayBuffer();
  try {
    const r = await call('open', { slot: 'tmp', bytes: buf }, [buf]);
    const decodeLike = r.info.chunks > 0; // 復元データ（knVt / KNVT）があれば DECODE
    const slot = forced ?? (decodeLike ? 'decode' : 'encode');
    await call('move', { from: 'tmp', to: slot });
    adopt(slot, file.name, r);
    if (!forced) setTab(slot);
  } catch (e) {
    showMsg(forced ?? 'encode', e.message);
    toast(e.message, 'error', 5000);
  }
  updateButtons();
}

function adopt(slot, name, r) {
  if (r.warnings.length) toast(r.warnings.join(' '), 'ok', 4000);
  const img = { width: r.width, height: r.height, name, info: r.info, rgba: r.rgba };
  if (slot === 'encode') {
    previewSeq++;
    Object.assign(E, { image: img, mask: new Uint8Array(r.width * r.height), maskCount: 0, maskImage: null, view: 'mask', preview: null, undo: [], redo: [] });
    E.maskVersion++;
    setSegment('viewGroup', 'view', 'mask');
    hideCursors();
    ST.setImage(r.width, r.height);
    renderEncode();
    updateStatus('encode');
    showMsg('encode', r.info.chunks > 0 ? 'This image already has restore data. Encoding again replaces it.' : '', false);
  } else {
    Object.assign(D, { image: img, revealed: null, view: 'spoiler', locked: r.info.chunk?.keyMode === 1 });
    $('decPass').value = '';
    $('decPassRow').hidden = !D.locked;
    $('decNote').hidden = true;
    SD.setImage(r.width, r.height);
    renderDecode();
    updateStatus('decode');
    showVerdict();
    showMsg('decode', r.info.chunkError || '');
  }
  updateButtons();
}

function showMsg(slot, text, bad = true) {
  const el = $(slot === 'encode' ? 'encMsg' : 'decMsg');
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle('msg-line', bad);
}

// ドロップは、枠・列の上ならその列、それ以外は振り分け
addEventListener('dragover', (e) => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault();
  document.body.classList.add('dragging');
});
addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  const col = e.target.closest?.('.col');
  openFile(e.dataTransfer?.files?.[0], col ? col.dataset.slot : null);
});

/* ---------- 貼り付け（Ctrl+V / PASTE） ---------- */
const clipStamp = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function openClipboardBlob(blob, forced) {
  const ext = { 'image/jpeg': '.jpg', 'image/webp': '.webp' }[blob.type] ?? '.png';
  return openFile(new File([blob], 'clipboard_' + clipStamp() + ext, { type: blob.type }), forced);
}

addEventListener('paste', (e) => {
  if (typingTarget(e.target)) return; // 文字の貼り付けを邪魔しない
  e.preventDefault();
  const file = [...(e.clipboardData?.files ?? [])].find((f) => IMAGE_TYPES.includes(f.type));
  if (!file) { toast('The clipboard has no image.', 'error'); return; }
  openClipboardBlob(file, null);
});

async function pasteButton(slot) {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = IMAGE_TYPES.find((t) => item.types.includes(t));
      if (type) { openClipboardBlob(await item.getType(type), slot); return; }
    }
    toast('The clipboard has no image.', 'error');
  } catch (e) {
    toast(e.name === 'NotAllowedError' ? 'The browser did not allow reading the clipboard.' : (e.message || 'Could not read the clipboard.'), 'error', 5000);
  }
}
if (!navigator.clipboard?.read) { $('encPaste').hidden = true; $('decPaste').hidden = true; }
$('encPaste').addEventListener('click', () => pasteButton('encode'));
$('decPaste').addEventListener('click', () => pasteButton('decode'));

/* ---------- ENCODE：保存 ---------- */
function download(bytes, name, mime = 'image/png') {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const baseName = (img) => img.name.replace(/\.[^.]*$/, '');

$('saveBtn').addEventListener('click', async () => {
  if (!E.image || $('saveBtn').disabled) return;
  if (E.maskCount === 0) { toast('Mark the part to hide first.', 'error'); return; }
  const mask = E.mask.slice();
  try {
    const r = await call('encode', {
      mask, render: currentRender(), hint: $('hintInput').value,
      passphrase: $('pass1').value, format: S.format, quality: +$('qualR').value, keepMetadata: $('keepMeta').checked,
    }, [mask.buffer]);
    download(r.bytes, baseName(E.image) + '_spoiler.' + r.ext, r.mime);
    const i = r.info;
    const parts = [
      `Saved. ${r.bytes.length.toLocaleString('en-US')} bytes`,
      `${i.spoilerPixels.toLocaleString('en-US')} px hidden`,
      i.keyMode ? 'passphrase' : 'no passphrase',
      FORMAT_LABEL[i.format],
    ];
    toast([parts.join(' · '), ...r.warnings].join(' / '), 'ok', r.warnings.length ? 6000 : 4000);
  } catch (e) {
    toast(e.message, 'error', 6000);
  }
});

/* ---------- DECODE：判定・UNLOCK・SAVE・COPY ---------- */
const VERDICT = { processed: 'PROCESSED', broken: 'BROKEN', not: 'NOT PROCESSED' };
const VERDICT_NOTE = { not: 'not a spoiler image' };

function showVerdict() {
  const info = D.image?.info;
  const v = $('decVerdict'), h = $('decHint');
  if (!info) {
    v.textContent = '-'; v.className = 'verdict dim'; v.title = ''; $('decVerdictNote').textContent = '';
    h.textContent = '-'; h.className = 'hint-text dim';
    $('sendBtn').hidden = true;
    return;
  }
  const bad = info.verdict === 'broken';
  v.textContent = VERDICT[info.verdict];
  $('decVerdictNote').textContent = VERDICT_NOTE[info.verdict] ?? '';
  v.className = 'verdict' + (bad ? ' bad' : info.verdict === 'processed' ? '' : ' dim');
  const n = (x) => (x == null ? '-' : x.toLocaleString('en-US'));
  v.title = [
    `FORMAT ${info.format.toUpperCase()}`,
    `DATA ${info.chunk ? n(info.chunk.ciphertextBytes) + ' bytes' : '-'}`,
    `LOCK ${info.chunk ? (info.chunk.keyMode === 1 ? 'PASSPHRASE' : 'NONE') : '-'}`,
  ].join('\n');
  const hint = info.chunk?.hint;
  h.textContent = hint || '-';
  h.className = 'hint-text' + (hint ? '' : ' dim');
  $('sendBtn').hidden = info.verdict !== 'not';
}

$('decPass').addEventListener('input', updateButtons);
$('decPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('unlockBtn').click(); } });

$('unlockBtn').addEventListener('click', async () => {
  if (!D.image || $('unlockBtn').disabled) return;
  if (D.revealed) { // SHOW SPOILER / SHOW ORIGINAL
    D.view = D.view === 'original' ? 'spoiler' : 'original';
    renderDecode();
    updateButtons();
    return;
  }
  try {
    const r = await call('reveal', { passphrase: $('decPass').value });
    D.revealed = r.rgba;
    D.view = 'original';
    showMsg('decode', '');
    $('decNote').textContent = r.lossless
      ? 'Restored. The whole image is original.'
      : 'Restored. The hidden part is original; the rest keeps the WebP compression.';
    $('decNote').hidden = false;
    renderDecode();
    updateButtons();
  } catch (e) {
    showMsg('decode', e.message);
    $('decNote').hidden = true;
    toast(e.message, 'error', 6000);
    if (!$('decPassRow').hidden) { $('decPass').focus(); $('decPass').select(); }
  }
});

$('sendBtn').addEventListener('click', async () => {
  if (!D.image) return;
  try {
    const r = await call('copy', { from: 'decode', to: 'encode' });
    adopt('encode', D.image.name, r);
    setTab('encode');
  } catch (e) {
    toast(e.message, 'error', 5000);
  }
});

$('decSave').addEventListener('click', async () => {
  if (!D.revealed || $('decSave').disabled) return;
  try {
    const r = await call('saveOriginal', { format: S.decFormat, quality: +$('decQualR').value });
    download(r.bytes, baseName(D.image).replace(/_spoiler$/, '') + '_original.' + r.ext, r.mime);
  } catch (e) {
    toast(e.message, 'error', 6000);
  }
});

if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') $('copyBtn').hidden = true;
$('copyBtn').addEventListener('click', async () => {
  if (!D.revealed) return;
  try {
    // ユーザー操作の有効期間内に write を始めるため、Blob は Promise のまま渡す
    const blob = call('saveOriginal', { format: 'png' }).then((r) => new Blob([r.bytes], { type: 'image/png' }));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Copied.');
  } catch (e) {
    toast(e.name === 'NotAllowedError' ? 'The browser did not allow writing to the clipboard.' : (e.message || 'Could not copy.'), 'error', 5000);
  }
});

/* ---------- ボタンの有効・無効 ---------- */
function updateButtons() {
  const busy = S.busy > 0;
  $('saveBtn').disabled = busy || !E.image || hintTooLong() || !passMatch();
  $('undoBtn').disabled = !E.undo.length;
  $('redoBtn').disabled = !E.redo.length;
  const unlock = $('unlockBtn');
  if (D.revealed) {
    unlock.textContent = D.view === 'original' ? 'SHOW SPOILER' : 'SHOW ORIGINAL';
    unlock.disabled = busy;
  } else {
    unlock.textContent = 'UNLOCK';
    unlock.disabled = busy || !D.image || (D.locked && !$('decPass').value);
  }
  $('decSave').disabled = busy || !D.revealed;
  $('copyBtn').disabled = busy || !D.revealed;
}

/* ---------- キーボード ---------- */
function typingTarget(el) {
  return el.matches?.('input[type=text], input[type=number], input[type=password], textarea');
}
const activeCol = () => (narrow() ? document.body.dataset.tab : S.lastTouched);

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === 's') {
    e.preventDefault();
    const b = activeCol() === 'decode' ? $('decSave') : $('saveBtn');
    if (!b.disabled) b.click();
    return;
  }
  if (typingTarget(e.target)) return;
  if (e.ctrlKey && k === 'o') { e.preventDefault(); pickFile(null); return; }
  if (e.ctrlKey && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); undoRedo(E.redo, E.undo); return; }
  if (e.ctrlKey && k === 'z') { e.preventDefault(); undoRedo(E.undo, E.redo); return; }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (k === ' ') { if (e.target.tagName !== 'BUTTON') e.preventDefault(); S.space = true; return; }
  const st = stages[narrow() ? document.body.dataset.tab : S.hoverCol] ?? ST;
  if (k === '+' || k === '=') st.step(1);
  else if (k === '-') st.step(-1);
  else if (k === '0') st.refit();
  else if (k === 'r') setTool('rect');
  else if (k === 'b') setTool('square');
  else if (k === 'c') setTool('round');
  else if (k === 'e') setTool('erase');
  else if (k === '[') setBrush(S.brush - 1);
  else if (k === ']') setBrush(S.brush + 1);
  else if (k === 'p' && E.image) setView(E.view === 'mask' ? 'preview' : 'mask');
});
addEventListener('keyup', (e) => { if (e.key === ' ') S.space = false; });
addEventListener('blur', () => { S.space = false; });

/* ブラウザのページ拡大（Ctrl+ホイール）は止める。枠の上では枠のホイールが拡大縮小を受け持つ */
addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
addEventListener('resize', () => { for (const st of Object.values(stages)) st.onResize(); });

/* ---------- 起動 ---------- */
if (new URLSearchParams(location.search).has('test')) window.konvert = { worker, stages, E, D, S };
onStyleChange();
showVerdict();
updateStatus('encode');
updateStatus('decode');
updateButtons();
