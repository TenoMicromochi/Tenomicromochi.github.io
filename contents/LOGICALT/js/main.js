// main.js — 組み立て・STOP/RUN/PAUSE/STEP・メインループ・UI 配線
import { M, MAT_NAMES } from './materials.js';
import { World, inCanvas } from './world.js';
import { rebuild } from './topology.js';
import { computeSignals, tick, initState } from './sim.js';
import { Renderer } from './render.js';
import { Editor } from './tools.js';
import { initInput } from './input.js';
import { drawGrid, drawHighlight, placeSelSize } from './overlays.js';
import { buildDock, makeSlider, syncDock } from './dock.js';
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
let tps = 10, tickAcc = 0;          // tickAcc = まだ消化していないティック数（小数）
let tickCount = 0;
let glow = 1;
let otherPct = 30;                  // もう一方の面の透明度（0〜100%）
let netHl = false;
const grid = { on: false, w: 8, h: 8 };
let tpsCount = 0, tpsStamp = performance.now(), tpsShown = 0;
let needDraw = true, drawnVersion = -1;
let unknownCount = 0;

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
  if (netHl) drawHighlight(ctx, r, world, editor.cursor, editor.layer);
  editor.overlay(ctx, r);
  placeSelSize(r, editor.pasting ? null : editor.selInfo());
}

// 画面の状態をドックとシステムバーに反映する（差分だけ書く）。ボタンの暗さ・選択・ステータスのすべて
function updateInfo() {
  const c = editor.cursor;
  let xy = 'X - Y -', name = '-';
  if (c.x >= 0) {
    xy = `X ${c.x} Y ${c.y}`;
    name = inCanvas(c.x, c.y) ? MAT_NAMES[world.mat[editor.cell(c.x, c.y)]] : 'OUT';
  }
  syncDock({
    mode, tick: tickCount, edit: canEdit(), selSize: editor.selInfo(),
    mat: editor.mat, lampColor: editor.lampColor, shape: editor.shape, hollow: editor.hollow, autoCross: editor.autoCross,
    scope: editor.scope, layer: editor.layer, pasteMode: editor.pasteMode, pasting: editor.pasting, sel: editor.sel,
    canUndo: editor.undoStack.length > 0, canRedo: editor.redoStack.length > 0,
    glow, scale: renderer.view.scale, otherPct, xy, matName: name, tps, saveText: auto.statusText(), unknown: unknownCount,
  });
}

function requestDraw() { needDraw = true; }

