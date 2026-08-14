/* ============================================================
   ANIMALT — global palette（パイプライン2）

   PALETALT は1枚の画像から色を採るが、ここでは全フレームを
   1つのヒストグラムにまとめてから量子化する。
   フレームごとにパレットを採ると、色が毎コマ入れ替わって激しくちらつくうえ、
   GIF のグローバルカラーテーブルが使えなくなる。
   「動画ぜんぶで1組の16色」にするのがこのツールの肝。
   ============================================================ */
const Palette = (() => {

  const cvs = document.createElement('canvas');
  const ctx = cvs.getContext('2d', { willReadFrequently: true });

  /**
   * 全フレームを縮小サンプリングして、ユニーク色のヒストグラムを1つ作る。
   * 量子化コストが画素数ではなく色数に比例するので、
   * フレーム数が増えてもここは大きくは重くならない。
   */
  function buildHistogram(frames, opt) {
    const map = new Map();
    let total = 0;

    // コマ数が多いときは等間隔で間引く（色の分布は数コマで十分つかめる）
    const step = Math.max(1, Math.ceil(frames.length / opt.sampleFrames));

    for (let i = 0; i < frames.length; i += step) {
      const bm = frames[i].bitmap;
      let w = bm.width, h = bm.height;
      const m = opt.longEdge;
      if (w > m || h > m) {
        if (w >= h) { h = Math.max(1, Math.round(h * m / w)); w = m; }
        else { w = Math.max(1, Math.round(w * m / h)); h = m; }
      }
      cvs.width = w; cvs.height = h;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(bm, 0, 0, w, h);

      const img = ctx.getImageData(0, 0, w, h);
      // ぼかしが入ると別バッファが返るので戻り値のほうを読む
      const d = Adjust.apply(img.data, w, h, opt.adjust);
      for (let p = 0; p < d.length; p += 4) {
        if (d[p + 3] < opt.alphaCutoff) continue;
        const key = (d[p] << 16) | (d[p + 1] << 8) | d[p + 2];
        map.set(key, (map.get(key) || 0) + 1);
        total++;
      }
    }

    const entries = new Array(map.size);
    let k = 0;
    for (const [key, n] of map) {
      const r = (key >> 16) & 255, g = (key >> 8) & 255, b = key & 255;
      entries[k++] = { r, g, b, n, v: Color.toWork(r, g, b, opt.space) };
    }
    return { entries, total, unique: map.size };
  }

  function extract(frames, opt) {
    const hist = buildHistogram(frames, opt);
    const palette = Quantize.extract(hist, {
      target: opt.target,
      pool: Math.max(opt.target * 4, 32),
      kmeans: opt.kmeans,
      space: opt.space,
      strategy: opt.strategy,
      chromaBias: opt.chromaBias,
      sortBy: opt.sortBy,
    });
    return { palette, unique: hist.unique };
  }

  return { extract };
})();
