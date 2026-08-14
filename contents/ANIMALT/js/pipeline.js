/* ============================================================
   ANIMALT-Δ — pipeline
   4本のパイプラインの駆動と、その間の依存関係だけを持つ。

     SOURCE ──┬─→ PALETTE ─┐
              │            ├─→ CONVERT ─→ RENDER / EXPORT
     FONT ────┴─→ GLYPHS ──┘

   IMAGE ADJUST は SOURCE の直後に効くので PALETTE と CONVERT の
   両方をやり直す必要がある。色スウォッチの ON/OFF、背景モード、隙間は
   パレット自体を変えないので CONVERT だけで済む。
   dirty フラグでその区別を持たせている。
   ============================================================ */

const state = {
  file: null,          // 読み込んだ File。切り出し設定を変えたらここから読み直す
  source: null,
  palette: [],        // 現在使っている色（AUTO 抽出でも FILE 読み込みでも同じ形）
  enabled: [],        // 文字色として使う色
  paletteName: null,  // FILE モードのとき読み込んだパレット名
  paperPick: 0,       // PAPER を「パレットから選ぶ」ときの色番号
  glyphs: null,
  result: null,
  previewIdx: 0,      // PREVIEW 中に見ている元フレームの番号
  showSource: false,
  stale: false,       // 全コマ描画が設定に追いついていない
  ready: false,
};

/* ---------- 設定の読み出し ---------- */
/* 素材の切り出し。ここを変えるとデコードからやり直しになる（他の設定とは違う） */
/* START/LENGTH はスライダーではなく希望値のほうを見る（clipWant の説明を参照）。
 * 素材の実尺に対する丸めは Source 側でやるので、ここでは削らない。 */
const sourceParams = () => ({
  fps:    +ui.videoFps.value,
  speed:  +ui.srcSpeed.value,
  start:  clipWant.start,
  length: clipWant.length,
});

const adjustParams = () => ({
  blur:       +ui.bl.value,
  sobel:      +ui.so.value,
  brightness: +ui.br.value,
  contrast:   +ui.ct.value,
  saturation: +ui.sa.value,
  hue:        +ui.hu.value,
  gamma:      +ui.ga.value / 100,
  invert:     ui.inv.checked,
});

/* IMAGE ADJUST の初期値。RESET と HTML の初期値がずれないよう1箇所にまとめる */
const ADJUST_DEFAULTS = { bl: 0, so: 0, br: 0, ct: 0, sa: 0, hu: 0, ga: 100, inv: false };

/** IMAGE ADJUST だけを初期値に戻す。パレットや字形の設定には触らない */
function resetAdjust() {
  for (const [key, v] of Object.entries(ADJUST_DEFAULTS)) {
    if (key === 'inv') { ui.inv.checked = v; continue; }
    setSlider(ui[key], ui[key + 'N'], v);
  }
}

const paletteParams = () => ({
  target:     +ui.target.value,
  space:      ui.space.value,
  strategy:   ui.strategy.value,
  chromaBias: +ui.cb.value,
  kmeans:     +ui.km.value,
  sampleFrames: +ui.sf.value,
  sortBy:     'lightness',
  longEdge:   256,
  alphaCutoff: 128,
  adjust:     adjustParams(),
});

function splitDims() {
  const [r, c] = ui.split.value.split('x').map(Number);
  return { rows: r, cols: c };
}

const isPreview = () => ui.preview.checked;
const gapValue = () => +ui.gap.value;

/* ---------- 文字セット ----------
 * テキストエリアの中身がそのまま使う文字。プリセットは「そこへ流し込む種」でしかない。
 * 選んだ瞬間に切り替わるのではなく ADD / OVERWRITE を押して初めて入るので、
 * 手で足した字がプリセット選択で消えることがない。 */
function currentChars() { return ui.customChars.value; }

function updateCharCount() {
  ui.charCount.textContent = `${[...ui.customChars.value].length} chars`;
}

