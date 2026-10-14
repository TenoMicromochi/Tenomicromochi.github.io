// main.js — 組み立て・STOP/RUN/PAUSE/STEP・メインループ。画面の欄は ui.js（app を渡して、描画のたびに sync を呼ぶ）
import { M, MAT_NAMES } from './materials.js';
import { World, inCanvas } from './world.js';
import { rebuild } from './topology.js';
import { computeSignals, tick, initState } from './sim.js';
import { Renderer } from './render.js';
import { Editor } from './tools.js';
import { initInput } from './input.js';
import { drawGrid, drawHighlight, placeSelSize } from './overlays.js';
import { createUi } from './ui.js';
import { createAutosave } from './autosave.js';
import { createFileIo } from './fileio.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const demo = params.get('demo');

const world = new World();
const canvas = $('screen');
const renderer = new Renderer(canvas);
const editor = new Editor(world, { onMessage: (s) => toast(s) });
const auto = createAutosave(world, { enabled: !demo, onSaved: () => updateInfo() });

let topo = null;
let mode = 'STOP'; // 'STOP' | 'RUN' | 'PAUSE'
const canEdit = () => mode === 'STOP';
const canDraw = () => canEdit() && renderer.view.n === 1;   // 縮小中（x0.5 以下）は描けない
let tps = 16, tickAcc = 0;          // tickAcc = まだ消化していないティック数（小数）
let tickCount = 0;
let glow = 50;                      // GLOW 0〜100%（0 = Off）
let otherPct = 30;                  // もう一方の面の透明度（0〜100%）
let netHl = false;
const grid = { on: false, w: 8, h: 8, showFrom: 4 };   // showFrom = この倍率以上でだけ線を出す（x1 / x2 / x4 / x8）
let full = false;                   // 全画面（Fullscreen API か、ブラウザ自身の F11）
editor.view = renderer.view; editor.grid = grid;
let tpsCount = 0, tpsStamp = performance.now(), tpsShown = 0;
let needDraw = true, drawnVersion = -1;
let unknownCount = 0;
let ui = null;                      // ui.js（boot で作る）

// ---------- 通知 ----------
let toastTimer = 0;
function toast(text, kind = 'ok') {
  const el = $('toast');
  el.textContent = text; el.className = 'toast ' + kind; el.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3500);
}

// ---------- トポロジー ----------
function rebuildNow() {
  if (!world.dirty && topo) return;
  topo = rebuild(world); // 初期状態（initState）まで済ませる
  if (world.nonEmpty >= 1000 || window.__pc?.verbose) {
    console.log(`[topology] rebuild ${topo.ms.toFixed(1)} ms (${world.nonEmpty} cells, ${topo.netCount} nets, ${topo.gateCount} gates)`);
  }
}

// ---------- STOP / RUN / PAUSE / STEP ----------
// STOP の間は、world のセルがそのまま初期状態。実行中の状態（ゲートの出力）は topo だけが持つので、
// STOP は topo を初期状態へ戻すだけでセルの状態に戻る。
function enterRun() {
  editor.cancelPaste(); editor.cancelDrag();
  rebuildNow(); initState(topo, world);
  tickCount = 0; tickAcc = 0; tpsCount = 0; tpsStamp = performance.now();
  if (auto.enabled) auto.saveQuietly();
}
function run() {
  if (mode === 'RUN') return;
  if (mode === 'STOP') enterRun();
  mode = 'RUN'; tickAcc = 0; tpsCount = 0; tpsStamp = performance.now();
  needDraw = true; updateInfo();
}
function pause() {
  if (mode !== 'RUN') return;
  mode = 'PAUSE'; updateInfo();
}
function stop() {
  if (mode === 'STOP') return;
  mode = 'STOP';
  rebuildNow(); initState(topo, world);
  tickCount = 0; tickAcc = 0; needDraw = true; updateInfo();
}
// PLAY に入ったとき：最初の状態（TICK 0）で止まる。Run で動き出す
function enterPause() {
  if (mode !== 'STOP') return;
  enterRun(); mode = 'PAUSE'; needDraw = true; updateInfo();
}
function stepOnce() {
  if (mode === 'RUN') return;
  if (mode === 'STOP') { enterRun(); mode = 'PAUSE'; updateInfo(); }
  tick(topo, world);
  tickCount++; tpsCount++; needDraw = true;
}

