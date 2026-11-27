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
// opt = { div, frames, note, out }。note は注意書き、out は書き出しの大きさ（最後に OUT 〜 を付ける）
export function statusText(inW, inH, w, h, zoom, opt = {}) {
  const z = zoom < 1 ? zoom.toFixed(2) : zoom.toFixed(1);
  const f = opt.frames > 1 ? ` (${opt.frames}f)` : '';
  const d = opt.div > 1 ? ` → 1/${opt.div}` : '';
  const note = opt.note ? ` ${opt.note}` : '';
  const out = opt.out ? `   OUT ${opt.out}` : '';
  return `IN ${inW}x${inH}${f}${d} → ${w}x${h}   x${z}${note}${out}`;
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
