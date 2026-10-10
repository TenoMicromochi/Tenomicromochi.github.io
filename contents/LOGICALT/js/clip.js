// clip.js — セルのバッファ（コピー・移動・貼り付け・回転・反転）
// バッファ b = { w, h, n, layers: [{mat, aux}, ...], canvas }
//   n = 2：両面ぶん（layers[0] = 表、layers[1] = 裏）。貼り付けると表は表、裏は裏に入る
//   n = 1：1 面ぶん（layers[0]）。貼り付けると、貼り付けたときの作業面に入る
import { saveRgb } from './materials.js';
import { W, H, cellIndex } from './world.js';

// world の矩形（両端を含む）から取り出す。layers = [0, 1]（両面）か [面]（1 面）
export function copyRegion(world, s, layerIds) {
  const w = s.x1 - s.x0 + 1, h = s.y1 - s.y0 + 1;
  const planes = layerIds.map((ly) => {
    const mat = new Uint8Array(w * h), aux = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const i0 = cellIndex(ly, s.x0, s.y0 + y);
      mat.set(world.mat.subarray(i0, i0 + w), y * w);
      aux.set(world.aux.subarray(i0, i0 + w), y * w);
    }
    return { mat, aux };
  });
  return { w, h, n: planes.length, layers: planes, canvas: null };
}

// 読み込んだ画像（storage.js の decode の結果）をバッファにする
export function bufFromDecoded(dec) {
  const planes = dec.layers.filter(Boolean);
  return { w: dec.w, h: dec.h, n: planes.length, layers: planes, canvas: null };
}

export function cloneBuf(b) {
  return { w: b.w, h: b.h, n: b.n, layers: b.layers.map((q) => ({ mat: q.mat.slice(), aux: q.aux.slice() })), canvas: null };
}

// 回転（cw = 時計回り 90°）
export function rotateBuf(b, cw) {
  const w = b.w, h = b.h, nw = h, nh = w;
  const planes = b.layers.map((q) => {
    const mat = new Uint8Array(nw * nh), aux = new Uint8Array(nw * nh);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const nx = cw ? h - 1 - y : y, ny = cw ? x : w - 1 - x;
      mat[ny * nw + nx] = q.mat[y * w + x]; aux[ny * nw + nx] = q.aux[y * w + x];
    }
    return { mat, aux };
  });
  return { w: nw, h: nh, n: b.n, layers: planes, canvas: null };
}

// 反転（horizontal = 左右）
export function flipBuf(b, horizontal) {
  const w = b.w, h = b.h;
  const planes = b.layers.map((q) => {
    const mat = new Uint8Array(w * h), aux = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const nx = horizontal ? w - 1 - x : x, ny = horizontal ? y : h - 1 - y;
      mat[ny * w + nx] = q.mat[y * w + x]; aux[ny * w + nx] = q.aux[y * w + x];
    }
    return { mat, aux };
  });
  return { w, h, n: b.n, layers: planes, canvas: null };
}

// プレビュー用の画像（EMPTY は透明）。面ごとに 1 枚
export function bufCanvas(b) {
  if (b.canvas) return b.canvas;
  b.canvas = b.layers.map((q) => {
    const c = document.createElement('canvas'); c.width = b.w; c.height = b.h;
    const ctx = c.getContext('2d'), img = ctx.createImageData(b.w, b.h);
    for (let p = 0, o = 0; p < b.w * b.h; p++, o += 4) {
      if (!q.mat[p]) continue;
      const rgb = saveRgb(q.mat[p], q.aux[p]);
      img.data[o] = (rgb >> 16) & 255; img.data[o + 1] = (rgb >> 8) & 255; img.data[o + 2] = rgb & 255; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  });
  return b.canvas;
}

// バッファの各面が書き込まれる面の番号（n = 1 のときは作業面 active）
export const bufLayers = (b, active) => (b.n === 2 ? [0, 1] : [active]);

// world に書き込む。mode: 'ALL' = EMPTY も上書き / 'CIRCUIT' = EMPTY 以外だけ（面ごとに適用）
export function placeBuf(world, b, x, y, mode, active) {
  const layers = bufLayers(b, active);
  for (let k = 0; k < b.n; k++) {
    const layer = layers[k], q = b.layers[k];
    for (let cy = 0; cy < b.h; cy++) {
      const ty = y + cy; if (ty < 0 || ty >= H) continue;
      for (let cx = 0; cx < b.w; cx++) {
        const tx = x + cx; if (tx < 0 || tx >= W) continue;
        const p = cy * b.w + cx, m = q.mat[p];
        if (mode === 'CIRCUIT' && !m) continue;
        world.edit(cellIndex(layer, tx, ty), m, q.aux[p]);
      }
    }
  }
}

// 矩形 s の中身を消す（layers の面だけ）。HOLE を消すと対も消える
export function eraseRegion(world, s, layers) {
  for (const ly of layers) {
    for (let y = s.y0; y <= s.y1; y++) for (let x = s.x0; x <= s.x1; x++) world.edit(cellIndex(ly, x, y), 0, 0);
  }
}
