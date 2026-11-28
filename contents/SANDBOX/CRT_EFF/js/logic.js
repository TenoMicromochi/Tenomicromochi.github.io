import { N_LOW, SIGNAL, BLOOM } from './config.js';
// 画面に依らない計算。node --test で試せるように、DOM にも GL にも触らない。

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 64;
export const WHEEL_STEP = Math.pow(2, 1 / 4);   // ホイール1目盛り

export function clampZoom(z) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

// 長い方の辺が max を超えたら縮める。縮めないときは元のまま（拡大しない）。最低 1 画素
export function fitSize(w, h, max) {
  const m = Math.max(w, h);
  if (m <= max) return { w, h };
  const s = max / m;
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

// view = { zoom, ox, oy }：画像上の点 p は、画面上の p*zoom + (ox, oy) に出る
// cursor の下の画像上の点が動かないように、factor 倍に拡大縮小する
export function zoomAt(view, cursor, factor) {
  const zoom = clampZoom(view.zoom * factor);
  const px = (cursor.x - view.ox) / view.zoom;
  const py = (cursor.y - view.oy) / view.zoom;
  return { zoom, ox: cursor.x - px * zoom, oy: cursor.y - py * zoom };
}

// 画像全体が stage（sw x sh）に収まる拡大率にして、中央に置く
export function fitView(w, h, sw, sh) {
  const zoom = clampZoom(Math.min(sw / w, sh / h));
  return { zoom, ox: (sw - w * zoom) / 2, oy: (sh - h * zoom) / 2 };
}

// 書き出しの大きさ。長い辺が limit を超えるときは ok: false（書き出さない）
export function exportSize(w, h, zoom, limit = 8192) {
  const ew = Math.max(1, Math.round(w * zoom));
  const eh = Math.max(1, Math.round(h * zoom));
  return { w: ew, h: eh, ok: Math.max(ew, eh) <= limit };
}

// 面積平均（box filter）。src は RGBA の Uint8ClampedArray。戻りは RGBA（alpha 255）
export function boxResize(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return src;
  const wx = axisWeights(sw, dw);
  const wy = axisWeights(sh, dh);
  // 横：dw x sh
  const mid = new Float32Array(dw * sh * 3);
  for (let y = 0; y < sh; y++) {
    const row = y * sw * 4;
    for (let x = 0; x < dw; x++) {
      const { start, w } = wx[x];
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < w.length; i++) {
        const p = row + (start + i) * 4;
        const k = w[i];
        r += src[p] * k; g += src[p + 1] * k; b += src[p + 2] * k;
      }
      const o = (y * dw + x) * 3;
      mid[o] = r; mid[o + 1] = g; mid[o + 2] = b;
    }
  }
  // 縦：dw x dh
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const { start, w } = wy[y];
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < w.length; i++) {
        const p = ((start + i) * dw + x) * 3;
        const k = w[i];
        r += mid[p] * k; g += mid[p + 1] * k; b += mid[p + 2] * k;
      }
      const o = (y * dw + x) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    }
  }
  return out;
}

// 出力1画素ごとの、元の画素の範囲と重み（重みの合計は 1）
function axisWeights(sn, dn) {
  const scale = sn / dn;
  const res = new Array(dn);
  for (let d = 0; d < dn; d++) {
    const a = d * scale, b = (d + 1) * scale;
    const start = Math.floor(a);
    const end = Math.min(sn, Math.ceil(b));
    const w = new Float64Array(end - start);
    let sum = 0;
    for (let s = start; s < end; s++) {
      const cover = Math.min(b, s + 1) - Math.max(a, s);
      w[s - start] = cover;
      sum += cover;
    }
    for (let i = 0; i < w.length; i++) w[i] /= sum;
    res[d] = { start, w };
  }
  return res;
}

