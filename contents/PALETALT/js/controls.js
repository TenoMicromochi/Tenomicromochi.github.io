/* ============================================================
   PALETALT-K — UI wiring

   LEVEL は再計算の深さ。変えたパラメータに応じて最小限だけ回す。
     3 IMAGE … 再サンプル + 画像調整から
     2 HIST  … ヒストグラム作り直しから
     1 QUANT … 量子化から
     0 DRAW  … 描画だけ
   ============================================================ */
const LEVEL = { IMAGE: 3, HIST: 2, QUANT: 1, DRAW: 0 };

const Controls = (() => {

  // range と number をペアで扱う。range は整数、param は実数のことがある
  const BIND = [
    { r: 'res', n: 'resN', v: 'resV', key: 'res',        level: LEVEL.IMAGE },
    { r: 'ac',  n: 'acN',  v: 'acV',  key: 'alpha',      level: LEVEL.HIST },
    { r: 'br',  n: 'brN',  v: 'brV',  key: 'brightness', level: LEVEL.IMAGE },
    { r: 'ct',  n: 'ctN',  v: 'ctV',  key: 'contrast',   level: LEVEL.IMAGE },
    { r: 'sa',  n: 'saN',  v: 'saV',  key: 'saturation', level: LEVEL.IMAGE },
    { r: 'ga',  n: 'gaN',  v: 'gaV',  key: 'gamma',      level: LEVEL.IMAGE,
      toParam: (x) => x / 100, toRange: (p) => Math.round(p * 100), fmt: (p) => p.toFixed(2), dec: 2 },
    { r: 'tg',  n: 'tgN',  v: 'tgV',  key: 'target',     level: LEVEL.QUANT },
    { r: 'po',  n: 'poN',  v: 'poV',  key: 'pool',       level: LEVEL.QUANT },
    { r: 'km',  n: 'kmN',  v: 'kmV',  key: 'kmeans',     level: LEVEL.QUANT },
    { r: 'mt',  n: 'mtN',  v: 'mtV',  key: 'mergeDelta', level: LEVEL.QUANT,
      toParam: (x) => x / 10, toRange: (p) => Math.round(p * 10), fmt: (p) => p.toFixed(1), dec: 1 },
    { r: 'cb',  n: 'cbN',  v: 'cbV',  key: 'chromaBias', level: LEVEL.QUANT },
  ];

  const CHECKS = [
    { id: 'weighted', key: 'weighted', level: LEVEL.QUANT },
    { id: 'showHex',  key: 'showHex',  level: LEVEL.DRAW },
    { id: 'autoRun',  key: 'autoRun',  level: null },
    { id: 'dither',   key: 'dither',   level: LEVEL.DRAW, out: true },
  ];

  // ディザ細かさスライダーの目盛り → 使用する被覆パターン数。
  // 4x4 ベイヤーの16段を均等に間引ける割り方はこの4通りしかない
  const DITHER_LEVELS = [3, 5, 9, 17];

  // CLEAN の上限。中央の段まで潰すとディザが消えてしまうので段数から決まる。
  // パターン数3では潰せる段がなく 0（＝操作不可）になる
  const maxClean = (levels) => Math.min(3, Math.floor((levels - 2) / 2));

  function updatePct(el) {
    const min = +el.min, max = +el.max;
    const pct = max === min ? 0 : ((+el.value - min) / (max - min)) * 100;
    el.style.setProperty('--pct', pct + '%');
  }

  function syncBind(b) {
    const range = $(b.r), num = $(b.n), label = $(b.v);
    const p = State.params[b.key];
    range.value = b.toRange ? b.toRange(p) : p;
    num.value = b.dec ? p.toFixed(b.dec) : p;
    label.textContent = b.fmt ? b.fmt(p) : p;
    updatePct(range);
  }

  /** 保存される量子化PNGの実寸を出しておく（倍率だけだと大きさが読めないため） */
  function syncImageScaleHint() {
    const el = $('imageScaleHint');
    if (!State.work) { el.textContent = 'Load an image first'; return; }
    const s = State.imageScale;
    el.textContent = 'Output: ' + (State.work.w * s) + '×' + (State.work.h * s) + ' px';
  }

  /** ディザ関連UIを params に合わせ直す。細かさは BAYER のときだけ有効 */
  function syncDitherUI() {
    const p = State.params;
    const fine = $('dfine');
    const idx = DITHER_LEVELS.indexOf(p.ditherLevels);
    fine.value = idx < 0 ? DITHER_LEVELS.length - 1 : idx;
    updatePct(fine);
    $('dfineV').textContent = p.ditherLevels;

    // CLEAN の可動域はパターン数に従属する。効かない位置は最初から選ばせない
    const cmax = maxClean(p.ditherLevels);
    const clean = $('dclean');
    p.ditherClean = Math.min(p.ditherClean, cmax);
    clean.max = cmax;
    clean.value = p.ditherClean;
    updatePct(clean);
    $('dcleanV').textContent = p.ditherClean;

    $('dither').checked = p.dither;
    $('ditherLabel').classList.toggle('on', p.dither);
    document.querySelectorAll('#ditherModeGroup .view-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.dmode === p.ditherMode));

    const bayerOn = p.dither && p.ditherMode === 'bayer';
    $('ditherModeGroup').classList.toggle('disabled', !p.dither);
    $('ditherFine').classList.toggle('disabled', !bayerOn);
    $('ditherClean').classList.toggle('disabled', !bayerOn || cmax === 0);
  }

  function bindAll() {
    BIND.forEach((b) => {
      const range = $(b.r), num = $(b.n);

      range.addEventListener('input', () => {
        State.params[b.key] = b.toParam ? b.toParam(+range.value) : +range.value;
        syncBind(b);
        Main.request(b.level);
      });

      const commitNum = () => {
        let p = parseFloat(num.value);
        if (!isFinite(p)) { syncBind(b); return; }
        const lo = b.toParam ? b.toParam(+range.min) : +range.min;
        const hi = b.toParam ? b.toParam(+range.max) : +range.max;
        p = Math.max(lo, Math.min(hi, p));
        State.params[b.key] = b.dec ? p : Math.round(p);
        syncBind(b);
        Main.request(b.level);
      };
      num.addEventListener('change', commitNum);
      num.addEventListener('blur', commitNum);

      syncBind(b);
    });

    CHECKS.forEach((c) => {
      const el = $(c.id);
      el.checked = State.params[c.key];
      el.addEventListener('change', () => {
        State.params[c.key] = el.checked;
        if (c.id === 'dither') syncDitherUI();
        if (c.level !== null) Main.request(c.level, c.out);
      });
    });

    $('dfine').addEventListener('input', (e) => {
      State.params.ditherLevels = DITHER_LEVELS[+e.target.value];
      syncDitherUI();
      Main.request(LEVEL.DRAW, true);
    });

    $('dclean').addEventListener('input', (e) => {
      State.params.ditherClean = +e.target.value;
      syncDitherUI();
      Main.request(LEVEL.DRAW, true);
    });

    groupButtons('#ditherModeGroup .view-btn', (btn) => {
      State.params.ditherMode = btn.dataset.dmode;
      syncDitherUI();
      Main.request(LEVEL.DRAW, true);
    });

    syncDitherUI();

    $('strategy').addEventListener('change', (e) => {
      State.params.strategy = e.target.value;
      Main.request(LEVEL.QUANT);
    });

    $('sortBy').addEventListener('change', (e) => {
      State.params.sortBy = e.target.value;
      Quantize.sortPalette(State.palette, State.params.sortBy);
      Main.request(LEVEL.DRAW);
    });

    // COLOR SPACE — ワークスペース座標が変わるのでヒストグラムから作り直す
    groupButtons('[data-space]', (btn) => {
      State.params.space = btn.dataset.space;
      Main.request(LEVEL.HIST);
    });

    groupButtons('#viewGroup .view-btn', (btn) => {
      State.view = btn.dataset.view;
      Render.drawMain();
    });

    groupButtons('#scaleGroup .view-btn', (btn) => {
      State.exportScale = +btn.dataset.scale;
    });

    groupButtons('#imageScaleGroup .view-btn', (btn) => {
      State.imageScale = +btn.dataset.iscale;
      syncImageScaleHint();
    });

    groupButtons('#zoomGroup .view-btn', (btn) => {
      State.zoom = btn.dataset.zoom;
      Render.drawMain();
    });
  }

  function groupButtons(selector, onPick) {
    const btns = Array.from(document.querySelectorAll(selector));
    btns.forEach((btn) => {
      btn.addEventListener('click', () => {
        btns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        onPick(btn);
      });
    });
  }

  function bindImageInput(onLoad) {
    const zone = $('dropZone');
    const input = $('imageInput');

    input.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) onLoad(e.target.files[0]);
    });

    ['dragenter', 'dragover'].forEach((ev) =>
      zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) =>
      zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag'); }));
    zone.addEventListener('drop', (e) => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) onLoad(f);
    });

    // 画面全体にドロップしても読み込めるようにする
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && f.type.startsWith('image/')) onLoad(f);
    });
  }

  function syncPngTextUI() {
    const withText = $('pngText').checked;
    // 文字入れONのときは倍率が強制4xになるため、スケール選択自体を無効化して伝える
    $('scaleGroup').classList.toggle('disabled', withText);
    $('pngTextHint').textContent = withText
      ? 'ON forces 4× scale on the exported image'
      : 'OFF outputs a 1px-per-color strip image';
  }

  function bindExports() {
    $('pngText').addEventListener('change', syncPngTextUI);
    syncPngTextUI();

    $('dlPaletteBtn').addEventListener('click', () =>
      Exporter.palettePng(State.exportScale, $('pngText').checked));
    $('dlImageBtn').addEventListener('click', () => Exporter.quantizedPng(State.imageScale));
    syncImageScaleHint();
    $('copyBtn').addEventListener('click', () => Exporter.copyPalette($('textFormat').value));
    $('dlTextBtn').addEventListener('click', () => Exporter.saveText($('textFormat').value));
  }

  function setBusy(on, text) {
    $('progressWrap').classList.toggle('show', on);
    if (text) $('progressText').textContent = text;
    $('progressBar').style.width = on ? '100%' : '0%';
  }

  function setEnabled(on) {
    ['runBtn', 'dlPaletteBtn', 'dlImageBtn', 'copyBtn', 'dlTextBtn']
      .forEach((id) => { $(id).disabled = !on; });
  }

  function resetAdjust() {
    Object.assign(State.params, { brightness: 0, contrast: 0, saturation: 0, gamma: 1 });
    BIND.filter((b) => ['brightness', 'contrast', 'saturation', 'gamma'].includes(b.key)).forEach(syncBind);
    Main.request(LEVEL.IMAGE);
  }

  return { bindAll, bindImageInput, bindExports, setBusy, setEnabled, resetAdjust, syncBind, syncImageScaleHint, BIND };
})();
