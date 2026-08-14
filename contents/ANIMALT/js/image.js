/* ============================================================
   ANIMALT-Δ — image adjustment

   かける順番:
     BLUR → SOBEL → 明度/コントラスト/ガンマ(LUT) → 彩度+色相(行列) → 反転

   ぼかしを先に置くのは、ノイズを潰してからエッジを拾わせるため。
   明度系を後に置くのは、空間フィルタが元の階調の上で効いてほしいため。

   彩度と色相はどちらも RGB の線形変換なので、2つの 3x3 行列を先に掛け合わせて
   1本にしてから画素に適用する。HSV へ往復するより速く、結果は同じ。
   彩度だけのときの係数は Rec.709 の輝度と一致するので、
   従来の「輝度との補間」で書いていたときと出力は変わらない。

   Worker からも importScripts で読むので DOM に触れないこと。
   ============================================================ */
const Adjust = (() => {

  /* ---- 使い回すスクラッチ ----
   * フレームごとに確保すると 512x512 で 1MB のゴミが毎コマ出る。
   * 同じ長さの間は使い回す。 */
  let _scratch = [null, null];
  let _scratchLen = -1;
  function scratch(i, len) {
    if (_scratchLen !== len) { _scratch = [null, null]; _scratchLen = len; }
    if (!_scratch[i]) _scratch[i] = new Uint8ClampedArray(len);
    return _scratch[i];
  }

  /* ---- BLUR ----
   * 移動和による箱ぼかし。1画素あたり O(半径) ではなく O(1)。
   * 端は画素を複製して、常に (2r+1) 個で平均する。 */
  function boxBlur(data, w, h, radius) {
    const r = Math.round(radius);
    if (r <= 0) return data;

    const tmp = scratch(0, data.length);
    const out = scratch(1, data.length);
    const cnt = 2 * r + 1;

    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      let sr = 0, sg = 0, sb = 0;
      for (let kx = -r; kx <= r; kx++) {
        const sx = kx < 0 ? 0 : (kx > w - 1 ? w - 1 : kx);
        const i = row + sx * 4;
        sr += data[i]; sg += data[i + 1]; sb += data[i + 2];
      }
      for (let x = 0; x < w; x++) {
        const oi = row + x * 4;
        tmp[oi] = sr / cnt; tmp[oi + 1] = sg / cnt; tmp[oi + 2] = sb / cnt; tmp[oi + 3] = data[oi + 3];
        const addX = x + 1 + r > w - 1 ? w - 1 : x + 1 + r;
        const remX = x - r < 0 ? 0 : x - r;
        const ai = row + addX * 4, ri = row + remX * 4;
        sr += data[ai] - data[ri];
        sg += data[ai + 1] - data[ri + 1];
        sb += data[ai + 2] - data[ri + 2];
      }
    }

    const stride = w * 4;
    for (let x = 0; x < w; x++) {
      const col = x * 4;
      let sr = 0, sg = 0, sb = 0;
      for (let ky = -r; ky <= r; ky++) {
        const sy = ky < 0 ? 0 : (ky > h - 1 ? h - 1 : ky);
        const i = sy * stride + col;
        sr += tmp[i]; sg += tmp[i + 1]; sb += tmp[i + 2];
      }
      for (let y = 0; y < h; y++) {
        const oi = y * stride + col;
        out[oi] = sr / cnt; out[oi + 1] = sg / cnt; out[oi + 2] = sb / cnt; out[oi + 3] = tmp[oi + 3];
        const addY = y + 1 + r > h - 1 ? h - 1 : y + 1 + r;
        const remY = y - r < 0 ? 0 : y - r;
        const ai = addY * stride + col, ri = remY * stride + col;
        sr += tmp[ai] - tmp[ri];
        sg += tmp[ai + 1] - tmp[ri + 1];
        sb += tmp[ai + 2] - tmp[ri + 2];
      }
    }
    return out;
  }

  /* ---- SOBEL ----
   * エッジの強さを求めて、元の絵に白で足し込む。
   * グレースケール化は行単位で1回だけ行う（9タップぶん重複させない）。 */
  let _edge = null, _gray = null;
  function sobel(data, w, h, amount) {
    if (amount <= 0) return data;
    if (!_edge || _edge.length !== w * h) {
      _edge = new Float32Array(w * h);
      _gray = new Float32Array(w * h);
    }
    const gray = _gray, edge = _edge;
    for (let i = 0, p = 0; p < w * h; p++, i += 4) {
      gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    let maxE = 0;
    for (let y = 0; y < h; y++) {
      const rU = (y > 0 ? y - 1 : 0) * w;
      const rC = y * w;
      const rD = (y < h - 1 ? y + 1 : h - 1) * w;
      for (let x = 0; x < w; x++) {
        const xm = x > 0 ? x - 1 : 0;
        const xp = x < w - 1 ? x + 1 : w - 1;
        const uL = gray[rU + xm], uC = gray[rU + x], uR = gray[rU + xp];
        const cL = gray[rC + xm], cR = gray[rC + xp];
        const dL = gray[rD + xm], dC = gray[rD + x], dR = gray[rD + xp];
        const ex = -uL + uR - 2 * cL + 2 * cR - dL + dR;
        const ey = -uL - 2 * uC - uR + dL + 2 * dC + dR;
        const mag = Math.sqrt(ex * ex + ey * ey);
        edge[rC + x] = mag;
        if (mag > maxE) maxE = mag;
      }
    }
    if (maxE === 0) return data;

    const t = amount / 100, base = 1 - t;
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      const e = Math.min(edge[p] / maxE, 1) * t * 255;
      data[i] = data[i] * base + e;
      data[i + 1] = data[i + 1] * base + e;
      data[i + 2] = data[i + 2] * base + e;
    }
    return data;
  }

  /* ---- 明度 / コントラスト / ガンマ ---- */
  function makeLUT(p) {
    const bright = p.brightness * 2.55;
    const c = p.contrast / 100;
    const cf = (259 * (c * 255 + 255)) / (255 * (259 - c * 255));
    const invGamma = 1 / Math.max(0.01, p.gamma);
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      let v = i + bright;
      v = cf * (v - 128) + 128;
      v = 255 * Math.pow(Math.max(0, Math.min(255, v)) / 255, invGamma);
      lut[i] = v;
    }
    return lut;
  }

  /* ---- 彩度 + 色相を 1本の 3x3 行列にまとめる ---- */
  const LR = 0.213, LG = 0.715, LB = 0.072; // Rec.709 の輝度係数

  function satMatrix(s) {
    return [
      LR + (1 - LR) * s, LG - LG * s,       LB - LB * s,
      LR - LR * s,       LG + (1 - LG) * s, LB - LB * s,
      LR - LR * s,       LG - LG * s,       LB + (1 - LB) * s,
    ];
  }

  function hueMatrix(deg) {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [
      LR + c * (1 - LR) - s * LR,        LG - c * LG - s * LG,        LB - c * LB + s * (1 - LB),
      LR - c * LR + s * 0.143,           LG + c * (1 - LG) + s * 0.140, LB - c * LB - s * 0.283,
      LR - c * LR - s * (1 - LR),        LG - c * LG + s * LG,        LB + c * (1 - LB) + s * LB,
    ];
  }

  function mul(a, b) {
    const o = new Float64Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
    return o;
  }

  /**
   * data を破壊的に書き換え、実際に使うバッファを返す。
   * ぼかしは別バッファへ書くので、戻り値のほうを使うこと。
   */
  function apply(data, w, h, p) {
    let d = data;

    if (p.blur > 0) d = boxBlur(d, w, h, p.blur / 100 * 8);
    if (p.sobel > 0) d = sobel(d, w, h, p.sobel);

    const lut = makeLUT(p);
    const sat = 1 + p.saturation / 100;
    const hue = p.hue || 0;
    const needsMatrix = sat !== 1 || hue !== 0;
    const m = needsMatrix
      ? (hue !== 0 ? mul(hueMatrix(hue), satMatrix(sat)) : satMatrix(sat))
      : null;
    const inv = !!p.invert;

    for (let i = 0; i < d.length; i += 4) {
      let r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]];
      if (m) {
        const nr = m[0] * r + m[1] * g + m[2] * b;
        const ng = m[3] * r + m[4] * g + m[5] * b;
        const nb = m[6] * r + m[7] * g + m[8] * b;
        r = nr; g = ng; b = nb;
      }
      if (inv) { r = 255 - r; g = 255 - g; b = 255 - b; }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
    return d;
  }

  return { apply };
})();

if (typeof self !== 'undefined' && typeof window === 'undefined') self.Adjust = Adjust;
