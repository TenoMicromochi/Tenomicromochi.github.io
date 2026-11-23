/** ============================================================
 * AA Generator v6 — charset.js
 * 文字セットUI操作（プリセット追加・カウント表示）
 * ============================================================ */

function updateCharCount() {
    // コードポイントで数える（絵文字も1文字）。改行・タブ・制御文字は数えない
    ui.charCount.textContent = [...ui.customCharsInput.value].filter(c => !/[\u0000-\u001f\u007f-\u009f]/.test(c)).length;
}

function addPresetChars(replace) {
    const key = ui.charSetSelect.value;
    const preset = CHAR_SETS[key] || '';
    if (replace) {
        ui.customCharsInput.value = preset;
    } else {
        const existing = new Set(ui.customCharsInput.value);
        let toAdd = '';
        for (const c of preset) {
            if (!existing.has(c)) {
                existing.add(c);
                toAdd += c;
            }
        }
        const cur = ui.customCharsInput.value;
        const hasTrailingSpace = cur.endsWith(' ');
        const base = hasTrailingSpace ? cur.slice(0, -1) : cur;
        const newToAdd = toAdd.replace(/ /g, '');
        const newHasSpace = toAdd.includes(' ') || hasTrailingSpace;
        ui.customCharsInput.value = base + newToAdd + (newHasSpace ? ' ' : '');
    }
    updateCharCount();
    scheduleProcess();
}
