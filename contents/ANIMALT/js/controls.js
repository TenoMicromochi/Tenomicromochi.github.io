/* ============================================================
   ANIMALT-Δ — controls
   イベント配線だけを持つ。ここに計算も描画も書かない。
   どの操作がどこまでやり直しを要求するかは schedule() の引数で表す:
     palette … パレットから作り直す（＝変換も必ず伴う）
     glyphs  … 字形表から作り直す
     convert … 変換だけやり直す
   ============================================================ */
const Controls = (() => {

function init() {

  /* ---------- パネル ---------- */
  ui.tabLeft.addEventListener('click', () => togglePanel('left'));
  ui.tabRight.addEventListener('click', () => togglePanel('right'));

  /* ---------- 入力 ---------- */
  ui.fileInput.addEventListener('change', (e) => loadFile(e.target.files[0]));
  ['dragenter', 'dragover'].forEach((ev) =>
    ui.dropZone.addEventListener(ev, (e) => { e.preventDefault(); ui.dropZone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    ui.dropZone.addEventListener(ev, () => ui.dropZone.classList.remove('drag')));
  ui.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    loadFile(e.dataTransfer.files[0]);
  });

  /* ---------- スライダー ＋ 数値入力 ---------- */
  const ADJ = { palette: true, convert: true };   // 調整はパレットの見え方も変える
  const CONV = { convert: true };                 // 変換だけで足りる
  const PAL = { palette: true };

  const bind = (range, num, what) =>
    linkSlider(range, num, what ? () => schedule(what) : null);

  /* 切り出し設定だけは schedule() の外。
   * FPS も START も「どのコマを持ってくるか」の話なので、変換をやり直しても
   * 意味がなくデコードからやり直すしかない。以前ここが null 配線だったせいで、
   * 読み込み後に FPS を動かしても何も起きなかった。
   * 動画のシークは遅いので、続けて動かされたぶんはまとめて捨てる。 */
  let reloadTimer = 0;
  const reloadSource = () => {
    rememberClip();
    updateClipInfo();
    if (!state.file) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => loadFile(state.file), 400);
  };

  ui.videoFps.addEventListener('change', reloadSource);
  linkSlider(ui.srcSpeed, ui.srcSpeedN, reloadSource);
  linkSlider(ui.clipStart, ui.clipStartN, reloadSource);
  linkSlider(ui.clipLen, ui.clipLenN, reloadSource);

  bind(ui.bl, ui.blN, ADJ);
  bind(ui.so, ui.soN, ADJ);
  bind(ui.br, ui.brN, ADJ);
  bind(ui.ct, ui.ctN, ADJ);
  bind(ui.sa, ui.saN, ADJ);
  bind(ui.hu, ui.huN, ADJ);
  bind(ui.ga, ui.gaN, ADJ);
  bind(ui.cols, ui.colsN, CONV);
  bind(ui.hyst, ui.hystN, CONV);
  bind(ui.gap, ui.gapN, CONV);
  bind(ui.target, ui.targetN, PAL);
  bind(ui.cb, ui.cbN, PAL);
  bind(ui.km, ui.kmN, PAL);
  bind(ui.sf, ui.sfN, PAL);

  ui.inv.addEventListener('change', () => schedule(ADJ));
  ui.space.addEventListener('change', () => schedule(PAL));
  ui.strategy.addEventListener('change', () => schedule(PAL));

  // IMAGE ADJUST だけを初期値へ戻す。他のセクションには触らない
  ui.adjustReset.addEventListener('click', () => {
    resetAdjust();
    schedule(ADJ);
  });

  /* ---------- グリフ ---------- */
  ui.font.addEventListener('change', () => schedule({ glyphs: true, convert: true }));
  ui.split.addEventListener('change', () => schedule({ glyphs: true, convert: true }));
  ui.customChars.addEventListener('input', () => {
    updateCharCount();
    schedule({ glyphs: true, convert: true });
  });
  ui.addPresetBtn.addEventListener('click', () => applyPreset(false));
  ui.replacePresetBtn.addEventListener('click', () => applyPreset(true));

  /* ---------- 描画モード ---------- */
  ui.colorMode.addEventListener('change', () => schedule(CONV));
  ui.paperMode.addEventListener('change', () => { drawPaperSwatches(); schedule(CONV); });

  /* ---------- パレット ---------- */
  ui.paletteMode.addEventListener('change', () => {
    syncPaletteMode();
    // AUTO へ戻したときだけ抽出をやり直す。FILE 側は読み込んだ色を守る
    schedule(ui.paletteMode.value === 'auto' ? { palette: true } : CONV);
  });

  ui.palInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const colors = await PaletteFiles.loadFile(file);
      ui.palName.textContent = file.name;
      usePaletteFile(file.name.replace(/\.[^.]+$/, ''), colors);
    } catch (err) {
      say('Palette load failed: ' + err.message, 'err');
    }
  });
  ['dragenter', 'dragover'].forEach((ev) =>
    ui.palDrop.addEventListener(ev, (e) => { e.preventDefault(); ui.palDrop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    ui.palDrop.addEventListener(ev, () => ui.palDrop.classList.remove('drag')));
  ui.palDrop.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const colors = await PaletteFiles.loadFile(file);
    ui.palName.textContent = file.name;
    usePaletteFile(file.name.replace(/\.[^.]+$/, ''), colors);
  });

  /* ---------- 変換の起動 ---------- */
  // CONVERT は常に全コマ。PREVIEW 中に押されたら本描画のつもりとみなす
  ui.convertBtn.addEventListener('click', () => {
    if (isPreview()) ui.preview.checked = false;
    convert();
  });

  ui.preview.addEventListener('change', () => {
    ui.playBtn.textContent = '▶ PLAY';
    if (isPreview()) {
      convert();               // 確認モードへ戻るのは軽いので即座に出す
    } else {
      // 全コマ側へ移るのは重いので、勝手には走らせず CONVERT 待ちにする
      markStale(true);
      say('Press CONVERT to render all frames.');
    }
  });

  /* ---------- 再生・表示 ---------- */
  ui.zoom.addEventListener('change', applyZoom);
  ui.speed.addEventListener('change', () => { if (state.result) state.result.speed = +ui.speed.value; });
  ui.playBtn.addEventListener('click', () => {
    player.toggle();
    ui.playBtn.textContent = player.playing ? '❚❚ PAUSE' : '▶ PLAY';
  });
  ui.frameSlider.addEventListener('input', () => {
    player.stop();
    ui.playBtn.textContent = '▶ PLAY';
    if (isPreview()) {
      // PREVIEW ではスライダーが「どのコマを確認するか」なので変換し直す
      state.previewIdx = +ui.frameSlider.value;
      updateCounter();
      schedule(CONV);
    } else {
      player.draw(+ui.frameSlider.value);
      if (state.showSource) drawSourceFrame();
    }
  });

  ui.compareBtn.addEventListener('click', () => {
    state.showSource = !state.showSource;
    ui.compareBtn.classList.toggle('on', state.showSource);
    ui.compareBtn.textContent = state.showSource ? 'RESULT' : 'SOURCE';
    if (state.showSource) player.stop();
    refreshView();
  });

  /* ---------- 書き出し ---------- */
  ui.exportScale.addEventListener('change', updateExportSize);
  ui.pngBtn.addEventListener('click', () => Export.png(ui.out, +ui.exportScale.value));
  ui.txtBtn.addEventListener('click', () => {
    const r = state.result;
    const i = r.preview ? 0 : player.index;
    Export.txt(Render.toText(r.cells[i], r.glyphs, r.cols, r.rows));
  });

  ui.gifBtn.addEventListener('click', async () => {
    // PREVIEW のまま、あるいは設定を変えたまま押されたら、
    // 古い結果や1コマだけの GIF を出すより先に全コマ回し直す
    if (isPreview() || state.stale) {
      say(isPreview() ? 'PREVIEW is on — rendering all frames first…'
                      : 'Settings changed — re-rendering all frames first…');
      ui.preview.checked = false;
      await convert();
    }
    const r = state.result;
    if (!confirmHeavy(r)) { say('Export cancelled.'); return; }

    const scale = +ui.exportScale.value;
    say('Encoding GIF…');
    // 進捗表示を1フレーム出してからエンコードに入る（同期処理でUIが止まるため）
    setTimeout(() => {
      const t0 = performance.now();
      const size = Export.gif(r, { diff: ui.gifDiff.checked, scale });
      const s = Export.gifSize(r, scale);
      say(`GIF written: ${s.w}x${s.h} ${scale}x, ${(size / 1024 / 1024).toFixed(2)} MB ` +
          `in ${((performance.now() - t0) / 1000).toFixed(2)}s`, 'ok');
    }, 30);
  });
}

return { init };
})();
