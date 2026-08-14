/* ============================================================
   ANIMALT — export
   PNG（表示中のコマ）/ GIF（全コマ）/ TXT（表示中のコマの文字だけ）
   ============================================================ */
const Export = (() => {

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  /** 表示中のコマを PNG に。拡大は整数倍・補間なし */
  function png(canvas, scale) {
    const s = Math.max(1, Math.round(scale || 1));
    let src = canvas;
    if (s > 1) {
      src = document.createElement('canvas');
      src.width = canvas.width * s;
      src.height = canvas.height * s;
      const cx = src.getContext('2d');
      cx.imageSmoothingEnabled = false;
      cx.drawImage(canvas, 0, 0, src.width, src.height);
    }
    src.toBlob((b) => download(b, `animalt_${stamp()}.png`), 'image/png');
  }

  function txt(text) {
    download(new Blob([text], { type: 'text/plain;charset=utf-8' }), `animalt_${stamp()}.txt`);
  }

  /** 書き出し寸法の見積り。UI の表示と警告判定に使う */
  function gifSize(result, scale) {
    const sz = Render.outSize(result.glyphs, result.cols, result.rows, scale, result.gap);
    return {
      w: sz.w, h: sz.h,
      frames: result.cells.length,
      pixels: sz.w * sz.h * result.cells.length,
    };
  }

  function gif(result, opt) {
    const { glyphs, palette, cols, rows, cells, frames, gap, paperIdx } = result;
    const s = Math.max(1, Math.round(opt.scale || 1));
    const { w, h } = Render.outSize(glyphs, cols, rows, s, gap);
    const speed = result.speed || 1;

    const gifFrames = cells.map((c, i) => ({
      indices: Render.buildIndices(c, glyphs, cols, rows, s, gap, paperIdx),
      delayMs: frames[i].delayMs / speed,
    }));

    const blob = GifEncoder.encode({
      width: w, height: h, palette, frames: gifFrames,
      diff: opt.diff, loop: 0,
    });
    download(blob, `animalt_${stamp()}.gif`);
    return blob.size;
  }

  return { png, txt, gif, gifSize };
})();
