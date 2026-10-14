// render.js — 表示範囲だけを 1セル=1px の ImageData に描き、整数倍で補間なしに拡大する
// 2 面：まず作業面でない面を透明度つきで描き、その上に作業面を不透明で描く（作業面の EMPTY は透けて下の面が見える）
// 縮小（x0.5 / x0.33 / x0.25）：n×n セルを 1 ピクセルにまとめる（中身は等倍のまま、表示だけ引く）
import { M, COL_ON, COL_OFF, COL_LAMP, COL_LAMP_EDIT, COL_OOB, COL_EMPTY, FADE_STEPS, LAMP_ON } from './materials.js';
import { W, H, CHX, CHN, CH_SHIFT, CH_SIZE, CH_MASK, Y_SHIFT, layerBase } from './world.js';

const SCALES = [0.25, 0.33, 0.5, 1, 2, 4, 8, 16, 32];
// GLOW は 0〜100%（t = 0〜1）。100% = 半径 2 セル（σ = 半径/2 + 0.25）・減光 75%。0% = Off（ぼかしも減光もなし）
// 半径 R = 2t、減光 = 1 - 0.25t
const GLOW_RMAX = 2;
const GLOW_GAIN = 0.7;   // にじみの強さ（暫定）
// 縮小時にブロックの色を決める順位（大きいほど優先）
const RANK = [];
RANK[M.EMPTY] = 0; RANK[M.CROSS] = 2; RANK[M.INVERT] = 3; RANK[M.BUFFER] = 3; RANK[M.HOLE] = 4;
RANK[M.INPUT] = 5; RANK[M.OUTPUT] = 5; RANK[M.WIRE] = 6; RANK[M.TFF] = 7; RANK[M.LAMP] = 8;

// ABGR の色を a/256 に暗くする（黒の上に重ねるのと同じ）
const shade = (c, a) => (0xff000000 | ((((c >> 16) & 255) * a >> 8) << 16) | ((((c >> 8) & 255) * a >> 8) << 8) | ((c & 255) * a >> 8)) >>> 0;