// ---------- 描画・ループ ----------
// LAMP の残光を dt ミリ秒ぶん進める。まだ消えきっていないものがあれば true
function updateFades(dt) {
  if (!topo || world.dirty) return false;
  const { lampGates, gateFade, gateOut } = topo;
  let fading = false;
  const decay = dt / 200;
  for (let k = 0; k < lampGates.length; k++) {
    const g = lampGates[k];
    if (gateOut[g]) gateFade[g] = 1;
    else if (gateFade[g] > 0) { gateFade[g] = Math.max(0, gateFade[g] - decay); fading = true; }
  }
  return fading;
}

let lastStepAt = performance.now(), lastFrameAt = 0;
function frame(now) {
  lastFrameAt = now;
  step(now);
  requestAnimationFrame(frame);
}
// rAF が止まる環境（非表示ペインなど）でも進むように、止まっている間だけタイマーで代行する
setInterval(() => {
  const now = performance.now();
  if (now - lastFrameAt > 120) { lastFrameAt = now - 100; step(now); }
}, 50);

function step(now) {
  const dt = Math.max(0, Math.min(100, now - lastStepAt)); lastStepAt = now;
  if (world.dirty) rebuildNow();
  if (mode === 'RUN' && topo) {
    tickAcc += dt * tps / 1000;
    let n = Math.floor(tickAcc); tickAcc -= n;
    const t0 = performance.now();
    while (n-- > 0) {
      tick(topo, world); tickCount++; tpsCount++;
      if (performance.now() - t0 > 12) { tickAcc = 0; break; }   // 重い回路は 1 フレームに使う時間を 12ms までにする
    }
    needDraw = true;
  }
  if (updateFades(dt)) needDraw = true;
  if (world.version !== drawnVersion) needDraw = true;

  if (now - tpsStamp >= 500) {
    tpsShown = Math.round(tpsCount * 1000 / (now - tpsStamp));
    tpsCount = 0; tpsStamp = now; updateInfo();
  }
  if (needDraw) {
    needDraw = false; drawnVersion = world.version;
    renderer.draw(world, topo, glow, editor.layer, otherPct, drawOverlays, canEdit());
    updateInfo();
  }
  if (auto.enabled) auto.tick(now);
}
function drawOverlays(ctx, r) {
  drawGrid(ctx, r, grid);
  if (netHl && r.view.n === 1) drawHighlight(ctx, r, world, editor.cursor, editor.layer);
  editor.overlay(ctx, r);
  placeSelSize(r, editor.pasting ? null : editor.selInfo());
}

// 今の状態をまとめて ui.js に渡す（ui.js は差分だけ書く）
function updateInfo() {
  if (!ui) return;
  const c = editor.cursor;
  const onCanvas = c.x >= 0 && inCanvas(c.x, c.y);
  ui.sync({
    mode, edit: canEdit(), tick: tickCount, tps, glow, otherPct, netHl, grid,
    mat: editor.mat, lampColor: editor.lampColor, shape: editor.shape, hollow: editor.hollow, autoCross: editor.autoCross,
    scope: editor.scope, layer: editor.layer, pasteMode: editor.pasteMode, pasting: editor.pasting, sel: editor.sel,
    canUndo: editor.undoStack.length > 0, canRedo: editor.redoStack.length > 0, hasClip: !!editor.clip,
    scale: renderer.view.scale, zoomOut: renderer.view.n > 1, full, shiftSnap: editor.shiftSnap,
    cursor: c.x >= 0 ? { x: c.x, y: c.y } : null,
    cursorMatName: c.x < 0 ? '-' : onCanvas ? MAT_NAMES[world.mat[editor.cell(c.x, c.y)]] : 'OUT',
    saveText: auto.statusText(), unknown: unknownCount,
  });
}

