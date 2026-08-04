/** ============================================================
 * AA Generator v6 — fontLoader.js
 * フォント読み込み（自動判定・手動フォールバック）
 * ============================================================ */

async function checkFontLoading() {
    ui.status.textContent = "🔄Loading fonts...";
    try {
        const fontFaceStr = `11px "${FONT_NAME}"`;
        await document.fonts.load(fontFaceStr);
        if (document.fonts.check(fontFaceStr)) fontLoadedSuccess();
        else throw new Error("Check failed");
    } catch (e) {
        ui.manualLoadArea.classList.add('visible');
        ui.status.className = 'status-bar error';
        ui.status.textContent = "⚠Automatic loading failed: Please manually select TenoText 8x11(+Extended ASCII).ttf.";
    }
}

function fontLoadedSuccess() {
    isFontReady = true;
    ui.manualLoadArea.classList.remove('visible');
    ui.status.className = 'status-bar success';
    ui.status.textContent = "✅Ready: Please select an image.";
    if (ui.customCharsInput.value === '') {
        ui.customCharsInput.value = CHAR_SETS['all'];
        updateCharCount();
    }
    ensureFontAnalyzed();
}

async function manualFontLoad(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const buff = await file.arrayBuffer();
        const fontFace = new FontFace(FONT_NAME, buff);
        await fontFace.load();
        document.fonts.add(fontFace);
        fontLoadedSuccess();
        if (sourceImage) processImage();
    } catch (err) {
        ui.status.className = 'status-bar error';
        ui.status.textContent = "⚠Error!" + err;
    }
}
