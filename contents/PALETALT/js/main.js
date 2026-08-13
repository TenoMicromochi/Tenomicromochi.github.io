/* ============================================================
   PALETALT-K — orchestration
   ============================================================ */
const Main = (() => {

  let raw = null;          // 縮小直後の ImageData（調整前）
  let pending = -1;        // 未処理の最大 LEVEL
  let pendingOut = false;  // 量子化画像の作り直しが必要か
  let timer = null;
  let running = false;

  /* ---------- 実行 ---------- */

  function request(level, needOut) {
    if (level === null || level === undefined) return;
    pending = Math.max(pending, level);
    pendingOut = pendingOut || !!needOut;

    if (!State.img) return;

    // 描画だけならデバウンスせず即座に反映する
    if (pending === LEVEL.DRAW && !pendingOut) { flush(); return; }

    if (!State.params.autoRun && pending >= LEVEL.QUANT) {
      Controls.setBusy(true, 'PRESS PROCESS TO APPLY');
      return;
    }

    clearTimeout(timer);
    timer = setTimeout(flush, 140);
  }

  function flush() {
    if (running || !State.img || pending < 0) return;
    const level = pending, needOut = pendingOut;
    pending = -1; pendingOut = false;
    running = true;

    Controls.setBusy(true, 'PROCESSING...');
    // 一度描画させてから重い処理に入る（プログレス表示を出すため）。
    // rAF はタブが非アクティブだと発火しないため setTimeout を使う。
    setTimeout(() => {
      const t0 = performance.now();
      try {
        compute(level, needOut);
      } catch (err) {
        showError('Processing failed: ' + err.message);
        console.error(err);
      }
      const ms = performance.now() - t0;
      // drawMain の FIT 倍率は同じ列の要素の高さを実測するので、
      // パレットと情報バーの表示を確定させてから最後に描く
      Render.drawThumbs();
      Render.drawPalette();
      Render.drawInfo(ms);
      Render.drawMain();
      Controls.syncImageScaleHint();
      Controls.setBusy(false);
      running = false;
    });
  }

  function compute(level, needOut) {
    const p = State.params;

    if (level >= LEVEL.IMAGE) {
      raw = ImageProc.sample(State.img, p.res);
      State.work = ImageProc.adjust(raw, p);
    }
    if (level >= LEVEL.HIST) {
      State.hist = ImageProc.histogram(State.work, p.alpha, p.space);
    }
    if (level >= LEVEL.QUANT) {
      if (!State.hist || State.hist.entries.length === 0) {
        State.palette = []; State.poolSize = 0; State.meanErr = 0;
      } else {
        const out = Quantize.extract(State.hist, p);
        State.palette = out.palette;
        State.poolSize = out.poolSize;
        State.meanErr = out.meanErr;
      }
    }
    if (level >= LEVEL.QUANT || needOut) {
      Render.refreshQuantized();
    }
  }

  /* ---------- 画像読み込み ---------- */

  function loadFile(file) {
    if (!file.type.startsWith('image/')) return showError('Not an image file');
    const reader = new FileReader();
    reader.onload = (e) => loadSrc(e.target.result, file.name);
    reader.onerror = () => showError('Failed to read file');
    reader.readAsDataURL(file);
  }

  function loadSrc(src, name) {
    const img = new Image();
    img.onload = () => {
      State.img = img;
      State.imgName = name;
      $('imgName').textContent = name;
      Controls.setEnabled(true);
      pending = LEVEL.IMAGE;
      flush();
    };
    img.onerror = () => showError('Failed to decode image');
    img.src = src;
  }

  /* ---------- テストパターン ---------- */

  /**
   * 小面積の鮮やかな色が背景に飲まれるかを見るための検証用画像。
   * ほぼ白のグラデーション + 面積比 0.6% の純緑 + 小さな彩度アクセント。
   */
  function testPattern() {
    const W = 256, H = 256;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const id = ctx.createImageData(W, H);
    const d = id.data;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const n = Math.floor(245 + 10 * (x / W) * Math.sin(y * 0.1));
        const o = (y * W + x) * 4;
        d[o] = n; d[o + 1] = n; d[o + 2] = n; d[o + 3] = 255;
      }
    }
    const box = (x0, y0, s, r, g, b) => {
      for (let y = y0; y < y0 + s; y++) {
        for (let x = x0; x < x0 + s; x++) {
          const o = (y * W + x) * 4;
          d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
        }
      }
    };
    box(118, 118, 20, 0, 255, 0);    // 面積 0.61%
    box(40, 200, 14, 230, 30, 40);   // 面積 0.30%
    box(200, 40, 10, 250, 210, 20);  // 面積 0.15%
    ctx.putImageData(id, 0, 0);

    loadSrc(cv.toDataURL('image/png'), 'test_pattern.png');
  }

  /* ---------- 起動 ---------- */

  function init() {
    Controls.bindAll();
    Controls.bindImageInput(loadFile);
    Controls.bindExports();
    Controls.setEnabled(false);

    $('demoBtn').addEventListener('click', testPattern);
    $('resetAdjBtn').addEventListener('click', () => Controls.resetAdjust());
    $('runBtn').addEventListener('click', () => {
      pending = Math.max(pending, LEVEL.QUANT);
      flush();
    });

    window.addEventListener('resize', () => { if (State.work) Render.drawMain(); });

    testPattern();
  }

  return { init, request, loadFile };
})();

window.addEventListener('DOMContentLoaded', Main.init);
