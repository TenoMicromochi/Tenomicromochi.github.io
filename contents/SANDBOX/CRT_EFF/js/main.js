// CRT SHADER — 画面の組み立て（読み込み・拡大・移動・書き出し）
import { MAX_CHOICES, DIV_CHOICES, SLIDERS, DEFAULT_MAX, DEFAULT_DIV, DEFAULT_MASK, MASKS, EXPORT_LIMIT, MP4_BPP, MP4_MAX_BITRATE, CROP_RATIOS } from './config.js';
import { fitSize, divSize, zoomAt, fitView, exportSize, boxResize, makeTestPattern, statusText, WHEEL_STEP, gifExportCheck, gifDelay, GIF_MAX_FRAMES, apngExportCheck, mp4Size, mp4Codec, cropRgba, cropOutSize, fitCropRect, makeCropRect, resizeCropRect } from './logic.js';
import { buildMp4 } from './mp4.js';
import { Renderer } from './shader.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const canvas = $('screen');
const statusEl = $('status');
const cropBox = $('cropBox');

// ---- 下の欄を作る（既定値は config.js） ----
for (const m of MAX_CHOICES) {
  const o = document.createElement('option');
  o.value = m; o.textContent = m;
  if (m === DEFAULT_MAX) o.selected = true;
  $('maxSel').appendChild(o);
}
for (const n of DIV_CHOICES) {
  const o = document.createElement('option');
  o.value = n; o.textContent = '1/' + n;
  if (n === DEFAULT_DIV) o.selected = true;
  $('divSel').appendChild(o);
}
for (const name of Object.keys(MASKS)) {
  const o = document.createElement('option');
  o.value = name; o.textContent = name;
  if (name === DEFAULT_MASK) o.selected = true;
  $('maskSel').appendChild(o);
}
const params = {};
for (const [key, s] of Object.entries(SLIDERS)) {
  params[key] = s.def;
  const box = document.createElement('div');
  box.className = 'sb-ctrl';
  box.innerHTML =
    `<label for="${key}">${s.label}</label>` +
    `<input type="range" id="${key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.def}">` +
    `<input type="number" id="${key}N" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.def}">`;
  $('sliders').appendChild(box);
  box.querySelector('input[type=range]').addEventListener('input', (e) => {
    params[key] = parseFloat(e.target.value);
    requestDraw();
  });
}
// タブ・スライダーと数値の同期は共通スクリプト。部品を作ったあとで読み込む
{
  const s = document.createElement('script');
  s.src = '/sandbox-ui.js';
  document.body.appendChild(s);
}

for (const k of ['OFF', ...Object.keys(CROP_RATIOS)]) {
  const o = document.createElement('option');
  o.value = k; o.textContent = k;
  $('cropSel').appendChild(o);
}

// ---- 状態 ----
const state = {
  orig: null,              // { w, h, name, data?, file? }：元画像の大きさと名前。静止画は data（読み込んだまま）、GIF は file を持つ
  img: null,               // { w, h }：処理する大きさ（1/n と MAX のあと）
  frames: [],              // 縮め終わったコマ（RGBA）。静止画は1枚
  delays: [],              // 各コマの待ち時間（ms）
  frame: 0,                // 今のコマ
  note: '',                // 状態の文字の最後の注意書き
  progress: '',            // 読み込み・書き出しの進み具合（あれば状態の文字より優先）
  max: DEFAULT_MAX,
  div: DEFAULT_DIV,
  mask: DEFAULT_MASK,
  view: { zoom: 1, ox: 0, oy: 0 },   // canvas の CSS 画素単位
  autoFit: true,           // 利用者が動かすまで、ウィンドウの大きさに追従して FIT
  msg: '',
  cropKey: 'OFF',          // CROP の選択（OFF か CROP_RATIOS のキー）
  crop: null,              // 枠 { x, y, w, h }：処理する画像の画素座標（小数可）。OFF のときは null
};

