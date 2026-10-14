// ui.js — 画面の欄（UX 2A）：BUILD / PLAY / FILE の場面ごとに下の欄を丸ごと切り替える。
// 操作は main.js の app を呼ぶだけ。sync(s) は描画のたびに呼ばれ、差分だけ書く。
import { $, $$, setText, setDis, setCls, setHidden, MATS, SHAPES, matButton, initHints, makeSlider, tpsToSlider, sliderToTps,
  btn, LAMP_ON, LAMP_NAMES, hex, matKey } from './uikit.js';

export function createUi(app) {
  const { M } = app;
  let cur = null, tab = 'BUILD';

  // ---- 場面の切り替え ----
  // BUILD に戻る = STOP（最初の状態へ）、PLAY に入る = PAUSE（TICK 0 の最初の状態で止まる。Run で動き出す）。FILE は今の状態のまま
  function setTab(t) {
    tab = t;
    if (t === 'BUILD') app.stop();
    if (t === 'PLAY' && app.mode === 'STOP') app.enterPause();
    app.redraw();
  }
  for (const b of $$('.tab')) b.addEventListener('click', () => setTab(b.dataset.tab));

  // ---- 欄の開け閉め（下の帯の左端）。閉じてもタブと状態はそのまま ----
  const deckTgl = $('deckTgl');
  function setDeck(open) {
    document.body.dataset.deck = open ? 'open' : 'closed';
    deckTgl.textContent = open ? '▼ CLOSE' : '▲ OPEN';
  }
  deckTgl.addEventListener('click', () => setDeck(document.body.dataset.deck === 'closed'));
  setDeck(true);

  const seg = (items, key) => {
    const s = document.createElement('span'); s.className = 'seg';
    for (const [label, val, hint, fn] of items) { const b = btn(label, hint, fn); b.dataset.on = `${key}=${val}`; s.append(b); }
    return s;
  };
  const label = (t) => Object.assign(document.createElement('span'), { className: 'sub', textContent: t });

  // ---- BUILD：1. 部品 ----
  const parts = $('parts');
  for (const info of MATS) {
    const b = matButton(info);
    b.prepend(Object.assign(document.createElement('span'), { className: 'k', textContent: String(matKey(info.m)) }));
    b.append(document.createTextNode(info.name));
    b.addEventListener('click', () => app.setMat(info.m));
    parts.append(b);
  }
  const lamps = $('lamps');
  LAMP_ON.forEach((c, k) => {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.lamp = k; b.dataset.hint = `LAMP ${LAMP_NAMES[k]}` + (k === 0 ? '  [8]' : '');
    b.innerHTML = `<i style="background:${hex(c)}"></i>`;
    b.addEventListener('click', () => app.setLamp(k));
    lamps.append(b);
  });

  // ---- BUILD：2. 描き方 ----
  const shapes = $('shapes');
  for (const sh of SHAPES) { const b = btn('ic:' + sh.ic, `${sh.s}  - ${sh.say.toUpperCase()}`, () => app.setShape(sh.s)); b.dataset.shape = sh.s; shapes.append(b); }
  // RECT / CIRCLE のときは FILLED / OUTLINE、PEN / LINE のときは AUTO CROSS を出す（同じ場所）
  const fillSeg = seg([['Filled', 'false', 'RECT / CIRCLE FILLED', () => app.setHollow(false)], ['Outline', 'true', 'RECT / CIRCLE OUTLINE ONLY', () => app.setHollow(true)]], 'hollow');
  $('shapeOpt').prepend(fillSeg);
  $('autoCross').addEventListener('change', (e) => app.setAutoCross(e.target.checked));

  // ---- BUILD：3. 変更 ----
  const E = {
    undo: btn('ic:undo', 'UNDO  [CTRL+Z]', app.undo), redo: btn('ic:redo', 'REDO  [CTRL+Y]', app.redo),
    copy: btn('ic:copy', 'COPY THE SELECTION  [CTRL+C]', app.copy), cut: btn('ic:cut', 'CUT  [CTRL+X]', app.cut),
    paste: btn('ic:paste', 'PASTE  [CTRL+V]', app.paste),
    del: btn('ic:trash', 'DELETE THE SELECTION  [DEL]', app.del),
    rcw: btn('ic:rotcw', 'ROTATE RIGHT  [R]', () => app.transform('cw')), rccw: btn('ic:rotccw', 'ROTATE LEFT  [SHIFT+R]', () => app.transform('ccw')),
    fh: btn('ic:fliph', 'FLIP LEFT-RIGHT  [F]', () => app.transform('fh')), fv: btn('ic:flipv', 'FLIP UP-DOWN  [SHIFT+F]', () => app.transform('fv')),
    done: btn('Done placing', 'STOP PLACING  [R-CLICK]', app.cancelPaste),
  };
  $('editRow').append(E.undo, E.redo, E.copy, E.cut, E.paste, E.del, E.rcw, E.rccw, E.fh, E.fv);
  $('editRow2').append(
    label('Move/paste'),
    seg([['All', 'ALL', 'MOVE / PASTE EVERYTHING, EMPTY CELLS TOO', () => app.setPasteMode('ALL')], ['Circuit', 'CIRCUIT', 'MOVE / PASTE ONLY NON-EMPTY CELLS', () => app.setPasteMode('CIRCUIT')]], 'pasteMode'),
    label('Select'),
    seg([['Both', 'BOTH', 'SELECTION TAKES FRONT AND BACK', () => app.setScope('BOTH')], ['This', 'ACTIVE', 'SELECTION TAKES THE LAYER YOU WORK ON', () => app.setScope('ACTIVE')]], 'scope'),
    E.done,
  );

  // ---- BUILD：面と表示 ／ PLAY：面 ----
  for (const id of ['layerSeg', 'layerSeg2']) {
    ['FRONT', 'BACK'].forEach((n, l) => { const b = btn(n, `WORK ON ${n}  [TAB]`, () => app.setLayer(l)); b.dataset.layer = l; $(id).append(b); });
  }
  const otherSld = makeSlider($('otherSld'), 100, (v) => app.setOther(v));
  $('otherSld').dataset.hint = 'OTHER LAYER  - HOW MUCH YOU SEE OF THE OTHER LAYER  0 - 100%';
  const otherSld2 = makeSlider($('otherSld2'), 100, (v) => app.setOther(v));   // PLAY の Look 欄の Other（BUILD の Other と同じ値）
  $('otherSld2').dataset.hint = $('otherSld').dataset.hint;
  $('netHl').addEventListener('change', (e) => app.setNetHl(e.target.checked));
  $('gridOn').addEventListener('change', (e) => app.setGrid(e.target.checked));
  for (const [id, key] of [['gridW', 'w'], ['gridH', 'h']]) {
    const el = $(id); el.value = app.grid[key];
    // ▲▼：クリックで ±1（1〜256）
    const spin = document.createElement('span'); spin.className = 'spin';
    for (const [t, d] of [['▲', 1], ['▼', -1]]) {
      const b = btn(t, `${key === 'w' ? 'GRID WIDTH' : 'GRID HEIGHT'}  ${d > 0 ? '+1' : '-1'}`, () => app.setGrid(app.grid.on, key === 'w' ? app.grid.w + d : 0, key === 'h' ? app.grid.h + d : 0));
      b.classList.remove('b'); spin.append(b);
    }
    $(id + 'Box').append(spin);
    el.addEventListener('input', () => { if (el.value) app.setGrid(app.grid.on, key === 'w' ? +el.value : 0, key === 'h' ? +el.value : 0); });
    el.addEventListener('blur', () => { el.value = app.grid[key]; });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
  }

  // Show from（この倍率以上でだけグリッドの線）／ Shift（BUILD の範囲選択）／ Full screen
  const fromSeg = seg([1, 2, 4, 8].map((v) => ['x' + v, v, `GRID LINES ONLY AT x${v} AND ABOVE`, () => app.setShowFrom(v)]), 'showFrom');
  $('showFromRow').append(Object.assign(label('Show from'), { className: 'sub w2' }), fromSeg);
  const shiftSeg = seg([['Square', 'false', 'SHIFT+DRAG SELECTS A SQUARE', () => app.setShiftSnap(false)], ['Grid snap', 'true', 'SHIFT+DRAG SELECTS WHOLE GRID CELLS (WHEN GRID IS ON)', () => app.setShiftSnap(true)]], 'shiftSnap');
  $('shiftRow').append(Object.assign(label('Shift'), { className: 'sub w2' }), shiftSeg);
  const fullBtns = [0, 1].map(() => btn('Full screen', 'FULL SCREEN  [F11]', app.toggleFull));
  $('fullRow').append(fullBtns[0]); $('fullRow2').append(fullBtns[1]);

  // ---- PLAY ----
  const runRow = $('runRow');
  for (const [k, text, hint, fn] of [['RUN', 'Run', 'RUN THE CIRCUIT', app.run], ['PAUSE', 'Pause', 'PAUSE', app.pause],
    ['STEP', 'Step', 'ADVANCE 1 TICK', app.step], ['STOP', 'To start', 'BACK TO THE START STATE (STAYS IN PLAY)', app.stop]]) {
    const b = btn(text, hint, fn); b.dataset.run = k; runRow.append(b);
  }
  const tpsN = $('tpsN');
  const tpsSld = makeSlider($('tpsSld'), 1100, (v) => app.setTps(sliderToTps(v)));
  $('tpsSld').dataset.hint = 'SPEED  1 - 2048 TICKS PER SECOND';
  tpsN.addEventListener('input', () => { if (tpsN.value !== '') app.setTps(tpsN.value); });
  tpsN.addEventListener('keydown', (e) => { if (e.key === 'Enter') tpsN.blur(); });
  for (const t of [1, 16, 64, 128, 256]) { const b = btn(String(t), `SPEED ${t}`, () => app.setTps(t)); b.dataset.tps = t; $('tpsPresets').append(b); }
  const glowSld = makeSlider($('glowSld'), 100, (v) => app.setGlow(v));
  $('glowSld').dataset.hint = 'LAMP GLOW  - 0% IS OFF, 100% IS THE STRONGEST';

  // ---- FILE ----
  const card = (title, say, text, hint, fn, needsEdit) => {
    const c = document.createElement('div'); c.className = 'card';
    const b = btn(text, hint, fn); b.dataset.needsEdit = needsEdit ? '1' : '';
    c.append(Object.assign(document.createElement('strong'), { textContent: title }), Object.assign(document.createElement('p'), { textContent: say }), b);
    return c;
  };
  $('fileCards').append(
    card('Save', 'Save the whole circuit as a PNG. One pixel is one cell.', 'Save PNG', 'SAVE  - BOTH LAYERS AS PNG (START STATE)', app.savePng),
    card('Load', 'Open a PNG. It replaces everything now on the canvas.', 'Open PNG', 'LOAD  - REPLACE BOTH LAYERS WITH A PNG', app.openLoad, true),
    card('Save part', 'Save only the selection, to reuse it later.', 'Save selection', 'SAVE THE SELECTION AS A PNG PART (FOLLOWS SELECT BOTH / THIS)', app.saveSel),
    card('Add part', 'Add a saved part. Click on the canvas to place it.', 'Add PNG part', 'ADD A PNG AS A PART YOU CAN PLACE (DROP ALSO WORKS)', app.openModule, true),
    card('Reset', 'Throw away the canvas and start again from the sample.', 'Reset', 'RESET  - REPLACE EVERYTHING WITH THE SAMPLE', app.reset, true),
  );

  // ---- 倍率（どの場面でも下の帯の右） ----
  const zoomSel = btn('ic:zsel', 'ZOOM TO SELECTION  [Z]', app.zoomSel);
  $('status').append(btn('ic:fit', 'SHOW EVERYTHING  [HOME]', app.fitAll), zoomSel,
    btn('-', 'ZOOM OUT  [WHEEL]', () => app.zoomBy(-1)), btn('+', 'ZOOM IN  [WHEEL]', () => app.zoomBy(1)));

  const showHint = initHints($('hint'), () => {
    if (!cur) return '';
    if (tab === 'FILE') return 'FILES ARE PNG IMAGES. 1 PIXEL = 1 CELL';
    if (!cur.edit) return cur.zoomOut ? 'SHIFT+DRAG: SELECT   R-DRAG: PAN   WHEEL: ZOOM   R-CLICK: DESELECT' : 'CLICK T-FF: FLIP   SHIFT+DRAG: SELECT   R-DRAG: PAN   WHEEL: ZOOM   R-CLICK: DESELECT';
    if (cur.pasting) return 'CLICK: PLACE   ARROWS: NUDGE 1 CELL   R / F: ROTATE / FLIP   R-CLICK: DONE' + (cur.grid.on ? '   SHIFT: SNAP TO GRID' : '');
    if (cur.zoomOut) return 'ZOOM IN TO DRAW   L-DRAG: SELECT   CTRL+C / V   R-DRAG: PAN   WHEEL: ZOOM   R-CLICK: DESELECT';
    if (cur.sel) return 'DRAG INSIDE: MOVE   ARROWS: MOVE 1 CELL   CTRL+C / X / V   R / F: ROTATE / FLIP   R-CLICK: DESELECT';
    return 'L-DRAG: DRAW   R-DRAG: PAN   WHEEL: ZOOM   MID-CLICK: PICK   1-0: PARTS   TAB: LAYER';
  });

  function sync(s) {
    cur = s;
    if (s.mode !== 'STOP' && tab === 'BUILD') tab = 'PLAY';   // キーや STEP で動き出したとき
    if (s.pasting && tab === 'FILE') tab = 'BUILD';             // Add part で部品を読んだら、置く場面（BUILD）へ
    document.body.dataset.mode = s.mode;
    document.body.dataset.tab = tab;
    document.body.dataset.layer = s.layer ? 'BACK' : 'FRONT';
    setHidden($('pBuild'), tab !== 'BUILD'); setHidden($('pPlay'), tab !== 'PLAY'); setHidden($('pFile'), tab !== 'FILE');

    // BUILD
    const noDraw = !s.edit || s.zoomOut;   // 縮小中は描けない
    for (const b of $$('[data-mat]', parts)) { setCls(b, 'on', +b.dataset.mat === s.mat); setDis(b, noDraw); }
    for (const b of $$('[data-lamp]', lamps)) { setCls(b, 'on', +b.dataset.lamp === s.lampColor); setDis(b, noDraw); }
    if (s.mat === M.LAMP) delete $('lampGrp').dataset.off; else $('lampGrp').dataset.off = '';
    for (const b of $$('[data-shape]', shapes)) { setCls(b, 'on', b.dataset.shape === s.shape && !s.pasting); setDis(b, noDraw); }
    const boxShape = s.shape === 'RECT' || s.shape === 'CIRCLE';
    setHidden(fillSeg, !boxShape);
    setHidden($('autoCrossChk'), boxShape || !(s.shape === 'PEN' || s.shape === 'LINE'));
    $('autoCross').checked = s.autoCross;
    const val = { pasteMode: s.pasteMode, scope: s.scope, hollow: String(s.hollow), showFrom: String(s.grid.showFrom), shiftSnap: String(s.shiftSnap) };
    for (const b of $$('[data-on]')) { const [k, v] = b.dataset.on.split('='); setCls(b, 'on', val[k] === v); }
    setDis(E.undo, !s.edit || !s.canUndo); setDis(E.redo, !s.edit || !s.canRedo);
    setDis(E.copy, !s.sel);
    for (const k of ['cut', 'del']) setDis(E[k], noDraw || !s.sel);
    setDis(E.paste, !s.edit || !s.hasClip);
    for (const k of ['rcw', 'rccw', 'fh', 'fv']) setDis(E[k], !s.edit || (!s.pasting && (s.zoomOut || !s.sel)));
    setHidden(E.done, !s.pasting);
    for (const b of $$('[data-layer]')) setCls(b, 'on', +b.dataset.layer === s.layer);
    otherSld.set(s.otherPct); setText($('otherV'), s.otherPct + '%');
    otherSld2.set(s.otherPct); setText($('otherV2'), s.otherPct + '%');
    $('netHl').checked = s.netHl; $('gridOn').checked = s.grid.on;
    for (const b of fullBtns) setCls(b, 'on', s.full);

    // PLAY
    for (const b of $$('[data-tps]')) setCls(b, 'on', +b.dataset.tps === s.tps);
    if (document.activeElement !== tpsN) tpsN.value = s.tps;
    for (const id of ['gridW', 'gridH']) { const el = $(id), v = String(s.grid[id === 'gridW' ? 'w' : 'h']); if (document.activeElement !== el && el.value !== v) el.value = v; }
    tpsSld.set(tpsToSlider(s.tps));
    glowSld.set(s.glow); setText($('glowV'), s.glow + '%');

    // FILE
    for (const b of $$('[data-needs-edit="1"]')) setDis(b, !s.edit);
    setDis(zoomSel, !s.sel);

    // ステータス
    setText($('stState'), s.mode);
    setText($('stLayer'), s.layer ? 'BACK' : 'FRONT');
    setHidden($('stUnknown'), !s.unknown); setText($('stUnknown'), 'UNKNOWN ' + s.unknown);
    setText($('stXY'), s.cursor ? `X ${s.cursor.x} Y ${s.cursor.y}  ${s.cursorMatName}` : 'X - Y -');
    setText($('stZoom'), 'x' + s.scale);
    setText($('stTick'), 'TICK ' + s.tick);
    setText($('stSave'), s.saveText);
    showHint();
  }
  return { sync };
}
