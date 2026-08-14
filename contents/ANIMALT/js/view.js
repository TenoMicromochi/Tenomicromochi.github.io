/* ============================================================
   ANIMALT-Δ — view
   DOM 参照と「画面に出す」仕事だけを持つ。
   パイプラインの計算はここには置かない（pipeline.js）。
   配線もここには置かない（controls.js）。

   main.js が 560行まで膨らんで、要素参照・計算・配線・起動が
   1ファイルに同居していたのを3つに割ったうちの1つ。
   ============================================================ */

const ui = {};
for (const id of [
  // panels
  'tabLeft','tabRight','tabLeftLabel','tabRightLabel','panelLeft','panelRight',
  // source
  'dropZone','fileInput','fileName','srcInfo','videoFps','srcSpeed','srcSpeedN',
  'clipStart','clipStartN','clipLen','clipLenN','clipInfo',
  // output
  'cols','colsN','hyst','hystN','preview','convertBtn',
  // glyph
  'font','charsetPreset','addPresetBtn','replacePresetBtn','customChars','charCount',
  'split','glyphPreview','glyphInfo',
  // render
  'colorMode','paperMode','paperSwatches','gap','gapN',
  // image adjust
  'adjustReset','bl','blN','so','soN','br','brN','ct','ctN','sa','saN','hu','huN','ga','gaN','inv',
  // palette
  'paletteMode','autoParams','target','targetN','space','strategy','cb','cbN','km','kmN',
  'sf','sfN','swatches','paletteInfo','palLibrary','palDrop','palInput','palName',
  // stage
  'playBtn','frameSlider','frameCounter','compareBtn','speed','zoom','out','placeholder','stage',
  // export
  'pngBtn','gifBtn','txtBtn','gifDiff','exportScale','exportSize',
  'progressWrap','progressBar','status','info',
]) ui[id] = document.getElementById(id);

const player = new Render.Player(ui.out);

/* ---------- パネル ---------- */
/* GLYPHALT と同じ「キャンバスの上に被せて translateX で仕舞う」方式。
 * 左右どちらも独立に開閉でき、狭い画面では片方を開くともう片方を閉じる。 */
function togglePanel(side) {
  const el = side === 'left' ? ui.panelLeft : ui.panelRight;
  const other = side === 'left' ? ui.panelRight : ui.panelLeft;
  const opening = el.classList.contains('hidden');
  el.classList.toggle('hidden', !opening);

  // 両方開くと中央が潰れる幅なら、開いたほうを残して反対側を閉じる。
  // 幅が取れない状況（描画されていないタブなど）では 0 が返るので、
  // そのときは閉じない — 0 を「狭い」と解釈すると常に片方が消える
  const w = document.documentElement.clientWidth || window.innerWidth || 0;
  if (opening && w > 0 && w < 1100) other.classList.add('hidden');
  syncTabs();
}

function syncTabs() {
  const l = !ui.panelLeft.classList.contains('hidden');
  const r = !ui.panelRight.classList.contains('hidden');
  ui.tabLeft.classList.toggle('on', l);
  ui.tabRight.classList.toggle('on', r);
  ui.tabLeftLabel.textContent = l ? '✕ CLOSE' : 'INPUT / GLYPH';
  ui.tabRightLabel.textContent = r ? '✕ CLOSE' : 'COLOR / PALETTE';
}

/* ---------- スライダーと数値入力の連結 ----------
 * スライダーだけでは1刻みを合わせにくいので、必ず数値入力を隣に置く。
 * どちらを触っても相手に反映し、変更通知は1本にまとめる。
 * 数値入力は打ち途中（空文字や "-" だけ）を弾いてから同期する。 */
function paintSlider(range) {
  const min = +range.min, max = +range.max;
  const pct = max > min ? ((+range.value - min) / (max - min)) * 100 : 0;
  range.style.setProperty('--pct', pct + '%');
}

/** コードから値を入れるとき用。入力イベントは飛ばさないので、
 *  呼んだ側が必要に応じて schedule() すること */
function setSlider(range, num, value) {
  range.value = value;
  if (num) num.value = range.value;
  paintSlider(range);
}