// 減光した色表（LAMP と T-FF はそのまま）。レベルごとに1回だけ作る
// a = 何 /256 にするか。値が変わったときだけ作り直す
let dimCache = null;
function dimTables(a) {
  if (!dimCache || dimCache.a !== a) {
    const f = (t) => Array.from(t, (c, m) => (a === 256 || m === M.TFF || m === M.LAMP) ? c : shade(c, a));
    dimCache = { a, on: f(COL_ON), off: f(COL_OFF) };
  }
  return dimCache;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.off = document.createElement('canvas');
    this.offCtx = this.off.getContext('2d');
    this.img = null; this.u32 = null;
    this.gcv = document.createElement('canvas');   // GLOW：光る LAMP だけの 1セル=1px の画像（まわりに余白つき）
    this.gctx = this.gcv.getContext('2d');
    this.gimg = null; this.g32 = null;
    this.dpr = 1;
    // n = 1 ピクセル（ブロック）が表すセルの一辺（x1 以上は 1、x0.5 / x0.33 / x0.25 は 2 / 3 / 4）
    // ds = n が 1 のときは 1セルのデバイスピクセル数、n が 2 以上のときは 1ブロックのデバイスピクセル数
    // pan は ds の単位（縮小中、ブロックの区切りはキャンバス座標の n の倍数で固定されるので、パンは n セル単位になる）
    this.view = { scaleIdx: 3, scale: 1, n: 1, ds: 1, panX: 0, panY: 0 };
  }

  // 表示サイズ（CSS px）に合わせて canvas の実ピクセル数を決める
  resize(cssW, cssH) {
    this.dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(cssW * this.dpr)), h = Math.max(1, Math.round(cssH * this.dpr));
    this.canvas.width = w; this.canvas.height = h;
    this.canvas.style.width = (w / this.dpr) + 'px';
    this.canvas.style.height = (h / this.dpr) + 'px';
    this.setScaleIdx(this.view.scaleIdx, null);
  }

  // 倍率の添字 idx の { n, ds }
  geom(idx) {
    const sc = SCALES[idx];
    return sc < 1 ? { n: Math.round(1 / sc), ds: Math.max(1, Math.round(this.dpr)) } : { n: 1, ds: Math.max(1, Math.round(sc * this.dpr)) };
  }

  // 倍率の変更。anchor = {sx, sy}（canvas 実ピクセル）の下のセル（縮小中はブロック）を動かさない
  setScaleIdx(idx, anchor) {
    const v = this.view;
    idx = Math.max(0, Math.min(SCALES.length - 1, idx));
    const oldDs = v.ds, oldN = v.n;
    let cx, cy, fx = 0, fy = 0;
    if (anchor) {
      const px = (anchor.sx - v.panX) / oldDs * oldN, py = (anchor.sy - v.panY) / oldDs * oldN;
      cx = Math.floor(px); cy = Math.floor(py); fx = px - cx; fy = py - cy;
    }
    const g = this.geom(idx);
    v.scaleIdx = idx; v.scale = SCALES[idx]; v.n = g.n; v.ds = g.ds;
    if (anchor) {
      const n = g.n, bx = Math.floor(cx / n), by = Math.floor(cy / n);
      v.panX = Math.round(anchor.sx - bx * v.ds - Math.floor((cx - bx * n + fx) / n * v.ds));
      v.panY = Math.round(anchor.sy - by * v.ds - Math.floor((cy - by * n + fy) / n * v.ds));
    }
  }

  // 画面実ピクセル -> セル座標（縮小中は、そのブロックの左上のセル）
  cellAt(sx, sy) {
    const v = this.view;
    return { x: Math.floor((sx - v.panX) / v.ds) * v.n, y: Math.floor((sy - v.panY) / v.ds) * v.n };
  }

  // セル (x,y) を画面中央に置く
  centerOn(x, y, tx = this.canvas.width / 2, ty = this.canvas.height / 2) {
    const v = this.view;
    v.panX = Math.round(tx - (x + 0.5) / v.n * v.ds);
    v.panY = Math.round(ty - (y + 0.5) / v.n * v.ds);
  }

  // セル矩形 (x0,y0,w,h) が見える範囲 vis = {cx, cy, w, h}（canvas 実ピクセル）に収まる最大の倍率にして、中央に置く。収まらなければ最小の倍率
  fitRect(x0, y0, w, h, vis) {
    let idx = 0;
    for (let k = SCALES.length - 1; k >= 0; k--) {
      const g = this.geom(k);
      if (w * g.ds / g.n <= vis.w && h * g.ds / g.n <= vis.h) { idx = k; break; }
    }
    this.setScaleIdx(idx, null);
    this.centerOn(x0 + w / 2 - 0.5, y0 + h / 2 - 0.5, vis.cx, vis.cy);
  }

  // セル矩形 -> 画面実ピクセル（縮小中は、かかるブロックをすべて含む）
  rect(x, y, w, h) {
    const v = this.view, n = v.n;
    if (n === 1) return [v.panX + x * v.ds, v.panY + y * v.ds, w * v.ds, h * v.ds];
    const bx0 = Math.floor(x / n), by0 = Math.floor(y / n), bx1 = Math.ceil((x + w) / n), by1 = Math.ceil((y + h) / n);
    return [v.panX + bx0 * v.ds, v.panY + by0 * v.ds, (bx1 - bx0) * v.ds, (by1 - by0) * v.ds];
  }

  // layer = 作業面（0 = FRONT, 1 = BACK）、otherPct = もう一方の面の透明度（0〜100）、editing = STOP 中（消灯の LAMP をその色の暗い版で出す）
  draw(world, topo, glowPct, layer, otherPct, overlay, editing = false) {
    const { ctx, canvas, view } = this;
    const ds = view.ds, n = view.n, cw = canvas.width, ch = canvas.height;
    const cols = Math.ceil(cw / ds) + 1, rows = Math.ceil(ch / ds) + 1;   // n が 2 以上のときは、ブロックの数
    const sx = Math.floor(-view.panX / ds), sy = Math.floor(-view.panY / ds);
    const shX = -view.panX - sx * ds, shY = -view.panY - sy * ds;
    if (!this.img || this.off.width !== cols || this.off.height !== rows) {
      this.off.width = cols; this.off.height = rows;
      this.img = this.offCtx.createImageData(cols, rows);
      this.u32 = new Uint32Array(this.img.data.buffer);
    }
    const u32 = this.u32, mat = world.mat, aux = world.aux, owner = world.owner;
    const live = topo && !world.dirty;
    const nodeNet = live ? topo.nodeNet : null, crossNet = live ? topo.crossNet : null;
    const netVal = live ? topo.netVal : null, inVal = live ? topo.inVal : null, outVal = live ? topo.outVal : null;
    const bodyGate = live ? topo.bodyGate : null, gateOut = live ? topo.gateOut : null, gateFade = live ? topo.gateFade : null;
    const gt = Math.max(0, Math.min(100, glowPct)) / 100;
    const glowR = GLOW_RMAX * gt;   // 0 = Off
    const { on: tOn, off: tOff } = dimTables(glowR ? Math.round(256 * (1 - 0.25 * gt)) : 256);
    const FS = FADE_STEPS + 1;
    const baseA = layerBase(layer), baseB = layerBase(layer ^ 1);
    const chA = layer * CHN, chB = (layer ^ 1) * CHN;
    const a256 = Math.round(otherPct * 256 / 100), alpha = otherPct / 100, showB = a256 > 0;

    // GLOW：光る LAMP のセルだけを描いた画像（黒地）。画面の外も半径ぶん（+1）描く
    const gM = glowR ? Math.ceil(glowR) + 1 : 0, gcols = cols + 2 * gM, grows = rows + 2 * gM;
    let g32 = null, gUsed = false;
    if (glowR) {
      if (!this.gimg || this.gcv.width !== gcols || this.gcv.height !== grows) {
        this.gcv.width = gcols; this.gcv.height = grows;
        this.gimg = this.gctx.createImageData(gcols, grows);
        this.g32 = new Uint32Array(this.gimg.data.buffer);
      }
      g32 = this.g32;
    }
    const markLamp = (cx, cy, c, inten) => {
      if (!gUsed) { g32.fill(0xff000000); gUsed = true; }
      const col = LAMP_ON[c];
      const r = ((col >> 16) & 255) * inten, g = ((col >> 8) & 255) * inten, b = (col & 255) * inten;
      g32[(cy + gM) * gcols + cx + gM] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
    };

    // セル i（素材 m）が今 ON か。「どのセルが ON か」の規則は sim.js の cellOn と同じ（LAMP は少しでも光っていれば ON）。縮小時の同順位の選び方に使う
    const onOf = (i, m) => {
      if (!live) return 0;
      switch (m) {
        case M.WIRE: case M.HOLE: return netVal[nodeNet[owner[i]]] ? 1 : 0;
        case M.CROSS: { const o = owner[i] * 2, h = crossNet[o], v = crossNet[o + 1]; return ((h >= 0 && netVal[h] === 1) || (v >= 0 && netVal[v] === 1)) ? 1 : 0; }
        case M.LAMP: return gateFade[bodyGate[owner[i]]] > 0 ? 1 : 0;
        case M.INPUT: return inVal[owner[i]] ? 1 : 0;
        case M.OUTPUT: return outVal[owner[i]] ? 1 : 0;
        case M.INVERT: case M.TFF: case M.BUFFER: return gateOut[bodyGate[owner[i]]] ? 1 : 0;
        default: return 0;
      }
    };

    // セル i（素材 m）の画面色（速さのため onOf の規則を展開してある）。
    // LAMP は光っていれば GLOW 用に記録する（wt = その面の濃さ）。(cx, cy) は画像の中の位置
    const colorOf = (i, m, cx, cy, wt) => {
      switch (m) {
        case M.WIRE: case M.HOLE: return (live && netVal[nodeNet[owner[i]]]) ? tOn[m] : tOff[m];
        case M.CROSS: {
          let on = false;
          if (live) { const o = owner[i] * 2, h = crossNet[o], v = crossNet[o + 1]; on = (h >= 0 && netVal[h] === 1) || (v >= 0 && netVal[v] === 1); }
          return on ? tOn[m] : tOff[m];
        }
        case M.LAMP: {
          let lv = 0, f = 0;
          if (live) { f = gateFade[bodyGate[owner[i]]]; lv = Math.ceil(f * FADE_STEPS - 1e-6); }
          if (glowR && lv >= FADE_STEPS - 1) markLamp(cx, cy, aux[i] & 15, f * wt);
          return (editing && lv === 0) ? COL_LAMP_EDIT[aux[i] & 15] : COL_LAMP[(aux[i] & 15) * FS + lv];
        }
        case M.INPUT: return (live && inVal[owner[i]]) ? tOn[m] : tOff[m];
        case M.OUTPUT: return (live && outVal[owner[i]]) ? tOn[m] : tOff[m];
        case M.INVERT: case M.TFF: case M.BUFFER: return (live && gateOut[bodyGate[owner[i]]]) ? tOn[m] : tOff[m];
        default: return COL_EMPTY;
      }
    };

    if (n === 1) {
      for (let cy = 0; cy < rows; cy++) {
        const y = sy + cy;
        const rowOff = cy * cols;
        if (y < 0 || y >= H) { u32.fill(COL_OOB, rowOff, rowOff + cols); continue; }
        const cx0 = Math.max(0, -sx), cx1 = Math.min(cols, W - sx); // 範囲内の列
        if (cx0 > 0) u32.fill(COL_OOB, rowOff, rowOff + Math.min(cx0, cols));
        if (cx1 < cols) u32.fill(COL_OOB, rowOff + Math.max(cx1, 0), rowOff + cols);
        let p = (y << Y_SHIFT) + sx + cx0;
        const chRow = (y >> CH_SHIFT) * CHX;
        for (let cx = cx0; cx < cx1; cx++, p++) {
          if ((((sx + cx) & CH_MASK) === 0 || cx === cx0) && cx < cx1) {
            // チャンク先頭：両面とも中身が空のチャンクは行ごと黒で埋めて飛ばす
            const ax = sx + cx, segEnd = Math.min(cx1, cx + CH_SIZE - (ax & CH_MASK)), ci = chRow + (ax >> CH_SHIFT);
            if (!world.chunkCount[chA + ci] && (!showB || !world.chunkCount[chB + ci])) {
              u32.fill(COL_EMPTY, rowOff + cx, rowOff + segEnd); p += segEnd - cx - 1; cx = segEnd - 1; continue;
            }
          }
          const ma = mat[baseA + p];
          if (ma) { u32[rowOff + cx] = colorOf(baseA + p, ma, cx, cy, 1); continue; }
          const mb = showB ? mat[baseB + p] : 0;
          u32[rowOff + cx] = mb ? shade(colorOf(baseB + p, mb, cx, cy, Math.max(alpha, 0.5)), a256) : COL_EMPTY;
        }
      }
      // 画面のすぐ外にある LAMP の光（画面の中は上のループで記録済み）
      if (glowR) {
        for (let by = -gM; by < rows + gM; by++) {
          const y = sy + by; if (y < 0 || y >= H) continue;
          const inner = by >= 0 && by < rows;
          for (let bx = -gM; bx < cols + gM; bx++) {
            if (inner && bx === 0) { bx = cols - 1; continue; }
            const x = sx + bx; if (x < 0 || x >= W) continue;
            const p = (y << Y_SHIFT) + x;
            if (mat[baseA + p]) { if (mat[baseA + p] === M.LAMP) colorOf(baseA + p, M.LAMP, bx, by, 1); }
            else if (showB && mat[baseB + p] === M.LAMP) colorOf(baseB + p, M.LAMP, bx, by, Math.max(alpha, 0.5));
          }
        }
      }
    } else {
      // 縮小：n×n セルを 1 ピクセルにする。ブロックの区切りはキャンバス座標の n の倍数。
      // 順位は RANK、同順位は ON を優先、それでも並べば左上から読んで最初のセル。作業面のブロックが全部空なら反対の面を同じ規則で選ぶ
      let pm = 0;
      const pick = (base, x0, y0, x1, y1) => {
        let bi = -1, bm = 0, br = 0, bon = -1;
        for (let y = y0; y < y1; y++) {
          let i = base + (y << Y_SHIFT) + x0;
          for (let x = x0; x < x1; x++, i++) {
            const m = mat[i]; if (!m) continue;
            const r = RANK[m]; if (r < br) continue;
            if (r > br) { br = r; bi = i; bm = m; bon = -1; continue; }
            if (bon < 0) bon = onOf(bi, bm);
            if (bon === 1) continue;
            if (onOf(i, m) === 1) { bi = i; bm = m; bon = 1; }
          }
        }
        pm = bm; return bi;
      };
      const WB = Math.ceil(W / n), HB = Math.ceil(H / n);
      const cnt = world.chunkCount;
      for (let by = 0; by < rows; by++) {
        const yb = sy + by, rowOff = by * cols;
        if (yb < 0 || yb >= HB) { u32.fill(COL_OOB, rowOff, rowOff + cols); continue; }
        const y0 = yb * n, y1 = Math.min(H, y0 + n), r0 = y0 >> CH_SHIFT, r1 = (y1 - 1) >> CH_SHIFT;
        const cx0 = Math.max(0, -sx), cx1 = Math.min(cols, WB - sx);
        if (cx0 > 0) u32.fill(COL_OOB, rowOff, rowOff + Math.min(cx0, cols));
        if (cx1 < cols) u32.fill(COL_OOB, rowOff + Math.max(cx1, 0), rowOff + cols);
        for (let bx = cx0; bx < cx1; bx++) {
          const x0 = (sx + bx) * n, x1 = Math.min(W, x0 + n), c0 = x0 >> CH_SHIFT, c1 = (x1 - 1) >> CH_SHIFT;
          let empty = true;
          for (let r = r0; r <= r1 && empty; r++) for (let c = c0; c <= c1; c++) {
            const ci = r * CHX + c;
            if (cnt[chA + ci] || (showB && cnt[chB + ci])) { empty = false; break; }
          }
          if (empty) {
            if (r0 === r1 && c0 === c1) {
              // 空のチャンクの中にまるごと入るブロックは、まとめて飛ばす
              let nb = Math.floor(((c0 + 1) << CH_SHIFT) / n) - sx;
              if (nb > cx1) nb = cx1;
              if (nb <= bx) nb = bx + 1;
              u32.fill(COL_EMPTY, rowOff + bx, rowOff + nb); bx = nb - 1;
            } else u32[rowOff + bx] = COL_EMPTY;
            continue;
          }
          let i = pick(baseA, x0, y0, x1, y1);
          if (i >= 0) { u32[rowOff + bx] = colorOf(i, pm, bx, by, 1); continue; }
          if (showB) {
            i = pick(baseB, x0, y0, x1, y1);
            if (i >= 0) { u32[rowOff + bx] = shade(colorOf(i, pm, bx, by, Math.max(alpha, 0.5)), a256); continue; }
          }
          u32[rowOff + bx] = COL_EMPTY;
        }
      }
      if (glowR) {
        for (let by = -gM; by < rows + gM; by++) {
          const yb = sy + by; if (yb < 0 || yb >= HB) continue;
          const inner = by >= 0 && by < rows;
          const y0 = yb * n, y1 = Math.min(H, y0 + n);
          for (let bx = -gM; bx < cols + gM; bx++) {
            if (inner && bx === 0) { bx = cols - 1; continue; }
            const xb = sx + bx; if (xb < 0 || xb >= WB) continue;
            const x0 = xb * n, x1 = Math.min(W, x0 + n);
            let i = pick(baseA, x0, y0, x1, y1);
            if (i >= 0) { if (pm === M.LAMP) colorOf(i, pm, bx, by, 1); continue; }
            if (showB) { i = pick(baseB, x0, y0, x1, y1); if (i >= 0 && pm === M.LAMP) colorOf(i, pm, bx, by, Math.max(alpha, 0.5)); }
          }
        }
      }
    }

    this.offCtx.putImageData(this.img, 0, 0);
    if (glowR && gUsed) this.applyGlow(glowR, gM);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.off, 0, 0, cols, rows, -shX, -shY, cols * ds, rows * ds);
    if (overlay) overlay(ctx, this);
  }

  // 光る LAMP の画像（1セル=1px）にぼかしをかけ、描画用の画像（これも1セル=1px）に加算で重ねる。整数倍の拡大はこのあと（補間なし）
  applyGlow(R, gM) {
    const o = this.offCtx;
    if (!('filter' in o)) return;   // canvas の filter が無いブラウザではにじみなし
    this.gctx.putImageData(this.gimg, 0, 0);
    const sigma = R / 2 + 0.25, gain = GLOW_GAIN * 2 * Math.PI * sigma * sigma;
    o.save();
    o.globalCompositeOperation = 'lighter';
    o.filter = `blur(${sigma}px) brightness(${gain})`;
    o.drawImage(this.gcv, -gM, -gM);
    o.restore();
  }
}
