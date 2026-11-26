// CRT SHADER — 画面の組み立て（読み込み・拡大・移動・書き出し）
import { MAX_CHOICES, DIV_CHOICES, SLIDERS, DEFAULT_MAX, DEFAULT_DIV, DEFAULT_MASK, MASKS, EXPORT_LIMIT } from './config.js';
import { fitSize, divSize, zoomAt, fitView, exportSize, boxResize, makeTestPattern, statusText, WHEEL_STEP, gifExportCheck, gifDelay, GIF_MAX_FRAMES } from './logic.js';
import { Renderer } from './shader.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const canvas = $('screen');
const statusEl = $('status');

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
    { div: state.div, frames: state.frames.length, note: state.note });
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
  let notches = -e.deltaY / (e.deltaMode === 1 ? 3 : 100);
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
  drag = { x: e.clientX, y: e.clientY, ox: state.view.ox, oy: state.view.oy };
  canvas.classList.add('is-drag');
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  state.view = { zoom: state.view.zoom, ox: drag.ox + e.clientX - drag.x, oy: drag.oy + e.clientY - drag.y };
  userMoved();
  requestDraw();
});
const endDrag = () => { drag = null; canvas.classList.remove('is-drag'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ---- 書き出し ----
let exporting = false;
function setExporting(on) {
  exporting = on;
  $('exportBtn').disabled = on;
  $('exportGifBtn').disabled = on;
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

// アニメーションのときは、今表示しているコマを書き出す
$('exportBtn').addEventListener('click', async () => {
  if (!state.img || exporting) return;
  const limit = Math.min(EXPORT_LIMIT, renderer.maxTex);
  const size = exportSize(state.img.w, state.img.h, state.view.zoom, limit);
  if (!size.ok) { setMsg('Too large to export. Zoom out.'); return; }
  setExporting(true);
  try {
    const blob = await renderer.exportPng(size.w, size.h, params, state.mask);
    download(blob, `${state.orig.name}_crt.png`);
    state.msg = '';
    updateStatus();
  } catch {
    setMsg('Export failed.');
  } finally {
    setExporting(false);
    requestDraw();
  }
});

// GIF：コマを1枚ずつ描いて Worker へ渡し、減色と圧縮は Worker に任せる
$('exportGifBtn').addEventListener('click', async () => {
  if (!state.img || exporting) return;
  const frames = state.frames, delays = state.delays, name = state.orig.name;
  const src = { w: state.img.w, h: state.img.h };
  const size = exportSize(src.w, src.h, state.view.zoom, Infinity);
  if (!gifExportCheck(size.w, size.h, frames.length)) { setMsg('Too large to export as GIF. Zoom out.'); return; }
  setExporting(true);
  const p = { ...params }, mask = state.mask, N = frames.length;
  const worker = new Worker('js/gif_worker.js', { type: 'module' });
  let done = 0, failed = false, wake = null, finished = null;
  const finishP = new Promise((res) => { finished = res; });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') {
      done = m.n;
      state.progress = `Encoding GIF ${done}/${N}`;
      updateStatus();
      if (wake) { wake(); wake = null; }
    } else if (m.type === 'done') finished(m.bytes);
    else if (m.type === 'error') { failed = true; if (wake) wake(); finished(null); }
  };
  worker.onerror = () => { failed = true; if (wake) wake(); finished(null); };
  try {
    state.progress = `Encoding GIF 0/${N}`;
    updateStatus();
    worker.postMessage({ type: 'start', w: size.w, h: size.h });
    for (let k = 0; k < N && !failed; k++) {
      // Worker が2コマ以上遅れているあいだは待つ（メモリを増やさない）
      while (k - done >= 2 && !failed) await new Promise((r) => { wake = r; });
      await new Promise((r) => setTimeout(r));      // 画面の再生・操作に手を空ける
      const rgba = renderer.exportRgba({ rgba: frames[k], w: src.w, h: src.h }, size.w, size.h, p, mask);
      worker.postMessage({ type: 'frame', rgba: rgba.buffer, delay: delays[k] }, [rgba.buffer]);
    }
    if (!failed) worker.postMessage({ type: 'finish' });
    const bytes = await finishP;
    if (!bytes || failed) throw new Error('encode');
    download(new Blob([bytes], { type: 'image/gif' }), `${name}_crt.gif`);
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
});

// ---- 起動：テスト模様 ----
{
  const t = makeTestPattern();
  resize();
  state.orig = { w: t.w, h: t.h, name: 'testpattern', data: t.data };
  applyStill(true);
}