function linkSlider(range, num, onChange) {
  const paint = () => paintSlider(range);

  range.addEventListener('input', () => {
    if (num) num.value = range.value;
    paint();
    if (onChange) onChange();
  });

  if (num) {
    num.addEventListener('input', () => {
      // 打ち途中は触らない。小数を受ける欄があるので "1." も未確定として扱う
      if (num.value === '' || num.value === '-' || num.value.endsWith('.')) return;
      const v = Math.min(+range.max, Math.max(+range.min, +num.value));
      range.value = v;
      paint();
      if (onChange) onChange();
    });
    // 範囲外のまま離れたら丸めて見せる
    num.addEventListener('blur', () => { num.value = range.value; paint(); });
  }

  paint();
}

/* ---------- ステータス ---------- */
function say(msg, cls) {
  ui.status.textContent = msg;
  ui.status.className = 'status' + (cls ? ' ' + cls : '');
}

function progress(p) {
  if (p === null) { ui.progressWrap.classList.remove('show'); return; }
  ui.progressWrap.classList.add('show');
  ui.progressBar.style.width = (p * 100) + '%';
}

/* ---------- 再生まわりの表示 ---------- */
function applyZoom() {
  const z = +ui.zoom.value;
  ui.out.style.width = ui.out.width * z + 'px';
  ui.out.style.height = ui.out.height * z + 'px';
}

function updateCounter() {
  const n = state.source ? state.source.frames.length : 0;
  const i = ui.preview.checked ? state.previewIdx : player.index;
  ui.frameCounter.textContent = `${n ? i + 1 : 0} / ${n}`;
}

player.onFrame = (i) => {
  if (!ui.preview.checked) ui.frameSlider.value = i;
  updateCounter();
};

/* ---------- 切り出しの見積り ---------- */
/* FPS × LENGTH は簡単に 256 コマを越える（16s @ 60fps で 960）。
 * 黙って打ち切ると「設定したのに尺が足りない」に化けるので、
 * 読み込み前から何コマになるかを出し、上限に当たったら色を変える。 */
function updateClipInfo() {
  const src = state.source;
  const nf = (n) => `${n} frame${n === 1 ? '' : 's'}`;
  let text, warn = false;

  if (src && src.kind === 'still') {
    text = '→ still image — 1 frame';
  } else if (src && src.kind === 'anim') {
    const ms = src.frames.reduce((s, f) => s + f.delayMs, 0);
    text = `→ ${nf(src.frames.length)} / ${(ms / 1000).toFixed(2)}s out — native timing`;
    warn = !!src.capped;
  } else {
    const p = Source.plan(src ? src.duration : 0, sourceParams());
    text = `→ ${nf(p.count)} / ${(p.outMs / 1000).toFixed(2)}s out @ ${p.fps}fps`;
    if (p.capped) { text += ` — capped at ${Source.MAX_FRAMES} (wanted ${p.want})`; warn = true; }
  }

  ui.clipInfo.textContent = text;
  ui.clipInfo.classList.toggle('warn', warn);
}

/* ---------- スウォッチ ---------- */
function drawSwatches() {
  const frag = document.createDocumentFragment();
  state.palette.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'sw' + (state.enabled[i] ? '' : ' off');
    el.style.background = Color.toHex(c);
    el.title = `${Color.toHex(c)}  ${(c.share * 100).toFixed(1)}%`;
    el.onclick = () => {
      const on = state.enabled.filter(Boolean).length;
      if (state.enabled[i] && on <= 1) return; // 最低1色は残す
      state.enabled[i] = !state.enabled[i];
      drawSwatches();
      schedule({ convert: true });
    };
    frag.appendChild(el);
  });
  ui.swatches.replaceChildren(frag);
  drawPaperSwatches();
}

/* PAPER をパレットから選ぶときの行。ON/OFF ではなく1つだけ選ぶので別グリッドにしてある */
function drawPaperSwatches() {
  const show = ui.paperMode.value === 'palette';
  ui.paperSwatches.style.display = show ? '' : 'none';
  if (!show) return;

  const frag = document.createDocumentFragment();
  state.palette.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'sw' + (state.paperPick === i ? ' picked' : '');
    el.style.background = Color.toHex(c);
    el.title = Color.toHex(c);
    el.onclick = () => {
      state.paperPick = i;
      drawPaperSwatches();
      schedule({ convert: true });
    };
    frag.appendChild(el);
  });
  ui.paperSwatches.replaceChildren(frag);
}