// 起動時のテスト模様（320x240、RGBA）
// 上半分：カラーバー（白・黄・シアン・緑・マゼンタ・赤・青・黒）
// 下半分：R・G・B・白それぞれを 0〜100% の 11 段で並べた帯
export function makeTestPattern() {
  // 1 画素ずつ並べたテスト模様（16x7）。行は R・Y・G・C・B・M・W、列は各 4bit の 0〜15 段（値 = 段 × 17）
  const rows = [[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]];
  const W = 16, H = rows.length;
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      px[o] = rows[y][0] * x * 17;
      px[o + 1] = rows[y][1] * x * 17;
      px[o + 2] = rows[y][2] * x * 17;
      px[o + 3] = 255;
    }
  }
  return { data: px, w: W, h: H };
}

// 状態の文字
//   静止画  IN 1920x1080 → 640x360   x8.0
//   1/n     IN 1920x1080 → 1/4 → 480x270   x8.0
//   GIF     IN 320x240 (24f) → 320x240   x4.0
// opt = { div, frames, note, out }。note は注意書き、out は書き出しの大きさ（最後に OUT 〜 を付ける）
export function statusText(inW, inH, w, h, zoom, opt = {}) {
  const z = zoom < 1 ? zoom.toFixed(2) : zoom.toFixed(1);
  const f = opt.frames > 1 ? ` (${opt.frames}f)` : '';
  const d = opt.div > 1 ? ` → 1/${opt.div}` : '';
  const note = opt.note ? ` ${opt.note}` : '';
  const out = opt.out ? `   OUT ${opt.out}` : '';
  return `IN ${inW}x${inH}${f}${d} → ${w}x${h}   x${z}${note}${out}`;
}

// ---- 第6段：素子の光り方（層 1〜3）----
// 位置・長さは元画像の画素単位。シェーダー（CRT_FRAG）は同じ式を GLSL で書いたもの。

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// 層 1・3：素子の升目と穴。mask は config の MASKS の値、P = { pitch, beam, gapX, gapY }
//   hx, hy          素子の「満ちた形」の半幅・半高さ（GRILLE の hy は BEAM / 2 行）
//   holeHx, holeHy  網の穴の半幅・半高さ（GRILLE は縦の網が無いので holeHy = Infinity）
export function maskGeometry(mask, P) {
  const grille = mask.id === 0;
  const cw = P.pitch / 3;
  const ch = grille ? 1 : cw * mask.aspect;
  const holeHx = (1 - P.gapX) / 2 * cw;
  const holeHy = grille ? Infinity : (mask.id === 3 ? holeHx : (1 - P.gapY) / 2 * ch);
  return { id: mask.id, grille, cw, ch, n: mask.n, nLow: Math.min(N_LOW, mask.n), min: P.min, holeHx, holeHy, hx: holeHx, hy: grille ? P.beam / 2 : holeHy, cellArea: cw * ch };
}

// 層 2：形の濃さ p（0〜1）。af = 満ち具合、sf = 柔らかさ
export function shapeP(g, af, sf, dx, dy, e) {
  const sz = g.min + (1 - g.min) * af;
  const ax = g.hx * sz, ay = g.hy * sz;
  const n = g.nLow + (g.n - g.nLow) * af;
  const f = Math.pow(Math.pow(Math.abs(dx) / ax, n) + Math.pow(Math.abs(dy) / ay, n), 1 / n);
  return (1 - sf) * (1 - smooth(1 - e, 1 + e, f)) + sf * Math.exp(-2 * f * f);
}

// 層 3：網。穴の中が 1、外が 0（縁は e でぼかす）。GRILLE は横だけ
export function holeMask(g, dx, dy, e) {
  let f;
  if (g.grille) f = Math.abs(dx) / g.holeHx;
  else f = Math.pow(Math.pow(Math.abs(dx) / g.holeHx, g.n) + Math.pow(Math.abs(dy) / g.holeHy, g.n), 1 / g.n);
  return 1 - smooth(1 - e, 1 + e, f);
}

