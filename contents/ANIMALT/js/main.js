/* ============================================================
   ANIMALT-Δ — startup
   選択肢の流し込みと、フォント・パレットの読み込みだけ。
   計算は pipeline.js、描画は view.js、配線は controls.js にある。
   ============================================================ */
(async () => {

  /* ---- セレクトの中身 ---- */
  for (const f of Glyphs.FONTS) {
    const o = document.createElement('option');
    o.value = f.id; o.textContent = f.label;
    ui.font.appendChild(o);
  }
  ui.font.value = '8x8';

  for (const [label, keys] of CHAR_SET_GROUPS) {
    const grp = document.createElement('optgroup');
    grp.label = label;
    for (const k of keys) {
      const o = document.createElement('option');
      o.value = k; o.textContent = CHAR_SET_LABELS[k] || k;
      grp.appendChild(o);
    }
    ui.charsetPreset.appendChild(grp);
  }
  ui.charsetPreset.value = 'all';
  ui.customChars.value = CHAR_SETS.all;
  updateCharCount();

  Controls.init();
  syncPaletteMode();
  syncTabs();
  drawPaperSwatches();
  updateClipInfo();   // 素材を読む前から、いまの設定だと何コマになるかを出しておく

  // コンソールから中身を覗くための口。パイプラインの途中結果を
  // そのまま触れると、色や字形の当たり外れを調べるのが早い
  window.ANIMALT = { state, player, convert, buildPalette, buildGlyphs, usePaletteFile };

  /* ---- パレットライブラリ（フォントを待たずに走らせる） ---- */
  PaletteFiles.loadAll().then((list) => {
    if (!list.length) { ui.palLibrary.textContent = 'no palettes found'; return; }
    drawPaletteLibrary(list);
  });

  /* ---- フォント ---- */
  try {
    await Glyphs.loadAll();
    buildGlyphs();
    state.ready = true;
    say(Source.hasImageDecoder
      ? 'Ready — drop a GIF, image, or video.'
      : 'Ready, but this browser has no ImageDecoder: animated GIFs will load as a single frame.',
      Source.hasImageDecoder ? 'ok' : 'err');
  } catch (e) {
    say('Font load failed: ' + e.message, 'err');
    console.error(e);
  }
})();