function applyPreset(replace) {
  const preset = CHAR_SETS[ui.charsetPreset.value] || '';
  if (replace) {
    ui.customChars.value = preset;
  } else {
    // 既にある字は足さない。空白だけは常に末尾に寄せる（AA の「抜き」に使う字なので）
    const cur = ui.customChars.value;
    const have = new Set([...cur]);
    let add = '';
    for (const c of preset) {
      if (c === ' ' || have.has(c)) continue;
      have.add(c); add += c;
    }
    const hadSpace = cur.includes(' ') || preset.includes(' ');
    ui.customChars.value = cur.replace(/ /g, '') + add + (hadSpace ? ' ' : '');
  }
  updateCharCount();
  schedule({ glyphs: true, convert: true });
}

/* ---------- パイプライン1: グリフ表 ---------- */
function buildGlyphs() {
  const { rows, cols } = splitDims();
  const chars = currentChars();
  updateCharCount();

  // 空のまま変換すると当てる字がなくなるので、最低限スペースだけ入れて回す
  state.glyphs = Glyphs.build(ui.font.value, chars.length ? chars : ' ', rows, cols);
  const g = state.glyphs;
  // シートは U+00FF までなので、範囲外の字（かなや漢字）は落ちる。
  // 黙って消えると「打ったのに出ない」になるので数を出しておく
  const dropped = g.outOfRange
    ? ` | ${g.outOfRange} dropped (beyond U+00FF)` : '';
  ui.glyphInfo.textContent = chars.length
    ? `${g.cellW}x${g.cellH}px | ${g.chars.length} unique shapes | ${g.quadCount} blocks/cell${dropped}`
    : `${g.cellW}x${g.cellH}px | CHARS is empty — add a preset`;
  drawGlyphPreview(g);
}

/* ---------- パイプライン2: パレット ---------- */
function buildPalette() {
  // FILE モードでは読み込んだ色を守る。抽出しなおすと選んだパレットが消える
  if (ui.paletteMode.value === 'file') return;
  if (!state.source) return;

  const t0 = performance.now();
  const { palette, unique } = Palette.extract(state.source.frames, paletteParams());
  state.palette = palette;
  state.enabled = palette.map(() => true);
  state.paletteName = null;
  state.paperPick = Math.min(state.paperPick, Math.max(0, palette.length - 1));
  ui.paletteInfo.textContent =
    `${palette.length} colors from ${unique.toLocaleString()} unique | ${Math.round(performance.now() - t0)}ms`;
  drawSwatches();
}

/** FILE モード: 読み込んだ色をそのまま使う（不足ぶんは埋めない） */
function usePaletteFile(name, colors) {
  if (!colors.length) return;
  state.palette = colors.map((c) => ({ ...c }));
  state.enabled = colors.map(() => true);
  state.paletteName = name;
  state.paperPick = Math.min(state.paperPick, colors.length - 1);
  ui.paletteMode.value = 'file';
  syncPaletteMode();
  ui.paletteInfo.textContent = `${name} — ${colors.length} colors`;
  drawSwatches();
  schedule({ convert: true });
}

function syncPaletteMode() {
  const auto = ui.paletteMode.value === 'auto';
  ui.autoParams.style.display = auto ? '' : 'none';
}

/* ---------- 描画用パレットと PAPER ----------
 * PAPER は ASCII モードの固定背景と、CELL GAP を埋める色の両方に使う。
 * パレットに無い色（黒・白）を選んだときは1色足す。GIF のカラーテーブルは
 * 2のべき乗に切り上がるので、17色になっても容量の心配は要らない。 */
function buildRenderPalette() {
  const base = state.palette.map((c) => ({ ...c }));
  const mode = ui.paperMode.value;

  let paper;
  if (mode === 'white') paper = { r: 255, g: 255, b: 255 };
  else if (mode === 'palette') paper = base[state.paperPick] || { r: 0, g: 0, b: 0 };
  else paper = { r: 0, g: 0, b: 0 };

  let paperIdx = base.findIndex((c) => c.r === paper.r && c.g === paper.g && c.b === paper.b);
  if (paperIdx < 0) {
    base.push({ r: paper.r, g: paper.g, b: paper.b, n: 0, share: 0 });
    paperIdx = base.length - 1;
  }
  return { palette: base, paperIdx };
}

