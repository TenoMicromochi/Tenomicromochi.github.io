/** ============================================================
 * AA Generator v6 — imageProcessing.js
 * 畳み込みカーネル・ぼかし・Sobel・閾値・ピクセル処理パイプライン
 *
 * 最適化方針: 出力を1ビットも変えずに、計算量とGC負荷だけを削る。
 *   - ぼかし  : 移動和により 1画素あたり O(半径) → O(1)
 *   - Sobel   : グレースケール化を 1画素1回に集約（従来は9タップ分重複計算）
 *   - シャープン: 係数0の四隅をスキップ（加算順序は従来のまま）
 *   - 値変換系 : ポスタライズ／反転をLUTに畳み込み
 *   - 中間バッファを使い回し、1段ごとの大量確保によるGCを止める
 * ============================================================ */

/* ---- Scratch Buffers ----
 * 5.76MPで1枚あたり約23MB。従来は1フィルタ毎に新規確保していたため
 * 1回の変換で100MB超のゴミが出ていた。同一サイズの間は使い回す。 */
let _scratch = [null, null, null];
let _scratchLen = -1;

function getScratch(i, len) {
    if (_scratchLen !== len) {
        _scratch = [null, null, null];
        _scratchLen = len;
    }
    if (!_scratch[i]) _scratch[i] = new Uint8ClampedArray(len);
    return _scratch[i];
}

const _lut1 = new Uint8Array(256);
const _lut2 = new Uint8Array(256);

/* ---- Convolution Kernels ---- */
function buildSharpenKernel(amount) {
    if (amount === 0) return null;
    if (amount > 0) {
        const a = amount;
        return {
            kernel: [
                 0, -a,  0,
                -a, 1+4*a, -a,
                 0, -a,  0
            ],
            size: 3,
            cross: true,   // 四隅が0のため専用の高速経路が使える
            a: a,
            center: 1 + 4 * a
        };
    } else {
        const b = Math.abs(amount);
        const center = 1 + 8 * b;
        const edge = b;
        const total = center + 8 * edge;
        return {
            kernel: [
                edge/total, edge/total, edge/total,
                edge/total, center/total, edge/total,
                edge/total, edge/total, edge/total
            ],
            size: 3,
            cross: false
        };
    }
}

/* 十字カーネル専用の経路。従来の加算順序 (上→左→中→右→下) をそのまま再現する。 */
function applyCrossKernel(data, w, h, negA, centerK, out) {
    for (let y = 0; y < h; y++) {
        const yUp   = y > 0     ? y - 1 : 0;
        const yDn   = y < h - 1 ? y + 1 : h - 1;
        const rowC  = y   * w * 4;
        const rowU  = yUp * w * 4;
        const rowD  = yDn * w * 4;

        for (let x = 0; x < w; x++) {
            const xL = x > 0     ? x - 1 : 0;
            const xR = x < w - 1 ? x + 1 : w - 1;

            const iC = rowC + x  * 4;
            const iU = rowU + x  * 4;
            const iD = rowD + x  * 4;
            const iL = rowC + xL * 4;
            const iR = rowC + xR * 4;

            let r = 0, g = 0, b = 0;
            r += data[iU]   * negA; g += data[iU+1] * negA; b += data[iU+2] * negA;
            r += data[iL]   * negA; g += data[iL+1] * negA; b += data[iL+2] * negA;
            r += data[iC]   * centerK; g += data[iC+1] * centerK; b += data[iC+2] * centerK;
            r += data[iR]   * negA; g += data[iR+1] * negA; b += data[iR+2] * negA;
            r += data[iD]   * negA; g += data[iD+1] * negA; b += data[iD+2] * negA;

            out[iC]   = r;
            out[iC+1] = g;
            out[iC+2] = b;
            out[iC+3] = data[iC+3];
        }
    }
    return out;
}

function applyConvolution(data, w, h, kernelObj, out) {
    if (!kernelObj) return data;
    if (!out) out = new Uint8ClampedArray(data.length);

    if (kernelObj.cross) {
        return applyCrossKernel(data, w, h, -kernelObj.a, kernelObj.center, out);
    }

    const { kernel, size } = kernelObj;
    const half = Math.floor(size / 2);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let r = 0, g = 0, b = 0;
            for (let ky = 0; ky < size; ky++) {
                for (let kx = 0; kx < size; kx++) {
                    const sy = Math.min(Math.max(y + ky - half, 0), h - 1);
                    const sx = Math.min(Math.max(x + kx - half, 0), w - 1);
                    const idx = (sy * w + sx) * 4;
                    const k = kernel[ky * size + kx];
                    r += data[idx]   * k;
                    g += data[idx+1] * k;
                    b += data[idx+2] * k;
                }
            }
            const idx = (y * w + x) * 4;
            out[idx]   = Math.min(Math.max(r, 0), 255);
            out[idx+1] = Math.min(Math.max(g, 0), 255);
            out[idx+2] = Math.min(Math.max(b, 0), 255);
            out[idx+3] = data[idx+3];
        }
    }
    return out;
}

