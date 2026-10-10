// input.js — マウス・ホイール・キーボード（SPEC 5節）
import { inCanvas } from './world.js';
import { M, MAT_ORDER } from './materials.js';

const DRAG_PX = 4; // クリックとドラッグの区別（CSS ピクセル）
// キー 1〜9・0 が MAT_ORDER の並び（WIRE / INPUT / OUTPUT / INVERT / BUFFER / CROSS / T-FF / LAMP / HOLE / ERASER）に対応する
const DIGIT_MAT = {};
MAT_ORDER.forEach((m, k) => { DIGIT_MAT['Digit' + ((k + 1) % 10)] = m; });

// 十字キー：選択範囲の中身（貼り付け中はプレビュー）を 1 セル動かす
const ARROW_STEP = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export function initInput(app) {
  const { canvas, renderer, editor } = app;
  let spaceDown = false, active = null; // active: 'draw' | 'pan' | 'pending'
  let pend = null; // 右 / 中ボタンの押下状態
  let pan = null;
  let lastWheel = 0;

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const sx = (e.clientX - r.left) * canvas.width / r.width, sy = (e.clientY - r.top) * canvas.height / r.height;
    return { sx, sy, ...renderer.cellAt(sx, sy) };
  };
  const inField = (e) => e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'checkbox' && e.target.type !== 'button';
  const startPan = (p) => { pan = { sx: p.sx, sy: p.sy, px: renderer.view.panX, py: renderer.view.panY }; };

  // 修飾キー無しの矢印キー。入力欄の外では、ページのスクロールを止める
  function nudge(e) {
    e.preventDefault();
    const [dx, dy] = ARROW_STEP[e.key];
    if (editor.nudge(dx, dy)) { app.requestDraw(); app.updateInfo(); }
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('auxclick', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    // 移動のプレビュー（左ドラッグ中）に右クリックしたら取り消す
    if (active === 'draw' && e.button === 2 && editor.drag && editor.drag.kind === 'MOVE') {
      editor.cancelDrag(); app.requestDraw(); e.preventDefault();
      return;
    }
    if (active) return;
    const p = pos(e);
    editor.cursor.x = p.x; editor.cursor.y = p.y;
    if (e.button === 1 || e.button === 2) {
      // クリックなら動作、4 CSS px 以上動かしたらパン
      active = 'pending';
      pend = { button: e.button, cx: e.clientX, cy: e.clientY, moved: false, cell: p };
      startPan(p);
      canvas.setPointerCapture(e.pointerId); e.preventDefault(); return;
    }
    if (e.button === 0 && spaceDown) {
      active = 'pan'; startPan(p);
      canvas.setPointerCapture(e.pointerId); e.preventDefault(); return;
    }
    if (e.button === 0 && !app.canEdit()) {
      // RUN / PAUSE：Shift＋ドラッグで範囲選択。そうでなければ、作業面の TFF の上なら今の状態を切り替えるだけ
      canvas.setPointerCapture(e.pointerId); e.preventDefault();
      if (e.shiftKey) { active = 'draw'; editor.beginSelect(p.x, p.y); }
      else { active = 'click'; app.toggleRunAt(p.x, p.y); }
      app.requestDraw();
      return;
    }
    if (e.button === 0) {
      active = 'draw';
      canvas.setPointerCapture(e.pointerId);
      const wasPasting = editor.pasting;
      editor.down(p.x, p.y, e.shiftKey);
      if (wasPasting) app.updateInfo();
      app.requestDraw();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e);
    editor.cursor.x = p.x; editor.cursor.y = p.y; editor.shift = e.shiftKey;
    if (active === 'pending' && !pend.moved && Math.hypot(e.clientX - pend.cx, e.clientY - pend.cy) >= DRAG_PX) pend.moved = true;
    if (active === 'pan' || (active === 'pending' && pend.moved)) {
      renderer.view.panX = Math.round(pan.px + (p.sx - pan.sx));
      renderer.view.panY = Math.round(pan.py + (p.sy - pan.sy));
    } else if (active === 'draw') editor.move(p.x, p.y, e.shiftKey);
    app.requestDraw();
  });

  const end = (e) => {
    if (!active) return;
    const p = pos(e);
    if (active === 'draw') editor.up(p.x, p.y, e.shiftKey);
    else if (active === 'pending' && !pend.moved) {
      const c = pend.cell;
      const onTff = inCanvas(c.x, c.y) && editor.world.mat[editor.cell(c.x, c.y)] === M.TFF;
      if (pend.button === 1) {
        // スポイトは編集の一部。RUN / PAUSE 中はクリックだけ無効
        if (app.canEdit() && editor.pick(c.x, c.y)) app.updateInfo();
      } else if (editor.pasting) {
        // プレビュー中は取り消しだけ（TFF の上でも切り替えない）
        editor.cancelPaste(); app.updateInfo();
      } else if (app.canEdit() && onTff) {
        app.toggleInitialAt(c.x, c.y);
      } else {
        editor.sel = null; app.updateInfo();
      }
    }
    active = null; pend = null; pan = null;
    app.requestDraw();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', () => {
    if (active === 'draw') editor.cancelDrag();
    active = null; pend = null; pan = null;
    app.requestDraw();
  });
  canvas.addEventListener('pointerleave', () => {
    if (active) return;
    editor.cursor.x = -1; editor.cursor.y = -1;
    app.requestDraw();
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const now = performance.now();
    if (now - lastWheel < 60) return;
    lastWheel = now;
    const p = pos(e);
    renderer.setScaleIdx(renderer.view.scaleIdx + (e.deltaY < 0 ? 1 : -1), { sx: p.sx, sy: p.sy });
    app.requestDraw();
  }, { passive: false });

  // PNG のドラッグ＆ドロップ：貼り付けプレビューにする
  canvas.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) app.loadModule(f);  // RUN / PAUSE 中は main 側で断る
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') { editor.shift = true; app.requestDraw(); }
    // Tab：作業面の切り替え（RUN / PAUSE 中も）。ブラウザのフォーカス移動は止める
    if (e.key === 'Tab') {
      e.preventDefault();
      const plain = !e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey;
      if (plain) {
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        app.toggleLayer();
      }
      return;
    }
    if (inField(e)) return;
    if (e.code === 'Space') { spaceDown = true; canvas.style.cursor = 'grab'; e.preventDefault(); return; }
    const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    const edit = app.canEdit();
    if (!edit) {
      // RUN / PAUSE 中に使えるキー：COPY・Esc・Home・Z だけ。そのほかは無視
      if (ctrl && k === 'c') { editor.copy(); app.requestDraw(); e.preventDefault(); }
      else if (ctrl || e.altKey) return;
      else if (e.key === 'Escape') { editor.escape(); app.updateInfo(); app.requestDraw(); }
      else if (e.key === 'Home') { app.fitAll(); e.preventDefault(); }
      else if (k === 'z') { app.zoomSel(); }
      else if (e.key in ARROW_STEP && !e.shiftKey) e.preventDefault();   // 十字キーは編集用。RUN / PAUSE 中は何もしない（ページも動かさない）
      return;
    }
    if (ctrl && k === 'z' && !e.shiftKey) { app.undo(); e.preventDefault(); }
    else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { app.redo(); e.preventDefault(); }
    else if (ctrl && k === 'c') { editor.copy(); app.requestDraw(); e.preventDefault(); }
    else if (ctrl && k === 'x') { editor.cut(); app.requestDraw(); e.preventDefault(); }
    else if (ctrl && k === 'v') { editor.startPaste(); app.updateInfo(); app.requestDraw(); e.preventDefault(); }
    else if (ctrl || e.altKey) return;
    else if (e.key in ARROW_STEP && !e.shiftKey) nudge(e);
    else if (e.key === 'Delete') { editor.del(); app.requestDraw(); e.preventDefault(); }
    else if (e.key === 'Escape') { editor.escape(); app.updateInfo(); app.requestDraw(); }
    else if (e.key === 'Home') { app.fitAll(); e.preventDefault(); }
    else if (k === 'z') { app.zoomSel(); }
    else if (k === 'r') { editor.transform(e.shiftKey ? 'ccw' : 'cw'); app.requestDraw(); }
    else if (k === 'f') { editor.transform(e.shiftKey ? 'fv' : 'fh'); app.requestDraw(); }
    else if (e.code in DIGIT_MAT && !e.shiftKey) {
      editor.setMat(DIGIT_MAT[e.code]);
      if (editor.mat === M.LAMP) editor.lampColor = 0; // 8 は白に固定
      app.updateInfo(); app.requestDraw();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') { editor.shift = false; app.requestDraw(); }
    if (e.code === 'Space') { spaceDown = false; canvas.style.cursor = ''; }
  });
  window.addEventListener('blur', () => { spaceDown = false; editor.shift = false; canvas.style.cursor = ''; });
}