// ---------- 表示の範囲・ズーム ----------
// 見える範囲 = キャンバスの部分（下部バーは別の要素なので含まない）。canvas 実ピクセル
function visibleRect() { return { cx: canvas.width / 2, cy: canvas.height / 2, w: canvas.width, h: canvas.height }; }
const visibleCenter = () => { const v = visibleRect(); return [v.cx, v.cy]; };
let pendingCenter = null; // レイアウト確定後に最初の中心を当てる
function fitCanvas() {
  const stack = $('canvasStack');
  // 画面中央のセルを保ったままサイズを変える
  const v = renderer.view, cw = canvas.width, ch = canvas.height;
  const cx = (cw / 2 - v.panX) / v.ds, cy = (ch / 2 - v.panY) / v.ds;
  renderer.resize(stack.clientWidth, stack.clientHeight);
  if (pendingCenter && stack.clientWidth > 1 && stack.clientHeight > 1) {
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
  if (!center) return;
  rebuildNow();
  pendingCenter = center; fitCanvas();
}

// ---------- 編集の操作 ----------
const clampTps = (v) => Math.max(1, Math.min(2048, Math.round(+v) || 1));
const tpsFromSlider = (v) => clampTps(2 ** (v / 100));
let tpsSlider = null, otherSlider = null;
function setTps(v) {
  tps = clampTps(v);
  if (tpsSlider) tpsSlider.set(Math.log2(tps) * 100);
  $('tpsN').value = tps; updateInfo();
}
function setOther(v) {
  otherPct = Math.max(0, Math.min(100, Math.round(+v) || 0));
  if (otherSlider) otherSlider.set(otherPct);
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

// ---------- UI の配線 ----------
const onClick = (id, fn) => $(id).addEventListener('click', fn);
// ボタンの列（.b を並べた要素）で、押されたボタンを fn に渡す。skipDisabled = false なら無効のボタンも通す
function onPick(id, fn, { selector = '.b', skipDisabled = true } = {}) {
  onClick(id, (e) => {
    const b = e.target.closest(selector);
    if (!b || (skipDisabled && b.disabled)) return;
    fn(b);
  });
}
const redrawUi = () => { updateInfo(); requestDraw(); };

const { savePng, saveSel, loadFile, loadModule } = createFileIo({
  world, editor, renderer, toast, canEdit, rebuildNow, visibleCenter,
  setUnknown: (n) => { unknownCount = n; },
  redraw: redrawUi,
});

function wireUi() {
  buildDock();
  tpsSlider = makeSlider($('tpsSld'), (v) => { tps = tpsFromSlider(v); $('tpsN').value = tps; updateInfo(); });
  otherSlider = makeSlider($('otherSld'), setOther);
  otherSlider.set(otherPct);

  onPick('matRow', (b) => { editor.setMat(+b.dataset.mat); redrawUi(); });
  onPick('lampRow', (b) => { editor.lampColor = +b.dataset.lamp; editor.setMat(M.LAMP); redrawUi(); }, { selector: '.sw' });
  for (const id of ['shapeRow', 'shape2Row']) onPick(id, (b) => { editor.setShape(b.dataset.shape); redrawUi(); });

  // SETTINGS の引き出し：開閉の状態は STOP / RUN をまたいで保つ（hidden 属性だけが持つ）
  const toggleDrawer = (open) => { $('drawer').hidden = !open; $('settingsBtn').classList.toggle('active', open); };
  onClick('settingsBtn', () => toggleDrawer($('drawer').hidden));
  onClick('drawerClose', () => toggleDrawer(false));
  onPick('fillSeg', (b) => { editor.hollow = b.dataset.hollow === '1'; updateInfo(); });
  onPick('layerSeg', (b) => setLayer(+b.dataset.layer), { skipDisabled: false });
  onPick('scopeSeg', (b) => { editor.scope = b.dataset.scope; updateInfo(); });
  $('autoCross').addEventListener('change', (e) => { editor.autoCross = e.target.checked; updateInfo(); });
  // ALL / CIRCUIT：EDIT パネルと貼り付けバーのどちらで選んでも同じ設定
  for (const id of ['pasteModeSeg', 'editModeSeg']) onPick(id, (b) => { editor.pasteMode = b.dataset.mode; redrawUi(); });
  onClick('cancelPasteBtn', () => { editor.cancelPaste(); redrawUi(); });
  onPick('glowSeg', (b) => { glow = +b.dataset.glow; redrawUi(); }, { skipDisabled: false });

  const runActions = { RUN: run, PAUSE: pause, STOP: stop, STEP: stepOnce };
  document.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', () => runActions[b.dataset.run]()));
  onClick('undoBtn', undo);
  onClick('redoBtn', redo);
  onClick('fitAllBtn', fitAll);
  onClick('zoomSelBtn', zoomSel);
  onClick('copyBtn', () => { editor.copy(); requestDraw(); });
  onClick('cutBtn', () => { if (canEdit()) { editor.cut(); requestDraw(); } });
  onClick('delBtn', () => { if (canEdit()) { editor.del(); requestDraw(); } });
  onClick('pasteBtn', () => {
    if (!canEdit()) return;
    if (editor.pasting) editor.cancelPaste(); else editor.startPaste();
    redrawUi();
  });
  for (const [id, op] of [['rotCwBtn', 'cw'], ['rotCcwBtn', 'ccw'], ['flipHBtn', 'fh'], ['flipVBtn', 'fv']]) {
    onClick(id, () => { if (canEdit()) { editor.transform(op); requestDraw(); } });
  }

  onClick('saveSelBtn', saveSel);
  onClick('saveBtn', savePng);
  onClick('loadBtn', () => { if (canEdit()) $('fileInput').click(); });
  onClick('loadModBtn', () => { if (canEdit()) $('modInput').click(); });
  for (const [inputId, load] of [['fileInput', loadFile], ['modInput', loadModule]]) {
    $(inputId).addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) load(file);
    });
  }

  $('tpsN').addEventListener('input', () => { if ($('tpsN').value !== '') setTps($('tpsN').value); });
  $('tpsN').addEventListener('blur', () => { $('tpsN').value = tps; });
  for (const id of ['tpsN', 'gridW', 'gridH']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('gridOn').addEventListener('change', (e) => { grid.on = e.target.checked; requestDraw(); });
  for (const [id, key] of [['gridW', 'w'], ['gridH', 'h']]) {
    const el = $(id);
    el.addEventListener('input', () => {
      if (el.value === '') return;
      grid[key] = Math.max(1, Math.min(256, Math.round(+el.value) || 1));
      requestDraw();
    });
    el.addEventListener('blur', () => { el.value = grid[key]; });
  }
  $('netHl').addEventListener('change', (e) => { netHl = e.target.checked; requestDraw(); });

  document.querySelectorAll('button').forEach((b) => b.addEventListener('pointerup', () => b.blur()));
  new ResizeObserver(fitCanvas).observe($('canvasStack'));
  window.addEventListener('resize', fitCanvas);
  // ウィンドウのどこに PNG を落としても、ブラウザが画像を開いてしまわないようにする
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}

