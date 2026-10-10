// tools.js — 描画ツール・範囲選択・移動・貼り付け・回転・UNDO/REDO（SPEC 5節）
import { M, RGB_ON, RGB_OFF, LAMP_ON, cssHex, lampColorOf, tffOnOf } from './materials.js';
import { W, H, X_MASK, Y_SHIFT, applyEntry, inCanvas, cellIndex } from './world.js';
import { line4, stairLine, rectCells, ellipseCells, squareEnd } from './shapes.js';
import { copyRegion, cloneBuf, rotateBuf, flipBuf, bufCanvas, placeBuf, bufLayers, eraseRegion } from './clip.js';

const MAX_STEPS = 200;           // SPEC の最低 100 手に余裕を持たせる
const MAX_CELLS_IN_HISTORY = 40e6;
const FILL_LIMIT = 65536;

// 2 点を角とする矩形を、キャンバスの内側に切って {x0,y0,x1,y1,w,h} にする（端を含むセル座標）。まったく外なら null
function clampedRect(ax, ay, bx, by) {
  const x0 = Math.max(0, Math.min(ax, bx)), x1 = Math.min(W - 1, Math.max(ax, bx));
  const y0 = Math.max(0, Math.min(ay, by)), y1 = Math.min(H - 1, Math.max(ay, by));
  return (x1 >= x0 && y1 >= y0) ? { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null;
}
const inRect = (r, x, y) => r && x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

let fillMark = null;

export class Editor {
  constructor(world, hooks) {
    this.world = world;
    this.hooks = hooks; // { onMessage(text) }
    this.mat = M.WIRE;
    this.lampColor = 0;
    this.onFlag = 0;                 // TFF を置くときの初期状態（スポイトで拾う）
    this.layer = 0;                  // 作業面（0 = FRONT, 1 = BACK）
    this.scope = 'BOTH';             // 選択の対象：BOTH（両面）/ ACTIVE（作業面だけ）
    this.shape = 'PEN';
    this.hollow = false;             // RECT / CIRCLE の FILLED / HOLLOW
    this.autoCross = true;
    this.sel = null;                 // {x0,y0,x1,y1}
    this.clip = null;                // clip.js のバッファ
    this.pasteBuf = null;            // 貼り付けプレビューの中身
    this.pasteMode = 'ALL';
    this.pasting = false;
    this.cursor = { x: -1, y: -1 };
    this.shift = false;
    this.drag = null;
    this.preMap = null;              // PEN の「描く前」の素材
    this.undoStack = []; this.redoStack = [];
    this.histCells = 0;
  }

  // ---- 書き込み ----
  put(x, y, m, aux) {
    if (!inCanvas(x, y)) return;
    const i = this.cell(x, y), world = this.world;
    if (m === M.LAMP) {
      if (world.mat[i] === M.LAMP && lampColorOf(world.aux[i]) === aux) return;
      world.edit(i, M.LAMP, aux);
    } else if (m === M.TFF) {
      world.edit(i, m, this.onFlag);
    } else if (world.mat[i] !== m) world.edit(i, m, 0);
  }
  // 作業面の (x, y) のセル番号
  cell(x, y) { return cellIndex(this.layer, x, y); }
  scopeLayers() { return this.scope === 'BOTH' ? [0, 1] : [this.layer]; }
  writeCell(x, y) { this.put(x, y, this.mat, this.lampColor); }

  pushHistory(e) {
    if (!e) return;
    this.undoStack.push(e); this.histCells += e.n;
    for (const r of this.redoStack) this.histCells -= r.n;
    this.redoStack = [];
    while (this.undoStack.length > MAX_STEPS || (this.histCells > MAX_CELLS_IN_HISTORY && this.undoStack.length > 1)) {
      this.histCells -= this.undoStack.shift().n;
    }
  }
  undo() {
    const e = this.undoStack.pop(); if (!e) return false;
    applyEntry(this.world, e, true); this.redoStack.push(e); this.histCells -= e.n; return true;
  }
  redo() {
    const e = this.redoStack.pop(); if (!e) return false;
    applyEntry(this.world, e, false); this.undoStack.push(e); this.histCells += e.n; return true;
  }

  // ---- AUTO CROSS ----
  // 既存の線（EMPTY・CROSS・HOLE 以外の素材 X）をまっすぐ横切るなら true。
  // pre = 描く前の「素材の鍵」を返す関数（LAMP は色つき）。直交する両側が X か CROSS で、描く向きの両側は X ではない
  crossing(pre, x, y, horizontal) {
    const X = pre(x, y);
    if (X === M.EMPTY || X === M.CROSS || X === M.HOLE) return false;
    const side = (k) => k === X || k === M.CROSS;
    if (horizontal) return side(pre(x, y - 1)) && side(pre(x, y + 1)) && pre(x - 1, y) !== X && pre(x + 1, y) !== X;
    return side(pre(x - 1, y)) && side(pre(x + 1, y)) && pre(x, y - 1) !== X && pre(x, y + 1) !== X;
  }
  // HOLE / CROSS / ERASER 以外のすべての素材で効く
  useCross() { return this.autoCross && this.mat !== M.HOLE && this.mat !== M.CROSS && this.mat !== M.EMPTY; }
  // セル i の素材の鍵：素材コード。LAMP だけ色を足す（同じ色の LAMP どうしだけ同じ素材）
  keyAt(i) {
    const m = this.world.mat[i];
    return m === M.LAMP ? m | ((lampColorOf(this.world.aux[i]) + 1) << 8) : m;
  }
  worldPre(x, y) { return inCanvas(x, y) ? this.keyAt(this.cell(x, y)) : 0; }
  strokePre(x, y) {
    if (!inCanvas(x, y)) return 0;
    const i = this.cell(x, y);
    return this.preMap.has(i) ? this.preMap.get(i) : this.keyAt(i);
  }
  // 経路 path の k 番目のセルを「まっすぐ通り抜ける」向き（'h' / 'v'）。端・角・折れ目は null
  straightDir(path, k) {
    if (k <= 0 || k >= path.length - 1) return null;
    const a = path[k - 1], c = path[k], b = path[k + 1];
    if (a[1] === c[1] && b[1] === c[1] && a[0] !== b[0]) return 'h';
    if (a[0] === c[0] && b[0] === c[0] && a[1] !== b[1]) return 'v';
    return null;
  }
  // 経路の k 番目に CROSS を入れるか（pre = 描く前の素材）
  crossAt(pre, path, k) {
    const dir = this.straightDir(path, k);
    return dir !== null && this.crossing(pre, path[k][0], path[k][1], dir === 'h');
  }

  // ---- ポインタ ----
  down(x, y, shift) {
    this.shift = shift;
    if (this.pasting) { this.commitPaste(x, y); return; }
    if (this.shape === 'FILL') { this.doFill(x, y); return; }
    const drag = { kind: this.shape, sx: x, sy: y, x, y };
    if (this.shape === 'SELECT' && inRect(this.sel, x, y)) {
      drag.kind = 'MOVE'; drag.buf = copyRegion(this.world, this.sel, this.scopeLayers()); drag.rect = { ...this.sel }; drag.layer = this.layer;
    }
    this.drag = drag;
    if (drag.kind === 'PEN') {
      this.world.beginRecord();
      this.preMap = new Map();
      drag.path = [[x, y]]; drag.written = 0; drag.lock = null;
      if (!this.useCross()) this.penWrite(drag);
    }
  }

  // RUN / PAUSE 中の範囲選択（Shift＋左ドラッグ）
  beginSelect(x, y) {
    if (this.pasting) return;
    this.drag = { kind: 'SELECT', sx: x, sy: y, x, y };
  }

  penWrite(drag) {
    // 向きの分かるセルから順に書く（最初のセルは 2 点目が決まってから）
    while (drag.written < drag.path.length) {
      const k = drag.written;
      // CROSS の判定には次のセルが要る（最後のセルは、ストロークが終わるまで待つ）
      if (this.useCross() && !drag.final && k >= drag.path.length - 1) return;
      const [x, y] = drag.path[k];
      if (inCanvas(x, y)) {
        const i = this.cell(x, y);
        if (!this.preMap.has(i)) this.preMap.set(i, this.keyAt(i));
        if (this.useCross() && this.crossAt((a, b) => this.strokePre(a, b), drag.path, k)) this.put(x, y, M.CROSS, 0);
        else this.writeCell(x, y);
      }
      drag.written++;
    }
  }

  move(x, y, shift) {
    this.shift = shift;
    this.cursor.x = x; this.cursor.y = y;
    const drag = this.drag; if (!drag) return;
    drag.x = x; drag.y = y;
    if (drag.kind === 'PEN') {
      let tx = x, ty = y;
      if (shift) {
        if (!drag.lock) {
          const dx = x - drag.sx, dy = y - drag.sy;
          if (dx || dy) drag.lock = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
        }
        if (drag.lock === 'h') ty = drag.sy; else if (drag.lock === 'v') tx = drag.sx;
      }
      const last = drag.path[drag.path.length - 1];
      let first = true;
      line4(last[0], last[1], tx, ty, (cx, cy) => { if (first) { first = false; return; } drag.path.push([cx, cy]); });
      this.penWrite(drag);
    }
  }

  // LINE の経路
  linePath(drag, shift) {
    const path = [];
    if (shift) stairLine(drag.sx, drag.sy, drag.x, drag.y, (x, y) => path.push([x, y]));
    else line4(drag.sx, drag.sy, drag.x, drag.y, (x, y) => path.push([x, y]));
    return path;
  }
  // 移動量（セル）。Shift を押している間は、ドラッグ開始からの移動量が大きい方の向きだけに動く
  moveDelta(drag, shift) {
    let dx = drag.x - drag.sx, dy = drag.y - drag.sy;
    if (shift) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }
    return [dx, dy];
  }
  rectEnd(drag, shift) { return shift ? squareEnd(drag.sx, drag.sy, drag.x, drag.y) : [drag.x, drag.y]; }

  up(x, y, shift) {
    const drag = this.drag; if (!drag) return;
    this.drag = null;
    drag.x = x; drag.y = y;
    const world = this.world;
    if (drag.kind === 'PEN') {
      drag.final = true; this.penWrite(drag); this.preMap = null;
      this.pushHistory(world.endRecord());
    } else if (drag.kind === 'LINE') {
      const path = this.linePath(drag, shift);
      world.beginRecord();
      // 判定は、描く前の状態で先にすべて済ませてから書く
      const cross = this.useCross();
      const isCross = path.map((c, k) => cross && this.crossAt((a, b) => this.worldPre(a, b), path, k));
      path.forEach(([cx, cy], k) => { if (isCross[k]) this.put(cx, cy, M.CROSS, 0); else this.writeCell(cx, cy); });
      this.pushHistory(world.endRecord());
    } else if (drag.kind === 'RECT' || drag.kind === 'CIRCLE') {
      const [ex, ey] = this.rectEnd(drag, shift);
      world.beginRecord();
      const fn = (cx, cy) => this.writeCell(cx, cy);
      if (drag.kind === 'RECT') rectCells(drag.sx, drag.sy, ex, ey, !this.hollow, fn);
      else ellipseCells(drag.sx, drag.sy, ex, ey, !this.hollow, fn);
      this.pushHistory(world.endRecord());
    } else if (drag.kind === 'SELECT') {
      const r = clampedRect(drag.sx, drag.sy, x, y);
      this.sel = r && { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 };
    } else if (drag.kind === 'MOVE') {
      const [dx, dy] = this.moveDelta(drag, shift);
      if (!dx && !dy) return;
      const r = drag.rect, nx = r.x0 + dx, ny = r.y0 + dy;
      world.beginRecord();
      eraseRegion(world, r, bufLayers(drag.buf, drag.layer));
      placeBuf(world, drag.buf, nx, ny, this.pasteMode, drag.layer);
      this.pushHistory(world.endRecord());
      this.sel = { x0: Math.max(0, nx), y0: Math.max(0, ny), x1: Math.min(W - 1, nx + drag.buf.w - 1), y1: Math.min(H - 1, ny + drag.buf.h - 1) };
    }
  }
  cancelDrag() {
    const drag = this.drag;
    if (drag && drag.kind === 'PEN') {
      drag.final = true; this.penWrite(drag); this.preMap = null;
      this.pushHistory(this.world.endRecord());
    }
    this.drag = null;
  }

  // ---- FILL ----
  // セル i（作業面）が、いま選んでいる素材と同じか（LAMP は色、TFF は初期状態まで）
  isBrush(i) {
    const m = this.world.mat[i], aux = this.world.aux[i];
    if (m !== this.mat) return false;
    if (m === M.LAMP) return lampColorOf(aux) === this.lampColor;
    if (m === M.TFF) return tffOnOf(aux) === this.onFlag;
    return true;
  }
  doFill(x, y) {
    if (!inCanvas(x, y)) return;
    const world = this.world, mat = world.mat, aux = world.aux, base = this.cell(0, 0);
    const start = this.cell(x, y);
    if (this.isBrush(start)) return; // 同じものを塗るなら何もしない
    const src = mat[start], srcColor = lampColorOf(aux[start]);
    if (!fillMark) fillMark = new Uint8Array(W * H);
    // 作業面だけで判定する。list と fillMark は面の中の番号（(y << Y_SHIFT) | x）
    const same = (i) => mat[base + i] === src && (src !== M.LAMP || lampColorOf(aux[base + i]) === srcColor);
    const list = [start - base]; fillMark[list[0]] = 1;
    let over = false;
    for (let head = 0; head < list.length; head++) {
      const i = list[head], cx = i & X_MASK, cy = i >> Y_SHIFT;
      const neighbors = [cx > 0 ? i - 1 : -1, cx < W - 1 ? i + 1 : -1, cy > 0 ? i - W : -1, cy < H - 1 ? i + W : -1];
      for (const j of neighbors) {
        if (j < 0 || fillMark[j] || !same(j)) continue;
        fillMark[j] = 1; list.push(j);
      }
      if (list.length > FILL_LIMIT) { over = true; break; }
    }
    for (const i of list) fillMark[i] = 0;
    if (over) { this.hooks.onMessage(`Fill area is too large (max ${FILL_LIMIT.toLocaleString('en-US')} cells)`); return; }
    world.beginRecord();
    for (const i of list) this.put(i & X_MASK, i >> Y_SHIFT, this.mat, this.lampColor);
    this.pushHistory(world.endRecord());
  }

  // ---- スポイト ----
  pick(x, y) {
    if (!inCanvas(x, y)) return false;
    const i = this.cell(x, y), m = this.world.mat[i], aux = this.world.aux[i];
    this.cancelPaste();
    this.mat = m;
    this.onFlag = m === M.TFF ? tffOnOf(aux) : 0;
    if (m === M.LAMP) this.lampColor = lampColorOf(aux);
    return true;
  }

  setShape(s) { this.cancelPaste(); this.cancelDrag(); this.shape = s; }
  setMat(m) { this.cancelPaste(); this.mat = m; this.onFlag = 0; }

  escape() {
    if (this.pasting) { this.cancelPaste(); return; }
    this.cancelDrag();
    this.sel = null;
  }

  // ---- 選択範囲 ----
  copy() {
    if (!this.sel) { this.hooks.onMessage('Select an area first'); return false; }
    this.clip = copyRegion(this.world, this.sel, this.scopeLayers());
    this.hooks.onMessage(`Copied ${this.clip.w}x${this.clip.h}`);
    return true;
  }
  del() {
    const s = this.sel;
    if (!s) { this.hooks.onMessage('Select an area first'); return false; }
    this.world.beginRecord();
    eraseRegion(this.world, s, this.scopeLayers());
    this.pushHistory(this.world.endRecord());
    return true;
  }
  cut() { if (this.copy()) this.del(); }

  // ---- 貼り付け（連続して貼れる） ----
  startPaste() {
    if (!this.clip) { this.hooks.onMessage('Clipboard is empty'); return false; }
    return this.startPasteBuf(cloneBuf(this.clip));
  }
  startPasteBuf(buf) {
    this.cancelDrag();
    this.pasteBuf = buf; this.pasting = true;
    return true;
  }
  cancelPaste() { this.pasting = false; this.pasteBuf = null; }
  commitPaste(x, y) {
    const world = this.world;
    world.beginRecord();
    placeBuf(world, this.pasteBuf, x, y, this.pasteMode, this.layer);
    this.pushHistory(world.endRecord());
  }

  // ---- 回転・反転：貼り付け中ならプレビュー、そうでなければ選択範囲をその場で ----
  transform(op) {
    const f = (b) => op === 'cw' ? rotateBuf(b, true) : op === 'ccw' ? rotateBuf(b, false) : op === 'fh' ? flipBuf(b, true) : flipBuf(b, false);
    if (this.pasting) { this.pasteBuf = f(this.pasteBuf); return true; }
    const s = this.sel;
    if (!s) { this.hooks.onMessage('Select an area first'); return false; }
    const world = this.world, layers = this.scopeLayers(), nb = f(copyRegion(world, s, layers));
    const selW = s.x1 - s.x0 + 1, selH = s.y1 - s.y0 + 1;
    const rnd = op === 'cw' ? Math.ceil : Math.floor; // 時計回りと反時計回りで丸めを逆にして、往復で元の位置に戻す
    const nx = Math.max(0, Math.min(W - nb.w, s.x0 + rnd((selW - nb.w) / 2)));
    const ny = Math.max(0, Math.min(H - nb.h, s.y0 + rnd((selH - nb.h) / 2)));
    world.beginRecord();
    eraseRegion(world, s, layers);
    placeBuf(world, nb, nx, ny, 'ALL', this.layer);
    this.pushHistory(world.endRecord());
    this.sel = { x0: nx, y0: ny, x1: nx + nb.w - 1, y1: ny + nb.h - 1 };
    return true;
  }

  // ---- 画像の読み込み（キャンバスを消して中央に置く。UNDO 可） ----
  placeImage(dec, record = true, pos = null) {
    const world = this.world;
    this.cancelDrag(); this.cancelPaste(); this.sel = null;
    const old = [];
    world.forEachNonEmpty((i) => old.push(i));
    if (record) world.beginRecord();
    for (const i of old) world.edit(i, 0, 0);
    const x0 = pos ? pos.x : (W - dec.w) >> 1, y0 = pos ? pos.y : (H - dec.h) >> 1;
    dec.layers.forEach((layerData, layer) => {
      if (!layerData) return;
      for (let y = 0; y < dec.h; y++) for (let x = 0; x < dec.w; x++) {
        const p = y * dec.w + x;
        if (layerData.mat[p]) world.edit(cellIndex(layer, x0 + x, y0 + y), layerData.mat[p], layerData.aux[p]);
      }
    });
    this.pushHistory(world.endRecord());
    return { x0, y0 };
  }

  // 選択範囲の大きさの表示用：ドラッグ中の範囲・移動中の範囲・確定した範囲。{x0,y0,x1,y1,w,h}（端を含むセル座標。範囲外はキャンバスに切る）
  selInfo() {
    const drag = this.drag;
    if (drag && drag.kind === 'SELECT') return clampedRect(drag.sx, drag.sy, drag.x, drag.y);
    if (drag && drag.kind === 'MOVE') {
      const [dx, dy] = this.moveDelta(drag, this.shift), r = drag.rect;
      return { x0: r.x0 + dx, y0: r.y0 + dy, x1: r.x0 + dx + drag.buf.w - 1, y1: r.y0 + dy + drag.buf.h - 1, w: drag.buf.w, h: drag.buf.h };
    }
    const s = this.sel;
    return s ? { ...s, w: s.x1 - s.x0 + 1, h: s.y1 - s.y0 + 1 } : null;
  }

  // ---- オーバーレイ ----
  // バッファのプレビュー。2 面ぶんのときは、作業面でない面を薄く先に描く
  drawBuf(ctx, b, px, py, pw, ph, alpha, active) {
    const cv = bufCanvas(b);
    ctx.imageSmoothingEnabled = false;
    if (b.n === 2) {
      ctx.globalAlpha = alpha * 0.4; ctx.drawImage(cv[active ^ 1], px, py, pw, ph);
      ctx.globalAlpha = alpha; ctx.drawImage(cv[active], px, py, pw, ph);
    } else { ctx.globalAlpha = alpha; ctx.drawImage(cv[0], px, py, pw, ph); }
    ctx.globalAlpha = 1;
  }

  overlay(ctx, r) {
    const dpr = r.dpr, t = Math.max(1, Math.round(dpr)), ds = r.view.ds;
    const outline = (x, y, w, h, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, t); ctx.fillRect(x, y + h - t, w, t);
      ctx.fillRect(x, y, t, h); ctx.fillRect(x + w - t, y, t, h);
    };
    const cellRect = (x0, y0, x1, y1) => r.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) + 1, Math.abs(y1 - y0) + 1);
    const cellFill = (x, y) => { const [px, py, pw, ph] = r.rect(x, y, 1, 1); ctx.fillRect(px, py, pw, ph); };
    const matRgb = this.brushRgb();
    const drag = this.drag;

    if (drag && drag.kind === 'LINE') {
      ctx.fillStyle = cssHex(matRgb); ctx.globalAlpha = 0.75;
      for (const [x, y] of this.linePath(drag, this.shift)) cellFill(x, y);
      ctx.globalAlpha = 1;
    } else if (drag && (drag.kind === 'RECT' || drag.kind === 'CIRCLE')) {
      const [ex, ey] = this.rectEnd(drag, this.shift);
      const [px, py, pw, ph] = cellRect(drag.sx, drag.sy, ex, ey);
      ctx.fillStyle = cssHex(matRgb); ctx.globalAlpha = 0.35;
      if (drag.kind === 'RECT' && !this.hollow) ctx.fillRect(px, py, pw, ph);
      ctx.globalAlpha = 0.75;
      if (drag.kind === 'RECT') rectCells(drag.sx, drag.sy, ex, ey, false, cellFill);
      else ellipseCells(drag.sx, drag.sy, ex, ey, false, cellFill);
      ctx.globalAlpha = 1;
      outline(px, py, pw, ph, 'rgba(255,255,255,0.5)');
    } else if (drag && drag.kind === 'SELECT') {
      const [px, py, pw, ph] = cellRect(drag.sx, drag.sy, drag.x, drag.y);
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(px, py, pw, ph);
      outline(px, py, pw, ph, '#ffffff');
    } else if (drag && drag.kind === 'MOVE') {
      const from = drag.rect;
      const [sx, sy, sw, sh] = r.rect(from.x0, from.y0, drag.buf.w, drag.buf.h);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(sx, sy, sw, sh);
      const [dx, dy] = this.moveDelta(drag, this.shift);
      const [px, py, pw, ph] = r.rect(from.x0 + dx, from.y0 + dy, drag.buf.w, drag.buf.h);
      if (this.pasteMode === 'ALL') { ctx.fillStyle = '#000'; ctx.globalAlpha = 0.7; ctx.fillRect(px, py, pw, ph); }
      this.drawBuf(ctx, drag.buf, px, py, pw, ph, 0.8, drag.layer);
      outline(px, py, pw, ph, '#ffff00');
    }

    // 選択範囲
    if (this.sel && !(drag && drag.kind === 'MOVE')) {
      const s = this.sel, [px, py, pw, ph] = cellRect(s.x0, s.y0, s.x1, s.y1);
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(px, py, pw, ph);
      outline(px, py, pw, ph, '#ffffff');
      outline(px + t, py + t, pw - 2 * t, ph - 2 * t, '#000000');
    }

    // 貼り付けプレビュー
    if (this.pasting && this.pasteBuf && this.cursor.x >= 0) {
      const buf = this.pasteBuf, [px, py, pw, ph] = r.rect(this.cursor.x, this.cursor.y, buf.w, buf.h);
      if (this.pasteMode === 'ALL') { ctx.fillStyle = '#000000'; ctx.globalAlpha = 0.7; ctx.fillRect(px, py, pw, ph); }
      this.drawBuf(ctx, buf, px, py, pw, ph, 0.75, this.layer);
      outline(px, py, pw, ph, '#ffff00');
    }

    // カーソル下のセル
    if (!this.pasting && !drag && this.cursor.x >= 0 && inCanvas(this.cursor.x, this.cursor.y) && ds >= 4) {
      const [px, py, pw, ph] = r.rect(this.cursor.x, this.cursor.y, 1, 1);
      outline(px, py, pw, ph, 'rgba(255,255,255,0.6)');
    }
  }

  // プレビューに使う、選んでいる素材の色（ERASER は灰色、OFF の T-FF は暗い色）
  brushRgb() {
    if (this.mat === M.LAMP) return LAMP_ON[this.lampColor];
    if (!this.mat) return 0x404040;
    return (this.mat === M.TFF && !this.onFlag) ? RGB_OFF[this.mat] : RGB_ON[this.mat];
  }
}