let renderer;
try {
  renderer = new Renderer(canvas);
} catch (e) {
  statusEl.textContent = 'WebGL2 is not available.';
  throw e;
}

// ---- canvas の大きさ：内部解像度 = CSS の大きさ × devicePixelRatio（整数に丸める） ----
let cssW = 1, cssH = 1;
function resize() {
  cssW = stage.clientWidth;
  cssH = stage.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  if (state.img && state.autoFit) state.view = fitView(state.img.w, state.img.h, cssW, cssH);
  updateStatus();
  requestDraw();
}
new ResizeObserver(resize).observe(stage);
window.addEventListener('resize', resize);

// ---- 描画 ----
let drawQueued = false;
function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; drawNow(); });
}
function drawNow() {
  layoutCrop();
  if (!state.img) return;
  // CSS 画素の view を、canvas の画素へ
  const sx = canvas.width / cssW, sy = canvas.height / cssH;
  const v = state.view;
  renderer.draw({ zoom: v.zoom * sx, ox: v.ox * sx, oy: v.oy * sy }, params, state.mask);
}

function updateStatus() {
  if (state.progress) { statusEl.textContent = state.progress; return; }
  if (state.msg) { statusEl.textContent = state.msg; return; }
  if (!state.orig) { statusEl.textContent = ''; return; }
  statusEl.textContent = statusText(state.orig.w, state.orig.h, state.img.w, state.img.h, state.view.zoom,
    { div: state.div, frames: state.frames.length, note: state.note, out: outSizeText() });
}
function setMsg(text) { state.msg = text; updateStatus(); }

// ---- 画像を入れる ----
// 縮める順番：元画像 → 1/n → MAX の上限（どちらも面積平均）
function reduce(data, w, h) {
  const d = divSize(w, h, state.div);
  const px = boxResize(data, w, h, d.w, d.h);
  const size = fitSize(d.w, d.h, state.max);
  return { px: boxResize(px, d.w, d.h, size.w, size.h), size };
}

let playStart = 0;
let ticking = false;

// 縮め終わったコマを画面に出す。fit するかは呼び出し側
function show(orig, frames, delays, size, note, fit) {
  state.orig = orig;
  state.frames = frames;
  state.delays = delays;
  state.frame = 0;
  state.note = note || '';
  state.img = size;
  state.msg = '';
  state.progress = '';
  renderer.setImage(frames[0], size.w, size.h);
  playStart = performance.now();
  if (fit) {
    state.view = fitView(size.w, size.h, cssW, cssH);
    state.autoFit = true;
  }
  if (state.cropKey !== 'OFF') newCrop();
  updateStatus();
  requestDraw();
  if (!ticking) { ticking = true; requestAnimationFrame(tick); }
}

// 静止画（読み込んだままの data から縮める）
function applyStill(fit) {
  const o = state.orig;
  const { px, size } = reduce(o.data, o.w, o.h);
  show(o, [px], [100], size, '', fit);
}

// アニメーションの再生：描画のたびに今のコマを1枚のテクスチャへ流し込む
function tick(now) {
  if (state.frames.length < 2) { ticking = false; return; }
  ticking = true;
  const total = state.delays.reduce((x, y) => x + y, 0);
  let t = (now - playStart) % total;
  let i = 0;
  while (t >= state.delays[i]) { t -= state.delays[i]; i++; }
  if (i !== state.frame) {
    state.frame = i;
    renderer.setImage(state.frames[i], state.img.w, state.img.h);
    requestDraw();
  }
  requestAnimationFrame(tick);
}

// 画像1枚を、元の大きさの RGBA にする（透明は黒に重ねる）
const scratch = document.createElement('canvas');
const scratchCtx = scratch.getContext('2d', { willReadFrequently: true });
function grab(source, w, h) {
  if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; }
  scratchCtx.imageSmoothingEnabled = false;
  scratchCtx.fillStyle = '#000';
  scratchCtx.fillRect(0, 0, w, h);
  scratchCtx.drawImage(source, 0, 0);
  return scratchCtx.getImageData(0, 0, w, h).data;
}

