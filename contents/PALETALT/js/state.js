/* ============================================================
   PALETALT-K — shared state
   ============================================================ */
const State = {
  img: null,          // 読み込み済みの HTMLImageElement
  imgName: '',

  work: null,         // { w, h, data:Uint8ClampedArray } 調整後の作業画像
  hist: null,         // ヒストグラム（ユニーク色 + 出現数）
  palette: [],        // 最終パレット [{ r,g,b,n,share }]
  poolSize: 0,        // 実際に生成された初期プール数
  meanErr: 0,         // 平均量子化誤差（ΔE）

  view: 'quantized',
  exportScale: 1,

  params: {
    res: 384,
    alpha: 128,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    gamma: 1.0,
    target: 8,
    space: 'oklab',
    pool: 64,
    kmeans: 8,
    mergeDelta: 0,
    weighted: true,
    strategy: 'centroid',
    chromaBias: 0,
    sortBy: 'population',
    showHex: true,
    autoRun: true,
    dither: false,
  },
};

const $ = (id) => document.getElementById(id);

function showError(msg) {
  const el = $('errorToast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 3200);
}

function showOk(msg) {
  const el = $('okToast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 1600);
}
