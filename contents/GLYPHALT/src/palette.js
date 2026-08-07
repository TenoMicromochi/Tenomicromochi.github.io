import { setStatus, showError } from './ui.js';

// 同梱パレット画像(各16色)の一覧。表示名とファイルパスの対
export const PALETTE_FILES = [
  { name: 'Legacy: APPLE',   path: 'Colors/Legacy_APPLE.png'   },
  { name: 'Legacy: EGA',   path: 'Colors/Legacy_CGA.png'   },
  { name: 'Legacy: Commodore64',   path: 'Colors/Legacy_Commodore64.png'   },
  { name: 'Legacy: MSX',   path: 'Colors/Legacy_MSX.png'   },
  { name: 'Legacy: WebColor',   path: 'Colors/Legacy_WebColor.png'   },
  { name: 'Tonal: Glayscale',   path: 'Colors/Tonal_Glayscale.png'   },
  { name: 'Tonal: Greenscale',   path: 'Colors/Tonal_Greenscale.png'   },
  { name: '16colors: PICO-8',   path: 'Colors/16colors_PICO-8.png'   },
  { name: '16colors: PRIDEs',   path: 'Colors/16colors_PRIDEs.png'   },
  { name: '16colors: Rainbow',   path: 'Colors/16colors_Rainbow.png'   },
  { name: '16colors: Sweetie16', path: 'Colors/16colors_Sweetie16.png' },
  { name: '16colors: CYAN//RUINS', path: 'Colors/16colors_CYAN_RUINS.png' },
  { name: '4x4colors: Glay',   path: 'Colors/4x4colors_Glay.png'   },
  { name: '4x4colors: Rain',   path: 'Colors/4x4colors_Rain.png'   },
  { name: '4x4colors: Nostalgia',   path: 'Colors/4x4colors_Nostalgia.png'   },
  { name: '4x4colors: Dusk',   path: 'Colors/4x4colors_Dusk.png'   },
  { name: '4x4colors: Fun',   path: 'Colors/4x4colors_Fun.png'   },
];

// 読み込み済みパレット({名前: [[r,g,b], ...16色]})と、現在選択中の状態
const loadedPalettes = {};
let currentPaletteName = null;
let currentPalette = [];
let enabledColors = [];

export function getCurrentPalette() { return currentPalette; }
export function getEnabledColors() { return enabledColors; }
export function getCurrentPaletteName() { return currentPaletteName; }

// パレット画像を16x1にリサイズしてサンプリングし、16色の配列として取り込む
export function loadPaletteFromPath(name, path) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const tmp = document.createElement('canvas');
      tmp.width = 16; tmp.height = 1;
      const ctx = tmp.getContext('2d');
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, 16, 1);
      const d = ctx.getImageData(0, 0, 16, 1).data;
      const colors = [];
      for (let i = 0; i < 16; i++) colors.push([d[i*4], d[i*4+1], d[i*4+2]]);
      loadedPalettes[name] = colors;
      resolve(true);
    };
    img.onerror = () => { showError(`Palette not found: ${path}`); resolve(false); };
    img.src = path;
  });
}

// PALETTE_FILES全件を読み込み、全滅時はビルトインCGAパレットにフォールバック
export async function loadAllPalettes() {
  const results = await Promise.all(PALETTE_FILES.map(f => loadPaletteFromPath(f.name, f.path)));
  if (!results.some(Boolean)) {
    loadedPalettes['CGA (built-in)'] = [
      [0,0,0],[170,0,0],[0,170,0],[170,170,0],
      [0,0,170],[170,0,170],[0,170,170],[170,170,170],
      [85,85,85],[255,85,85],[85,255,85],[255,255,85],
      [85,85,255],[255,85,255],[85,255,255],[255,255,255]
    ];
  }
  rebuildPaletteSelect();
  setActivePalette(document.getElementById('paletteSelect').options[0].value);
  const n = Object.keys(loadedPalettes).length;
  setStatus('paletteStatus', `${n} palette${n>1?'s':''} loaded`, 'ok');
}

// パレット選択<select>の中身を読み込み済みパレット名で再構築。
// 読み込み完了順(非同期・不定)ではなく、表示名の五十音/アルファベット順に並べる
export function rebuildPaletteSelect() {
  const sel = document.getElementById('paletteSelect');
  sel.innerHTML = '';
  const names = Object.keys(loadedPalettes).sort((a, b) => a.localeCompare(b));
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    sel.appendChild(opt);
  }
}

// 使用パレットを切り替え、全色を有効化した状態でスウォッチ表示を作り直す
export function setActivePalette(name) {
  if (!loadedPalettes[name]) return;
  currentPaletteName = name;
  currentPalette = loadedPalettes[name].map(c => [...c]);
  enabledColors  = new Array(currentPalette.length).fill(true);
  document.getElementById('paletteSelect').value = name;
  buildPaletteGrid();
}

// 現在のパレットのスウォッチグリッドを描画し、クリックで色の有効/無効を切り替え可能にする
export function buildPaletteGrid() {
  const grid = document.getElementById('paletteGrid');
  grid.innerHTML = '';
  currentPalette.forEach((rgb, i) => {
    const sw = document.createElement('div');
    sw.className = 'pal-swatch' + (enabledColors[i] ? '' : ' off');
    sw.style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    sw.title = `#${i}: rgb(${rgb.join(',')})`;
    sw.onclick = () => {
      enabledColors[i] = !enabledColors[i];
      sw.classList.toggle('off', !enabledColors[i]);
    };
    grid.appendChild(sw);
  });
}