async function decodeStill(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { colorSpaceConversion: 'none' }); }
  catch { bmp = await createImageBitmap(file); }
  const w = bmp.width, h = bmp.height;
  const data = grab(bmp, w, h);
  bmp.close();
  return { data, w, h };
}

let loadToken = 0;
async function loadFile(file) {
  if (!file) return;
  const token = ++loadToken;
  const name = file.name.replace(/\.[^.]*$/, '') || 'image';
  try {
    const isGif = file.type === 'image/gif' || /\.gif$/i.test(file.name);
    const canAnim = isGif && typeof ImageDecoder !== 'undefined' && await ImageDecoder.isTypeSupported('image/gif');
    if (!canAnim) {
      const { data, w, h } = await decodeStill(file);
      if (token !== loadToken) return;
      const { px, size } = reduce(data, w, h);
      show({ w, h, name, data }, [px], [100], size, isGif ? '(first frame only)' : '', true);
      return;
    }
    // GIF：全コマを ImageDecoder で読む（重ね合わせ済みの絵で受け取る）
    const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' });
    await dec.tracks.ready;
    const total = dec.tracks.selectedTrack.frameCount;
    const count = Math.min(total, GIF_MAX_FRAMES);
    const frames = [], delays = [];
    let ow = 0, oh = 0, size = null;
    for (let i = 0; i < count; i++) {
      let image;
      try { ({ image } = await dec.decode({ frameIndex: i })); }
      catch (e) { if (i === 0) throw e; break; }
      if (token !== loadToken) { image.close(); dec.close(); return; }
      ow = image.displayWidth; oh = image.displayHeight;
      const r = reduce(grab(image, ow, oh), ow, oh);
      size = r.size;
      frames.push(r.px);
      delays.push(gifDelay((image.duration || 0) / 1000));
      image.close();
      if (count > 1) { state.progress = `Loading GIF ${i + 1}/${count}`; updateStatus(); }
      if (i % 4 === 3) await new Promise((res) => setTimeout(res));
    }
    dec.close();
    if (token !== loadToken) return;
    const note = total > GIF_MAX_FRAMES ? '(500 frames max)' : '';
    show({ w: ow, h: oh, name, file }, frames, delays, size, note, true);
  } catch {
    if (token !== loadToken) return;
    state.progress = '';
    setMsg('Cannot read this file.');       // 前の画像は残す
  }
}

// 1/n・MAX を変えたとき：元画像から縮め直す（GIF は全コマ）
function reload() {
  if (!state.orig) return;
  if (state.orig.file) loadFile(state.orig.file);
  else applyStill(true);
}

$('openBtn').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', (e) => {
  loadFile(e.target.files[0]);
  e.target.value = '';
});
stage.addEventListener('dragover', (e) => { e.preventDefault(); });
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  loadFile(e.dataTransfer.files[0]);
});

$('maxSel').addEventListener('change', (e) => { state.max = parseInt(e.target.value, 10); reload(); });
$('divSel').addEventListener('change', (e) => { state.div = parseInt(e.target.value, 10); reload(); });
$('maskSel').addEventListener('change', (e) => { state.mask = e.target.value; requestDraw(); });

// ---- 切り抜きの枠 ----
const HIT_CORNER = 8, HIT_EDGE = 5;     // 当たりの範囲（CSS 画素）
const CURSORS = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', move: 'move' };
function cropRatio() { return CROP_RATIOS[state.cropKey]; }