// 網を通した形 min(p, 穴)。満ちたとき（af = 1, sf = 0）は p そのもの
function transmitShape(g, af, sf, dx, dy, e) {
  return Math.min(shapeP(g, af, sf, dx, dy, e), holeMask(g, dx, dy, e));
}

// 網を通した形の面積（中点則、4象限は対称なので1象限を4倍）
export function shapeArea(g, af, sf, e, N) {
  const sz = g.min + (1 - g.min) * af;
  const ax = g.hx * sz, ay = g.hy * sz;
  const ext = sf > 0 ? 2.4 : 1 + e + 0.02;
  const Lx = Math.min(g.holeHx * (1 + e), ax * ext);
  const Ly = Math.min(g.holeHy * (1 + e), ay * ext);
  let sum = 0;
  for (let j = 0; j < N; j++) {
    const dy = (j + 0.5) * Ly / N;
    for (let i = 0; i < N; i++) sum += transmitShape(g, af, sf, (i + 0.5) * Lx / N, dy, e);
  }
  return 4 * sum * Lx * Ly / (N * N);
}

// B の表。Q(af, sf) = 網を通した形の面積 ÷ 満ちた形の面積。B = 1 / Q（MIN が変わったら作り直す）。
// 表には Q ÷ sz²（sz = MIN + (1 − MIN) × af、形の大きさの割合）を持つ。Q の主な変化を sz² が受け持つので、補間が合う
//   aFull    満ちた形（af = 1, sf = 0）の面積
//   avgFrac  満ちた形の面積 ÷ 素子の升目の面積（細かすぎるときの平均の明るさ）
export function buildTable(g, e, T) {
  const { na, ns, afMin, n } = T;
  const tmin = Math.sqrt(afMin);
  const aFull = shapeArea(g, 1, 0, e, n);
  const R = new Float32Array(na * ns);
  for (let i = 0; i < na; i++) {
    const t = tmin + (1 - tmin) * i / (na - 1), af = t * t;
    const sz = g.min + (1 - g.min) * af;
    for (let j = 0; j < ns; j++)
      R[j * na + i] = shapeArea(g, af, j / (ns - 1), e, n) / aFull / (sz * sz);
  }
  return { na, ns, tmin, afMin, min: g.min, aFull, avgFrac: aFull / g.cellArea, R };
}

export function lookupQ(tab, af, sf) {
  const t = Math.sqrt(Math.min(1, Math.max(tab.afMin, af)));
  const u = (t - tab.tmin) / (1 - tab.tmin) * (tab.na - 1);
  const v = Math.min(1, Math.max(0, sf)) * (tab.ns - 1);
  const i0 = Math.min(Math.floor(u), tab.na - 2), j0 = Math.min(Math.floor(v), tab.ns - 2);
  const fu = u - i0, fv = v - j0, r = tab.R, na = tab.na;
  const a = r[j0 * na + i0] * (1 - fu) + r[j0 * na + i0 + 1] * fu;
  const b = r[(j0 + 1) * na + i0] * (1 - fu) + r[(j0 + 1) * na + i0 + 1] * fu;
  const sz = tab.min + (1 - tab.min) * Math.min(1, af);
  return (a * (1 - fv) + b * fv) * sz * sz;
}

// 層 2 + 3：素子の中心から (dx, dy) ずれた点の光（強さ I、色の係数は掛けない）
//   af = min(1, I / KNEE)、sf = SOFT × (1 − af)、光 = I × B × min(p, 穴)  （B = 1 / Q）
export function elementLight(g, tab, P, e, I, dx, dy) {
  if (I <= 1e-4) return 0;
  const af = Math.min(1, I / P.knee), sf = P.soft * (1 - af);
  return I * transmitShape(g, af, sf, dx, dy, e) / lookupQ(tab, af, sf);
}

// 細かすぎるときの、素子の升目で平均した明るさ（素子の光の総量 I × 満ちた形の面積 ÷ 升目の面積）
export function avgLight(tab, I) {
  return I * tab.avgFrac;
}

