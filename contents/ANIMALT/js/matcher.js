/* ============================================================
   ANIMALT — cell matcher (パイプライン3の中核)

   1セルを「背景色 bg・文字色 fg・グリフ g」の組で近似する。
   セルを rows×cols のブロックに割り、ブロック q の再現色を

       recon_q = bg + f_q * (fg - bg)          f_q = グリフ g のブロック q 塗り率

   とみなし、実際の平均色 t_q との二乗誤差の総和を最小化する組を探す。
   GLYPHALT v3 の matching.js と同じモデルだが、探索は下の 2 点で作り直した。

   ── 1. 誤差式をグリフについて展開しておく ──
       Σ_q |bg + f_q·d - t_q|²                    d = fg - bg
     = Σ_q |e_q|² + 2Σ_q f_q (e_q·d) + |d|² Σ_q f_q²      e_q = bg - t_q
     =   E        + 2Σ_q f_q·a_q          + D2·S2_g
   ペアごとに E・a_q・D2 を1回求めれば、グリフ1個あたりの計算は
   長さ Q の内積＋1乗算で済む。S2_g（塗り率の二乗和）はグリフ表と一緒に
   前計算しておく。GLYPHALT はグリフごとに RGB 3成分を回していたので、
   ここがそのまま約3倍の差になる。

   ── 2. ペアの並べ替えをやめた ──
   GLYPHALT はセルごとに全ペアを下界でソートしていた（256要素の
   Array#sort がセル数ぶん走る）。ここでは
     (a) 下界が最小のペアだけ先に全グリフ評価して暫定最良を作り、
     (b) 残りは「下界 ≥ 暫定最良」なら丸ごと飛ばす
   という順序にした。ソートを消しても枝刈りの正しさは変わらない
   （下界はそのペアが到達しうる最小値なので、これを超えるペアに
   最良解はない）ため、結果は全探索と一致する。

   Worker からも importScripts で読むので DOM に触れないこと。
   ============================================================ */

/**
 * @param {Float32Array} palette   パレット RGB を平坦化したもの（長さ 3*nColors）
 * @param {Int32Array}   colorIdx  実際に使う色の番号（OFF にした色は含めない）
 * @param {Float32Array} fillFlat  グリフ塗り率を平坦化したもの（長さ nGlyph*quadCount）
 * @param {Float32Array} fillSq    グリフごとの Σ f_q²（長さ nGlyph）
 * @param {number}       quadCount ブロック数
 * @param {number}       bgFixed   背景色を固定する色番号。-1 で従来どおり全組を探す
 */