// 枠を作る：prev があれば中心と高さを保つ（比率を変えたとき）。無ければ画面の中心・見えている範囲の 60%
function newCrop(prev) {
  if (!state.img || state.cropKey === 'OFF') { state.crop = null; return; }
  const v = state.view, ratio = cropRatio();
  const cx = prev ? prev.x + prev.w / 2 : (cssW / 2 - v.ox) / v.zoom;
  const cy = prev ? prev.y + prev.h / 2 : (cssH / 2 - v.oy) / v.zoom;
  state.crop = makeCropRect(ratio, cx, cy, state.img.w, state.img.h, cssW / v.zoom, cssH / v.zoom, prev ? prev.h : undefined);
}
$('cropSel').addEventListener('change', (e) => {
  const prev = state.crop;
  state.cropKey = e.target.value;
  newCrop(prev);
  state.msg = '';
  updateStatus();
  requestDraw();
});

// 画面の上の枠（暗くする要素と線の要素）を、今の拡大・移動に合わせて置く。シェーダーには混ぜない
function layoutCrop() {
  if (!state.crop || !state.img) { cropBox.hidden = true; return; }
  const v = state.view, c = state.crop;
  const l = Math.round(v.ox + c.x * v.zoom), t = Math.round(v.oy + c.y * v.zoom);
  const r = Math.round(v.ox + (c.x + c.w) * v.zoom), b = Math.round(v.oy + (c.y + c.h) * v.zoom);
  cropBox.hidden = false;
  cropBox.style.left = l + 'px'; cropBox.style.top = t + 'px';
  cropBox.style.width = Math.max(1, r - l) + 'px'; cropBox.style.height = Math.max(1, b - t) + 'px';
}
// ポインタの下にあるもの：角（'nw' 'ne' 'sw' 'se'、縁より優先）、縁（'n' 's' 'e' 'w'）、枠の中（'move'）、それ以外は null
function cropHit(e) {
  if (!state.crop) return null;
  const r = canvas.getBoundingClientRect(), v = state.view, c = state.crop;
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const l = v.ox + c.x * v.zoom, t = v.oy + c.y * v.zoom, rt = l + c.w * v.zoom, bt = t + c.h * v.zoom;
  const nearL = Math.abs(x - l) <= HIT_CORNER, nearR = Math.abs(x - rt) <= HIT_CORNER;
  const nearT = Math.abs(y - t) <= HIT_CORNER, nearB = Math.abs(y - bt) <= HIT_CORNER;
  if ((nearT || nearB) && (nearL || nearR)) return (nearT ? 'n' : 's') + (nearL ? 'w' : 'e');
  const inX = x >= l - HIT_EDGE && x <= rt + HIT_EDGE, inY = y >= t - HIT_EDGE && y <= bt + HIT_EDGE;
  if (inY && Math.abs(x - l) <= HIT_EDGE) return 'w';
  if (inY && Math.abs(x - rt) <= HIT_EDGE) return 'e';
  if (inX && Math.abs(y - t) <= HIT_EDGE) return 'n';
  if (inX && Math.abs(y - bt) <= HIT_EDGE) return 's';
  if (x >= l && x <= rt && y >= t && y <= bt) return 'move';
  return null;
}
function imagePoint(e) {
  const r = canvas.getBoundingClientRect(), v = state.view;
  return { x: (e.clientX - r.left - v.ox) / v.zoom, y: (e.clientY - r.top - v.oy) / v.zoom };
}

