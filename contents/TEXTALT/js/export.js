/** ============================================================
 * AA Generator v6 — export.js
 * PNGエクスポート
 * ============================================================ */

function exportPNG(scale) {
    if (lastAsciiLines.length === 0 || charBitmaps.size === 0) {
        ui.exportStatus.className = 'export-status err';
        ui.exportStatus.textContent = '⚠Please convert the image first';
        return;
    }

    const rows = lastAsciiLines.length;
    const cols = lastAsciiLines.reduce((m, l) => Math.max(m, [...l].length), 0);

    const pngW = cols * FONT_W * scale;
    const pngH = rows * FONT_H * scale;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width  = pngW;
    exportCanvas.height = pngH;
    const ctx = exportCanvas.getContext('2d');

    const colors = checkColorCache();

    ctx.fillStyle = ui.bgColorPicker.value;
    ctx.fillRect(0, 0, pngW, pngH);

    for (let r = 0; r < rows; r++) {
        const line = lastAsciiLines[r];
        const chars = [...line];
        for (let c = 0; c < chars.length; c++) {
            const char = chars[c];
            const cachedCvs = getCachedGlyph(char, colors.fg, colors.bg);
            if (!cachedCvs) continue;

            const dx = c * FONT_W * scale;
            const dy = r * FONT_H * scale;

            if (scale === 1) {
                ctx.drawImage(cachedCvs, dx, dy);
            } else {
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(cachedCvs, 0, 0, FONT_W, FONT_H, dx, dy, FONT_W * scale, FONT_H * scale);
            }
        }
    }

    exportCanvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `aa_${cols}x${rows}_${scale}x.png`;
        a.click();
        URL.revokeObjectURL(url);
        ui.exportStatus.className = 'export-status ok';
        ui.exportStatus.textContent = `✅ ${pngW}×${pngH}px (${scale}×) を保存`;
    }, 'image/png');
}
