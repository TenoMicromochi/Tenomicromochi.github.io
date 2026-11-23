/** ============================================================
 * AA Generator v6 — convert.js
 * 画像読込〜ASCII変換本体
 * ============================================================ */

/* ---- Source Image ---- */
function loadSourceImage(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
        const img = new Image();
        img.onload = () => {
            sourceImage = img;
            processImage();
        };
        img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
}

/* ---- Process ---- */
function scheduleProcess() {
    if (!sourceImage || !isFontReady) return;
    clearTimeout(processTimer);
    processTimer = setTimeout(processImage, 60);
}

function processImage() {
    if (!sourceImage || !isFontReady) return;

    // スライダー操作等ではフォント条件が変わらなければ再解析をスキップする
    ensureFontAnalyzed();
    syncFontUI();   // PIXEL ではセルが CHAR SET に合わせて変わることがある

    const outW  = parseInt(ui.width.value) || 80;
    const contrast     = parseInt(ui.contrast.value);
    const brightness   = parseInt(ui.brightness.value);
    const gamma        = parseFloat(ui.gamma.value);
    const posterize    = parseInt(ui.posterize.value);
    const sharpenAmt   = parseFloat(ui.sharpen.value);
    const blurAmt      = parseFloat(ui.blur.value);
    const sobelAmt     = parseFloat(ui.sobel.value);
    const threshAmt    = parseInt(ui.threshold.value);
    const needsInvert  = ui.invert.checked;
    const densityW     = parseFloat(ui.densityWeight.value);
    const gridX        = parseInt(ui.gridX.value);
    const gridY        = parseInt(ui.gridY.value);
    const includeAvg   = ui.includeAvg.checked;

    const imgAspect = sourceImage.height / sourceImage.width;
    const cellW = font.cellW, cellH = font.cellH;   // ensureFontAnalyzed がセルを確定させたあとの値
    const fontAspect = cellW / cellH;
    const outH = Math.round(outW * imgAspect * fontAspect);

    const cvsW = outW * cellW;
    const cvsH = outH * cellH;

    /* 段ごとのキャッシュ。変えた設定より後ろの段だけをやり直す：
     *   S 元画像の縮小 → P 加工 → F セルの特徴量 → A 文字の選択
     * 各段の中身は従来と同じ計算なので、出力は従来と完全一致する。 */

    // --- S: 元画像を出力サイズへ縮小して読む（画像と出力サイズが同じ間は使い回す）---
    const keyS = `${cvsW}x${cvsH}|${cellW}x${cellH}`;
    if (_cache.srcImage !== sourceImage || _cache.keyS !== keyS) {
        ui.preview.width  = cvsW;
        ui.preview.height = cvsH;
        pCtx.imageSmoothingEnabled = true;
        pCtx.imageSmoothingQuality = 'high';
        pCtx.drawImage(sourceImage, 0, 0, cvsW, cvsH);
        _cache.previewImg = pCtx.getImageData(0, 0, cvsW, cvsH);
        _cache.srcPixels = new Uint8ClampedArray(_cache.previewImg.data);
        _cache.srcImage = sourceImage;
        _cache.keyS = keyS;
        _cache.keyP = null;
    }

    // --- P: 画像の加工（加工の設定が同じ間は使い回す）---
    const keyP = `${keyS}|${brightness}|${contrast}|${gamma}|${posterize}|${sharpenAmt}|${blurAmt}|${sobelAmt}|${threshAmt}|${needsInvert}`;
    if (_cache.keyP !== keyP) {
        _cache.processed = processPixels(_cache.srcPixels, cvsW, cvsH, {
            brightness, contrast, gamma,
            posterize, sharpenAmount: sharpenAmt,
            blurAmount: blurAmt, sobelAmount: sobelAmt, thresholdAmount: threshAmt,
            needsInvert
        });
        _cache.previewImg.data.set(_cache.processed);
        pCtx.putImageData(_cache.previewImg, 0, 0);
        _cache.keyP = keyP;
        _cache.keyF = null;
    }
    const processed = _cache.processed;

    // --- F: セルごとの特徴量（格子の設定が同じ間は使い回す）---
    const ex = getCellExtractor(gridX, gridY, includeAvg, cellW, cellH);
    const vecLen = ex.len;
    const keyF = `${keyP}|${gridX}|${gridY}|${includeAvg}`;
    if (_cache.keyF !== keyF) {
        const need = outW * outH * vecLen;
        if (!_cache.feats || _cache.feats.length !== need) _cache.feats = new Float64Array(need);
        const feats = _cache.feats;
        let o = 0;
        for (let r = 0; r < outH; r++) {
            const cy = r * cellH;
            for (let c = 0; c < outW; c++) {
                const vec = calcCellFeatures(processed, c * cellW, cy, cvsW, ex);
                for (let j = 0; j < vecLen; j++) feats[o++] = vec[j];
            }
        }
        _cache.keyF = keyF;
        _cache.keyA = null;
    }

    // --- A: 文字の選択（重み・文字セットが同じ間は使い回す）---
    const keyA = `${keyF}|${densityW}|${lastAnalyzeKey}`;
    if (_cache.keyA !== keyA) {
        const feats = _cache.feats;
        const rows = new Array(outH);
        const rowChars = new Array(outW);
        let off = 0;
        for (let r = 0; r < outH; r++) {
            for (let c = 0; c < outW; c++, off += vecLen) {
                rowChars[c] = findClosestChar(feats, off, densityW, vecLen);
            }
            rows[r] = rowChars.join('');
        }
        lastAsciiLines = rows;
        _cache.keyA = keyA;
    }

    ui.status.className = 'status-bar success';
    ui.status.textContent = `✅Converted: ${outW} × ${outH} Characters | Grid ${gridX}×${gridY} | ${charVectors.length} chars`;

    lastRender = { masks: charMasks, cw: cellW, ch: cellH };
    renderOutput();
    fitPreviewCanvas();
}

/* 距離は従来と同じ「重み付き二乗和」。式の形と加算順序を保っているため結果は一致する。
 * 途中で最良値を超えたら打ち切るが、二乗和は単調増加なので判定は変わらない。 */
/* feats[off .. off+vecLen) が1セルの特徴量 */
function findClosestChar(feats, off, densityWeight, vecLen) {
    const n = charCharList.length;
    if (n === 0) return ' ';

    const flat = charVecFlat;
    const t0 = feats[off];
    const skipSpace = t0 >= 0.05;

    let minD = Infinity;
    let best = ' ';

    for (let i = 0, base = 0; i < n; i++, base += vecLen) {
        if (skipSpace && charIsSpace[i]) continue;

        // 第0成分だけ densityWeight が掛かる
        const d0 = (flat[base] - t0) * densityWeight;
        let d = d0 * d0;
        if (d >= minD) continue;

        for (let j = 1; j < vecLen; j++) {
            const dj = flat[base + j] - feats[off + j];
            d += dj * dj;
            if (d >= minD) break;
        }

        if (d < minD) {
            minD = d;
            best = charCharList[i];
        }
    }
    return best;
}