/* ---------- パイプライン3+4: 変換 ---------- */
/**
 * @param {boolean} [forceFull] PREVIEW 中でも全フレーム回したいとき（GIF 書き出し）
 */
async function convert(forceFull) {
  if (!state.source || !state.glyphs || state.palette.length === 0) return;

  const preview = isPreview() && !forceFull;
  const g = state.glyphs;
  const cols = +ui.cols.value;
  const gap = gapValue();
  const bm = state.source.frames[0].bitmap;

  // 隙間を入れるとセルの実効的な縦横比が変わる。ここに素の cellW/cellH を
  // 渡したままだと 8x11 で約3%、4x6 で約7% アスペクトが狂う
  const rows = Math.max(1, Math.round(
    cols * (bm.height / bm.width) * ((g.cellW + gap) / (g.cellH + gap))));

  const { palette, paperIdx } = buildRenderPalette();
  const paletteFlat = new Float32Array(palette.length * 3);
  palette.forEach((c, i) => {
    paletteFlat[i * 3] = c.r; paletteFlat[i * 3 + 1] = c.g; paletteFlat[i * 3 + 2] = c.b;
  });

  // 文字色の候補は「有効にしたパレット色」だけ。PAPER で足した色は含めない
  const colorIdx = Int32Array.from(
    state.enabled.map((on, i) => (on ? i : -1)).filter((i) => i >= 0));
  if (colorIdx.length === 0) { say('All colors are disabled.', 'err'); return; }

  // ASCII モードは背景を PAPER に固定する。候補が nC² から nC に落ちるので速くもなる
  const ascii = ui.colorMode.value === 'ascii';
  const bgFixed = ascii ? paperIdx : -1;

  // PREVIEW では見ている1コマだけを回す。ちらつき止めは前後のコマが
  // 要るので、1コマだけのときは意味がない（履歴なし＝0 と同じ）
  state.previewIdx = Math.min(state.previewIdx, state.source.frames.length - 1);
  const frames = preview ? [state.source.frames[state.previewIdx]] : state.source.frames;

  const wasPlaying = player.playing;
  player.stop();
  say(preview ? `Previewing frame ${state.previewIdx + 1}…` : 'Converting…');
  progress(0);
  const t0 = performance.now();

  const cells = await Converter.run({
    glyphs: g, paletteFlat, colorIdx, cols, rows, frames, bgFixed,
    adjust: adjustParams(),
    hyst: preview ? 0 : +ui.hyst.value / 100,
    onProgress: (d, t) => progress(d / t),
  });

  const ms = performance.now() - t0;
  state.result = {
    cells, frames, glyphs: g, preview, palette, paperIdx, gap,
    cols, rows, speed: +ui.speed.value,
  };

  player.setResult(state.result);
  applyZoom();
  ui.out.style.display = 'block';
  ui.placeholder.style.display = 'none';

  // スライダーの目盛りは常に元フレーム数。PREVIEW でも
  // 「どのコマを見るか」を選べるようにしておく
  const n = state.source.frames.length;
  ui.frameSlider.max = Math.max(0, n - 1);
  ui.frameSlider.value = preview ? state.previewIdx : 0;
  ui.frameSlider.disabled = n < 2;
  ui.playBtn.disabled = preview || cells.length < 2;
  ui.compareBtn.disabled = false;
  ui.pngBtn.disabled = ui.txtBtn.disabled = ui.gifBtn.disabled = false;
  updateCounter();
  updateExportSize();
  // 全コマ回したときだけ「追いついた」ことになる
  if (!preview) markStale(false);
  if (state.showSource) drawSourceFrame();

  progress(null);
  const sz = Render.outSize(g, cols, rows, 1, gap);
  say(preview
    ? `Frame ${state.previewIdx + 1} of ${n} in ${(ms / 1000).toFixed(2)}s — uncheck PREVIEW to render all`
    : `Done in ${(ms / 1000).toFixed(2)}s`, 'ok');
  ui.info.textContent =
    `${cols}x${rows} cells | ${sz.w}x${sz.h}px | ${cells.length} / ${n} frames | ` +
    `${colorIdx.length} colors${ascii ? ' (ASCII)' : ''}${gap ? ` | gap ${gap}` : ''} | ` +
    `${g.chars.length} glyphs`;

  if (wasPlaying && !preview) player.play();
}

