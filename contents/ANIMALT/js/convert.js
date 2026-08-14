/* ============================================================
   ANIMALT — conversion driver（パイプライン4）

   フレームは互いに独立に変換できるので、コア数ぶんの Worker に
   連続した塊で配って並列に回す。塊単位にするのは、ちらつき止めが
   直前フレームの結果を要るため（worker.js のコメント参照）。

   ここでの仕事は
     1. 各フレームを出力セル数ちょうどの大きさに描き直して調整をかける
     2. その画素バッファを Worker へ transfer で渡す
     3. 返ってきたセル配列をフレーム順に並べ直す
   の3つだけ。
   ============================================================ */
const Converter = (() => {

  let pool = [];
  let busy = false;

  function ensurePool(n) {
    while (pool.length < n) pool.push(new Worker('js/worker.js'));
    return pool.slice(0, n);
  }

  function terminateAll() {
    for (const w of pool) w.terminate();
    pool = [];
    busy = false;
  }

  const cvs = document.createElement('canvas');
  const ctx = cvs.getContext('2d', { willReadFrequently: true });

  /**
   * 1フレームを出力解像度で描き直す。
   * adjust を渡すとこの場で調整までかける（SOURCE 表示用）。
   * 変換の本線では渡さない — 調整は Worker 側でやったほうが
   * コア数ぶん並列になり、ぼかしや Sobel を足してもメインスレッドが詰まらない。
   */
  function rasterize(bitmap, w, h, adjust) {
    cvs.width = w; cvs.height = h;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    if (!adjust) return img.data.buffer;
    // ぼかしが入ると別バッファが返る。使い回しのスクラッチなので写しを返す
    return Adjust.apply(img.data, w, h, adjust).slice().buffer;
  }

  /**
   * @returns {Promise<Uint16Array[]>} フレームごとの [bg, fg, glyph] × セル数
   */
  function run(o) {
    const { glyphs, paletteFlat, colorIdx, cols, rows, frames, adjust, hyst, bgFixed, onProgress } = o;
    const w = cols * glyphs.cellW, h = rows * glyphs.cellH;

    // 前の変換がまだ走っているならまるごと捨てる。
    // 設定スライダーを続けて動かしたとき、古い結果が後から届いて
    // 新しい結果を上書きするのを防ぐ。
    if (busy) terminateAll();
    busy = true;

    const nWorkers = Math.max(1, Math.min(
      navigator.hardwareConcurrency || 4, frames.length, 8));
    const workers = ensurePool(nWorkers);

    // 連続した塊に切る（ちらつき止めの履歴を塊の中で引き継ぐため）
    const per = Math.ceil(frames.length / nWorkers);
    const chunks = [];
    for (let i = 0; i < frames.length; i += per) {
      chunks.push({ start: i, end: Math.min(frames.length, i + per) });
    }

    const out = new Array(frames.length);
    let doneFrames = 0;
    const totalFrames = frames.length;

    return Promise.all(chunks.map((chunk, ci) => new Promise((resolve, reject) => {
      const wk = workers[ci % workers.length];

      const payload = [];
      const transfer = [];
      for (let i = chunk.start; i < chunk.end; i++) {
        const buf = rasterize(frames[i].bitmap, w, h, null);
        payload.push({ index: i, buf });
        transfer.push(buf);
      }

      const onMsg = (ev) => {
        const m = ev.data;
        if (m.chunkId !== ci) return;
        if (m.type === 'progress') {
          doneFrames++;
          if (onProgress) onProgress(doneFrames, totalFrames);
          return;
        }
        if (m.type === 'done') {
          wk.removeEventListener('message', onMsg);
          for (const r of m.results) out[r.index] = r.cells;
          resolve();
        }
      };
      wk.addEventListener('message', onMsg);
      wk.addEventListener('error', reject, { once: true });

      wk.postMessage({
        chunkId: ci,
        palette: paletteFlat,
        colorIdx,
        fillFlat: glyphs.fillFlat,
        fillSq: glyphs.fillSq,
        quadCount: glyphs.quadCount,
        blocks: glyphs.blockFlat,
        cellW: glyphs.cellW,
        cellH: glyphs.cellH,
        cols, rows, hyst, adjust,
        bgFixed: (bgFixed === undefined ? -1 : bgFixed),
        frames: payload,
      }, transfer);
    }))).then(() => { busy = false; return out; });
  }

  // rasterize は「変換前・調整後の画素」なので、AA と見比べる用に外へも出す
  return { run, terminateAll, rasterize };
})();