function requestDraw() { needDraw = true; }

// ---------- 表示の範囲・ズーム ----------
// 見える範囲 = キャンバスの部分（下部バーは別の要素なので含まない）。canvas 実ピクセル
function visibleRect() { return { cx: canvas.width / 2, cy: canvas.height / 2, w: canvas.width, h: canvas.height }; }
const visibleCenter = () => { const v = visibleRect(); return [v.cx, v.cy]; };
let pendingCenter = null; // レイアウト確定後に最初の中心を当てる
let pendingFit = false;   // レイアウト確定後に、使っているセル全体へ画面を合わせる（サンプルを置いたとき）
function fitCanvas() {
  const stack = $('canvasStack');
  // 画面中央のセルを保ったままサイズを変える
  const v = renderer.view, cw = canvas.width, ch = canvas.height;
  const cx = (cw / 2 - v.panX) / v.ds * v.n, cy = (ch / 2 - v.panY) / v.ds * v.n;
  renderer.resize(stack.clientWidth, stack.clientHeight);
  const laidOut = stack.clientWidth > 1 && stack.clientHeight > 1;
  if (pendingFit && laidOut) {
    pendingFit = false; pendingCenter = null;
    fitAll();
  } else if (pendingCenter && laidOut) {
    renderer.centerOn(pendingCenter.x, pendingCenter.y, ...visibleCenter());
    pendingCenter = null;
  } else if (cw > 1 && ch > 1) renderer.centerOn(cx - 0.5, cy - 0.5);
  needDraw = true;
}

// FIT ALL：使っているセル全体を、キャンバスの見える範囲に収める
function fitAll() {
  const b = world.bounds();
  if (!b) renderer.centerOn(2048, 2048, ...visibleCenter());
  else renderer.fitRect(b.x0, b.y0, b.w, b.h, visibleRect());
  requestDraw(); updateInfo();
}
// ZOOM SEL：選択範囲に対して同じことをする
function zoomSel() {
  const s = editor.sel; if (!s) return;
  renderer.fitRect(s.x0, s.y0, s.x1 - s.x0 + 1, s.y1 - s.y0 + 1, visibleRect());
  requestDraw(); updateInfo();
}

// 起動時：自動保存してあったものを読み込む
async function restoreAutosave() {
  const center = await auto.restore(editor);
  if (!center) return false;
  rebuildNow();
  pendingCenter = center; fitCanvas();
  return true;
}

// ---------- 編集の操作 ----------
const clampTps = (v) => Math.max(1, Math.min(2048, Math.round(+v) || 1));
function setTps(v) { tps = clampTps(v); updateInfo(); }
function setOther(v) {
  otherPct = Math.max(0, Math.min(100, Math.round(+v) || 0));
  requestDraw(); updateInfo();
}

function undo() { if (!canEdit()) return; editor.undo(); requestDraw(); updateInfo(); }
function redo() { if (!canEdit()) return; editor.redo(); requestDraw(); updateInfo(); }

// RUN / PAUSE：T-FF の今の状態を切り替える（初期状態は変わらない）
function toggleRunAt(x, y) {
  if (!inCanvas(x, y)) return;
  rebuildNow();
  const i = editor.cell(x, y);
  if (world.mat[i] !== M.TFF) return;
  topo.gateOut[topo.bodyGate[world.owner[i]]] ^= 1;
  computeSignals(topo, world);
  requestDraw();
}
// STOP：T-FF の塊全体の初期状態を切り替える（1手として UNDO できる）
function toggleInitialAt(x, y) {
  if (!canEdit() || !inCanvas(x, y)) return;
  rebuildNow();
  const i = editor.cell(x, y);
  if (world.mat[i] !== M.TFF) return;
  const gate = topo.bodyGate[world.owner[i]], newState = topo.gateOut[gate] ^ 1;
  world.beginRecord();
  for (let b = 0; b < topo.bodyCnt; b++) {
    if (topo.bodyGate[b] === gate) world.edit(topo.bodyCells[b], M.TFF, newState);
  }
  editor.pushHistory(world.endRecord());
  requestDraw();
}

