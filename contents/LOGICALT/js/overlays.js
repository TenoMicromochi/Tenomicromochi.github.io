// overlays.js — GRID・NET HIGHLIGHT・選択範囲の大きさ表示（表示だけ。セルの色は変えない）
import { M, isNet, isBody, lampColorOf } from './materials.js';
import { W, H, inCanvas, cellIndex, cellX, cellY, cellLayer, otherLayer } from './world.js';

// グリッドの基準はキャンバスの (0,0)。grid.showFrom 倍以上のときだけ（縮小中は出さない）、セルの境界に 1 デバイスピクセルの線
export function drawGrid(ctx, r, grid) {
  if (!grid.on || r.view.n > 1 || r.view.scale < grid.showFrom) return;
  const v = r.view, ds = v.ds, cw = r.canvas.width, ch = r.canvas.height;
  const gw = Math.max(1, grid.w | 0), gh = Math.max(1, grid.h | 0);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  const cx0 = Math.max(0, Math.floor(-v.panX / ds)), cx1 = Math.min(W, Math.ceil((cw - v.panX) / ds));
  const cy0 = Math.max(0, Math.floor(-v.panY / ds)), cy1 = Math.min(H, Math.ceil((ch - v.panY) / ds));
  const yTop = Math.max(0, v.panY), yBot = Math.min(ch, v.panY + H * ds);
  const xLeft = Math.max(0, v.panX), xRight = Math.min(cw, v.panX + W * ds);
  for (let x = Math.ceil(cx0 / gw) * gw; x <= cx1; x += gw) ctx.fillRect(v.panX + x * ds, yTop, 1, yBot - yTop);
  for (let y = Math.ceil(cy0 / gh) * gh; y <= cy1; y += gh) ctx.fillRect(xLeft, v.panY + y * ds, xRight - xLeft, 1);
}

// ---- NET HIGHLIGHT：世界の配置から直接、同じ接続規則でたどる（両面。CROSS は透明、HOLE は対の面へ渡る） ----
const LIMIT = 300000;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// セル i の dx, dy 方向の隣（CROSS を飛ばした先の最初のセル）。なければ -1。通った CROSS は via に入れる
function neighbor(mat, i, dx, dy, via) {
  let x = cellX(i), y = cellY(i);
  const layer = cellLayer(i);
  for (;;) {
    x += dx; y += dy;
    if (!inCanvas(x, y)) return -1;
    const j = cellIndex(layer, x, y), m = mat[j];
    if (m === M.CROSS) { if (via) via.push(j); continue; }
    return m ? j : -1;
  }
}

// ネット（WIRE / HOLE）全体。HOLE は反対の面の HOLE にも渡る。つながる入口・出口の塊も返す
function floodNet(mat, start, out, ports) {
  const stack = [start];
  if (out.has(start)) return;
  out.add(start);
  while (stack.length && out.size < LIMIT) {
    const i = stack.pop();
    if (mat[i] === M.HOLE) { const j = otherLayer(i); if (mat[j] === M.HOLE && !out.has(j)) { out.add(j); stack.push(j); } }
    for (const [dx, dy] of DIRS) {
      const via = [], j = neighbor(mat, i, dx, dy, via);
      if (j < 0) continue;
      const m = mat[j];
      if (isNet(m)) { if (!out.has(j)) { out.add(j); stack.push(j); for (const c of via) out.add(c); } }
      else if (m === M.INPUT || m === M.OUTPUT) { for (const c of via) out.add(c); ports.push(j); }
    }
  }
}

// 同じゲートの本体全体（同じ素材。LAMP は同じ色）。隣の入口・出口は ports に入れる
function floodGate(mat, aux, start, out, ports) {
  const m0 = mat[start], c0 = lampColorOf(aux[start]);
  const stack = [start];
  out.add(start);
  while (stack.length && out.size < LIMIT) {
    const i = stack.pop();
    for (const [dx, dy] of DIRS) {
      const via = [], j = neighbor(mat, i, dx, dy, via);
      if (j < 0) continue;
      const m = mat[j];
      if (m === M.INPUT || m === M.OUTPUT) { for (const c of via) out.add(c); ports.push(j); }
      else if (m === m0 && (m0 !== M.LAMP || lampColorOf(aux[j]) === c0) && !out.has(j)) { out.add(j); stack.push(j); for (const c of via) out.add(c); }
    }
  }
}

