// render.js — 表示範囲だけを 1セル=1px の ImageData に描き、整数倍で補間なしに拡大する
// 2 面：まず作業面でない面を透明度つきで描き、その上に作業面を不透明で描く（作業面の EMPTY は透けて下の面が見える）
import { M, COL_ON, COL_OFF, COL_LAMP, COL_LAMP_EDIT, COL_OOB, COL_EMPTY, FADE_STEPS, LAMP_ON } from './materials.js';
import { W, H, CHX, CHN, CH_SHIFT, CH_SIZE, CH_MASK, Y_SHIFT, layerBase } from './world.js';

const SCALES = [1, 2, 4, 8, 16, 32];
const GLOW_R = [0, 1, 2, 3, 4, 5]; // OFF / 1〜5（にじみの半径、セル単位）

// ABGR の色を a/256 に暗くする（黒の上に重ねるのと同じ）
const shade = (c, a) => (0xff000000 | ((((c >> 16) & 255) * a >> 8) << 16) | ((((c >> 8) & 255) * a >> 8) << 8) | ((c & 255) * a >> 8)) >>> 0;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.off = document.createElement('canvas');
    this.offCtx = this.off.getContext('2d');
    this.img = null; this.u32 = null;
    this.dpr = 1;
    this.view = { scaleIdx: 0, scale: 1, ds: 1, panX: 0, panY: 0 };
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

  // 倍率の変更。anchor = {sx, sy}（canvas 実ピクセル）の下のセルを動かさない
  setScaleIdx(idx, anchor) {
    const v = this.view;
    idx = Math.max(0, Math.min(SCALES.length - 1, idx));
    const oldDs = v.ds;
    let cx, cy, fx = 0, fy = 0;
    if (anchor) {
      const px = (anchor.sx - v.panX) / oldDs, py = (anchor.sy - v.panY) / oldDs;
      cx = Math.floor(px); cy = Math.floor(py); fx = px - cx; fy = py - cy;
    }
    v.scaleIdx = idx; v.scale = SCALES[idx];
    v.ds = Math.max(1, Math.round(v.scale * this.dpr));
    if (anchor) {
      v.panX = Math.round(anchor.sx - cx * v.ds - Math.floor(fx * v.ds));
      v.panY = Math.round(anchor.sy - cy * v.ds - Math.floor(fy * v.ds));
    }
  }

  // 画面実ピクセル -> セル座標
  cellAt(sx, sy) {
    const v = this.view;
    return { x: Math.floor((sx - v.panX) / v.ds), y: Math.floor((sy - v.panY) / v.ds) };
  }

  // セル (x,y) を画面中央に置く
  centerOn(x, y, tx = this.canvas.width / 2, ty = this.canvas.height / 2) {
    const v = this.view;
    v.panX = Math.round(tx - (x + 0.5) * v.ds);
    v.panY = Math.round(ty - (y + 0.5) * v.ds);
  }

  // セル矩形 (x0,y0,w,h) が見える範囲 vis = {cx, cy, w, h}（canvas 実ピクセル）に収まる最大の倍率にして、中央に置く
  fitRect(x0, y0, w, h, vis) {
    let idx = 0;
    for (let k = SCALES.length - 1; k >= 0; k--) {
      const ds = Math.max(1, Math.round(SCALES[k] * this.dpr));
      if (w * ds <= vis.w && h * ds <= vis.h) { idx = k; break; }
    }
    this.setScaleIdx(idx, null);
    this.centerOn(x0 + w / 2 - 0.5, y0 + h / 2 - 0.5, vis.cx, vis.cy);
  }

  // セル矩形 -> 画面実ピクセル
  rect(x, y, w, h) {
    const v = this.view;
    return [v.panX + x * v.ds, v.panY + y * v.ds, w * v.ds, h * v.ds];
  }

  // layer = 作業面（0 = FRONT, 1 = BACK）、otherPct = もう一方の面の透明度（0〜100）、editing = STOP 中（消灯の LAMP をその色の暗い版で出す）
  draw(world, topo, glowLevel, layer, otherPct, overlay, editing = false) {
    const { ctx, canvas, view } = this;
    const ds = view.ds, cw = canvas.width, ch = canvas.height;
    const cols = Math.ceil(cw / ds) + 1, rows = Math.ceil(ch / ds) + 1;
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
    const lamps = []; // グロー用 [cx, cy, color, intensity]
    const glowR = GLOW_R[glowLevel] || 0;
    const FS = FADE_STEPS + 1;
    const baseA = layerBase(layer), baseB = layerBase(layer ^ 1);
    const chA = layer * CHN, chB = (layer ^ 1) * CHN;
    const a256 = Math.round(otherPct * 256 / 100), alpha = otherPct / 100, showB = a256 > 0;

    // セル i（素材 m）の画面色。「どのセルが ON か」の規則は sim.js の cellOn と同じ（ここは速さのため展開してある）。
    // LAMP は光っていればグロー用に記録する（wt = その面の濃さ）
    const colorOf = (i, m, cx, cy, wt) => {
      switch (m) {
        case M.WIRE: case M.HOLE: return (live && netVal[nodeNet[owner[i]]]) ? COL_ON[m] : COL_OFF[m];
        case M.CROSS: {
          let on = false;
          if (live) { const o = owner[i] * 2, h = crossNet[o], v = crossNet[o + 1]; on = (h >= 0 && netVal[h] === 1) || (v >= 0 && netVal[v] === 1); }
          return on ? COL_ON[m] : COL_OFF[m];
        }
        case M.LAMP: {
          let lv = 0, f = 0;
          if (live) { f = gateFade[bodyGate[owner[i]]]; lv = Math.ceil(f * FADE_STEPS - 1e-6); }
          if (glowR && lv >= FADE_STEPS - 1 && lamps.length < 40000) lamps.push(cx, cy, aux[i] & 15, f * wt);
          return (editing && lv === 0) ? COL_LAMP_EDIT[aux[i] & 15] : COL_LAMP[(aux[i] & 15) * FS + lv];
        }
        case M.INPUT: return (live && inVal[owner[i]]) ? COL_ON[m] : COL_OFF[m];
        case M.OUTPUT: return (live && outVal[owner[i]]) ? COL_ON[m] : COL_OFF[m];
        case M.INVERT: case M.TFF: case M.BUFFER: return (live && gateOut[bodyGate[owner[i]]]) ? COL_ON[m] : COL_OFF[m];
        default: return COL_EMPTY;
      }
    };

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

    if (glowR && lamps.length) this.applyGlow(lamps, glowR, sx, sy, cols, rows, mat, baseA);

    this.offCtx.putImageData(this.img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.off, 0, 0, cols, rows, -shX, -shY, cols * ds, rows * ds);
    if (overlay) overlay(ctx, this);
  }

  // 作業面のセルがない所に、ON の LAMP の色を距離で薄めて足す（セル自体は変えない）
  applyGlow(lamps, R, sx, sy, cols, rows, mat, baseA) {
    const u32 = this.u32;
    for (let k = 0; k < lamps.length; k += 4) {
      const lx = lamps[k], ly = lamps[k + 1], col = LAMP_ON[lamps[k + 2]], inten = lamps[k + 3];
      const lr = (col >> 16) & 255, lg = (col >> 8) & 255, lb = col & 255;
      for (let dy = -R; dy <= R; dy++) {
        const y = ly + dy; if (y < 0 || y >= rows) continue;
        const ay = sy + y; if (ay < 0 || ay >= H) continue;
        for (let dx = -R; dx <= R; dx++) {
          if (!dx && !dy) continue;
          const x = lx + dx; if (x < 0 || x >= cols) continue;
          const ax = sx + x; if (ax < 0 || ax >= W) continue;
          const q = (ay << Y_SHIFT) + ax;
          if (mat[baseA + q]) continue;   // 作業面のセルの上には重ねない（透けた反対の面の上には重ねる）
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > R) continue;
          const a = (1 - d / (R + 1)); const k2 = a * a * 0.55 * inten;
          const idx = y * cols + x, pv = u32[idx];
          const r = Math.min(255, (pv & 255) + lr * k2), g = Math.min(255, ((pv >> 8) & 255) + lg * k2), b = Math.min(255, ((pv >> 16) & 255) + lb * k2);
          u32[idx] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
        }
      }
    }
  }
}
