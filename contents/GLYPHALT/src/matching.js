// 画像1セル(8x8)を最適な(背景色, 前景色, グリフ)の組にマッチングする処理
import { GLYPH_W, GLYPH_H, getCombinedEnabledMasks } from './glyph.js';
import { getCurrentPalette, getEnabledColors } from './palette.js';

// FEATURE SPLITの分割パターン一覧(id, ラベル, 行数, 列数)
export const QUAD_MODES = [
  { id: '1',   label: '1',      rows: 1, cols: 1 },
  { id: '2h',  label: '2 L/R',  rows: 1, cols: 2 },
  { id: '2v',  label: '2 T/B',  rows: 2, cols: 1 },
  { id: '4',   label: '4',      rows: 2, cols: 2 },
  { id: '16',  label: '16',     rows: 4, cols: 4 },
];

let currentQuadMode = QUAD_MODES.find(m => m.id === '4');

// 現在の分割モードを変更する(id指定)。次回のmakeConversionSnapshot()から反映される
export function setQuadMode(id) {
  const mode = QUAD_MODES.find(m => m.id === id);
  if (!mode || mode === currentQuadMode) return;
  currentQuadMode = mode;
}

// グリフのビットマスクを分割モードの各ブロックごとに集計し、「前景ピクセルの占有率(0〜1)」を返す
export function computeFillRatios(mask, mode = currentQuadMode) {
  const { rows, cols } = mode;
  const qw = GLYPH_W / cols, qh = GLYPH_H / rows;
  const ratios = new Float32Array(rows * cols);
  const cnt = qw * qh;
  let qi = 0;
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++, qi++) {
      let on = 0;
      const sx = rx*qw, sy = ry*qh;
      for (let py=sy; py<sy+qh; py++)
        for (let px=sx; px<sx+qw; px++)
          on += mask[py*GLYPH_W+px];
      ratios[qi] = on / cnt;
    }
  }
  return ratios;
}

// 変換開始時点の「使用パレット・有効グリフ・有効色・分割モード」を1つのオブジェクトに凍結する。
// 変換中にユーザーがUIで設定を変えても、実行中の変換には影響しないようにするためのスナップショット。
export function makeConversionSnapshot() {
  const currentPalette = getCurrentPalette();
  const enabledColors = getEnabledColors();

  const palette = currentPalette.map(rgb => [...rgb]);
  const masks = getCombinedEnabledMasks();
  const colorIndices = enabledColors.map((on, i) => on ? i : -1).filter(i => i >= 0);
  if (!masks.length || !colorIndices.length) return null;

  const fillRatios = masks.map(m => computeFillRatios(m, currentQuadMode));
  const quadCount = currentQuadMode.rows * currentQuadMode.cols;

  return { palette, masks, colorIndices, fillRatios, quadCount, mode: currentQuadMode };
}