// ---------- 起動 ----------
// demos.js と debug.js は、確認用なので ?demo=… があるとき（debug.js は ?debug=1 でも）だけ読み込む
const DEMO_SCALE_IDX = { stress: 1, layers: 5 };   // 倍率の添字（既定は 4）

async function boot() {
  wireUi();
  fitCanvas();
  renderer.setScaleIdx(2, null); // x4
  pendingCenter = { x: 2048, y: 2048 };
  initInput({ canvas, renderer, editor, canEdit, toggleLayer, toggleRunAt, toggleInitialAt, undo, redo, requestDraw, updateInfo, fitAll, zoomSel, loadModule });

  const demos = demo ? await import('./demos.js').catch(() => null) : null;   // 無くてもアプリは動く（サイト版には入れない）
  const focus = demos && Object.hasOwn(demos.DEMOS, demo) ? demos.DEMOS[demo](world) : null;
  if (!focus) await restoreAutosave();
  if (auto.enabled) auto.warm();
  if (params.get('layer') === 'back') editor.layer = 1; // 確認用：?layer=back で BACK を作業面にして始める
  if (focus) {
    renderer.setScaleIdx(DEMO_SCALE_IDX[demo] ?? 4, null);
    pendingCenter = { x: focus.cx, y: focus.cy }; fitCanvas();
  }
  setTps(tps);
  if (params.get('tps')) setTps(params.get('tps'));
  if (params.get('run') === '1') run();
  if (!demo && !auto.savedAt) auto.markSaved();
  updateInfo();
  if (demo || params.get('debug') === '1') await import('./debug.js').then((m) => m.installDebugHooks(debugApp), () => {});
  requestAnimationFrame(frame);
}

const debugApp = {
  world, editor, renderer, grid, auto,
  rebuildNow, stepOnce, run, pause, stop, setTps, fitAll, zoomSel, loadModule, saveSel, loadFile, savePng, restoreAutosave,
  setLayer, toggleLayer, setOther, toggleRunAt, toggleInitialAt, canEdit,
  get topo() { return topo; },
  get mode() { return mode; },
  get tickCount() { return tickCount; },
  get tpsShown() { return tpsShown; },
  get glow() { return glow; },
  get otherPct() { return otherPct; },
};
boot();