/* ---- Image Processing Pipeline ---- */
/* 移動和による箱ぼかし。端は従来同様に画素を複製して常に (2r+1) 個で平均する。
 * 入力は整数のみ・加減算のみのため走査和は誤差なく整数を保ち、結果は従来と完全一致。 */
function applyBoxBlur(data, w, h, radius, out, tmp) {
    if (radius <= 0) return data;
    const r = Math.round(radius);
    if (!tmp) tmp = new Uint8ClampedArray(data.length);
    if (!out) out = new Uint8ClampedArray(data.length);

    const cnt = 2 * r + 1;

    // horizontal pass
    for (let y = 0; y < h; y++) {
        const row = y * w * 4;
        let sr = 0, sg = 0, sb = 0;
        for (let kx = -r; kx <= r; kx++) {
            const sx = kx < 0 ? 0 : (kx > w - 1 ? w - 1 : kx);
            const i = row + sx * 4;
            sr += data[i]; sg += data[i+1]; sb += data[i+2];
        }
        for (let x = 0; x < w; x++) {
            const oi = row + x * 4;
            tmp[oi] = sr/cnt; tmp[oi+1] = sg/cnt; tmp[oi+2] = sb/cnt; tmp[oi+3] = data[oi+3];

            // 窓を1つ進める: clamp(x-r) を抜き clamp(x+1+r) を足す
            const addX = x + 1 + r > w - 1 ? w - 1 : x + 1 + r;
            const remX = x - r < 0 ? 0 : x - r;
            const ai = row + addX * 4;
            const ri = row + remX * 4;
            sr += data[ai]   - data[ri];
            sg += data[ai+1] - data[ri+1];
            sb += data[ai+2] - data[ri+2];
        }
    }

    // vertical pass
    const stride = w * 4;
    for (let x = 0; x < w; x++) {
        const col = x * 4;
        let sr = 0, sg = 0, sb = 0;
        for (let ky = -r; ky <= r; ky++) {
            const sy = ky < 0 ? 0 : (ky > h - 1 ? h - 1 : ky);
            const i = sy * stride + col;
            sr += tmp[i]; sg += tmp[i+1]; sb += tmp[i+2];
        }
        for (let y = 0; y < h; y++) {
            const oi = y * stride + col;
            out[oi] = sr/cnt; out[oi+1] = sg/cnt; out[oi+2] = sb/cnt; out[oi+3] = tmp[oi+3];

            const addY = y + 1 + r > h - 1 ? h - 1 : y + 1 + r;
            const remY = y - r < 0 ? 0 : y - r;
            const ai = addY * stride + col;
            const ri = remY * stride + col;
            sr += tmp[ai]   - tmp[ri];
            sg += tmp[ai+1] - tmp[ri+1];
            sb += tmp[ai+2] - tmp[ri+2];
        }
    }
    return out;
}

/* Sobel用のグレースケール行キャッシュ。3行あれば足りるので w*3 分だけ持つ。 */
let _grayRows = null;
let _grayRowW = -1;
const _grayRowNum = [-1, -1, -1];

function _resetGrayRows(w) {
    if (_grayRowW !== w) {
        _grayRows = [new Float64Array(w), new Float64Array(w), new Float64Array(w)];
        _grayRowW = w;
    }
    _grayRowNum[0] = _grayRowNum[1] = _grayRowNum[2] = -1;
}

function _grayRow(data, w, yy) {
    const slot = yy % 3;
    if (_grayRowNum[slot] !== yy) {
        const buf = _grayRows[slot];
        let idx = yy * w * 4;
        for (let x = 0; x < w; x++, idx += 4) {
            buf[x] = 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
        }
        _grayRowNum[slot] = yy;
    }
    return _grayRows[slot];
}

let _edgeBuf = null;