/* ---------- 更新のまとめ ----------
 * 走らせ方をモードで変える:
 *   PREVIEW … 1コマだけなので、いじった端から回す（リアルタイム）
 *   全コマ  … 何十コマも巻き込むので自動では回さず、CONVERT 待ちにする
 * どちらでもパレットと字形の作り直しはその場でやる。軽いうえ、
 * スウォッチと字形プレビューは変換しなくても見て確かめられるので。 */
let scheduleTimer = null;
const dirty = { palette: false, glyphs: false, convert: false };

function schedule(what) {
  Object.assign(dirty, what);
  clearTimeout(scheduleTimer);
  scheduleTimer = setTimeout(async () => {
    // パレットを作り直したなら変換も必ずやり直す。
    // フラグを落とす前に必要な仕事を確定させておくこと
    const needConvert = dirty.convert || dirty.palette || dirty.glyphs;
    if (dirty.glyphs) { buildGlyphs(); dirty.glyphs = false; }
    if (dirty.palette) { buildPalette(); dirty.palette = false; }
    dirty.convert = false;
    if (!needConvert) return;

    if (isPreview()) await convert();
    else {
      markStale(true);
      say('Settings changed — press CONVERT to render all frames.');
    }
  }, 150);
}

/* ---------- 入力 ---------- */
/* ユーザーが指定した START/LENGTH の「希望値」。
 * 素材の実尺に合わせて max ごと縮めるので、スライダーの値だけを頼りにすると
 * 短い素材を1本挟んだだけで設定が縮みっぱなしになる（2秒の GIF を見たあと
 * 60秒の動画を読むと LENGTH が 2 のまま）。希望を別に覚えて、素材が長ければ戻す。 */
const clipWant = { start: 0, length: 4 };
const rememberClip = () => {
  clipWant.start = +ui.clipStart.value;
  clipWant.length = +ui.clipLen.value;
};

/* START/LENGTH の目盛りを、いま読んでいる素材の実尺に合わせる。
 * 目盛りが実尺より長いと、スライダーの右側が全部「末尾」になって触れなくなる。
 * 値の丸めはデコード後にやるので、ここで動かしても読み直しは起きない。 */
function fitClipRange(src) {
  const d = src && src.duration;
  if (!(d > 0)) return;
  const cap = Math.round(d * 10) / 10;

  ui.clipStart.max = cap;
  ui.clipStartN.max = cap;
  setSlider(ui.clipStart, ui.clipStartN, Math.min(clipWant.start, cap));

  const lenMax = Math.max(+ui.clipLen.min, Math.min(16, cap));
  ui.clipLen.max = lenMax;
  ui.clipLenN.max = lenMax;
  setSlider(ui.clipLen, ui.clipLenN, Math.min(clipWant.length, lenMax));
}

async function loadFile(file) {
  if (!file) return;
  state.file = file;
  ui.fileName.textContent = file.name;
  player.stop();
  say('Decoding…');
  progress(0);
  try {
    const src = await Source.load(file, sourceParams(), (d, t) => progress(d / t));
    state.source = src;
    fitClipRange(src);

    const bm = src.frames[0].bitmap;
    const total = src.frames.reduce((s, f) => s + f.delayMs, 0);
    ui.srcInfo.textContent =
      `${src.kind} | ${bm.width}x${bm.height} | ${src.frames.length} frames | ${(total / 1000).toFixed(2)}s`;
    updateClipInfo();
    if (src.note) say(src.note, 'err');

    ui.convertBtn.disabled = false;
    state.previewIdx = 0;
    progress(null);
    buildPalette();
    await convert();
  } catch (e) {
    progress(null);
    say('Error: ' + e.message, 'err');
    console.error(e);
  }
}