// ---- 第2段 ----

// 1/n 縮小の大きさ（各辺 max(1, round(w / n))）
export function divSize(w, h, n) {
  return { w: Math.max(1, Math.round(w / n)), h: Math.max(1, Math.round(h / n)) };
}

export const GIF_MAX_SIDE = 2048;
export const GIF_MAX_PIXELS = 100000000;   // 1コマの画素数 × コマ数
export const GIF_MAX_FRAMES = 500;

// GIF で書き出せるか：長い辺 2048 以下、かつ 1コマの画素数 × コマ数が 1 億以下
export function gifExportCheck(w, h, frames) {
  return Math.max(w, h) <= GIF_MAX_SIDE && w * h * frames <= GIF_MAX_PIXELS;
}

// GIF の待ち時間（ms）。10ms 以下は 100ms（ブラウザと同じ扱い）
export function gifDelay(ms) {
  return ms <= 10 ? 100 : ms;
}

// ---- 第3段 ----

export const APNG_MAX_PIXELS = 1e9;   // 1コマの画素数 × コマ数

// APNG で書き出せるか：長い辺が limit 以下、かつ 1コマの画素数 × コマ数が 10 億以下
export function apngExportCheck(w, h, frames, limit) {
  return Math.max(w, h) <= limit && w * h * frames <= APNG_MAX_PIXELS;
}

// MP4 の大きさ：幅・高さを偶数に切り下げる（右端・下端の1列を落とす）
export function mp4Size(w, h) {
  return { w: w - (w % 2), h: h - (h % 2) };
}

// MP4 のコーデック文字列。1コマのマクロブロック数（16x16 の数）で選ぶ。書き出せない大きさは null
export function mp4Codec(w, h) {
  if (w < 2 || h < 2) return null;
  const mb = Math.ceil(w / 16) * Math.ceil(h / 16);
  if (mb <= 36864) return 'avc1.640033';    // High 5.1
  if (mb <= 139264) return 'avc1.64003C';   // High 6.0
  return null;
}

// RGBA（w x h）の左上 ew x eh を切り出す。同じ大きさなら元のまま
export function cropRgba(rgba, w, h, ew, eh) {
  if (ew === w && eh === h) return rgba;
  const out = new Uint8ClampedArray(ew * eh * 4);
  for (let y = 0; y < eh; y++) out.set(rgba.subarray(y * w * 4, y * w * 4 + ew * 4), y * ew * 4);
  return out;
}

// ---- 第4段 ----

// 切り抜きの書き出しの大きさ。ratio = [rw, rh]、zoom = 今の拡大率。
// 単位 u = max(1, floor(rect.h × zoom / rh))、大きさは (rw × u) x (rh × u)（比率がぴったり保たれる）。
// even のとき（MP4）は、幅・高さが偶数になるよう u を偶数に切り上げる
export function cropOutSize(rect, zoom, ratio, even) {
  const [rw, rh] = ratio;
  let u = Math.max(1, Math.floor(rect.h * zoom / rh + 1e-9));
  if (even && u % 2 === 1 && (rw % 2 === 1 || rh % 2 === 1)) u++;
  return { w: rw * u, h: rh * u };
}

// 枠を画像（imgW x imgH）に収める。画像より大きいときは比率を保って縮め、短い辺が最小（minSide）を割るときは
// 画像に収まる範囲で大きくし、はみ出すときは押し戻す。中心を保って大きさを直し、そのあと位置を押し戻す
export function fitCropRect(rect, imgW, imgH, minSide = 4) {
  let { w, h } = rect;
  const cx = rect.x + w / 2, cy = rect.y + h / 2;
  let k = 1;
  if (Math.min(w, h) < minSide) k = minSide / Math.min(w, h);
  k = Math.min(k, imgW / w, imgH / h);
  w *= k; h *= k;
  const x = Math.min(Math.max(0, cx - w / 2), imgW - w);
  const y = Math.min(Math.max(0, cy - h / 2), imgH - h);
  return { x, y, w, h };
}

