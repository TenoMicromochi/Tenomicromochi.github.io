// shapes.js — 描き方の形（セルの列を作るだけ。世界は触らない）
// 斜めの線はすべて 4 方向でつながる（角のセルを足す）。

// 4方向でつながる直線。fn(x, y) を始点から終点へ順に呼ぶ
export function line4(x0, y0, x1, y1, fn) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  fn(x, y);
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    let mx = false, my = false;
    if (e2 >= dy) { err += dy; x += sx; mx = true; }
    if (e2 <= dx) { err += dx; y += sy; my = true; }
    if (mx && my) fn(x, y - sy); // 角（横に進んだ位置、縦は元のまま）
    fn(x, y);
  }
}

// Shift+LINE：傾きを 0、n:1、1:n（n=1..8）、縦に丸めて、終点を階段の切れ目に合わせる。
// 返り値 { x1, y1, a, b, k, sx, sy }（a = 横に進むセル数、b = 縦に進むセル数、k = 階段の段数、sx / sy = 進む向き -1 か 1。始点と同じ点のとき k = 0 で sx / sy は無い）
const CANDS = [[1, 0], [0, 1]];
for (let n = 1; n <= 8; n++) { CANDS.push([n, 1]); if (n > 1) CANDS.push([1, n]); }
function snapStair(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, adx = Math.abs(dx), ady = Math.abs(dy);
  if (!adx && !ady) return { x1, y1, a: 1, b: 0, k: 0 };
  const ang = Math.atan2(ady, adx);
  let best = CANDS[0], bd = 9;
  for (const c of CANDS) {
    const d = Math.abs(Math.atan2(c[1], c[0]) - ang);
    if (d < bd) { bd = d; best = c; }
  }
  const [a, b] = best;
  const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
  let k;
  if (b === 0) k = adx; else if (a === 0) k = ady;
  else if (a >= b) k = Math.max(1, Math.round(adx / a)); else k = Math.max(1, Math.round(ady / b));
  return { x1: x0 + sx * a * k, y1: y0 + sy * b * k, a, b, k, sx, sy };
}

// 階段の線。長い辺（major）を 1 段あたり a（または b）セル進めるごとに、短い辺を 1 セル進める
export function stairLine(x0, y0, x1, y1, fn) {
  const st = snapStair(x0, y0, x1, y1);
  const { a, b, k } = st;
  if (!k) { fn(x0, y0); return st; }
  const sx = st.sx, sy = st.sy;
  if (b === 0) { for (let i = 0; i <= k; i++) fn(x0 + sx * i, y0); return st; }
  if (a === 0) { for (let i = 0; i <= k; i++) fn(x0, y0 + sy * i); return st; }
  if (a >= b) {
    // 横に a セル進むごとに縦へ 1 セル
    for (let j = 0; j < k; j++) {
      const bx = x0 + sx * a * j, by = y0 + sy * j;
      for (let i = 0; i <= a; i++) fn(bx + sx * i, by); // 横 a セル＋角
    }
    fn(x1, y1);
  } else {
    for (let j = 0; j < k; j++) {
      const bx = x0 + sx * j, by = y0 + sy * b * j;
      for (let i = 0; i <= b; i++) fn(bx, by + sy * i);
    }
    fn(x1, y1);
  }
  return st;
}

// 矩形（両端を含む）。filled=false なら外周だけ
export function rectCells(x0, y0, x1, y1, filled, fn) {
  const xa = Math.min(x0, x1), xb = Math.max(x0, x1), ya = Math.min(y0, y1), yb = Math.max(y0, y1);
  for (let y = ya; y <= yb; y++) {
    if (filled || y === ya || y === yb) for (let x = xa; x <= xb; x++) fn(x, y);
    else { fn(xa, y); if (xb !== xa) fn(xb, y); }
  }
}

// 矩形に内接する楕円。HOLLOW の輪郭は 4 方向でつながる（8 近傍に外があるセルを残す）
export function ellipseCells(x0, y0, x1, y1, filled, fn) {
  const xa = Math.min(x0, x1), xb = Math.max(x0, x1), ya = Math.min(y0, y1), yb = Math.max(y0, y1);
  const w = xb - xa + 1, h = yb - ya + 1;
  const cx = (xa + xb + 1) / 2, cy = (ya + yb + 1) / 2, rx = w / 2, ry = h / 2;
  const L = new Int32Array(h), R = new Int32Array(h); // 各行の [L, R]。空行は L > R
  for (let r = 0; r < h; r++) {
    const dy = (ya + r + 0.5 - cy) / ry, t = 1 - dy * dy;
    if (t < 0) { L[r] = 1; R[r] = 0; continue; }
    const half = Math.sqrt(t) * rx;
    let l = Math.ceil(cx - half - 0.5), rr = Math.floor(cx + half - 0.5);
    l = Math.max(xa, l); rr = Math.min(xb, rr);
    if (l > rr) { // 細い行は中心の 1 セルは必ず通す（つながりを切らさない）
      l = rr = Math.min(xb, Math.max(xa, Math.floor(cx)));
    }
    L[r] = l; R[r] = rr;
  }
  for (let r = 0; r < h; r++) {
    const l = L[r], rr = R[r];
    if (l > rr) continue;
    if (filled) { for (let x = l; x <= rr; x++) fn(x, ya + r); continue; }
    // 上下の行と合わせた内側（8 近傍がすべて内側）
    let il = l + 1, ir = rr - 1;
    if (r === 0 || r === h - 1) { il = 1; ir = 0; }
    else {
      const l2 = Math.max(l, L[r - 1], L[r + 1]), r2 = Math.min(rr, R[r - 1], R[r + 1]);
      il = l2 + 1; ir = r2 - 1;
      if (L[r - 1] > R[r - 1] || L[r + 1] > R[r + 1]) { il = 1; ir = 0; }
    }
    for (let x = l; x <= rr; x++) if (x < il || x > ir) fn(x, ya + r);
  }
}

// 正方形・正円にする：長いほうに合わせる
export function squareEnd(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, m = Math.max(Math.abs(dx), Math.abs(dy));
  return [x0 + (dx < 0 ? -m : m), y0 + (dy < 0 ? -m : m)];
}
