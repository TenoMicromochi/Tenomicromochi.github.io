/* ============================================================
   PALETALT-K — image resampling / adjustment / histogram
   ============================================================ */
const ImageProc = (() => {

  const workCanvas = () => $('workCanvas');

  /** 元画像を長辺 maxEdge に収まるよう縮小して ImageData を返す */
  function sample(img, maxEdge) {
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (w > maxEdge || h > maxEdge) {
      if (w >= h) { h = Math.max(1, Math.round(h * maxEdge / w)); w = maxEdge; }
      else { w = Math.max(1, Math.round(w * maxEdge / h)); h = maxEdge; }
    }
    const cv = workCanvas();
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  /** 明度 / コントラスト / 彩度 / ガンマ を LUT + 線形補間で適用 */
  function adjust(src, p) {
    const out = new Uint8ClampedArray(src.data.length);
    const data = src.data;

    const bright = p.brightness * 2.55;
    const c = p.contrast / 100;
    const cf = (259 * (c * 255 + 255)) / (255 * (259 - c * 255));
    const invGamma = 1 / Math.max(0.01, p.gamma);

    // チャンネル単位の処理は LUT にまとめる（彩度だけは画素ごと）
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      let v = i + bright;
      v = cf * (v - 128) + 128;
      v = 255 * Math.pow(Math.max(0, Math.min(255, v)) / 255, invGamma);
      lut[i] = v;
    }

    const sat = 1 + p.saturation / 100;
    const plain = p.saturation === 0;

    for (let i = 0; i < data.length; i += 4) {
      let r = lut[data[i]], g = lut[data[i + 1]], b = lut[data[i + 2]];
      if (!plain) {
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = l + (r - l) * sat;
        g = l + (g - l) * sat;
        b = l + (b - l) * sat;
      }
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = data[i + 3];
    }
    return { w: src.width, h: src.height, data: out };
  }

  /**
   * ユニーク色のヒストグラムを作る。
   * 量子化を全画素ではなくユニーク色に対して行うことで、
   * k-means の反復コストが画素数ではなく色数に比例するようになる。
   */
  function histogram(work, alphaCutoff, space) {
    const map = new Map();
    const d = work.data;
    let total = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < alphaCutoff) continue;
      const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      map.set(key, (map.get(key) || 0) + 1);
      total++;
    }
    const entries = new Array(map.size);
    let k = 0;
    for (const [key, n] of map) {
      const r = (key >> 16) & 255, g = (key >> 8) & 255, b = key & 255;
      const v = Color.toWork(r, g, b, space);
      entries[k++] = { r, g, b, n, v };
    }
    return { entries, total };
  }

  return { sample, adjust, histogram };
})();