// 作業面の切り替え（Tab）。UNDO の対象外
function setLayer(layer) {
  if (editor.layer === layer) return;
  editor.cancelDrag();
  editor.layer = layer;
  updateInfo(); requestDraw();
}
const toggleLayer = () => setLayer(editor.layer ^ 1);

// ---------- ui.js に渡す窓口 ----------
const redrawUi = () => { updateInfo(); requestDraw(); };

const { savePng, saveSel, loadFile, loadModule, placeSample, resetToSample } = createFileIo({
  world, editor, renderer, toast, canEdit, rebuildNow, visibleCenter, fitAll,
  setUnknown: (n) => { unknownCount = n; },
  redraw: redrawUi,
});
// ファイルを選ぶ窓を開く（input 要素はその場で作る）
function pickFile(onFile) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/png';
  input.addEventListener('change', () => { const file = input.files[0]; if (file) onFile(file); });
  input.click();
}
// ---------- 全画面 ----------
// Fullscreen API（ボタン・F11）か、ブラウザ自身の全画面（F11 をページが受け取れなかったとき）。どちらでも同じ見た目：サイト版の上部タブを隠す
const fsMedia = window.matchMedia('(display-mode: fullscreen)');   // ブラウザ自身の F11 全画面
function checkFull() {
  const f = !!document.fullscreenElement || fsMedia.matches;
  if (f === full) return;
  full = f;
  document.body.dataset.full = f ? '1' : '';
  fitCanvas(); updateInfo();
}
function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (full) { /* ブラウザ自身の全画面：ページからは抜けられない（F11 で戻る） */ }
  else document.documentElement.requestFullscreen().catch(() => {});
}
document.addEventListener('fullscreenchange', checkFull);
fsMedia.addEventListener('change', checkFull);

// 画面中央を動かさずに倍率を1段変える
function zoomBy(d) { renderer.setScaleIdx(renderer.view.scaleIdx + d, { sx: canvas.width / 2, sy: canvas.height / 2 }); redrawUi(); }

const app = {
  M, grid,
  get mode() { return mode; }, canEdit,
  run, pause, stop, step: stepOnce,
  setTps, setOther, setLayer, toggleLayer, undo, redo, fitAll, zoomSel, zoomBy,
  setGlow(v) { glow = Math.max(0, Math.min(100, Math.round(+v) || 0)); redrawUi(); },
  setNetHl(v) { netHl = !!v; redrawUi(); },
  setShowFrom(v) { grid.showFrom = v; redrawUi(); },
  setShiftSnap(v) { editor.shiftSnap = !!v; redrawUi(); },
  toggleFull,
  enterPause,
  setGrid(on, w, h) {
    grid.on = !!on;
    if (w) grid.w = Math.max(1, Math.min(256, Math.round(w)));
    if (h) grid.h = Math.max(1, Math.min(256, Math.round(h)));
    redrawUi();
  },
  setMat(m) { if (canDraw()) { editor.setMat(m); redrawUi(); } },
  setLamp(c) { if (canDraw()) { editor.lampColor = c; editor.setMat(M.LAMP); redrawUi(); } },
  setShape(s) { if (canDraw()) { editor.setShape(s); redrawUi(); } },
  setHollow(v) { editor.hollow = !!v; redrawUi(); },
  setScope(s) { editor.scope = s; redrawUi(); },
  setPasteMode(m) { editor.pasteMode = m; redrawUi(); },
  setAutoCross(v) { editor.autoCross = !!v; redrawUi(); },
  copy() { editor.copy(); redrawUi(); },
  cut() { if (canEdit()) { editor.cut(); redrawUi(); } },
  del() { if (canEdit()) { editor.del(); redrawUi(); } },
  paste() { if (canEdit()) { editor.startPaste(); redrawUi(); } },
  cancelPaste() { editor.cancelPaste(); redrawUi(); },
  transform(op) { if (canEdit()) { editor.transform(op); redrawUi(); } },
  savePng, saveSel,
  openLoad() { if (canEdit()) pickFile(loadFile); },
  openModule() { if (canEdit()) pickFile(loadModule); },
  reset: resetToSample,
  redraw: redrawUi,
};