function createMatcher(palette, colorIdx, fillFlat, fillSq, quadCount, bgFixed) {
  const nC = colorIdx.length;
  const nG = fillSq.length;

  // 背景を固定すると候補が nC² から nC に落ちる。
  // ASCII-ART モード（背景オミット）はここが効いてマッチングが一気に軽くなる。
  const bgList = (bgFixed >= 0) ? [bgFixed] : Array.from(colorIdx);
  const nPairs = bgList.length * nC;

  // (bg, fg) の順序対を先に展開しておく。bg と fg を入れ替えた組は
  // 「塗り率を反転したグリフ」が字形集合にあるとは限らないので別物として扱う。
  const pairBg = new Int32Array(nPairs);
  const pairFg = new Int32Array(nPairs);
  const pairD  = new Float32Array(nPairs * 3);
  const pairD2 = new Float32Array(nPairs);
  const pairOf = new Map(); // (bg,fg) → ペア番号。ちらつき止めの引き当てに使う
  {
    let p = 0;
    for (let bi = 0; bi < bgList.length; bi++) {
      const bg = bgList[bi], b3 = bg * 3;
      for (let fi = 0; fi < nC; fi++, p++) {
        const fg = colorIdx[fi], f3 = fg * 3;
        pairOf.set(bg * 1024 + fg, p);
        const dr = palette[f3] - palette[b3];
        const dg = palette[f3 + 1] - palette[b3 + 1];
        const db = palette[f3 + 2] - palette[b3 + 2];
        pairBg[p] = bg; pairFg[p] = fg;
        pairD[p * 3] = dr; pairD[p * 3 + 1] = dg; pairD[p * 3 + 2] = db;
        // bg === fg のとき |d|² = 0。0除算を避けるため下限を置く
        // （このペアはどのグリフでも同じ塗り潰し結果になる＝ベタ塗り候補）
        pairD2[p] = (dr * dr + dg * dg + db * db) || 1e-6;
      }
    }
  }

  // セルごとに再利用する作業領域（確保をループ外に出す）
  const lb = new Float32Array(nPairs);
  const E  = new Float32Array(nPairs);
  const A  = new Float32Array(nPairs * quadCount);

  /**
   * @param {Float32Array} feat  ブロックごとの平均 RGB（長さ quadCount*3）
   * @param {number} prevBg  直前フレームの選択（履歴を使わないときは -1）
   * @param {number} prevFg
   * @param {number} prevGi
   * @param {number} hyst    履歴を優先する余裕（0 で無効。0.15 なら 15% 悪くても据え置き）
   * @returns {{bg:number, fg:number, gi:number}}
   */
  return function match(feat, prevBg, prevFg, prevGi, hyst) {
    /* --- 全ペアの E・a_q・下界を求める --- */
    let minLb = Infinity, minPi = 0;
    for (let pi = 0; pi < nPairs; pi++) {
      const b3 = pairBg[pi] * 3;
      const br = palette[b3], bgc = palette[b3 + 1], bb = palette[b3 + 2];
      const dr = pairD[pi * 3], dg = pairD[pi * 3 + 1], db = pairD[pi * 3 + 2];
      const d2 = pairD2[pi];
      const aBase = pi * quadCount;

      let e = 0, bound = 0;
      for (let q = 0; q < quadCount; q++) {
        const i3 = q * 3;
        const er = br - feat[i3], eg = bgc - feat[i3 + 1], eb = bb - feat[i3 + 2];
        e += er * er + eg * eg + eb * eb;

        const a = er * dr + eg * dg + eb * db;
        A[aBase + q] = a;

        // f_q を [0,1] の実数として自由に選べたときの最小値＝下界
        let t = -a / d2;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        bound += 2 * t * a + t * t * d2;
      }
      E[pi] = e;
      lb[pi] = e + bound;
      if (lb[pi] < minLb) { minLb = lb[pi]; minPi = pi; }
    }

    /* --- 下界最小のペアで暫定最良を作る --- */
    let best = Infinity, bestBg = -1, bestFg = -1, bestGi = 0;
    const scanPair = (pi) => {
      const e = E[pi], d2 = pairD2[pi], aBase = pi * quadCount;
      for (let gi = 0, fBase = 0; gi < nG; gi++, fBase += quadCount) {
        let dot = 0;
        for (let q = 0; q < quadCount; q++) dot += fillFlat[fBase + q] * A[aBase + q];
        const cost = e + 2 * dot + d2 * fillSq[gi];
        if (cost < best) { best = cost; bestBg = pairBg[pi]; bestFg = pairFg[pi]; bestGi = gi; }
      }
    };
    scanPair(minPi);

    /* --- 残りは下界で丸ごと切り落とす --- */
    for (let pi = 0; pi < nPairs; pi++) {
      if (pi === minPi || lb[pi] >= best) continue;
      scanPair(pi);
    }

    /* --- 時間方向のちらつき止め ---
     * 直前フレームと同じ組でも誤差がほとんど変わらないなら、そちらを据え置く。
     * AA 動画は隣接フレームの微差で毎回別の字が選ばれてザワつくので、
     * これが入るかどうかで見え方がかなり変わる。 */
    if (hyst > 0 && prevBg >= 0) {
      const pi = pairOf.has(prevBg * 1024 + prevFg) ? pairOf.get(prevBg * 1024 + prevFg) : -1;
      if (pi >= 0) {
        const e = E[pi], d2 = pairD2[pi], aBase = pi * quadCount, fBase = prevGi * quadCount;
        let dot = 0;
        for (let q = 0; q < quadCount; q++) dot += fillFlat[fBase + q] * A[aBase + q];
        const cost = e + 2 * dot + d2 * fillSq[prevGi];
        if (cost <= best * (1 + hyst)) return { bg: prevBg, fg: prevFg, gi: prevGi };
      }
    }

    return { bg: bestBg, fg: bestFg, gi: bestGi };
  };
}

/* ============================================================
   セル特徴量の抽出（パイプライン3の入力側）

   ブロック境界は Math.round(i * size / n) で取る。TEXTALT の
   calcCellFeatures と同じ式で、幅が割り切れないフォント
   （TenoText 3x6 を 2列に割る等）でも破綻しない。
   空になったブロックは blocks の生成時点で捨ててある。
   ============================================================ */

/** セルサイズとブロック分割からブロック矩形の一覧を作る（空ブロックは除外） */
function makeBlocks(cellW, cellH, rows, cols) {
  const xs = [], ys = [];
  for (let i = 0; i <= cols; i++) xs.push(Math.round(i * cellW / cols));
  for (let i = 0; i <= rows; i++) ys.push(Math.round(i * cellH / rows));
  const blocks = [];
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const x0 = xs[rx], x1 = xs[rx + 1], y0 = ys[ry], y1 = ys[ry + 1];
      if (x1 > x0 && y1 > y0) blocks.push({ x0, x1, y0, y1 });
    }
  }
  return blocks;
}

/** グリフのビットマスク（0/1）からブロックごとの塗り率を出す */
function fillRatiosOf(mask, cellW, blocks) {
  const out = new Float32Array(blocks.length);
  for (let q = 0; q < blocks.length; q++) {
    const { x0, x1, y0, y1 } = blocks[q];
    let on = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) on += mask[y * cellW + x];
    out[q] = on / ((x1 - x0) * (y1 - y0));
  }
  return out;
}

if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.createMatcher = createMatcher;
  self.makeBlocks = makeBlocks;
  self.fillRatiosOf = fillRatiosOf;
}
