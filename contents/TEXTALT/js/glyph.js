/** ============================================================
 * AA Generator v6 — glyph.js
 * 表示・書き出し共通の描画（ImageData に直接書く）と色の補助
 * ============================================================ */

function hexToRGB(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function syncColorDots() {
    ui.fgColorDot.style.background = ui.fgColorPicker.value;
    ui.bgColorDot.style.background = ui.bgColorPicker.value;
}

/* 行の配列・文字ごとのマスク(Map<char, Uint8Array(FONT_W*FONT_H)>)・FG・BG([r,g,b])・倍率を受け取り、
 * ImageData を返す。DOM は読まない。表示(scale=1)も PNG 書き出し(scale=2〜4)も同じ関数。 */
function renderAsciiImageData(lines, masks, fg, bg, scale) {
    const rows = lines.length;
    const cols = lines.reduce((m, l) => Math.max(m, [...l].length), 0);
    const w = cols * FONT_W * scale;
    const h = rows * FONT_H * scale;

    const toU32 = c => ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
    const fgU = toU32(fg);
    const bgU = toU32(bg);

    const img = new ImageData(w, h);
    const px = new Uint32Array(img.data.buffer);
    px.fill(bgU);

    for (let r = 0; r < rows; r++) {
        const chars = [...lines[r]];
        for (let c = 0; c < chars.length; c++) {
            const mask = masks.get(chars[c]);
            if (!mask) continue;
            const x0 = c * FONT_W * scale;
            const y0 = r * FONT_H * scale;
            for (let gy = 0; gy < FONT_H; gy++) {
                for (let gx = 0; gx < FONT_W; gx++) {
                    if (!mask[gy * FONT_W + gx]) continue;
                    for (let sy = 0; sy < scale; sy++) {
                        const o = (y0 + gy * scale + sy) * w + x0 + gx * scale;
                        for (let sx = 0; sx < scale; sx++) px[o + sx] = fgU;
                    }
                }
            }
        }
    }
    return img;
}

/* 変換前の空表示：BG の 320×80 の枠に FG で案内文 */
function renderEmptyView(cvs, fg, bg) {
    const ctx = cvs.getContext('2d');
    cvs.width = 320;
    cvs.height = 80;
    ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
    ctx.fillRect(0, 0, 320, 80);
    ctx.fillStyle = `rgb(${fg[0]},${fg[1]},${fg[2]})`;
    ctx.font = '11px monospace';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Please select an image.', 16, 44);
}

/* 成果物エリアの描き直し（変換結果・色が変わるたびに呼ぶ） */
function renderOutput() {
    const cvs = ui.outputCanvas;
    const fg = hexToRGB(ui.fgColorPicker.value);
    const bg = hexToRGB(ui.bgColorPicker.value);
    ui.outputBody.style.backgroundColor = ui.bgColorPicker.value;
    if (lastAsciiLines.length === 0 || charMasks.size === 0) {
        renderEmptyView(cvs, fg, bg);
        return;
    }
    const img = renderAsciiImageData(lastAsciiLines, charMasks, fg, bg, 1);
    cvs.width = img.width;
    cvs.height = img.height;
    cvs.getContext('2d').putImageData(img, 0, 0);
}

/* COPY TEXT / SAVE TXT 用の文字列（行を \n でつなぐ。末尾の改行は付けない） */
function buildAsciiText() {
    return lastAsciiLines.join('\n');
}

function asciiSize() {
    const rows = lastAsciiLines.length;
    const cols = lastAsciiLines.reduce((m, l) => Math.max(m, [...l].length), 0);
    return { cols, rows };
}

/* 左の PREVIEW を「実ピクセル ÷ n」（n は枠に収まる最小の整数）で表示する。
 * 実画素（devicePixelRatio 込み）で判定する。 */
function fitPreviewCanvas() {
    const cvs = ui.preview;
    const box = cvs.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const avail = box.clientWidth * dpr;
    if (!cvs.width || !avail) return;
    const n = Math.max(1, Math.ceil(cvs.width / avail));
    cvs.style.width = (cvs.width / n / dpr) + 'px';
    cvs.style.height = (cvs.height / n / dpr) + 'px';
}