function wireUi() {
  ui = createUi(app);
  // ボタンを押したあとにフォーカスを残さない（Space や Enter でもう一度押されないように）
  document.addEventListener('pointerup', (e) => { const b = e.target.closest && e.target.closest('button'); if (b) b.blur(); });
  new ResizeObserver(fitCanvas).observe($('canvasStack'));
  window.addEventListener('resize', fitCanvas);
  // ウィンドウのどこに PNG を落としても、ブラウザが画像を開いてしまわないようにする
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}

// ---------- 起動 ----------
// demos.js と debug.js は、確認用なので ?demo=… があるとき（debug.js は ?debug=1 でも）だけ読み込む
const DEMO_SCALE_IDX = { stress: 4, layers: 8 };   // 倍率の添字（x2 / x32。既定は 7 = x16）

async function boot() {
  wireUi();
  fitCanvas();
  renderer.setScaleIdx(5, null); // x4
  pendingCenter = { x: 2048, y: 2048 };
  initInput({ canvas, renderer, editor, canEdit, toggleLayer, toggleRunAt, toggleInitialAt, undo, redo, requestDraw, updateInfo, fitAll, zoomSel, loadModule, toggleFull });

  const demos = demo ? await import('./demos.js').catch(() => null) : null;   // 無くてもアプリは動く（サイト版には入れない）
  const focus = demos && Object.hasOwn(demos.DEMOS, demo) ? demos.DEMOS[demo](world) : null;
  // 自動保存があればそれを復元し、無ければ（初めて開いたとき）サンプルを置く。?demo=… のときは置かない
  if (!focus && !(await restoreAutosave()) && !demo) {
    await placeSample(() => { pendingFit = true; fitCanvas(); });
  }
  if (auto.enabled) auto.warm();
  if (params.get('layer') === 'back') editor.layer = 1; // 確認用：?layer=back で BACK を作業面にして始める
  if (focus) {
    renderer.setScaleIdx(DEMO_SCALE_IDX[demo] ?? 7, null);
    pendingCenter = { x: focus.cx, y: focus.cy }; fitCanvas();
  }
  setTps(tps);
  if (params.get('tps')) setTps(params.get('tps'));
  if (params.get('run') === '1') run();
  checkFull();
  if (!demo && !auto.savedAt) auto.markSaved();
  updateInfo();
  if (demo || params.get('debug') === '1') await import('./debug.js').then((m) => m.installDebugHooks(debugApp), () => {});
  requestAnimationFrame(frame);
}

const debugApp = {
  world, editor, renderer, grid, auto,
  rebuildNow, stepOnce, run, pause, stop, setTps, fitAll, zoomSel, loadModule, saveSel, loadFile, savePng, restoreAutosave,
  setLayer, toggleLayer, setOther, toggleRunAt, toggleInitialAt, canEdit, enterPause,
  setGlow: app.setGlow,
  get topo() { return topo; },
  get mode() { return mode; },
  get tickCount() { return tickCount; },
  get tpsShown() { return tpsShown; },
  get glow() { return glow; },
  get otherPct() { return otherPct; },
};
boot();
