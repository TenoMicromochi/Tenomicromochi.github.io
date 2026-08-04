
import { setStatus, showError } from './ui.js';

// 同梱グリフ(文字)シート画像の一覧。表示名とファイルパスの対
export const GLYPH_FILES = [
  { name: 'Default', path: 'glyph/shapes_default.png'  },
  { name: 'Shapes: Basic_Shapes',   path: 'glyph/shapes_basicshapes.png'    },
  { name: 'Shapes: Circles',        path: 'glyph/shapes_circles.png'        },
  { name: 'Shapes: Dithering',      path: 'glyph/shapes_dithering.png'      },
  { name: 'Shapes: Ruled_Line',     path: 'glyph/shapes_ruledline.png'      },
  { name: 'Shapes: Stained_Glass',  path: 'glyph/shapes_stainedglass.png'   },
  { name: 'Symbols: Arrows',        path: 'glyph/symbols_arrows.png'        },
  { name: 'Symbols: Game_Icons',    path: 'glyph/symbols_gameicons.png'     },
  { name: 'Text: EN_Letters_and_Numbers', path: 'glyph/text_en_letter_and_num.png' },
  { name: 'Text: EN_Pseudominster', path: 'glyph/text_en_pseudominster.png' },
  { name: 'Text: EN_Symbols',       path: 'glyph/text_en_symbols.png'       },
  { name: 'Text: JP_Hiragana',      path: 'glyph/text_jp_hiragana.png'      },
  { name: 'Text: JP_Katakana',      path: 'glyph/text_jp_katakana.png'      },
  { name: 'Text: TenoGlyph_Magic',  path: 'glyph/text_otr_tenoglyphmagic.png' },
];

// 1グリフのセルサイズ(px)と、グリフ一覧グリッドの表示上限(列×行)
export const GLYPH_W = 8, GLYPH_H = 8;
export const GLYPH_GRID_COLS = 8, GLYPH_GRID_MAX_ROWS = 8;

// 読み込み済みグリフセット({名前: {bitmasks, thumbCanvases}})。A/B両スロットで共有するプール
const loadedGlyphs = {};

// グリフシート画像を輝度127しきい値で二値化し、グリフごとのON/OFFビットマスクに変換
export function parseFontBitmasks(canvas) {
  const ctx = canvas.getContext('2d');
  const d   = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const cols = Math.floor(canvas.width  / GLYPH_W);
  const rows = Math.floor(canvas.height / GLYPH_H);
  const bitmasks = [];
  for (let gi = 0; gi < cols * rows; gi++) {
    const gx = (gi % cols) * GLYPH_W;
    const gy = Math.floor(gi / cols) * GLYPH_H;
    const mask = new Uint8Array(GLYPH_W * GLYPH_H);
    for (let py = 0; py < GLYPH_H; py++)
      for (let px = 0; px < GLYPH_W; px++) {
        const idx = ((gy+py)*canvas.width + (gx+px))*4;
        mask[py*GLYPH_W+px] = (d[idx]*0.299 + d[idx+1]*0.587 + d[idx+2]*0.114) > 127 ? 1 : 0;
      }
    bitmasks.push(mask);
  }
  return bitmasks;
}

// ビットマスク1個をプレビュー用の小さなcanvas(明暗2値の画像)に変換
export function makeThumb(mask) {
  const c = document.createElement('canvas');
  c.width = GLYPH_W; c.height = GLYPH_H;
  const ctx = c.getContext('2d');
  const id  = ctx.createImageData(GLYPH_W, GLYPH_H);
  for (let i = 0; i < GLYPH_W * GLYPH_H; i++) {
    const v = mask[i] ? 220 : 20;
    id.data[i*4]=v; id.data[i*4+1]=v; id.data[i*4+2]=v; id.data[i*4+3]=255;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

// 1つのグリフシート画像を読み込み、ビットマスクとサムネイルを生成して登録
export function loadGlyphFromPath(name, path) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const tmp = document.createElement('canvas');
      tmp.width = img.naturalWidth; tmp.height = img.naturalHeight;
      tmp.getContext('2d').drawImage(img, 0, 0);
      const bitmasks = parseFontBitmasks(tmp);
      const thumbCanvases = bitmasks.map(makeThumb);
      loadedGlyphs[name] = { bitmasks, thumbCanvases };
      resolve(true);
    };
    img.onerror = () => { showError(`Glyph not found: ${path}`); resolve(false); };
    img.src = path;
  });
}

