/** ============================================================
 * AA Generator v6 — export.js
 * PNG / テキストの書き出し
 * ============================================================ */

function setExportStatus(cls, text) {
    ui.exportStatus.className = 'export-status ' + cls;
    ui.exportStatus.textContent = text;
}

function hasResult() {
    if (lastAsciiLines.length === 0 || charMasks.size === 0) {
        setExportStatus('err', '⚠Please convert the image first');
        return false;
    }
    return true;
}

/* 書き出し用 canvas を作る（toBlob 前。確認用に切り出してある） */
function buildExportCanvas(scale) {
    const img = renderAsciiImageData(
        lastAsciiLines, charMasks,
        hexToRGB(ui.fgColorPicker.value), hexToRGB(ui.bgColorPicker.value), scale);
    const cvs = document.createElement('canvas');
    cvs.width = img.width;
    cvs.height = img.height;
    cvs.getContext('2d').putImageData(img, 0, 0);
    return cvs;
}

function exportPNG(scale) {
    if (!hasResult()) return;
    const { cols, rows } = asciiSize();
    const exportCanvas = buildExportCanvas(scale);
    const pngW = exportCanvas.width;
    const pngH = exportCanvas.height;

    exportCanvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `aa_${cols}x${rows}_${scale}x.png`;
        a.click();
        URL.revokeObjectURL(url);
        setExportStatus('ok', `✅ ${pngW}×${pngH}px (${scale}×) saved`);
    }, 'image/png');
}

function copyText() {
    if (!hasResult()) return;
    const { cols, rows } = asciiSize();
    navigator.clipboard.writeText(buildAsciiText()).then(
        () => setExportStatus('ok', `✅ Copied ${cols}×${rows} text`),
        () => setExportStatus('err', '⚠Copy failed')
    );
}

function saveTxt() {
    if (!hasResult()) return;
    const { cols, rows } = asciiSize();
    const blob = new Blob([buildAsciiText() + '\n'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aa_${cols}x${rows}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setExportStatus('ok', `✅ Saved aa_${cols}x${rows}.txt`);
}
