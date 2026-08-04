/** ============================================================
 * AA Generator v6 — main.js
 * init()・イベントバインディング・エントリポイント
 * ============================================================ */

function init() {
    const ranges = [
        [ui.width,       ui.valWidth,       v => v],
        [ui.contrast,    ui.valContrast,    v => v],
        [ui.brightness,  ui.valBrightness,  v => v],
        [ui.gamma,       ui.valGamma,       v => parseFloat(v).toFixed(2)],
        [ui.posterize,   ui.valPosterize,   v => v === '0' ? 'OFF' : v],
        [ui.sharpen,     ui.valSharpen,     v => parseFloat(v).toFixed(1)],
        [ui.threshold,   ui.valThreshold,   v => v === '0' ? 'OFF' : v],
        [ui.sobel,       ui.valSobel,       v => v === '0' ? 'OFF' : v],
        [ui.blur,        ui.valBlur,        v => v === '0' ? 'OFF' : v],
        [ui.densityWeight, ui.valDensityWeight, v => parseFloat(v).toFixed(1)],
    ];
    function updateSliderPct(el) {
        const min = parseFloat(el.min), max = parseFloat(el.max), val = parseFloat(el.value);
        el.style.background = `linear-gradient(90deg, var(--accent) ${((val - min) / (max - min) * 100).toFixed(1)}%, var(--border) ${((val - min) / (max - min) * 100).toFixed(1)}%)`;
    }
    ranges.forEach(([input, label, fmt]) => {
        label.textContent = fmt(input.value);
        updateSliderPct(input);
        input.addEventListener('input', () => {
            label.textContent = fmt(input.value);
            updateSliderPct(input);
            scheduleProcess();
        });
    });

    document.querySelectorAll('.spin-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const dir      = parseInt(btn.dataset.dir);
            const hidden   = document.getElementById(targetId);
            const label    = document.getElementById('val-' + targetId);
            let val = parseInt(hidden.value) + dir;
            val = Math.min(5, Math.max(1, val));
            hidden.value = val;
            label.textContent = val;
            scheduleProcess();
        });
    });

    ui.file.addEventListener('change', loadSourceImage);
    ui.fontFile.addEventListener('change', manualFontLoad);

    ui.addPresetBtn.addEventListener('click',     () => addPresetChars(false));
    ui.replacePresetBtn.addEventListener('click', () => addPresetChars(true));
    ui.customCharsInput.addEventListener('input', () => {
        updateCharCount();
        if (ui.autoApplyCheck.checked) scheduleProcess();
    });

    [ui.invert, ui.includeAvg, ui.autoApplyCheck].forEach(el => {
        el.addEventListener('change', scheduleProcess);
    });

    document.querySelectorAll('.view-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.output-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
            // 非表示中にスキップした描画をここで取り戻す
            if (tab.dataset.tab === 'preview' && bitmapDirty) renderBitmapPreview();
        });
    });

    document.querySelectorAll('.btn-scale').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.btn-scale').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            exportPNG(parseInt(btn.dataset.scale));
        });
    });

    [ui.fgColorPicker, ui.bgColorPicker].forEach(el => {
        el.addEventListener('input', () => {
            syncColorDots();
            requestBitmapPreview();
        });
    });
    ui.swapColorsBtn.addEventListener('click', () => {
        const tmp = ui.fgColorPicker.value;
        ui.fgColorPicker.value = ui.bgColorPicker.value;
        ui.bgColorPicker.value = tmp;
        syncColorDots();
        requestBitmapPreview();
    });

    checkFontLoading();
}

init();
