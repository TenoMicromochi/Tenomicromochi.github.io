/** ============================================================
 * AA Generator v6 — glyph.js
 * 着色グリフキャッシュ・ビットマッププレビュー描画
 * ============================================================ */

/* ---- Colored Glyph Generator (Cache System) ---- */
function getCachedGlyph(char, fg, bg) {
    if (coloredGlyphCache.has(char)) {
        return coloredGlyphCache.get(char);
    }

    const bmp = charBitmaps.get(char);
    if (!bmp) return null;

    const cacheCvs = document.createElement('canvas');
    cacheCvs.width = FONT_W;
    cacheCvs.height = FONT_H;
    const cacheCtx = cacheCvs.getContext('2d');
    cacheCtx.imageSmoothingEnabled = false;
    const cImg = cacheCtx.createImageData(FONT_W, FONT_H);

    for (let p = 0; p < FONT_W * FONT_H; p++) {
        const isInk = bmp[p * 4] < 128;
        cImg.data[p * 4]     = isInk ? fg[0] : bg[0];
        cImg.data[p * 4 + 1] = isInk ? fg[1] : bg[1];
        cImg.data[p * 4 + 2] = isInk ? fg[2] : bg[2];
        cImg.data[p * 4 + 3] = 255;
    }

    cacheCtx.putImageData(cImg, 0, 0);
    coloredGlyphCache.set(char, cacheCvs);
    return cacheCvs;
}

function checkColorCache() {
    const colorKey = ui.fgColorPicker.value + "|" + ui.bgColorPicker.value;
    if (colorKey !== lastColorKey) {
        coloredGlyphCache.clear();
        lastColorKey = colorKey;
    }
    return {
        fg: hexToRGB(ui.fgColorPicker.value),
        bg: hexToRGB(ui.bgColorPicker.value)
    };
}

function hexToRGB(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function syncColorDots() {
    ui.fgColorDot.style.background = ui.fgColorPicker.value;
    ui.bgColorDot.style.background = ui.bgColorPicker.value;
}

/* ---- Bitmap Preview Renderer ---- */

/* プレビューは重い描画なので、TEXTタブ表示中は描かずに「要再描画」だけ立てておき、
 * PREVIEWタブに切り替わった時点で初めて描く。 */
let bitmapDirty = true;

function isPreviewTabActive() {
    const tab = document.querySelector('.view-tab.active');
    return !!tab && tab.dataset.tab === 'preview';
}

function requestBitmapPreview() {
    bitmapDirty = true;
    if (isPreviewTabActive()) renderBitmapPreview();
}

function renderBitmapPreview() {
    const cvs = ui.bitmapCanvas;
    const ctx = cvs.getContext('2d');
    bitmapDirty = false;

    if (lastAsciiLines.length === 0 || charBitmaps.size === 0) {
        cvs.width  = 320;
        cvs.height = 80;
        ctx.fillStyle = '#1a1d28';
        ctx.fillRect(0, 0, cvs.width, cvs.height);
        ctx.fillStyle = '#6b7494';
        ctx.font = '11px monospace';
        ctx.fillText('[ ⚠ Please convert the image first ]', 16, 44);
        return;
    }

    const rows = lastAsciiLines.length;
    const cols = lastAsciiLines.reduce((m, l) => Math.max(m, [...l].length), 0);

    cvs.width  = cols * FONT_W;
    cvs.height = rows * FONT_H;
    ctx.imageSmoothingEnabled = false;

    const colors = checkColorCache();

    ctx.fillStyle = ui.bgColorPicker.value;
    ctx.fillRect(0, 0, cvs.width, cvs.height);

    for (let r = 0; r < rows; r++) {
        const line = lastAsciiLines[r];
        const chars = [...line];
        for (let c = 0; c < chars.length; c++) {
            const char = chars[c];
            const cachedCvs = getCachedGlyph(char, colors.fg, colors.bg);
            if (!cachedCvs) continue;

            // キャッシュ済みのCanvasを高速転写するのみ
            ctx.drawImage(cachedCvs, c * FONT_W, r * FONT_H);
        }
    }
}
