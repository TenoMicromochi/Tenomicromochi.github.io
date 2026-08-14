/* ============================================================
   ANIMALT — conversion worker（パイプライン4の実行単位）

   メインスレッドから「連続したフレームの塊」をまとめて受け取り、
   セルごとに (bg, fg, glyph) を決めて返す。フレームを塊で渡すのは、
   ちらつき止め（hysteresis）が直前フレームの結果を必要とするため。
   塊の切れ目でだけ履歴が途切れるが、そこは見て分からない。

   返すのは色番号とグリフ番号だけ。実際の描画・GIF 化はメイン側で行う。
   ============================================================ */
importScripts('color.js', 'image.js', 'matcher.js');

self.onmessage = (ev) => {
  const m = ev.data;
  const {
    palette, colorIdx, fillFlat, fillSq, quadCount,
    blocks, cellW, cellH, cols, rows, frames, hyst, adjust, bgFixed, chunkId,
  } = m;

  const match = createMatcher(palette, colorIdx, fillFlat, fillSq, quadCount, bgFixed);
  const nCells = cols * rows;
  const feat = new Float32Array(quadCount * 3);

  // 直前フレームの選択。塊の先頭では履歴なしから始める
  let prev = hyst > 0 ? new Uint16Array(nCells * 3).fill(0xffff) : null;

  const results = [];
  const transfer = [];

  const stride = cols * cellW;

  for (let f = 0; f < frames.length; f++) {
    // 調整はここでかける。フレームが Worker に分かれているぶん、
    // ぼかしや Sobel のような重い空間フィルタもコア数ぶん並列に流れる
    const src = Adjust.apply(new Uint8ClampedArray(frames[f].buf), stride, rows * cellH, adjust);
    const out = new Uint16Array(nCells * 3);

    for (let cy = 0; cy < rows; cy++) {
      const py0 = cy * cellH;
      for (let cx = 0; cx < cols; cx++) {
        const px0 = cx * cellW;

        // ブロックごとの平均 RGB
        for (let q = 0; q < quadCount; q++) {
          const b4 = q * 4;
          const x0 = blocks[b4], x1 = blocks[b4 + 1], y0 = blocks[b4 + 2], y1 = blocks[b4 + 3];
          let r = 0, g = 0, b = 0;
          for (let y = y0; y < y1; y++) {
            let i = ((py0 + y) * stride + px0 + x0) * 4;
            for (let x = x0; x < x1; x++, i += 4) { r += src[i]; g += src[i + 1]; b += src[i + 2]; }
          }
          const n = (x1 - x0) * (y1 - y0);
          feat[q * 3] = r / n; feat[q * 3 + 1] = g / n; feat[q * 3 + 2] = b / n;
        }

        const ci = (cy * cols + cx) * 3;
        let pb = -1, pf = 0, pg = 0;
        if (prev && prev[ci] !== 0xffff) { pb = prev[ci]; pf = prev[ci + 1]; pg = prev[ci + 2]; }

        const best = match(feat, pb, pf, pg, hyst);
        out[ci] = best.bg; out[ci + 1] = best.fg; out[ci + 2] = best.gi;
      }
    }

    // out はこのあと transfer で手放すので、履歴は別バッファへ写す
    if (prev) prev.set(out);
    results.push({ index: frames[f].index, cells: out });
    transfer.push(out.buffer);
    self.postMessage({ type: 'progress', chunkId, done: f + 1, total: frames.length });
  }

  self.postMessage({ type: 'done', chunkId, results }, transfer);
};
