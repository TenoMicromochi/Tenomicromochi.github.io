/** ============================================================
 * AA Generator v6 — fontLoader.js
 * フォントの読み込み（FontFace・専用の家族名）と FONT の項目の操作
 * ============================================================ */

/* プリセットは SODENMIR の FONT ページの一覧（/contents/FONT/fonts.json）から TenoText だけを使う。
 * SIZE は一覧の emPx（そのフォントの等倍）。読めなければ index.html に書いた TenoText 8x11 だけになる */
const FONT_LIST_URL = '/contents/FONT/fonts.json';
const FILE_OPTION = '__file__';
const PIXEL_PROBE_TEXT = 'AMgW#@08';
/* 「中間の灰色」の範囲。作業票は 16〜239 だが、この環境の Chrome（Windows）はドット絵フォントの
 * 縁にも 30 や 230 前後の灰色を出す（文字の濃さ補正）ため、16〜239 だと正しい SIZE でも 20% 以上が中間になる。
 * 本当の中間（半分かかった画素）だけを数えるよう 64〜191 にしてある。 */
const PIXEL_MID_LO = 64, PIXEL_MID_HI = 191;

let _fontSeq = 0;

/* FontFace で読み、TEXTALT 専用の家族名を付けて登録する（読むたびに新しい名前） */
async function loadFontFace(buffer) {
    const family = `TextaltFont${_fontSeq++}`;
    const face = new FontFace(family, buffer);
    await face.load();
    document.fonts.add(face);
    return { family, face };
}

/* ドット絵フォントの SIZE を推す：SIZE 4〜64 を小さい順に試し、AMgW#@08 を描いて
 * インクのある画素のうち中間の灰色(PIXEL_MID_LO〜HI)が 1% 未満になる最初の SIZE。見つからなければ null */
function inferPixelSize(family) {
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    for (let size = 4; size <= 64; size++) {
        const f = `${size}px "${family}"`;
        ctx.font = f;
        const m = ctx.measureText(PIXEL_PROBE_TEXT);
        const w = Math.ceil(m.width) + 4;
        const asc = Math.round(m.fontBoundingBoxAscent);
        const h = Math.ceil(m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) + 4;
        cv.width = w;
        cv.height = h;
        ctx.font = f;
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#000000';
        ctx.fillText(PIXEL_PROBE_TEXT, 2, 2 + asc);
        const d = ctx.getImageData(0, 0, w, h).data;
        let ink = 0, mid = 0;
        for (let i = 0; i < d.length; i += 4) {
            const g = d[i];
            if (g < 255) {
                ink++;
                if (g >= PIXEL_MID_LO && g <= PIXEL_MID_HI) mid++;
            }
        }
        if (ink > 0 && mid / ink < 0.01) return size;
    }
    return null;
}

/* 読み込めたフォントを今のフォントにする */
function applyFont(loaded, name, mode, size) {
    if (font.face) document.fonts.delete(font.face);
    font.family = loaded.family;
    font.face = loaded.face;
    font.name = name;
    font.mode = mode;
    font.size = size;

    const chars = getCurrentChars();
    refreshAutoCell(chars, chars.join(''), true);
    isFontReady = true;

    if (ui.customCharsInput.value === '') {
        ui.customCharsInput.value = CHAR_SETS['ascii'];
        updateCharCount();
    }
    syncFontUI();

    if (sourceImage) {
        processImage();
        return;
    }
    ensureFontAnalyzed();
    ui.status.className = 'status-bar success';
    ui.status.textContent = '✅Ready: Please select an image.';
}

function fontLoadFailed(err) {
    ui.status.className = 'status-bar error';
    ui.status.textContent = '⚠Font load failed: ' + (err && err.message ? err.message : err);
}

