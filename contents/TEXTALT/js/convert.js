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
    const fontAspect = FONT_W / FONT_H;
    const outH = Math.round(outW * imgAspect * fontAspect);

    const cvsW = outW * FONT_W;
    const cvsH = outH * FONT_H;

    ui.preview.width  = cvsW;
    ui.preview.height = cvsH;

    pCtx.imageSmoothingEnabled = true;
    pCtx.imageSmoothingQuality = 'high';
    pCtx.drawImage(sourceImage, 0, 0, cvsW, cvsH);

    const imgData = pCtx.getImageData(0, 0, cvsW, cvsH);

    const processed = processPixels(imgData.data, cvsW, cvsH, {
        brightness, contrast, gamma,
        posterize, sharpenAmount: sharpenAmt,
        blurAmount: blurAmt, sobelAmount: sobelAmt, thresholdAmount: threshAmt,
        needsInvert
    });

    imgData.data.set(processed);
    pCtx.putImageData(imgData, 0, 0);

    // --- ASCII conversion ---
    const ex = getCellExtractor(gridX, gridY, includeAvg);
    const rows = new Array(outH);
    const rowChars = new Array(outW);

    for (let r = 0; r < outH; r++) {
        const cy = r * FONT_H;
        for (let c = 0; c < outW; c++) {
            const vec = calcCellFeatures(processed, c * FONT_W, cy, cvsW, ex);
            rowChars[c] = findClosestChar(vec, densityW, ex.len);
        }
        rows[r] = rowChars.join('');
    }
    const ascii = rows.join('\n') + '\n';

    ui.output.textContent = ascii;
    lastAsciiLines = rows;
    lastNeedsInvert = needsInvert;

    if (needsInvert) {
        ui.output.style.backgroundColor = '#e8edf8';
        ui.output.style.color = '#1a1d28';
        if (ui.bgColorPicker.value === '#1a1d28') ui.bgColorPicker.value = '#e8edf8';
        if (ui.fgColorPicker.value === '#c8cfe8') ui.fgColorPicker.value = '#1a1d28';
    } else {
        ui.output.style.backgroundColor = '#1a1d28';
        ui.output.style.color = '#c8cfe8';
        if (ui.bgColorPicker.value === '#e8edf8') ui.bgColorPicker.value = '#1a1d28';
        if (ui.fgColorPicker.value === '#1a1d28') ui.fgColorPicker.value = '#c8cfe8';
    }
    syncColorDots();

    ui.status.className = 'status-bar success';
    ui.status.textContent = `✅Converted: ${outW} × ${outH} Characters | Grid ${gridX}×${gridY} | ${charVectors.length} chars`;

    requestBitmapPreview();
}

/* 距離は従来と同じ「重み付き二乗和」。式の形と加算順序を保っているため結果は一致する。
 * 途中で最良値を超えたら打ち切るが、二乗和は単調増加なので判定は変わらない。 */
function findClosestChar(targetVec, densityWeight, vecLen) {
    const n = charCharList.length;
    if (n === 0) return ' ';

    const flat = charVecFlat;
    const skipSpace = targetVec[0] >= 0.05;

    let minD = Infinity;
    let best = ' ';

    for (let i = 0, base = 0; i < n; i++, base += vecLen) {
        if (skipSpace && charIsSpace[i]) continue;

        // 第0成分だけ densityWeight が掛かる
        const d0 = (flat[base] - targetVec[0]) * densityWeight;
        let d = d0 * d0;
        if (d >= minD) continue;

        for (let j = 1; j < vecLen; j++) {
            const dj = flat[base + j] - targetVec[j];
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
