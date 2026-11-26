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
  const W = 320, H = 240;
  const px = new Uint8ClampedArray(W * H * 4);
  const bars = [[1, 1, 1], [1, 1, 0], [0, 1, 1], [0, 1, 0], [1, 0, 1], [1, 0, 0], [0, 0, 1], [0, 0, 0]];
  const bands = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1]];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c;
      if (y < H / 2) {
        c = bars[Math.floor(x / (W / 8))];
      } else {
        const band = bands[Math.floor((y - H / 2) / (H / 2 / 4))];
        const v = Math.floor(x * 11 / W) / 10;
        c = [band[0] * v, band[1] * v, band[2] * v];
      }
      const o = (y * W + x) * 4;
      px[o] = Math.round(c[0] * 255);
      px[o + 1] = Math.round(c[1] * 255);
      px[o + 2] = Math.round(c[2] * 255);
      px[o + 3] = 255;
    }
  }
  return { data: px, w: W, h: H };
}

// 状態の文字
//   静止画  IN 1920x1080 → 640x360   x8.0
//   1/n     IN 1920x1080 → 1/4 → 480x270   x8.0
//   GIF     IN 320x240 (24f) → 320x240   x4.0
// opt = { div, frames, note }。note は最後に付ける注意書き
export function statusText(inW, inH, w, h, zoom, opt = {}) {
  const z = zoom < 1 ? zoom.toFixed(2) : zoom.toFixed(1);
  const f = opt.frames > 1 ? ` (${opt.frames}f)` : '';
  const d = opt.div > 1 ? ` → 1/${opt.div}` : '';
  const note = opt.note ? ` ${opt.note}` : '';
  return `IN ${inW}x${inH}${f}${d} → ${w}x${h}   x${z}${note}`;
}

// ガンマ関数（Lanczos 近似）。穴の面積の計算だけに使う
function gamma(z) {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let x = c[0];
  const t = z + g + 0.5;
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

// 穴の面積 ÷ 升目の面積。超楕円 |x/a|^n + |y/b|^n <= 1 の面積は 4ab Γ(1+1/n)^2 / Γ(1+2/n)。
// 升目の大きさは 1（DELTA だけ 0.866）。b = 0（縦を切らない）は幅 2a の帯
export function holeAreaFraction(mask) {
  const cell = mask.id === 3 ? 0.8660254 : 1;
  const area = mask.b === 0
    ? 2 * mask.a
    : 4 * mask.a * mask.b * gamma(1 + 1 / mask.n) ** 2 / gamma(1 + 2 / mask.n);
  return Math.min(1, area / cell);
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
