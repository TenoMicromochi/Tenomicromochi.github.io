/* ============================================================
   PALETALT-K — canvas / palette DOM rendering
   ============================================================ */
const Render = (() => {

  let lastQuantized = null; // { w, h, data } ダウンロード用に保持

  /* ---------- 最近傍パレット色 ---------- */

  function makeMatcher(palette, space) {
    const pw = palette.map((c) => Color.toWork(c.r, c.g, c.b, space));
    const cache = new Map();
    return function match(r, g, b) {
      const key = (r << 16) | (g << 8) | b;
      let idx = cache.get(key);
      if (idx === undefined) {
        const v = Color.toWork(r, g, b, space);
        let bi = 0, bd = Infinity;
        for (let i = 0; i < pw.length; i++) {
          const d = Color.dist2(v, pw[i]);
          if (d < bd) { bd = d; bi = i; }
        }
        idx = bi;
        cache.set(key, idx);
      }
      return idx;
    };
  }

  /* ---------- 近傍2色 + 混合比（順序付きディザ用） ---------- */

  /**
   * 元色 → { a, b, lv } を返すキャッシュ付き関数。
   * a / b は最も近いパレット色2つの添字、lv は b を打つ被覆段数（0..levels-1）。
   * どれも画素位置に依存しないのでキャッシュに丸ごと載せられる。
   *
   * clean は両端から何段ぶんをベタに寄せるか。打点が疎すぎる段は模様として
   * 成立せずゴミに見えるので、そこだけ落とす。段数単位なので levels と直交する。
   */
  function makePairMatcher(palette, space, levels, clean) {
    const pw = palette.map((c) => Color.toWork(c.r, c.g, c.b, space));
    const cache = new Map();
    const steps = levels - 1;
    // 中央の段まで潰すとディザが全滅するので、最低1段は残す
    const dead = Math.max(0, Math.min(clean, Math.floor((steps - 1) / 2)));

    return function pair(r, g, b) {
      const key = (r << 16) | (g << 8) | b;
      let e = cache.get(key);
      if (e !== undefined) return e;

      const v = Color.toWork(r, g, b, space);
      let a = 0, ad = Infinity, s = -1, sd = Infinity;
      for (let i = 0; i < pw.length; i++) {
        const d = Color.dist2(v, pw[i]);
        if (d < ad) { s = a; sd = ad; a = i; ad = d; }
        else if (d < sd) { s = i; sd = d; }
      }

      let lv = 0;
      if (s >= 0) {
        // v を線分 a→s に射影して混合比 t を出す。t をそのまま段数に落とす
        const va = pw[a], vs = pw[s];
        let num = 0, den = 0;
        for (let k = 0; k < 3; k++) {
          const dk = vs[k] - va[k];
          num += (v[k] - va[k]) * dk;
          den += dk * dk;
        }
        const t = den > 0 ? Math.max(0, Math.min(1, num / den)) : 0;
        lv = Math.round(t * steps);
        if (lv <= dead) lv = 0;
        else if (lv >= steps - dead) lv = steps;
      }

      e = { a, b: s < 0 ? a : s, lv };
      cache.set(key, e);
      return e;
    };
  }

  /* ---------- 順序付きディザ（ベイヤー 4x4） ---------- */

  // 4x4 ベイヤー行列。値は 0..15 なので被覆パターンは 17 通り
  const BAYER4 = [
     0,  8,  2, 10,
    12,  4, 14,  6,
     3, 11,  1,  9,
    15,  7, 13,  5,
  ];

  /**
   * パターン数を減らすときは行列そのものを間引く。
   * div=2 → 9通り、4 → 5通り（2x2ベイヤー相当）、8 → 3通り（ベタ + 市松のみ）。
   */
  function ditherBayer(work, palette, space, levels, clean) {
    const { w, h } = work;
    const src = work.data;
    const out = new Uint8ClampedArray(src.length);
    const pair = makePairMatcher(palette, space, levels, clean);
    const div = 16 / (levels - 1);

    for (let y = 0; y < h; y++) {
      const row = (y & 3) << 2;
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const e = pair(src[o], src[o + 1], src[o + 2]);
        const m = (BAYER4[row | (x & 3)] / div) | 0;
        const c = palette[m < e.lv ? e.b : e.a];
        out[o] = c.r; out[o + 1] = c.g; out[o + 2] = c.b; out[o + 3] = src[o + 3];
      }
    }
    return { w, h, data: out };
  }

  /* ---------- 量子化画像 ---------- */

  function quantizeImage(work, palette, p) {
    const { w, h } = work;
    const space = p.space;
    const src = work.data;
    const out = new Uint8ClampedArray(src.length);
    if (palette.length === 0) return { w, h, data: out };

    if (!p.dither) {
      const match = makeMatcher(palette, space);
      for (let i = 0; i < src.length; i += 4) {
        const c = palette[match(src[i], src[i + 1], src[i + 2])];
        out[i] = c.r; out[i + 1] = c.g; out[i + 2] = c.b; out[i + 3] = src[i + 3];
      }
      return { w, h, data: out };
    }

    if (p.ditherMode === 'bayer') return ditherBayer(work, palette, space, p.ditherLevels, p.ditherClean);

    // Floyd–Steinberg。誤差拡散で元にない色が出るので毎回最近傍を引く
    const buf = new Float32Array(w * h * 3);
    for (let i = 0, j = 0; i < src.length; i += 4, j += 3) {
      buf[j] = src[i]; buf[j + 1] = src[i + 1]; buf[j + 2] = src[i + 2];
    }
    const pw = palette.map((c) => Color.toWork(c.r, c.g, c.b, space));
    const clamp = (x) => x < 0 ? 0 : x > 255 ? 255 : x;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const j = (y * w + x) * 3;
        const r = clamp(buf[j]), g = clamp(buf[j + 1]), b = clamp(buf[j + 2]);
        const v = Color.toWork(r, g, b, space);
        let bi = 0, bd = Infinity;
        for (let i = 0; i < pw.length; i++) {
          const d = Color.dist2(v, pw[i]);
          if (d < bd) { bd = d; bi = i; }
        }
        const c = palette[bi];
        const er = r - c.r, eg = g - c.g, eb = b - c.b;
        const o = (y * w + x) * 4;
        out[o] = c.r; out[o + 1] = c.g; out[o + 2] = c.b; out[o + 3] = src[o + 3];

        const spread = (dx, dy, f) => {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= w || ny >= h) return;
          const k = (ny * w + nx) * 3;
          buf[k] += er * f; buf[k + 1] += eg * f; buf[k + 2] += eb * f;
        };
        spread(1, 0, 7 / 16);
        spread(-1, 1, 3 / 16);
        spread(0, 1, 5 / 16);
        spread(1, 1, 1 / 16);
      }
    }
    return { w, h, data: out };
  }

  /* ---------- メインキャンバス ---------- */

  function drawMain() {
    const cv = $('dispCanvas');
    const ph = $('placeholder');
    if (!State.work) { cv.style.display = 'none'; ph.style.display = 'flex'; return; }

    let frame;
    if (State.view === 'original' && State.img) {
      cv.width = State.work.w; cv.height = State.work.h;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(State.img, 0, 0, cv.width, cv.height);
      finishMain(cv, ph);
      return;
    }
    if (State.view === 'adjusted') frame = State.work;
    else frame = lastQuantized || State.work;

    cv.width = frame.w; cv.height = frame.h;
    const ctx = cv.getContext('2d');
    ctx.putImageData(new ImageData(frame.data, frame.w, frame.h), 0, 0);
    finishMain(cv, ph);
  }

  /**
   * FIT のときに使う倍率。縦長の画像がはみ出さないよう横だけでなく縦も見る。
   * 残り高さは、キャンバス枠と同じ列に並ぶ要素を実測して差し引いて求める。
   * スクロール量に依存しないよう、基準は常にコンテナ高さと画面高さの小さい方。
   */
  function fitScale(cv) {
    const area = cv.parentElement.parentElement;   // .canvas-area
    const maxW = Math.min(720, area.clientWidth - 24);

    const pal = $('paletteBlock'), info = $('infoBar');
    const palOn = pal.style.display !== 'none';
    const infoOn = info.style.display !== 'none';
    const used = area.querySelector('.view-toolbar').offsetHeight
      + (palOn ? pal.offsetHeight : 0)
      + (infoOn ? info.offsetHeight : 0)
      + 8 * (1 + palOn + infoOn)                   // .canvas-area の gap
      + 24 + 2;                                    // padding と枠線
    const maxH = Math.min(area.clientHeight, window.innerHeight) - used;

    const s = Math.min(Math.floor(maxW / cv.width), Math.floor(maxH / cv.height));
    return Math.max(1, Math.min(16, s));
  }

  function finishMain(cv, ph) {
    // ドット絵を潰さないため表示倍率は常に整数。FIT でも非整数には落とさず、
    // 等倍で枠に入らない場合は縮小せず canvas-stack 側をスクロールさせる
    const scale = State.zoom === 'fit' ? fitScale(cv) : 1;
    cv.style.width = (cv.width * scale) + 'px';
    cv.style.height = 'auto';
    cv.style.display = 'block';
    ph.style.display = 'none';
  }

  /* ---------- サムネイル ---------- */

  function drawThumb(id, frame, imgEl) {
    const cv = $(id);
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!frame && !imgEl) return;

    const w = frame ? frame.w : imgEl.naturalWidth;
    const h = frame ? frame.h : imgEl.naturalHeight;
    const s = Math.min(cv.width / w, cv.height / h);
    const dw = Math.max(1, Math.round(w * s)), dh = Math.max(1, Math.round(h * s));
    const dx = ((cv.width - dw) / 2) | 0, dy = ((cv.height - dh) / 2) | 0;

    if (frame) {
      const tmp = document.createElement('canvas');
      tmp.width = w; tmp.height = h;
      tmp.getContext('2d').putImageData(new ImageData(frame.data, w, h), 0, 0);
      ctx.drawImage(tmp, dx, dy, dw, dh);
    } else {
      ctx.drawImage(imgEl, dx, dy, dw, dh);
    }
  }

  function drawThumbs() {
    drawThumb('thumb0', null, State.img);
    drawThumb('thumb1', State.work, null);
    drawThumb('thumb2', lastQuantized, null);
  }

  /* ---------- パレット ---------- */

  function drawPalette() {
    const strip = $('paletteStrip');
    const block = $('paletteBlock');
    strip.innerHTML = '';
    strip.classList.toggle('nolabel', !State.params.showHex);

    if (State.palette.length === 0) { block.style.display = 'none'; return; }
    block.style.display = 'flex';

    State.palette.forEach((c) => {
      const hex = Color.toHex(c);
      const el = document.createElement('div');
      el.className = 'swatch';
      el.title = hex + '  ' + (c.share * 100).toFixed(2) + '%';

      const chip = document.createElement('span');
      chip.className = 'swatch-chip';
      chip.style.background = hex;

      const meta = document.createElement('div');
      meta.className = 'swatch-meta';
      const h = document.createElement('span');
      h.className = 'swatch-hex';
      h.textContent = hex.toUpperCase();
      const s = document.createElement('span');
      s.className = 'swatch-share';
      s.textContent = (c.share * 100).toFixed(1) + '%';
      meta.appendChild(h); meta.appendChild(s);

      el.appendChild(chip); el.appendChild(meta);
      el.addEventListener('click', () => Exporter.copyText(hex.toUpperCase(), hex.toUpperCase() + ' copied'));
      strip.appendChild(el);
    });

    $('paletteCount').textContent = State.palette.length + ' COLORS';
  }

  /* ---------- 情報バー ---------- */

  function drawInfo(ms) {
    $('infoBar').style.display = State.work ? 'flex' : 'none';
    if (!State.work) return;
    $('infoSize').textContent = State.work.w + '×' + State.work.h;
    $('infoUnique').textContent = State.hist ? State.hist.entries.length.toLocaleString() : '-';
    $('infoFlow').textContent = State.poolSize + ' → ' + State.palette.length;
    $('infoErr').textContent = State.meanErr.toFixed(2);
    $('infoTime').textContent = ms.toFixed(0) + 'ms';
  }

  function refreshQuantized() {
    if (!State.work || State.palette.length === 0) { lastQuantized = null; return; }
    lastQuantized = quantizeImage(State.work, State.palette, State.params);
  }

  return {
    refreshQuantized, drawMain, drawThumbs, drawPalette, drawInfo,
    getQuantized: () => lastQuantized,
  };
})();