/* ---------- パレットライブラリ ---------- */
function drawPaletteLibrary(list) {
  const frag = document.createDocumentFragment();
  for (const p of list) {
    const row = document.createElement('div');
    row.className = 'pal-entry';

    const strip = document.createElement('div');
    strip.className = 'pal-strip';
    for (const c of p.colors) {
      const cell = document.createElement('i');
      cell.style.background = Color.toHex(c);
      strip.appendChild(cell);
    }

    const label = document.createElement('div');
    label.className = 'pal-name';
    label.textContent = `${p.name} · ${p.colors.length}`;

    row.append(strip, label);
    row.onclick = () => usePaletteFile(p.name, p.colors);
    frag.appendChild(row);
  }
  ui.palLibrary.replaceChildren(frag);
}

/* ---------- 字形プレビュー ---------- */
function drawGlyphPreview(g) {
  const perRow = Math.min(g.chars.length, Math.max(1, Math.floor(200 / g.cellW)));
  const rows = Math.ceil(g.chars.length / perRow);
  const c = document.createElement('canvas');
  c.width = perRow * g.cellW; c.height = rows * g.cellH;
  const cx = c.getContext('2d');
  const img = cx.createImageData(c.width, c.height);
  const d = img.data;
  for (let i = 0; i < g.chars.length; i++) {
    const gx = (i % perRow) * g.cellW, gy = Math.floor(i / perRow) * g.cellH;
    const m = g.masks[i];
    for (let y = 0; y < g.cellH; y++) for (let x = 0; x < g.cellW; x++) {
      const o = ((gy + y) * c.width + gx + x) * 4;
      const v = m[y * g.cellW + x] ? 220 : 26;
      d[o] = v; d[o + 1] = v; d[o + 2] = v + 10; d[o + 3] = 255;
    }
  }
  cx.putImageData(img, 0, 0);
  // 等倍だと 8px の字が読めないので 2倍固定（整数倍のみ）
  c.style.width = c.width * 2 + 'px';
  c.style.height = c.height * 2 + 'px';
  ui.glyphPreview.replaceChildren(c);
}

/* ---------- 調整後の元画像との見比べ ---------- */
/* AA の良し悪しは元画像あってのものなので、同じ寸法・同じ調整をかけた
 * 変換前の画素を同じキャンバスに出せるようにしてある。
 * ここに映るのはマッチャが実際に見ている画素そのもの。
 * 隙間ぶんは含まないので、GAP を入れているときは右下が余る。 */
function drawSourceFrame() {
  const r = state.result;
  if (!r) return;
  const w = r.cols * r.glyphs.cellW, h = r.rows * r.glyphs.cellH;
  const idx = r.preview ? 0 : player.index;
  const buf = Converter.rasterize(r.frames[idx].bitmap, w, h, adjustParams());
  const ctx = ui.out.getContext('2d');
  ctx.clearRect(0, 0, ui.out.width, ui.out.height);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(buf), w, h), 0, 0);
}

function refreshView() {
  if (state.showSource) drawSourceFrame();
  else player.draw(player.index);
}

/* ---------- 書き出し量の表示 ---------- */
/* 「全コマぶんの総画素数」で見るのがいちばん実測に近かった。
 * 4x は面積が16倍になるので、画面上は小さくても一気に跳ねる。 */
const HEAVY_PIXELS = 200e6;

function updateExportSize() {
  const r = state.result;
  if (!r) { ui.exportSize.textContent = '—'; ui.exportSize.className = 'counter wide'; return; }
  const s = Export.gifSize(r, +ui.exportScale.value);
  const heavy = s.pixels > HEAVY_PIXELS;
  ui.exportSize.textContent = `${s.w}x${s.h} · ${s.frames}f`;
  ui.exportSize.className = 'counter wide' + (heavy ? ' warn' : '');
  ui.exportSize.title = heavy ? 'Large export: this will take a while and produce a big file.' : '';
}

/** 重すぎる書き出しの前に一度だけ確認する。止めはしない */
function confirmHeavy(r) {
  const s = Export.gifSize(r, +ui.exportScale.value);
  if (s.pixels <= HEAVY_PIXELS) return true;
  return confirm(
    `${s.w} x ${s.h} px, ${s.frames} frames (${(s.pixels / 1e6).toFixed(0)} megapixels total).\n\n` +
    `Encoding will take a while and the file will be large.\n` +
    `Lower SCALE or WIDTH to keep it smaller.\n\nGo ahead?`);
}

/* ---------- 変換待ちの表示 ---------- */
function markStale(on) {
  state.stale = on;
  ui.convertBtn.classList.toggle('stale', on);
}