// 画像読み込みが全て失敗した場合の保険: monospaceフォントの文字を描画して256グリフ分のセットを自作
function buildDefaultGlyph() {
  const name = 'Default (built-in)';
  const fc   = document.createElement('canvas');
  fc.width = 16*GLYPH_W; fc.height = 16*GLYPH_H;
  const ctx = fc.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0,0,fc.width,fc.height);
  ctx.fillStyle = '#fff'; ctx.font = `${GLYPH_H}px monospace`; ctx.textBaseline = 'top';
  const gs = '█▄▀▌▐░▒▓▲▼◆●■□◇○ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()[]{}`~╔╗╚╝║═┌┐└┘│─♠♣♥♦♪♫☺☻ ';
  for (let i = 0; i < 256; i++)
    ctx.fillText(gs[i]||' ', (i%16)*GLYPH_W, Math.floor(i/16)*GLYPH_H);
  const bitmasks = parseFontBitmasks(fc);
  loadedGlyphs[name] = { bitmasks, thumbCanvases: bitmasks.map(makeThumb) };
}

// 「グリフセットを使わない」ことを表す<select>の特別な値
const NONE = '';

// グリフの「選択中セット + 有効/無効状態」を1枠分持つスロットを作る。
// A/B 2つのスロットを独立に動かせるよう、対応するDOM idをまとめて渡す。
function createSlot(dom) {
  let currentGlyphName = null; // NONE(未選択)のときはnull
  let enabledGlyphs = [];

  function updateCount() {
    const on    = enabledGlyphs.filter(Boolean).length;
    const total = enabledGlyphs.length;
    document.getElementById(dom.onCount).textContent    = on;
    document.getElementById(dom.totalCount).textContent = total;
    updateCombinedInfoGlyphs();
  }

  // このスロットの<select>の中身を「None」+ 読み込み済みグリフセット名で再構築
  function rebuildSelect() {
    const sel = document.getElementById(dom.select);
    sel.innerHTML = '';
    const noneOpt = document.createElement('option');
    noneOpt.value = NONE; noneOpt.textContent = 'None';
    sel.appendChild(noneOpt);
    for (const name of Object.keys(loadedGlyphs)) {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      sel.appendChild(opt);
    }
  }

  // このスロットのサムネイルグリッド(表示上限あり)を描画し、クリックで有効/無効を切り替え可能にする。
  // Noneが選択中(entryが無い)場合はグリッドを空にするだけ
  function buildGrid() {
    const grid = document.getElementById(dom.grid);
    grid.innerHTML = '';

    const entry = loadedGlyphs[currentGlyphName];
    if (!entry) { updateCount(); return; }

    const showCount = Math.min(entry.bitmasks.length, GLYPH_GRID_COLS * GLYPH_GRID_MAX_ROWS);

    for (let gi = 0; gi < showCount; gi++) {
      const cell = document.createElement('div');
      cell.className = 'glyph-cell' + (enabledGlyphs[gi] ? '' : ' off');
      cell.title = `Glyph #${gi}`;

      const src = entry.thumbCanvases[gi];
      const dst = document.createElement('canvas');
      dst.width = GLYPH_W; dst.height = GLYPH_H;
      dst.getContext('2d').drawImage(src, 0, 0);
      cell.appendChild(dst);

      cell.addEventListener('click', () => {
        enabledGlyphs[gi] = !enabledGlyphs[gi];
        cell.classList.toggle('off', !enabledGlyphs[gi]);
        updateCount();
      });
      grid.appendChild(cell);
    }
    updateCount();
  }

  // このスロットの使用グリフセットを切り替える。NONEを渡すとこのスロットを無効化する
  // (選択欄はCSSで赤く表示する)。それ以外は全グリフを有効化した状態でグリッドを作り直す
  function setActiveGlyph(name) {
    if (name !== NONE && !loadedGlyphs[name]) return;
    currentGlyphName = name === NONE ? null : name;
    enabledGlyphs = currentGlyphName ? new Array(loadedGlyphs[currentGlyphName].bitmasks.length).fill(true) : [];
    const sel = document.getElementById(dom.select);
    sel.value = name;
    sel.classList.toggle('none-selected', currentGlyphName === null);
    buildGrid();
  }

  // このスロットの全グリフを一括で有効/無効化する(ALL ON/OFFボタン用。他スロットのグリッドには影響しない)
  function setAllEnabled(value) {
    enabledGlyphs = enabledGlyphs.map(() => value);
    document.getElementById(dom.grid).querySelectorAll('.glyph-cell')
      .forEach(c => c.classList.toggle('off', !value));
    updateCount();
  }

  return {
    getCurrentGlyphName: () => currentGlyphName,
    getEnabledGlyphs: () => enabledGlyphs,
    setActiveGlyph,
    setAllEnabled,
    rebuildSelect,
  };
}