// ---- 拡大・移動 ----
function userMoved() { state.autoFit = false; state.msg = ''; }
function fit() {
  if (!state.img) return;
  state.view = fitView(state.img.w, state.img.h, cssW, cssH);
  state.autoFit = true;
  state.msg = '';
  updateStatus();
  requestDraw();
}
$('fitBtn').addEventListener('click', fit);
canvas.addEventListener('dblclick', fit);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!state.img) return;
  // 1目盛り（100）で ×2^(1/4)。上で拡大
  let notches = -(e.deltaY || e.deltaX) / (e.deltaMode === 1 ? 3 : 100);
  notches = Math.max(-4, Math.min(4, notches));
  const r = canvas.getBoundingClientRect();
  state.view = zoomAt(state.view, { x: e.clientX - r.left, y: e.clientY - r.top }, Math.pow(WHEEL_STEP, notches));
  userMoved();
  updateStatus();
  requestDraw();
}, { passive: false });

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  const hit = cropHit(e);
  drag = { x: e.clientX, y: e.clientY, ox: state.view.ox, oy: state.view.oy, crop: hit ? state.crop : null, hit, gx: 0, gy: 0 };
  // 縁・角：つかんだ位置と線のずれを覚えておき、最初の動きで線が跳ばないようにする
  if (hit && hit !== 'move') {
    const c = state.crop, p = imagePoint(e);
    if (hit.includes('e')) drag.gx = c.x + c.w - p.x;
    if (hit.includes('w')) drag.gx = c.x - p.x;
    if (hit.includes('s')) drag.gy = c.y + c.h - p.y;
    if (hit.includes('n')) drag.gy = c.y - p.y;
  }
  if (!hit) canvas.style.cursor = '';
  canvas.classList.add('is-drag');
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) { canvas.style.cursor = CURSORS[cropHit(e)] || ''; return; }
  if (drag.crop && drag.hit !== 'move') {      // 縁・角のドラッグ：枠の大きさが変わる（始めたときの枠から計算）
    const p = imagePoint(e);
    state.crop = resizeCropRect(drag.crop, drag.hit, { x: p.x + drag.gx, y: p.y + drag.gy }, state.img.w, state.img.h);
    state.msg = '';
    updateStatus();
    requestDraw();
    return;
  }
  if (drag.crop) {         // 枠の中をドラッグ：枠が動く
    const dx = (e.clientX - drag.x) / state.view.zoom, dy = (e.clientY - drag.y) / state.view.zoom;
    state.crop = fitCropRect({ ...drag.crop, x: drag.crop.x + dx, y: drag.crop.y + dy }, state.img.w, state.img.h);
    state.msg = '';
    updateStatus();
    requestDraw();
    return;
  }
  state.view = { zoom: state.view.zoom, ox: drag.ox + e.clientX - drag.x, oy: drag.oy + e.clientY - drag.y };
  userMoved();
  requestDraw();
});
const endDrag = () => { drag = null; canvas.classList.remove('is-drag'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ---- 書き出し ----
// FORMAT で選んだ形式で、EXPORT の1つのボタンから書き出す。大きさはどれも exportSize（MP4 だけ偶数に切り下げ）
const FORMATS = ['PNG', 'GIF', 'APNG', 'MP4'];
for (const f of FORMATS) {
  const o = document.createElement('option');
  o.value = f; o.textContent = f;
  $('fmtSel').appendChild(o);
}
let format = 'PNG';
$('fmtSel').addEventListener('change', (e) => { format = e.target.value; updateStatus(); });

let exporting = false;
function setExporting(on) {
  exporting = on;
  $('exportBtn').disabled = on;
  $('fmtSel').disabled = on;
}
function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// 今の形式で書き出す大きさ（状態の文字の OUT）
// 書き出す大きさ：切り抜きがあれば枠の中だけ（cropOutSize）、無ければ画像全体（exportSize。MP4 だけ偶数に切り下げ）
function outDims() {
  if (state.crop) {
    const o = cropOutSize(state.crop, state.view.zoom, cropRatio(), format === 'MP4');
    return { w: o.w, h: o.h, crop: state.crop };
  }
  const s = exportSize(state.img.w, state.img.h, state.view.zoom, Infinity);
  const o = format === 'MP4' ? mp4Size(s.w, s.h) : s;
  return { w: o.w, h: o.h, crop: undefined };
}
function outSizeText() {
  if (!state.img) return '';
  const o = outDims();
  return `${o.w}x${o.h}` + (o.crop ? ` (CROP ${state.cropKey})` : '');
}

$('exportBtn').addEventListener('click', () => {
  if (!state.img || exporting) return;
  if (format === 'PNG') exportPng();
  else if (format === 'GIF') {
    exportViaWorker({ label: 'GIF', worker: 'js/gif_worker.js', ext: 'gif', mime: 'image/gif',
      check: (w, h, n) => gifExportCheck(w, h, n) });
  } else if (format === 'APNG') {
    exportViaWorker({ label: 'APNG', worker: 'js/apng_worker.js', ext: 'png', suffix: '_crt_anim', mime: 'image/png',
      check: (w, h, n) => apngExportCheck(w, h, n, Math.min(EXPORT_LIMIT, renderer.maxTex)) });
  } else exportMp4();
});

// PNG：アニメーションのときは、今表示しているコマを書き出す
async function exportPng() {
  const limit = Math.min(EXPORT_LIMIT, renderer.maxTex);
  const size = outDims();
  if (Math.max(size.w, size.h) > limit) { setMsg('Too large to export. Zoom out.'); return; }
  setExporting(true);
  try {
    const blob = await renderer.exportPng(size.w, size.h, params, state.mask, size.crop);
    download(blob, `${state.orig.name}_crt.png`);
    state.msg = '';
    updateStatus();
  } catch {
    setMsg('Export failed.');
  } finally {
    setExporting(false);
    requestDraw();
  }
}

// GIF・APNG：コマを1枚ずつ描いて Worker へ渡し、減色・フィルタ・圧縮は Worker に任せる
async function exportViaWorker({ label, worker: url, ext, suffix = '_crt', mime, check }) {
  const frames = state.frames, delays = state.delays, name = state.orig.name;
  const src = { w: state.img.w, h: state.img.h };
  const size = outDims();
  if (!check(size.w, size.h, frames.length)) { setMsg(`Too large to export as ${label}. Zoom out.`); return; }
  setExporting(true);
  const p = { ...params }, mask = state.mask, N = frames.length;
  const worker = new Worker(url, { type: 'module' });
  let done = 0, failed = false, wake = null, finished = null;
  const finishP = new Promise((res) => { finished = res; });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') {
      done = m.n;
      state.progress = `Encoding ${label} ${done}/${N}`;
      updateStatus();
      if (wake) { wake(); wake = null; }
    } else if (m.type === 'done') finished(m.parts || [m.bytes]);
    else if (m.type === 'error') { failed = true; if (wake) wake(); finished(null); }
  };
  worker.onerror = () => { failed = true; if (wake) wake(); finished(null); };
  try {
    state.progress = `Encoding ${label} 0/${N}`;
    updateStatus();
    worker.postMessage({ type: 'start', w: size.w, h: size.h });
    for (let k = 0; k < N && !failed; k++) {
      // Worker が2コマ以上遅れているあいだは待つ（メモリを増やさない）
      while (k - done >= 2 && !failed) await new Promise((r) => { wake = r; });
      await new Promise((r) => setTimeout(r));      // 画面の再生・操作に手を空ける
      const rgba = renderer.exportRgba({ rgba: frames[k], w: src.w, h: src.h }, size.w, size.h, p, mask, size.crop);
      worker.postMessage({ type: 'frame', rgba: rgba.buffer, delay: delays[k] }, [rgba.buffer]);
    }
    if (!failed) worker.postMessage({ type: 'finish' });
    const parts = await finishP;
    if (!parts || failed) throw new Error('encode');
    download(new Blob(parts, { type: mime }), `${name}${suffix}.${ext}`);
    state.progress = '';
    state.msg = '';
  } catch {
    state.progress = '';
    state.msg = 'Export failed.';
  } finally {
    worker.terminate();
    setExporting(false);
    updateStatus();
    requestDraw();
  }
}