// 入口（出口）の塊全体。隣のネット・ゲート本体は nets / bodies に入れる
function floodPort(mat, start, out, nets, bodies) {
  const m0 = mat[start];
  const stack = [start];
  out.add(start);
  while (stack.length && out.size < LIMIT) {
    const i = stack.pop();
    for (const [dx, dy] of DIRS) {
      const via = [], j = neighbor(mat, i, dx, dy, via);
      if (j < 0) continue;
      const m = mat[j];
      if (m === m0) { if (!out.has(j)) { out.add(j); stack.push(j); for (const c of via) out.add(c); } }
      else if (isNet(m)) { for (const c of via) out.add(c); nets.push(j); }
      else if (isBody(m)) { for (const c of via) out.add(c); bodies.push(j); }
    }
  }
}

// start のセルに応じたハイライトを out に足す
function expand(world, start, out) {
  const mat = world.mat, aux = world.aux, m = mat[start];
  const ports = [];
  if (isNet(m)) floodNet(mat, start, out, ports);
  else if (isBody(m)) floodGate(mat, aux, start, out, ports);
  else if (m === M.INPUT || m === M.OUTPUT) {
    const nets = [], bodies = [];
    floodPort(mat, start, out, nets, bodies);
    for (const j of nets) if (!out.has(j)) floodNet(mat, j, out, []);
    for (const j of bodies) if (!out.has(j)) floodGate(mat, aux, j, out, []);
    return;
  }
  // ネット・ゲートから見えた入口・出口は、その塊だけを足す
  for (const j of ports) if (!out.has(j)) floodPort(mat, j, out, [], []);
}

// 作業面のカーソルの下のセルに応じてハイライトするセルの集合（セル番号は面つき）
function netHighlight(world, x, y, layer) {
  if (!inCanvas(x, y)) return null;
  const mat = world.mat, i = cellIndex(layer, x, y), m = mat[i];
  const out = new Set();
  if (m === M.CROSS) {
    // 縦と横のそれぞれでつないでいる相手
    out.add(i);
    for (const [dx, dy] of DIRS) {
      const via = [], j = neighbor(mat, i, dx, dy, via);
      if (j < 0) continue;
      for (const c of via) out.add(c);
      expand(world, j, out);
    }
  } else if (m) expand(world, i, out);
  else return null;
  return out;
}

let cache = { key: '', set: null };
export function drawHighlight(ctx, r, world, cursor, layer) {
  if (cursor.x < 0 || r.view.n > 1) return;   // 縮小中は出さない
  const key = cursor.x + ',' + cursor.y + ',' + layer + ',' + world.version;
  if (cache.key !== key) cache = { key, set: netHighlight(world, cursor.x, cursor.y, layer) };
  const set = cache.set;
  if (!set || !set.size) return;
  const v = r.view, ds = v.ds, cw = r.canvas.width, ch = r.canvas.height;
  for (const i of set) {
    const px = v.panX + cellX(i) * ds, py = v.panY + cellY(i) * ds;
    if (px + ds < 0 || py + ds < 0 || px > cw || py > ch) continue;
    // 作業面は半透明の黄、もう一方の面は透明度の設定にかかわらず見えるように濃い橙で塗る
    ctx.fillStyle = cellLayer(i) === layer ? 'rgba(255,230,0,0.5)' : 'rgba(255,150,0,0.85)';
    ctx.fillRect(px, py, ds, ds);
  }
}

// 選択範囲の大きさ（11x9 など）。キャンバスの上に重ねる DOM。範囲の枠の右下の外側に置き、画面からはみ出すときは内側へ寄せる
// sel = editor.selInfo() の結果（なければ null で隠す）。値が変わったときだけ DOM を書く
let selLabel = '', selX = -1, selY = -1;
export function placeSelSize(r, sel) {
  const el = document.getElementById('selSize');
  if (!sel) { if (!el.hidden) el.hidden = true; return; }
  const text = `${sel.w}x${sel.h}`;
  if (el.hidden) el.hidden = false;
  if (text !== selLabel) { el.textContent = text; selLabel = text; }
  const [px, py, pw, ph] = r.rect(sel.x0, sel.y0, sel.x1 - sel.x0 + 1, sel.y1 - sel.y0 + 1);
  const stack = document.getElementById('canvasStack');
  const x = Math.max(0, Math.min(Math.round((px + pw) / r.dpr) + 4, stack.clientWidth - el.offsetWidth));
  const y = Math.max(0, Math.min(Math.round((py + ph) / r.dpr) + 4, stack.clientHeight - el.offsetHeight));
  if (x !== selX || y !== selY) { el.style.left = x + 'px'; el.style.top = y + 'px'; selX = x; selY = y; }
}
