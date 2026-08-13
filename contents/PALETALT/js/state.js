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
  zoom: 'fit',        // 'fit' = 枠に収まる最大の整数倍 / 'actual' = 等倍
  exportScale: 1,     // パレットPNGの倍率
  imageScale: 1,      // 量子化画像PNGの倍率

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
    dither: true,
    ditherMode: 'bayer',  // 'bayer' = 順序付き / 'fs' = Floyd–Steinberg
    ditherLevels: 17,     // ベイヤーで使う被覆パターン数（3 / 5 / 9 / 17）
    ditherClean: 0,       // 両端から何段ぶんベタに寄せるか（疎な打点の除去）
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
