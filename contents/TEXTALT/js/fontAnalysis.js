/** ============================================================
 * AA Generator v6 — fontAnalysis.js
 * CHAR SET の文字だけをセルに描き、インク（表示用）と特徴量を作る
 * ============================================================ */

/* 文字ごとの解析結果。キー = フォント・MODE・SIZE・セル。キーが変わったら捨てる。
 *   rec = { dens: Float32Array(濃さ 0..1), ink: Uint8Array(0..255), gkey, vec } */
let _glyphCache = { key: '', recs: new Map() };
// 直近の解析で「実際に描いた文字数」と時間（確認用）
const analysisStats = { drawn: 0, ms: 0 };

function fontKey() {
    return `${font.family}|${font.mode}|${font.size}|${font.cellW}|${font.cellH}`;
}

function setAnalysisFont() {
    aCtx.font = `${font.size}px "${font.family}"`;
    aCtx.textBaseline = 'alphabetic';
}

/* CHAR SET の文字（コードポイント単位・重複なし・改行/タブ/制御文字は無視）。空なら ALL */
function getCurrentChars() {
    const filter = s => {
        const seen = new Set();
        const out = [];
        for (const ch of s) {
            if (/[\u0000-\u001f\u007f-\u009f]/.test(ch) || seen.has(ch)) continue;
            seen.add(ch);
            out.push(ch);
        }
        return out;
    };
    const chars = filter(ui.customCharsInput.value);
    return chars.length > 0 ? chars : filter(CHAR_SETS['ascii']);
}

/* 自動のセル：幅 = 送り幅（四捨五入）の最頻値（同数なら大きい方）、高さ = フォントの高さ（切り上げ） */
function measureAutoCell(chars) {
    setAnalysisFont();
    const counts = new Map();
    for (const ch of chars) {
        const w = Math.round(aCtx.measureText(ch).width);
        counts.set(w, (counts.get(w) || 0) + 1);
    }
    let w = 0, best = -1;
    for (const [k, n] of counts) {
        if (n > best || (n === best && k > w)) { w = k; best = n; }
    }
    const m = aCtx.measureText('M');
    const h = Math.ceil(m.fontBoundingBoxAscent + m.fontBoundingBoxDescent);
    return { w: Math.max(1, w), h: Math.max(1, h) };
}

/* 自動のセルを測り直して font.autoW/H に入れる。PIXEL のときはセルもそれにする（force で SMOOTH でも） */
let _autoKey = '';
function refreshAutoCell(chars, charsKey, force) {
    const key = `${font.family}|${font.size}|${charsKey}`;
    if (key !== _autoKey || force) {
        const a = measureAutoCell(chars);
        font.autoW = a.w;
        font.autoH = a.h;
        _autoKey = key;
    }
    if (font.mode === 'pixel' || force) {
        font.cellW = font.autoW;
        font.cellH = font.autoH;
    }
}

function ensureFontAnalyzed() {
    const chars = getCurrentChars();
    const charsKey = chars.join('');
    refreshAutoCell(chars, charsKey, false);

    const gridX = ui.gridX.value;
    const gridY = ui.gridY.value;
    const includeAvg = ui.includeAvg.checked;

    // パラメータ群から一意なキーを作成し、変更があった場合のみ解析を実行
    const key = `${fontKey()}|${charsKey}|${gridX}|${gridY}|${includeAvg}`;
    if (key !== lastAnalyzeKey) {
        analyzeFontShapes(chars);
        lastAnalyzeKey = key;
    }
}

/* 文字を白地に黒で描き、濃さ・インクを読む（足りない文字だけ） */
function drawGlyphs(chars) {
    const cw = font.cellW, ch = font.cellH;
    ui.analysis.width = cw;
    ui.analysis.height = ch;
    setAnalysisFont();
    const m = aCtx.measureText('M');
    const asc = Math.round(m.fontBoundingBoxAscent);
    const fh = Math.ceil(m.fontBoundingBoxAscent + m.fontBoundingBoxDescent);
    const top = Math.floor((ch - fh) / 2);
    const pixel = font.mode === 'pixel';

    for (const c of chars) {
        const adv = Math.round(aCtx.measureText(c).width);
        aCtx.fillStyle = '#FFFFFF';
        aCtx.fillRect(0, 0, cw, ch);
        aCtx.fillStyle = '#000000';
        aCtx.fillText(c, Math.floor((cw - adv) / 2), top + asc);

        const d = aCtx.getImageData(0, 0, cw, ch).data;
        const n = cw * ch;
        const dens = new Float32Array(n);
        const ink = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
            const gray = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
            dens[i] = (255 - gray) / 255;
            if (pixel) ink[i] = gray < 128 ? 255 : 0;
            else ink[i] = Math.min(255, Math.max(0, Math.round(255 - gray)));
        }
        _glyphCache.recs.set(c, { dens, ink, gkey: '', vec: null });
    }
}

function analyzeFontShapes(chars) {
    if (!isFontReady) return;
    const t0 = performance.now();

    const fk = fontKey();
    if (_glyphCache.key !== fk) _glyphCache = { key: fk, recs: new Map() };
    const recs = _glyphCache.recs;

    const missing = chars.filter(c => !recs.has(c));
    if (missing.length > 0) drawGlyphs(missing);

    const gridX = parseInt(ui.gridX.value);
    const gridY = parseInt(ui.gridY.value);
    const includeAvg = ui.includeAvg.checked;
    const gkey = `${gridX}|${gridY}|${includeAvg}`;

    charVectors = [];
    const masks = new Map();
    for (const c of chars) {
        const rec = recs.get(c);
        if (rec.gkey !== gkey) {
            rec.vec = calcFeaturesFromDensity(rec.dens, font.cellW, font.cellH, gridX, gridY, includeAvg);
            rec.gkey = gkey;
        }
        masks.set(c, rec.ink);
        charVectors.push({ char: c, vec: rec.vec });
    }
    charMasks = masks;

    flattenCharVectors();
    analysisStats.drawn = missing.length;
    analysisStats.ms = performance.now() - t0;
}

/* 探索の内側ループが連続メモリを読めるように詰め直す。順序は charVectors のまま
 * （同値時にどの文字が勝つかが変わらないよう、走査順を保つ必要がある）。 */
function flattenCharVectors() {
    const n = charVectors.length;
    charVecLen = n > 0 ? charVectors[0].vec.length : 0;
    charVecFlat = new Float64Array(n * charVecLen);
    charCharList = new Array(n);
    charIsSpace = new Uint8Array(n);

    for (let i = 0; i < n; i++) {
        const entry = charVectors[i];
        const base = i * charVecLen;
        for (let j = 0; j < charVecLen; j++) charVecFlat[base + j] = entry.vec[j];
        charCharList[i] = entry.char;
        charIsSpace[i] = entry.char === ' ' ? 1 : 0;
    }
}
