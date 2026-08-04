/** ============================================================
 * AA Generator v6 — fontAnalysis.js
 * フォントの各文字をビットマップ化し特徴ベクトルを算出
 * ============================================================ */

function ensureFontAnalyzed() {
    const chars = getCurrentChars();
    const gridX = ui.gridX.value;
    const gridY = ui.gridY.value;
    const includeAvg = ui.includeAvg.checked;

    // パラメータ群から一意なキーを作成し、変更があった場合のみ解析を実行
    const key = `${chars}|${gridX}|${gridY}|${includeAvg}`;
    if (key !== lastAnalyzeKey) {
        analyzeFontShapes();
        lastAnalyzeKey = key;
    }
}

function analyzeFontShapes() {
    if (!isFontReady) return;

    const chars = getCurrentChars();
    charVectors = [];
    const gridX = parseInt(ui.gridX.value);
    const gridY = parseInt(ui.gridY.value);
    const includeAvg = ui.includeAvg.checked;

    ui.analysis.width  = FONT_W;
    ui.analysis.height = FONT_H;
    aCtx.font = `11px "${FONT_NAME}"`;
    aCtx.textBaseline = 'top';

    const seen = new Set();
    charBitmaps.clear();
    for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        if (seen.has(char)) continue;
        seen.add(char);

        aCtx.fillStyle = '#FFFFFF';
        aCtx.fillRect(0, 0, FONT_W, FONT_H);
        aCtx.fillStyle = '#000000';
        aCtx.fillText(char, 0, 0);

        const imgData = aCtx.getImageData(0, 0, FONT_W, FONT_H);
        charBitmaps.set(char, new Uint8Array(imgData.data));
        const vec = calcFeatures(imgData.data, FONT_W, FONT_H, true, gridX, gridY, includeAvg);
        charVectors.push({ char, vec });
    }

    flattenCharVectors();
}

/* 探索の内側ループが連続メモリを読めるように詰め直す。順序は charVectors のまま
 * （同値時にどの文字が勝つかが変わらないよう、走査順を保つ必要がある）。 */
function flattenCharVectors() {
    const n = charVectors.length;
    charVecLen = n > 0 ? charVectors[0].vec.length : 0;
    charVecFlat = new Float64Array(n * charVecLen);
    charCharList = new Array(n);
    charIsSpace = new Uint8Array(n);

    for (let i = 0; i < n; i++) {
        const entry = charVectors[i];
        const base = i * charVecLen;
        for (let j = 0; j < charVecLen; j++) charVecFlat[base + j] = entry.vec[j];
        charCharList[i] = entry.char;
        charIsSpace[i] = entry.char === ' ' ? 1 : 0;
    }
}

function getCurrentChars() {
    const custom = ui.customCharsInput.value;
    return custom.length > 0 ? custom : CHAR_SETS['all'];
}