// GLYPH SET A / GLYPH SET B の2スロット。両方の有効グリフが変換時に1つの候補プールへ合成される
export const glyphSlots = {
  A: createSlot({ select: 'glyphSelectA', grid: 'glyphGridA', onCount: 'glyphOnCountA', totalCount: 'glyphTotalCountA' }),
  B: createSlot({ select: 'glyphSelectB', grid: 'glyphGridB', onCount: 'glyphOnCountB', totalCount: 'glyphTotalCountB' }),
};

// 変換前のライブプレビュー用に、A/B両スロットの有効グリフ数の合計を情報バーへ反映
function updateCombinedInfoGlyphs() {
  document.getElementById('infoGlyphs').textContent = getCombinedEnabledMasks().length;
}

// A/B両スロットの「現在選択中セットのうち有効なビットマスク」を1つの配列に結合する。
// マッチング側(matching.js)はスロットの存在を意識せず、この結合済みプールだけを見ればよい。
export function getCombinedEnabledMasks() {
  const combined = [];
  for (const slot of Object.values(glyphSlots)) {
    const entry = loadedGlyphs[slot.getCurrentGlyphName()];
    if (!entry) continue;
    const enabled = slot.getEnabledGlyphs();
    for (let i = 0; i < entry.bitmasks.length; i++)
      if (enabled[i]) combined.push(entry.bitmasks[i]);
  }
  return combined;
}

// GLYPH_FILES全件を読み込み、全滅時はビルトインのフォント描画グリフにフォールバック。
// Slot Aは「Default」(見つからなければ1番目のセット)、Slot BはNoneを初期状態として割り当てる
export async function loadAllGlyphs() {
  const results = await Promise.all(GLYPH_FILES.map(f => loadGlyphFromPath(f.name, f.path)));
  if (!results.some(Boolean)) buildDefaultGlyph();

  glyphSlots.A.rebuildSelect();
  glyphSlots.B.rebuildSelect();

  const names = Object.keys(loadedGlyphs);
  glyphSlots.A.setActiveGlyph(loadedGlyphs['Default'] ? 'Default' : names[0]);
  glyphSlots.B.setActiveGlyph(NONE);

  const n = names.length;
  setStatus('glyphStatus', `${n} glyph set${n>1?'s':''} loaded`, 'ok');
}