// MP4：WebCodecs の VideoEncoder（H.264）で主の流れのまま符号化し、js/mp4.js で箱詰めする
async function exportMp4() {
  const frames = state.frames, name = state.orig.name;
  const delays = frames.length === 1 ? [1000] : state.delays;   // 静止画は1コマ・1000ms
  const src = { w: state.img.w, h: state.img.h };
  const dims = outDims();
  const { w, h } = dims;
  const unsupported = `MP4 encoder does not support ${w}x${h}. Zoom out.`;
  const codec = mp4Codec(w, h);
  if (typeof VideoEncoder === 'undefined' || !codec || Math.max(w, h) > Math.min(EXPORT_LIMIT, renderer.maxTex)) {
    setMsg(unsupported); return;
  }
  const config = { codec, width: w, height: h, framerate: 30, avc: { format: 'avc' },
    bitrate: Math.min(MP4_MAX_BITRATE, Math.round(w * h * 30 * MP4_BPP)) };
  try {
    if (!(await VideoEncoder.isConfigSupported(config)).supported) { setMsg(unsupported); return; }
  } catch { setMsg(unsupported); return; }
  setExporting(true);
  const p = { ...params }, mask = state.mask, N = frames.length;
  const samples = [];
  let avcC = null, failed = false;
  const enc = new VideoEncoder({
    output: (chunk, meta) => {
      const desc = meta && meta.decoderConfig && meta.decoderConfig.description;
      if (desc) avcC = new Uint8Array(desc instanceof ArrayBuffer ? desc.slice(0) : new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength).slice());
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({ data, duration: delays[samples.length], key: chunk.type === 'key' });
      state.progress = `Encoding MP4 ${samples.length}/${N}`;
      updateStatus();
    },
    error: () => { failed = true; },
  });
  try {
    enc.configure(config);
    state.progress = `Encoding MP4 0/${N}`;
    updateStatus();
    let ts = 0, lastKey = -Infinity;
    for (let k = 0; k < N && !failed; k++) {
      // キューが詰まっているあいだは次のコマを描かない（メモリを増やさない）
      while (enc.encodeQueueSize > 4 && !failed) {
        await new Promise((r) => { enc.addEventListener('dequeue', r, { once: true }); setTimeout(r, 50); });
      }
      await new Promise((r) => setTimeout(r));      // 画面の再生・操作に手を空ける
      const rgba = cropRgba(renderer.exportRgba({ rgba: frames[k], w: src.w, h: src.h }, w, h, p, mask, dims.crop), w, h, w, h);
      const frame = new VideoFrame(rgba, { format: 'RGBA', codedWidth: w, codedHeight: h, timestamp: ts * 1000, duration: delays[k] * 1000 });
      const key = k === 0 || ts - lastKey >= 2000;
      if (key) lastKey = ts;
      enc.encode(frame, { keyFrame: key });
      frame.close();
      ts += delays[k];
    }
    if (!failed) await enc.flush();
    if (failed || !avcC || samples.length !== N) throw new Error('encode');
    const parts = buildMp4({ w, h, timescale: 1000, avcC, samples });
    download(new Blob(parts, { type: 'video/mp4' }), `${name}_crt.mp4`);
    state.progress = '';
    state.msg = '';
  } catch {
    state.progress = '';
    state.msg = unsupported;
  } finally {
    try { enc.close(); } catch { /* すでに閉じている */ }
    setExporting(false);
    updateStatus();
    requestDraw();
  }
}

// ---- 下の欄をしまう ----
// 広がった分は stage の大きさの変化として resize に乗る（自動 FIT のあいだは FIT し直す）
function togglePanel() {
  const dock = document.querySelector('footer.sb-dock');
  dock.hidden = !dock.hidden;
  $('panelBtn').textContent = dock.hidden ? 'SHOW PANEL' : 'HIDE PANEL';
}
$('panelBtn').addEventListener('click', togglePanel);
window.addEventListener('keydown', (e) => {
  if (e.key !== 'h' && e.key !== 'H') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  togglePanel();
});

// ---- 起動：テスト模様 ----
{
  const t = makeTestPattern();
  resize();
  state.orig = { w: t.w, h: t.h, name: 'testpattern', data: t.data };
  applyStill(true);
}
