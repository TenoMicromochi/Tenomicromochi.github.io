/* ============================================================
   FLAKALT — raster.js
   640x400 / 16色のソフトウェアラスタライザ。

   canvas の 2D API は線をアンチエイリアスしてしまうので使わない。
   ImageData を直接叩いて 1px の線と 6x8 の文字を置く。
   結果として「補間ゼロ・16色固定」が保証される。

   座標は全部整数ピクセル。クリップ矩形を持っていて、
   3D ビューポートの外（下の計器盤）へはみ出さないようにしている。
   ============================================================ */

import { PAL32 } from './palette.js';
import { FONT_W, FONT_H, glyphFor } from './font.js';

/* 4x4 の Bayer 行列。空のグラデーションや網掛けに使う。 */
const BAYER4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

export class Raster {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.image = new ImageData(w, h);
    this.buf = new Uint32Array(this.image.data.buffer);
    this.clip(0, 0, w, h);
  }

  /* --- クリップ ---------------------------------------------- */

  clip(x, y, w, h) {
    this.cx0 = Math.max(0, x | 0);
    this.cy0 = Math.max(0, y | 0);
    this.cx1 = Math.min(this.w, (x + w) | 0); // 右端は含まない
    this.cy1 = Math.min(this.h, (y + h) | 0);
  }

  clipAll() {
    this.clip(0, 0, this.w, this.h);
  }

  /* --- 基本描画 ---------------------------------------------- */

  clear(c) {
    this.buf.fill(PAL32[c]);
  }

  px(x, y, c) {
    x |= 0; y |= 0;
    if (x < this.cx0 || x >= this.cx1 || y < this.cy0 || y >= this.cy1) return;
    this.buf[y * this.w + x] = PAL32[c];
  }

  /* クリップ判定済みの前提で書く内部用。ホットループから呼ぶ。 */
  _px(x, y, v) {
    this.buf[y * this.w + x] = v;
  }

  hline(x0, x1, y, c) {
    y |= 0;
    if (y < this.cy0 || y >= this.cy1) return;
    if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
    x0 = Math.max(this.cx0, x0 | 0);
    x1 = Math.min(this.cx1 - 1, x1 | 0);
    const v = PAL32[c];
    const row = y * this.w;
    for (let x = x0; x <= x1; x++) this.buf[row + x] = v;
  }

  vline(x, y0, y1, c) {
    x |= 0;
    if (x < this.cx0 || x >= this.cx1) return;
    if (y0 > y1) { const t = y0; y0 = y1; y1 = t; }
    y0 = Math.max(this.cy0, y0 | 0);
    y1 = Math.min(this.cy1 - 1, y1 | 0);
    const v = PAL32[c];
    for (let y = y0; y <= y1; y++) this.buf[y * this.w + x] = v;
  }

  fillRect(x, y, w, h, c) {
    const x1 = x + w, y1 = y + h;
    for (let yy = Math.max(this.cy0, y | 0); yy < Math.min(this.cy1, y1 | 0); yy++) {
      this.hline(x, x1 - 1, yy, c);
    }
  }

  rect(x, y, w, h, c) {
    this.hline(x, x + w - 1, y, c);
    this.hline(x, x + w - 1, y + h - 1, c);
    this.vline(x, y, y + h - 1, c);
    this.vline(x + w - 1, y, y + h - 1, c);
  }

  /* level = 0..16。0 で全部 c0、16 で全部 c1。 */
  ditherRect(x, y, w, h, c0, c1, level) {
    const v0 = PAL32[c0], v1 = PAL32[c1];
    const yy0 = Math.max(this.cy0, y | 0), yy1 = Math.min(this.cy1, (y + h) | 0);
    const xx0 = Math.max(this.cx0, x | 0), xx1 = Math.min(this.cx1, (x + w) | 0);
    for (let yy = yy0; yy < yy1; yy++) {
      const row = yy * this.w;
      const br = (yy & 3) << 2;
      for (let xx = xx0; xx < xx1; xx++) {
        this.buf[row + xx] = BAYER4[br + (xx & 3)] < level ? v1 : v0;
      }
    }
  }

  /* --- 線 ---------------------------------------------------- */

  /* Cohen-Sutherland。クリップ矩形の外へ出る線を落としてから引く。 */
  _outcode(x, y) {
    let code = 0;
    if (x < this.cx0) code |= 1;
    else if (x > this.cx1 - 1) code |= 2;
    if (y < this.cy0) code |= 4;
    else if (y > this.cy1 - 1) code |= 8;
    return code;
  }

  line(x0, y0, x1, y1, c) {
    x0 = Math.round(x0); y0 = Math.round(y0);
    x1 = Math.round(x1); y1 = Math.round(y1);

    let o0 = this._outcode(x0, y0);
    let o1 = this._outcode(x1, y1);
    const xmin = this.cx0, xmax = this.cx1 - 1;
    const ymin = this.cy0, ymax = this.cy1 - 1;

    for (let guard = 0; guard < 8; guard++) {
      if (!(o0 | o1)) break;        // 両端とも内側
      if (o0 & o1) return;          // 同じ側の外にある
      const o = o0 || o1;
      let x, y;
      if (o & 8) { x = x0 + ((x1 - x0) * (ymax - y0)) / (y1 - y0); y = ymax; }
      else if (o & 4) { x = x0 + ((x1 - x0) * (ymin - y0)) / (y1 - y0); y = ymin; }
      else if (o & 2) { y = y0 + ((y1 - y0) * (xmax - x0)) / (x1 - x0); x = xmax; }
      else { y = y0 + ((y1 - y0) * (xmin - x0)) / (x1 - x0); x = xmin; }
      x = Math.round(x); y = Math.round(y);
      if (o === o0) { x0 = x; y0 = y; o0 = this._outcode(x0, y0); }
      else { x1 = x; y1 = y; o1 = this._outcode(x1, y1); }
    }
    if (o0 | o1) return;

    // Bresenham
    const v = PAL32[c];
    let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this._px(x0, y0, v);
      if (x0 === x1 && y0 === y1) break;
      const e2 = err << 1;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /* 破線。HUD の補助線に使う。 */
  lineDash(x0, y0, x1, y1, c, on = 3, off = 3) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const step = 1 / len;
    let t = 0;
    const period = on + off;
    while (t < 1) {
      const d = t * len;
      if ((d % period) < on) {
        this.px(x0 + dx * t, y0 + dy * t, c);
      }
      t += step;
    }
  }

  /* --- 円 ---------------------------------------------------- */

  circle(cx, cy, r, c) {
    cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r);
    if (r < 1) { this.px(cx, cy, c); return; }
    let x = r, y = 0, err = 1 - r;
    while (x >= y) {
      this.px(cx + x, cy + y, c); this.px(cx - x, cy + y, c);
      this.px(cx + x, cy - y, c); this.px(cx - x, cy - y, c);
      this.px(cx + y, cy + x, c); this.px(cx - y, cy + x, c);
      this.px(cx + y, cy - x, c); this.px(cx - y, cy - x, c);
      y++;
      if (err < 0) err += 2 * y + 1;
      else { x--; err += 2 * (y - x) + 1; }
    }
  }

  disc(cx, cy, r, c) {
    cx = Math.round(cx); cy = Math.round(cy);
    const r2 = r * r;
    for (let y = -r; y <= r; y++) {
      const w = Math.floor(Math.sqrt(Math.max(0, r2 - y * y)));
      this.hline(cx - w, cx + w, cy + y, c);
    }
  }

  /* 網掛けの円。爆炎や太陽に使う。 */
  discDither(cx, cy, r, c0, c1, level) {
    cx = Math.round(cx); cy = Math.round(cy);
    const r2 = r * r;
    const v0 = PAL32[c0], v1 = PAL32[c1];
    for (let y = -r; y <= r; y++) {
      const yy = (cy + y) | 0;
      if (yy < this.cy0 || yy >= this.cy1) continue;
      const w = Math.floor(Math.sqrt(Math.max(0, r2 - y * y)));
      const row = yy * this.w;
      const br = (yy & 3) << 2;
      const x0 = Math.max(this.cx0, cx - w), x1 = Math.min(this.cx1 - 1, cx + w);
      for (let xx = x0; xx <= x1; xx++) {
        this.buf[row + xx] = BAYER4[br + (xx & 3)] < level ? v1 : v0;
      }
    }
  }

  /* --- 文字 -------------------------------------------------- */

  /* scale は整数倍のみ。半端な倍率は掛けない。 */
  text(x, y, str, c, scale = 1) {
    x |= 0; y |= 0;
    const v = PAL32[c];
    let cx = x;
    for (const ch of String(str)) {
      if (ch === '\n') { cx = x; y += FONT_H * scale; continue; }
      const g = glyphFor(ch);
      for (let r = 0; r < FONT_H; r++) {
        const bits = g[r];
        if (!bits) continue;
        for (let col = 0; col < FONT_W; col++) {
          if (!(bits & (1 << (FONT_W - 1 - col)))) continue;
          const px = cx + col * scale, py = y + r * scale;
          if (scale === 1) {
            if (px >= this.cx0 && px < this.cx1 && py >= this.cy0 && py < this.cy1) {
              this._px(px, py, v);
            }
          } else {
            this.fillRect(px, py, scale, scale, c);
          }
        }
      }
      cx += FONT_W * scale;
    }
    return cx;
  }

  textW(str, scale = 1) {
    return String(str).length * FONT_W * scale;
  }

  textCenter(cx, y, str, c, scale = 1) {
    return this.text(cx - (this.textW(str, scale) >> 1), y, str, c, scale);
  }

  textRight(rx, y, str, c, scale = 1) {
    return this.text(rx - this.textW(str, scale), y, str, c, scale);
  }

  /* --- DOS 風の枠 -------------------------------------------- */

  /* w,h は文字数・行数ではなくピクセル。罫線文字を敷き詰めて枠を作る。 */
  frame(x, y, w, h, c, double = false) {
    const [tl, tr, bl, br, hz, vt] = double
      ? ['╔', '╗', '╚', '╝', '═', '║']
      : ['┌', '┐', '└', '┘', '─', '│'];
    const cols = Math.max(2, Math.floor(w / FONT_W));
    const rows = Math.max(2, Math.floor(h / FONT_H));
    let top = tl, bottom = bl;
    for (let i = 0; i < cols - 2; i++) { top += hz; bottom += hz; }
    top += tr; bottom += br;
    this.text(x, y, top, c);
    for (let r = 1; r < rows - 1; r++) {
      this.text(x, y + r * FONT_H, vt, c);
      this.text(x + (cols - 1) * FONT_W, y + r * FONT_H, vt, c);
    }
    this.text(x, y + (rows - 1) * FONT_H, bottom, c);
    return { cols, rows };
  }

  /* 枠のタイトル。上辺に文字を埋め込む。 */
  frameLabel(x, y, label, c) {
    this.text(x + FONT_W * 2, y, ' ' + label + ' ', c);
  }

  /* --- 出力 -------------------------------------------------- */

  present(ctx) {
    ctx.putImageData(this.image, 0, 0);
  }
}