// スナップショットから「セルの特徴量→最も近い(背景色, 前景色, グリフ)の組」を求める関数を作る。
// 背景/前景の全色ペアについて凸結合の下界distanceを計算し、それでソート・枝刈りしながら
// 実際のグリフ候補を距離が近い順に走査することで、全探索より高速に最適な組を見つける。
export function createMatcher(snapshot) {
  const { palette, fillRatios, colorIndices, quadCount } = snapshot;
  const nC = colorIndices.length;
  const nG = fillRatios.length;
  const nPairs = nC * nC;

  const pairBg = new Int32Array(nPairs);
  const pairFg = new Int32Array(nPairs);
  const pairDR = new Float32Array(nPairs);
  const pairDG = new Float32Array(nPairs);
  const pairDB = new Float32Array(nPairs);
  const lowerBound = new Float32Array(nPairs);
  const order = new Int32Array(nPairs);

  // 有効色同士の全ペア(bg, fg)とその色差ベクトルを事前に列挙しておく
  let p = 0;
  for (let bi = 0; bi < nC; bi++) {
    const bg = colorIndices[bi], bgRGB = palette[bg];
    for (let fi = 0; fi < nC; fi++) {
      const fg = colorIndices[fi], fgRGB = palette[fg];
      pairBg[p] = bg; pairFg[p] = fg;
      pairDR[p] = fgRGB[0]-bgRGB[0];
      pairDG[p] = fgRGB[1]-bgRGB[1];
      pairDB[p] = fgRGB[2]-bgRGB[2];
      order[p] = p;
      p++;
    }
  }

  return function bestMatch(cellFeat) {
    // 各(bg,fg)ペアについて、グリフ形状を問わない理論上の最小距離(下界)を求める
    for (let pi = 0; pi < nPairs; pi++) {
      const bg = pairBg[pi], bgRGB = palette[bg];
      const dr = pairDR[pi], dg = pairDG[pi], db = pairDB[pi];
      const denom = (dr*dr + dg*dg + db*db) || 1e-6;
      let lb = 0;
      for (let q = 0; q < quadCount; q++) {
        const i3 = q*3;
        const tr = cellFeat[i3]-bgRGB[0], tg = cellFeat[i3+1]-bgRGB[1], tb = cellFeat[i3+2]-bgRGB[2];
        let t = (tr*dr + tg*dg + tb*db) / denom;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const pr = bgRGB[0]+t*dr-cellFeat[i3], pg = bgRGB[1]+t*dg-cellFeat[i3+1], pb = bgRGB[2]+t*db-cellFeat[i3+2];
        lb += pr*pr + pg*pg + pb*pb;
      }
      lowerBound[pi] = lb;
    }

    // 下界が小さいペアから順に、実際のグリフ候補との距離を計算(下界が現在の最良距離を超えたら打ち切り)
    order.sort((a, b) => lowerBound[a] - lowerBound[b]);
    let bestDist = Infinity, bestBg = -1, bestFg = -1, bestGi = -1;
    for (let k = 0; k < nPairs; k++) {
      const pi = order[k];
      if (lowerBound[pi] >= bestDist) break;
      const bg = pairBg[pi], fg = pairFg[pi];
      const bgRGB = palette[bg];
      const dr = pairDR[pi], dg = pairDG[pi], db = pairDB[pi];
      for (let gi = 0; gi < nG; gi++) {
        const fr = fillRatios[gi];
        let dist = 0, q = 0;
        for (; q < quadCount; q++) {
          const i3 = q*3, t = fr[q];
          const pr = bgRGB[0]+t*dr-cellFeat[i3], pg = bgRGB[1]+t*dg-cellFeat[i3+1], pb = bgRGB[2]+t*db-cellFeat[i3+2];
          dist += pr*pr + pg*pg + pb*pb;
          if (dist >= bestDist) break;
        }
        if (q === quadCount && dist < bestDist) {
          bestDist = dist; bestBg = bg; bestFg = fg; bestGi = gi;
        }
      }
    }
    return bestBg >= 0 ? { bg: bestBg, fg: bestFg, gi: bestGi } : null;
  };
}

// 入力画像側の1セル(8x8ピクセル)を分割モードのブロックごとに平均RGBへ集約する。
// modeは呼び出し側(convert.js)が変換開始時のスナップショットから明示的に渡すこと
// (グローバルな現在モードを暗黙参照すると、変換中にモードが変わった際に不整合を起こすため)。
export function extractCellFeature(pixels, cw, ch, mode) {
  const { rows, cols } = mode;
  const qw = Math.floor(cw/cols), qh = Math.floor(ch/rows);
  const feat = new Float32Array(rows * cols * 3);
  let qi = 0;
  for (let ry=0; ry<rows; ry++) {
    for (let rx=0; rx<cols; rx++, qi++) {
      let r=0, g=0, b=0, cnt=0;
      const sx=rx*qw, sy=ry*qh;
      for (let py=sy; py<sy+qh; py++)
        for (let px=sx; px<sx+qw; px++)
          if (px<cw && py<ch) {
            const idx=(py*cw+px)*4;
            r+=pixels[idx]; g+=pixels[idx+1]; b+=pixels[idx+2]; cnt++;
          }
      if (cnt) { feat[qi*3]=r/cnt; feat[qi*3+1]=g/cnt; feat[qi*3+2]=b/cnt; }
    }
  }
  return feat;
}