function applySobel(data, w, h, amount, out) {
    if (amount <= 0) return data;
    if (!out) out = new Uint8ClampedArray(data.length);

    if (!_edgeBuf || _edgeBuf.length !== w * h) _edgeBuf = new Float32Array(w * h);
    const edge = _edgeBuf;
    let maxE = 0;

    _resetGrayRows(w);

    for (let y = 0; y < h; y++) {
        // 従来は9タップそれぞれでRGB→グレー変換していたが、行単位で1回に集約する。
        // 3行を個別のローカル変数で保持する（配列の配列にすると型が曖昧になり遅くなる）。
        const rU = _grayRow(data, w, y > 0     ? y - 1 : 0);
        const rC = _grayRow(data, w, y);
        const rD = _grayRow(data, w, y < h - 1 ? y + 1 : h - 1);
        const rowOff = y * w;

        for (let x = 0; x < w; x++) {
            const xm = x > 0     ? x - 1 : 0;
            const xp = x < w - 1 ? x + 1 : w - 1;

            const uL = rU[xm], uC = rU[x], uR = rU[xp];
            const cL = rC[xm],             cR = rC[xp];
            const dL = rD[xm], dC = rD[x], dR = rD[xp];

            // 係数0のタップは加算結果を変えないため省略。残りの加算順序は従来通り。
            const ex = -uL + uR - 2*cL + 2*cR - dL + dR;
            const ey = -uL - 2*uC - uR + dL + 2*dC + dR;

            const mag = Math.sqrt(ex*ex + ey*ey);
            edge[rowOff + x] = mag;
            if (mag > maxE) maxE = mag;
        }
    }
    if (maxE === 0) return data;

    const t = amount / 100;
    const base = 1 - t;
    for (let i = 0; i < w * h; i++) {
        const e = Math.min(edge[i] / maxE, 1) * t * 255;
        out[i*4]   = Math.min(255, data[i*4]   * base + e);
        out[i*4+1] = Math.min(255, data[i*4+1] * base + e);
        out[i*4+2] = Math.min(255, data[i*4+2] * base + e);
        out[i*4+3] = data[i*4+3];
    }
    return out;
}

function applyThreshold(data, thresh) {
    if (thresh <= 0) return data;
    for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
        const v = gray >= thresh ? 255 : 0;
        data[i] = v; data[i+1] = v; data[i+2] = v;
    }
    return data;
}

function processPixels(rawData, w, h, params) {
    const { brightness, contrast, gamma, posterize, sharpenAmount, blurAmount, sobelAmount, thresholdAmount, needsInvert } = params;
    const len = rawData.length;

    /* --- 値変換LUT: ガンマ → コントラスト → 明度 --- */
    const lut = _lut1;
    const cFactor = contrast === 0 ? 1 : (259 * (contrast + 255)) / (255 * (259 - contrast));
    for (let i = 0; i < 256; i++) {
        let v = i / 255;
        v = Math.pow(v, 1.0 / gamma);
        v = v * 255;
        v = cFactor * (v - 128) + 128;
        v = v + brightness * 2.55;
        lut[i] = Math.min(255, Math.max(0, Math.round(v)));
    }

    /* --- Pass A: LUT適用 --- */
    let bufIdx = 0;
    let d = getScratch(bufIdx, len);

    for (let i = 0; i < len; i += 4) {
        d[i]   = lut[rawData[i]];
        d[i+1] = lut[rawData[i+1]];
        d[i+2] = lut[rawData[i+2]];
        d[i+3] = rawData[i+3];
    }

    /* --- 空間フィルタ: バッファをピンポンして使い回す --- */
    if (sharpenAmount !== 0) {
        const next = (bufIdx + 1) % 3;
        d = applyConvolution(d, w, h, buildSharpenKernel(sharpenAmount), getScratch(next, len));
        bufIdx = next;
    }

    if (blurAmount > 0) {
        const tmpIdx = (bufIdx + 1) % 3;
        const outIdx = (bufIdx + 2) % 3;
        d = applyBoxBlur(d, w, h, blurAmount / 100 * 8, getScratch(outIdx, len), getScratch(tmpIdx, len));
        bufIdx = outIdx;
    }

    if (sobelAmount > 0) {
        const next = (bufIdx + 1) % 3;
        d = applySobel(d, w, h, sobelAmount, getScratch(next, len));
        bufIdx = next;
    }

    /* --- Pass B: ポスタライズと反転を1本のLUTに畳み込み、その場で適用 --- */
    if (posterize > 0 || needsInvert) {
        const lut2 = _lut2;
        if (posterize > 0) {
            const levels = Math.max(2, posterize);
            const step = 255 / (levels - 1);
            for (let i = 0; i < 256; i++) {
                const v = Math.round(Math.round(i / step) * step);
                lut2[i] = needsInvert ? 255 - v : v;
            }
        } else {
            for (let i = 0; i < 256; i++) lut2[i] = 255 - i;
        }
        for (let i = 0; i < len; i += 4) {
            d[i]   = lut2[d[i]];
            d[i+1] = lut2[d[i+1]];
            d[i+2] = lut2[d[i+2]];
        }
    }

    if (thresholdAmount > 0) {
        applyThreshold(d, thresholdAmount);
    }

    return d;
}