// 比率 ratio の枠を新しく作る。中心 (cx, cy)・高さ h を指定する（h が無いときは、見えている範囲 visW x visH の 60% に収まる一番大きな枠）
export function makeCropRect(ratio, cx, cy, imgW, imgH, visW, visH, h) {
  const [rw, rh] = ratio;
  if (h === undefined) {
    const w = Math.min(0.6 * visW, 0.6 * visH * rw / rh);
    h = w * rh / rw;
  }
  const w = h * rw / rh;
  return fitCropRect({ x: cx - w / 2, y: cy - h / 2, w, h }, imgW, imgH);
}

// 縁・角のドラッグで枠の大きさを変える（比率は start のまま）。座標は処理する画像の画素。
// handle：'n' 's' 'e' 'w'（縁）、'nw' 'ne' 'sw' 'se'（角）。pointer = { x, y }。start（ドラッグを始めたときの枠）から計算する
//   角：向かいの角を止め、幅から決めた大きさと高さから決めた大きさの大きい方
//   左右の縁：向かいの縁を止め、高さは比率から決めて縦の中心を保つ。上下の縁は縦横を入れ替えたもの
//   画像の外へは広げず（止めた側は動かさない）、短い辺は minSide で止まる（裏返らない）
export function resizeCropRect(start, handle, pointer, imgW, imgH, minSide = 4) {
  const r = start.w / start.h;
  const wMin = r >= 1 ? minSide * r : minSide;
  const east = handle.includes('e'), west = handle.includes('w');
  const south = handle.includes('s'), north = handle.includes('n');
  let w;
  let x, y;
  if (handle.length === 2) {
    const sx = east ? 1 : -1, sy = south ? 1 : -1;
    const ax = east ? start.x : start.x + start.w, ay = south ? start.y : start.y + start.h;
    const dw = (pointer.x - ax) * sx, dh = (pointer.y - ay) * sy;
    w = Math.max(dw, dh * r);
    const wMax = Math.min(sx > 0 ? imgW - ax : ax, (sy > 0 ? imgH - ay : ay) * r);
    w = Math.min(Math.max(w, wMin), Math.max(wMin, wMax));
    const h = w / r;
    x = sx > 0 ? ax : ax - w;
    y = sy > 0 ? ay : ay - h;
    return { x, y, w, h };
  }
  if (east || west) {
    const sx = east ? 1 : -1;
    const ax = east ? start.x : start.x + start.w;
    const cy = start.y + start.h / 2;
    w = (pointer.x - ax) * sx;
    const wMax = Math.min(sx > 0 ? imgW - ax : ax, 2 * Math.min(cy, imgH - cy) * r);
    w = Math.min(Math.max(w, wMin), Math.max(wMin, wMax));
    const h = w / r;
    return { x: sx > 0 ? ax : ax - w, y: cy - h / 2, w, h };
  }
  const sy = south ? 1 : -1;
  const ay = south ? start.y : start.y + start.h;
  const cx = start.x + start.w / 2;
  let h = (pointer.y - ay) * sy;
  const hMin = wMin / r;
  const hMax = Math.min(sy > 0 ? imgH - ay : ay, 2 * Math.min(cx, imgW - cx) / r);
  h = Math.min(Math.max(h, hMin), Math.max(hMin, hMax));
  w = h * r;
  return { x: cx - w / 2, y: sy > 0 ? ay : ay - h, w, h };
}

