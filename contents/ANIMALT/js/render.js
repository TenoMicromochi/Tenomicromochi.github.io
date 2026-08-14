/* ============================================================
   ANIMALT — output raster & playback

   変換結果は「セルごとの (bg, fg, glyph) 番号」でしかないので、
   見せるにも書き出すにも一度ラスタに起こす必要がある。
   その中間形として「パレット番号の配列」を作る。
   画面表示はここから RGBA に展開し、GIF はこの番号列をそのまま食う。
   量子化をやり直さないので、プレビューと GIF が完全に一致する。
   ============================================================ */
const Render = (() => {

  /**
   * 出力ラスタの寸法。隙間はセル座標の上で足してから拡大するので、
   * SCALE 4x では隙間も4倍になる（絶対値の1pxではなく「AAの1px」）。
   * 隙間は外周にも入れて額縁状にする。右下だけに入れると左上端だけ詰まって不揃いになるため。
   */
  function outSize(glyphs, cols, rows, scale, gap) {
    const s = Math.max(1, Math.round(scale || 1));
    const g = Math.max(0, Math.round(gap || 0));
    return {
      s, g,
      pitchX: (glyphs.cellW + g) * s,
      pitchY: (glyphs.cellH + g) * s,
      w: (cols * (glyphs.cellW + g) + g) * s,
      h: (rows * (glyphs.cellH + g) + g) * s,
    };
  }

  /**
   * セル配列 → パレット番号のラスタ（長さ w*h）
   * scale は整数倍のみ。画素をそのまま複製するので補間は一切かからない。
   * 1行ぶんを作ってから copyWithin で縦に複製している。
   */
  function buildIndices(cells, glyphs, cols, rows, scale, gap, paperIdx) {
    const { s, g, pitchX, pitchY, w, h } = outSize(glyphs, cols, rows, scale, gap);
    const cw = glyphs.cellW, ch = glyphs.cellH;
    const out = new Uint8Array(w * h);
    if (g > 0) out.fill(paperIdx || 0); // 隙間の色。セルはこの上から塗り潰す

    const masks = glyphs.masks;
    const cellRun = cw * s;
    const originX = g * s, originY = g * s;

    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const ci = (cy * cols + cx) * 3;
        const bg = cells[ci], fg = cells[ci + 1];
        const mask = masks[cells[ci + 2]];
        const px0 = originX + cx * pitchX, py0 = originY + cy * pitchY;

        for (let y = 0; y < ch; y++) {
          const rowStart = (py0 + y * s) * w + px0;
          let d = rowStart, m = y * cw;
          for (let x = 0; x < cw; x++, m++) {
            const v = mask[m] ? fg : bg;
            for (let k = 0; k < s; k++) out[d++] = v;
          }
          for (let k = 1; k < s; k++) out.copyWithin(rowStart + k * w, rowStart, rowStart + cellRun);
        }
      }
    }
    return out;
  }

  function indicesToImageData(indices, palette, w, h) {
    const img = new ImageData(w, h);
    const d = img.data;
    // パレットを平坦化しておくとオブジェクト参照が消えて内側が速い
    const p = new Uint8Array(palette.length * 3);
    for (let i = 0; i < palette.length; i++) {
      p[i * 3] = palette[i].r; p[i * 3 + 1] = palette[i].g; p[i * 3 + 2] = palette[i].b;
    }
    for (let i = 0, o = 0; i < indices.length; i++, o += 4) {
      const c = indices[i] * 3;
      d[o] = p[c]; d[o + 1] = p[c + 1]; d[o + 2] = p[c + 2]; d[o + 3] = 255;
    }
    return img;
  }

  /** セル配列 → テキスト（色は落ちる。TEXTALT 相当の出力） */
  function toText(cells, glyphs, cols, rows) {
    const chars = glyphs.chars;
    const lines = new Array(rows);
    for (let cy = 0; cy < rows; cy++) {
      let s = '';
      for (let cx = 0; cx < cols; cx++) s += chars[cells[(cy * cols + cx) * 3 + 2]];
      lines[cy] = s;
    }
    return lines.join('\n');
  }

  /* ---------- 再生 ---------- */

  class Player {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.timer = null;
      this.index = 0;
      this.playing = false;
      this.onFrame = null;
    }

    setResult(result) {
      this.result = result; // { cells[], frames[], glyphs, palette, cols, rows, gap, paperIdx }
      this.index = 0;
      const { glyphs, cols, rows, gap } = result;
      const sz = outSize(glyphs, cols, rows, 1, gap);
      this.canvas.width = sz.w;
      this.canvas.height = sz.h;
      this.ctx.imageSmoothingEnabled = false;
      this.draw(0);
    }

    draw(i) {
      const r = this.result;
      if (!r || !r.cells[i]) return;
      this.index = i;
      const w = this.canvas.width, h = this.canvas.height;
      const idx = buildIndices(r.cells[i], r.glyphs, r.cols, r.rows, 1, r.gap, r.paperIdx);
      this.ctx.putImageData(indicesToImageData(idx, r.palette, w, h), 0, 0);
      if (this.onFrame) this.onFrame(i);
    }

    play() {
      const r = this.result;
      if (!r || r.cells.length < 2 || this.playing) return;
      this.playing = true;
      const tick = () => {
        if (!this.playing) return;
        this.draw(this.index);
        const delay = Math.max(20, r.frames[this.index].delayMs / (r.speed || 1));
        this.index = (this.index + 1) % r.cells.length;
        this.timer = setTimeout(tick, delay);
      };
      tick();
    }

    stop() {
      this.playing = false;
      clearTimeout(this.timer);
    }

    toggle() { this.playing ? this.stop() : this.play(); }
  }

  return { buildIndices, indicesToImageData, toText, outSize, Player };
})();