/* プリセットの一覧を作る（TenoText のみ。今選ばれているものは残す） */
async function fillFontPresets() {
    const sel = ui.fontPresetSelect;
    try {
        const res = await fetch(FONT_LIST_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const list = (await res.json()).filter(f => /^TenoText/.test(f.label));
        if (list.length === 0) return;
        const keep = sel.value;
        sel.textContent = '';
        for (const f of list) {
            const o = document.createElement('option');
            o.value = f.file;
            o.textContent = f.label;
            o.dataset.size = f.emPx;
            o.dataset.mode = f.pixelGrid ? 'pixel' : 'smooth';
            sel.appendChild(o);
        }
        sel.value = keep;
        if (sel.selectedIndex < 0) sel.selectedIndex = 0;
    } catch (err) {
        // 一覧が読めなくても、index.html の TenoText 8x11 で動く
    }
}

/* プリセットの選択中のフォントを読む */
async function loadPresetFont() {
    const o = ui.fontPresetSelect.selectedOptions[0];
    if (!o || o.value === FILE_OPTION) return;
    try {
        const res = await fetch(o.value);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const loaded = await loadFontFace(await res.arrayBuffer());
        applyFont(loaded, o.textContent, o.dataset.mode, parseInt(o.dataset.size));
        dropFileOption();
    } catch (err) {
        fontLoadFailed(err);
    }
}

/* ファイルを読んだときだけ、プリセットに「— FILE —」を出して選んだ状態にする */
function showFileOption() {
    const sel = ui.fontPresetSelect;
    let o = sel.querySelector(`option[value="${FILE_OPTION}"]`);
    if (!o) {
        o = document.createElement('option');
        o.value = FILE_OPTION;
        o.textContent = '— FILE —';
        sel.appendChild(o);
    }
    sel.value = FILE_OPTION;
}
function dropFileOption() {
    const o = ui.fontPresetSelect.querySelector(`option[value="${FILE_OPTION}"]`);
    if (o) o.remove();
}

async function loadFontFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const loaded = await loadFontFace(await file.arrayBuffer());
        const px = inferPixelSize(loaded.family);
        applyFont(loaded, file.name, px ? 'pixel' : 'smooth', px || 16);
        showFileOption();
    } catch (err) {
        fontLoadFailed(err);
    }
    e.target.value = '';
}

/* 起動時：一覧を作ってから、選択中のプリセット（TenoText 8x11）を読む */
async function loadDefaultFont() {
    await fillFontPresets();
    await loadPresetFont();
}

/* ---- FONT の項目 ---- */
function clampInt(v, lo, hi) { return Math.min(hi, Math.max(lo, Math.round(v))); }

function syncFontUI() {
    ui.fontNameLabel.textContent = font.name;
    ui.modePixelBtn.classList.toggle('active', font.mode === 'pixel');
    ui.modeSmoothBtn.classList.toggle('active', font.mode === 'smooth');
    ui.valSize.textContent = font.size;
    ui.valCellW.textContent = font.cellW;
    ui.valCellH.textContent = font.cellH;
    ui.cellAutoText.textContent = `${font.cellW} × ${font.cellH} (auto)`;
    ui.cellPixelRow.hidden = font.mode !== 'pixel';
    ui.cellSmoothRow.hidden = font.mode !== 'smooth';
    // CHAR SET のテキスト欄も今のフォントで表示する
    const ta = ui.customCharsInput;
    ta.style.fontFamily = `"${font.family}", monospace`;
    ta.style.fontSize = font.size + 'px';
    ta.style.lineHeight = font.cellH + 'px';
}

function resetAutoCell() {
    const chars = getCurrentChars();
    refreshAutoCell(chars, chars.join(''), true);
}

function initFontUI() {
    ui.fontFileInput.addEventListener('change', loadFontFile);
    ui.fontPresetSelect.addEventListener('change', loadPresetFont);

    ui.modePixelBtn.addEventListener('click', () => {
        if (!isFontReady) return;
        font.mode = 'pixel';
        resetAutoCell();
        syncFontUI();
        scheduleProcess();
    });
    ui.modeSmoothBtn.addEventListener('click', () => {
        if (!isFontReady) return;
        font.mode = 'smooth';
        syncFontUI();
        scheduleProcess();
    });
    ui.cellAutoBtn.addEventListener('click', () => {
        if (!isFontReady) return;
        resetAutoCell();
        syncFontUI();
        scheduleProcess();
    });

    document.querySelectorAll('.spin-btn[data-font]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!isFontReady) return;
            const dir = parseInt(btn.dataset.dir);
            const key = btn.dataset.font;
            if (key === 'size') {
                font.size = clampInt(font.size + dir, 4, 128);
                resetAutoCell();            // SIZE を変えたらセルも自動の値に戻す
            } else if (key === 'cellW') {
                font.cellW = clampInt(font.cellW + dir, 1, 128);
            } else if (key === 'cellH') {
                font.cellH = clampInt(font.cellH + dir, 1, 128);
            }
            syncFontUI();
            scheduleProcess();
        });
    });
}