// ---- 層 0：信号（コンポジットの横のぼけ）。shader.js の SIGNAL_FRAG はこれと同じ式 ----
// 帯域 f（MHz）のときのガウスの幅 σ（画素）。−3dB が f になるガウス。画像の横幅 W 画素 = 走査線の映る部分（lineUs µs）
export function compositeSigma(W, f) {
  return SIGNAL.sigmaK / f / (SIGNAL.lineUs / W);
}
// ぼかす範囲（片側の画素数）= ±range σ、最低 1
export function compositeRadius(sigma) {
  return Math.max(1, Math.ceil(SIGNAL.range * sigma));
}
// 1 行（rgbRow = [r, g, b, r, g, b, ...]、0〜1、sRGB のまま）を YIQ で横にぼかして RGB に戻す（0〜1 に切り詰め）。
// Y は yMHz、I・Q は cMHz の帯域。画像の左右の外は 0（重みは範囲全体の合計で割る）
export function compositeRow(rgbRow, W, yMHz, cMHz) {
  const Y = new Float64Array(W), I = new Float64Array(W), Q = new Float64Array(W);
  for (let x = 0; x < W; x++) {
    const r = rgbRow[3 * x], g = rgbRow[3 * x + 1], b = rgbRow[3 * x + 2];
    Y[x] = 0.299 * r + 0.587 * g + 0.114 * b;
    I[x] = 0.596 * r - 0.274 * g - 0.322 * b;
    Q[x] = 0.211 * r - 0.523 * g + 0.312 * b;
  }
  const blur = (v, f) => {
    const s = compositeSigma(W, f), R = compositeRadius(s);
    const w = new Float64Array(2 * R + 1);
    let ws = 0;
    for (let d = -R; d <= R; d++) { w[d + R] = Math.exp(-d * d / (2 * s * s)); ws += w[d + R]; }
    const out = new Float64Array(W);
    for (let x = 0; x < W; x++) {
      let a = 0;
      for (let d = -R; d <= R; d++) {
        const k = x + d;
        if (k >= 0 && k < W) a += w[d + R] * v[k];
      }
      out[x] = a / ws;
    }
    return out;
  };
  const By = blur(Y, yMHz), Bi = blur(I, cMHz), Bq = blur(Q, cMHz);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const out = new Float64Array(3 * W);
  for (let x = 0; x < W; x++) {
    out[3 * x] = clamp01(By[x] + 0.956 * Bi[x] + 0.621 * Bq[x]);
    out[3 * x + 1] = clamp01(By[x] - 0.272 * Bi[x] - 0.647 * Bq[x]);
    out[3 * x + 2] = clamp01(By[x] - 1.106 * Bi[x] + 1.703 * Bq[x]);
  }
  return out;
}

// ---- BLOOM（明るい色の表面のにじみ）。shader.js の BLOOM_SRC_FRAG・BLOOM_BLUR_FRAG はこれと同じ式 ----
// 元：リニアの色 rgbLinear（0〜）に EXPOSURE を掛けた c から、c × min(Y, 1)^pow。暗い色ほど小さい
export function bloomSource(rgbLinear, exposure) {
  const c = rgbLinear.map((v) => v * exposure);
  const Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const k = Math.pow(Math.min(Y, 1), BLOOM.pow);
  return c.map((v) => v * k);
}
// B SIZE のときの2枚のガウス。σ（元画素）・片側の画素数 R = ceil(range σ)・R の範囲で合計 1 に直した1次元の重み・足す重み。
// margin = 2枚目の R = にじみのテクスチャが元画像の周りに足す余白（元画素）
export function bloomKernel(size) {
  const gauss = BLOOM.sigmas.map((k) => {
    const sigma = k * size, R = Math.max(1, Math.ceil(BLOOM.rangeSigmas * sigma));
    const w = new Float64Array(2 * R + 1);
    let sum = 0;
    for (let d = -R; d <= R; d++) { w[d + R] = Math.exp(-d * d / (2 * sigma * sigma)); sum += w[d + R]; }
    for (let i = 0; i < w.length; i++) w[i] /= sum;
    return { sigma, R, w };
  });
  return { gauss, weights: BLOOM.weights, margin: gauss[1].R };
}
