/** ============================================================
 * AA Generator v6 — features.js
 * 特徴量抽出（グリッド密度ベクトル）
 *
 * calcFeatures は汎用版（フォント解析用・呼び出しは文字種類数ぶんのみ）。
 * 画像セル側は1変換で数万回走るため、確保をゼロにした専用版 calcCellFeatures を使う。
 * 密度をFloat32で持つ点・加算順序は従来と同一にしてあるため結果は完全一致する。
 * ============================================================ */

function calcFeatures(data, w, h, isDarkIsDense, gridX, gridY, includeAvg) {
    const grayDensity = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        grayDensity[i] = isDarkIsDense ? (255 - gray) / 255 : gray / 255;
    }

    const features = [];

    if (includeAvg) {
        let sum = 0;
        for (let i = 0; i < grayDensity.length; i++) sum += grayDensity[i];
        features.push(sum / grayDensity.length);
    }

    for (let gy = 0; gy < gridY; gy++) {
        for (let gx = 0; gx < gridX; gx++) {
            const x0 = Math.round(gx * w / gridX);
            const x1 = Math.round((gx + 1) * w / gridX);
            const y0 = Math.round(gy * h / gridY);
            const y1 = Math.round((gy + 1) * h / gridY);
            let cellSum = 0, cellCount = 0;
            for (let py = y0; py < y1; py++) {
                for (let px = x0; px < x1; px++) {
                    cellSum += grayDensity[py * w + px];
                    cellCount++;
                }
            }
            features.push(cellCount > 0 ? cellSum / cellCount : 0);
        }
    }

    return features;
}

/* ---- 画像セル用の高速経路 ---- */

const CELL_PIXELS = FONT_W * FONT_H;
const _cellDensity = new Float32Array(CELL_PIXELS);

let _extractorCache = null;
let _extractorKey = "";

/* グリッド境界はセル毎に変わらないので1変換につき1回だけ算出する。
 * 境界式 Math.round(i * FONT_W / gridX) は従来と同一。 */
function getCellExtractor(gridX, gridY, includeAvg) {
    const key = `${gridX}|${gridY}|${includeAvg}`;
    if (key === _extractorKey) return _extractorCache;

    const xs = new Int32Array(gridX + 1);
    for (let i = 0; i <= gridX; i++) xs[i] = Math.round(i * FONT_W / gridX);
    const ys = new Int32Array(gridY + 1);
    for (let i = 0; i <= gridY; i++) ys[i] = Math.round(i * FONT_H / gridY);

    const len = (includeAvg ? 1 : 0) + gridX * gridY;
    _extractorCache = { xs, ys, gridX, gridY, includeAvg, len, vec: new Float64Array(len) };
    _extractorKey = key;
    return _extractorCache;
}

/* セルを切り出さず元バッファから直接読む（従来の extractCell によるコピーが不要）。
 * 戻り値は使い回しのバッファなので、次の呼び出しまでに読み終えること。 */
function calcCellFeatures(data, cellX, cellY, strideW, ex) {
    const dens = _cellDensity;

    let p = 0;
    for (let ry = 0; ry < FONT_H; ry++) {
        let idx = ((cellY + ry) * strideW + cellX) * 4;
        for (let rx = 0; rx < FONT_W; rx++, idx += 4) {
            const gray = 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
            dens[p++] = gray / 255;
        }
    }

    const vec = ex.vec;
    let vi = 0;

    if (ex.includeAvg) {
        let sum = 0;
        for (let i = 0; i < CELL_PIXELS; i++) sum += dens[i];
        vec[vi++] = sum / CELL_PIXELS;
    }

    const xs = ex.xs, ys = ex.ys, gridX = ex.gridX, gridY = ex.gridY;
    for (let gy = 0; gy < gridY; gy++) {
        const y0 = ys[gy], y1 = ys[gy + 1];
        for (let gx = 0; gx < gridX; gx++) {
            const x0 = xs[gx], x1 = xs[gx + 1];
            let cellSum = 0, cellCount = 0;
            for (let py = y0; py < y1; py++) {
                const rowBase = py * FONT_W;
                for (let px = x0; px < x1; px++) {
                    cellSum += dens[rowBase + px];
                    cellCount++;
                }
            }
            vec[vi++] = cellCount > 0 ? cellSum / cellCount : 0;
        }
    }

    return vec;
}
