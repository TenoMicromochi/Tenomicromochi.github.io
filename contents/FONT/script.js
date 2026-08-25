/* ============================================================
   FONT DISTRIBUTION - coverage viewer

   各フォントの cmap を実行時に読み、収録文字を 256文字単位の
   「ページ」に区切って一覧表示する。
   事前生成JSONにしていないのは、フォントを更新したときに
   一覧だけ古いまま残る事故を避けるため。
   ============================================================ */

import { loadCoverage } from './cmapReader.js';

/* ── 表示サイズ（すべて整数px。ドット絵の等倍拘束の基準になる） ──
   タイルの寸法は固定せず、右カラムの実幅から毎回計算する。
   固定にすると全角仮名のページ（送り幅16px）が常に2倍止まりになり、
   広い画面の余地を使えないため。 */
const ROWHEAD_W = 36;   // 行ヘッダ（002x など）の幅
const CELL_PAD_X = 6;   // タイル内のグリフ左右余白
const CELL_PAD_Y = 8;   // 同・上下余白
const MAX_GLYPH_H = 64; // 高さ方向に許すグリフの最大px（縦に伸びすぎるのを防ぐ）
const MIN_GLYPH_H = 16; // 読める下限。これを割るくらいなら枠内を横スクロールさせる
const MIN_CELL_W = 22;  // クリックできる最小幅

const BIG_BOX = 240;    // 中央の大プレビュー
const STRIP_BOX = 52;   // 書体横断ストリップの1枠

/* 未収録文字を表示するための汎用フォント（ドット絵ではないもの） */
const FALLBACK_STACK = '"Yu Gothic", "Hiragino Sans", Meiryo, system-ui, sans-serif';

const state = {
    fonts: [],          // fonts.json
    blocks: [],         // unicodeBlocks.json
    cov: new Map(),     // family -> Set<codepoint>
    font: null,         // 選択中の書体エントリ
    page: 0,            // 選択中ページの先頭コードポイント
    cp: 0x41,           // 選択中のコードポイント
    mode: 'page'        // 'page' | 'compare'
};

const el = {};

/* ============================================================
   文字幅の実測

   フォントごとの「1デザインピクセル = 1CSSピクセル」となるサイズ
   （font.emPx）で measureText して、送り幅をデザインピクセル数として得る。
   これを整数倍すれば、どの倍率でも必ず整数pxに収まる。
   ============================================================ */
const measureCtx = document.createElement('canvas').getContext('2d');

function advanceOf(family, sizePx, ch) {
    measureCtx.font = `${sizePx}px "${family}"`;
    return measureCtx.measureText(ch).width;
}

/* 汎用フォントで .notdef（豆腐）になる文字を判定するための基準幅 */
let tofuWidth = null;
function fallbackCanRender(ch) {
    measureCtx.font = `32px ${FALLBACK_STACK}`;
    if (tofuWidth === null) tofuWidth = measureCtx.measureText('￿').width;
    const w = measureCtx.measureText(ch).width;
    return w > 0 && Math.abs(w - tofuWidth) > 0.01;
}

/* 字形そのものが存在しないコードポイント（制御文字・サロゲート・非文字） */
function isVoidCodepoint(cp) {
    if (cp < 0x20) return true;                       // C0
    if (cp >= 0x7F && cp <= 0x9F) return true;        // DEL / C1
    if (cp >= 0xD800 && cp <= 0xDFFF) return true;    // サロゲート
    if ((cp & 0xFFFE) === 0xFFFE) return true;        // 非文字
    if (cp >= 0xFDD0 && cp <= 0xFDEF) return true;    // 非文字
    return false;
}

/* ============================================================
   ページ / ブロック
   ============================================================ */
function pagesOf(cps) {
    const counts = new Map();
    for (const cp of cps) {
        const base = cp & ~0xFF;
        counts.set(base, (counts.get(base) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0] - b[0]);
}

function pageHex(base) {
    return (base >> 8).toString(16).toUpperCase().padStart(2, '0') + 'xx';
}

function codeHex(cp) {
    return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
}

/** ページ内で実際に収録がある Unicode ブロック名だけを連結する */
function blockLabel(base, cps) {
    const names = [];
    for (const [start, end, name] of state.blocks) {
        if (end < base || start > base + 0xFF) continue;
        const from = Math.max(start, base);
        const to = Math.min(end, base + 0xFF);
        for (let cp = from; cp <= to; cp++) {
            if (cps.has(cp)) { names.push(name); break; }
        }
    }
    return names.length ? names.join(' + ') : 'Unassigned';
}

/* ============================================================
   等倍スケールの決定

   枠に収まる最大の整数倍を選ぶ。pixelGrid:false の書体（Magic）は
   ドットグリッドに乗っていないので等倍拘束の対象外にする。
   ============================================================ */
function pixelScale(font, boxW, boxH, maxAdvance) {
    if (!font.pixelGrid) return 1;
    const byWidth = Math.floor(boxW / Math.max(1, Math.ceil(maxAdvance)));
    const byHeight = Math.floor(boxH / font.emPx);
    return Math.max(1, Math.min(byWidth, byHeight));
}

/* ============================================================
   起動
   ============================================================ */
init();

async function init() {
    cacheElements();

    const [fonts, blocks] = await Promise.all([
        fetch('./fonts.json').then(r => r.json()),
        fetch('./unicodeBlocks.json').then(r => r.json())
    ]);
    state.fonts = fonts;
    state.blocks = blocks;

    el.chartStatus.textContent = 'READING FONT TABLES...';

    // 全書体を並列で解析する。ACROSS FONTS と COMPARE が
    // 常に全書体の情報を必要とするため、起動時にまとめて読む。
    await Promise.all(state.fonts.map(async font => {
        try {
            const [info] = await Promise.all([
                loadCoverage(font.file),
                document.fonts.load(`${font.emPx}px "${font.family}"`)
            ]);
            // 制御文字などは cmap に載っていても字形を持たない。
            // フォント作成ツールが自動で付けた残骸なので収録数から外す
            // （収録数を「実際に使える文字数」として読めるようにするため）。
            const printable = new Set();
            for (const cp of info.codepoints) {
                if (!isVoidCodepoint(cp)) printable.add(cp);
            }
            state.cov.set(font.family, printable);
        } catch (err) {
            console.error(`[FONT] ${font.family}:`, err);
            state.cov.set(font.family, new Set());
        }
    }));

    buildFontSelector();
    bindEvents();

    selectFont(state.fonts[0]);
}

function cacheElements() {
    el.fontSelector = document.getElementById('font-selector');
    el.fontMeta = document.getElementById('font-meta');
    el.downloadBtn = document.getElementById('download-button');
    el.glyphStage = document.getElementById('glyph-stage');
    el.glyphBig = document.getElementById('glyph-big');
    el.glyphCode = document.getElementById('glyph-code');
    el.fontStrip = document.getElementById('font-strip');
    el.input = document.getElementById('preview-input');
    el.inputPreview = document.getElementById('input-preview');
    el.missingReport = document.getElementById('missing-report');
    el.pageSelector = document.getElementById('page-selector');
    el.chartScroll = document.getElementById('chart-scroll');
    el.charGrid = document.getElementById('char-grid');
    el.compareView = document.getElementById('compare-view');
    el.chartStatus = document.getElementById('chart-status');
    el.modeButtons = [...document.querySelectorAll('.mode-toggle button')];
}

function buildFontSelector() {
    el.fontSelector.innerHTML = '';
    for (const font of state.fonts) {
        const opt = document.createElement('option');
        opt.value = font.family;
        opt.textContent = font.note ? `${font.label} (${font.note})` : font.label;
        el.fontSelector.appendChild(opt);
    }
}

function bindEvents() {
    el.fontSelector.addEventListener('change', () => {
        const font = state.fonts.find(f => f.family === el.fontSelector.value);
        if (font) selectFont(font);
    });

    el.pageSelector.addEventListener('change', () => {
        state.page = Number(el.pageSelector.value);
        renderGrid();
    });

    el.downloadBtn.addEventListener('click', () => {
        if (state.font?.download) window.open(state.font.download, '_blank');
    });

    el.input.addEventListener('input', renderInputPreview);

    for (const btn of el.modeButtons) {
        btn.addEventListener('click', () => setMode(btn.dataset.mode));
    }

    el.charGrid.addEventListener('keydown', onGridKeydown);

    // 幅が変われば入る倍率も変わるので組み直す
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (state.mode === 'page' && state.font) renderGrid();
        }, 150);
    });
}

/* ============================================================
   書体の切り替え
   ============================================================ */
function selectFont(font) {
    state.font = font;
    el.fontSelector.value = font.family;

    const cps = state.cov.get(font.family);
    const pages = pagesOf(cps);

    // ページ選択は書体をまたいでも維持する（同じ範囲を見比べたいため）
    if (!pages.some(([base]) => base === state.page)) {
        state.page = pages.length ? pages[0][0] : 0;
    }
    // 選択中の文字が新しい書体に無い場合も、コードポイント自体は保持する
    // （未収録であることを見せたいので勝手に動かさない）

    renderFontMeta();
    renderPageSelector();
    renderGrid();
    renderBigGlyph();
    renderInputPreview();
    if (state.mode === 'compare') renderCompare();
}

function renderFontMeta() {
    const font = state.font;
    const cps = state.cov.get(font.family);
    const pages = pagesOf(cps);
    el.fontMeta.innerHTML = `
        <div><span class="k">GLYPHS</span><span class="v">${cps.size}</span></div>
        <div><span class="k">PAGES</span><span class="v">${pages.length}</span></div>
        <div><span class="k">GRID</span><span class="v">${font.pixelGrid ? font.emPx + 'px em' : 'non-grid'}</span></div>
    `;
}

function renderPageSelector() {
    const cps = state.cov.get(state.font.family);
    const pages = pagesOf(cps);

    el.pageSelector.innerHTML = '';
    for (const [base, count] of pages) {
        const opt = document.createElement('option');
        opt.value = String(base);
        opt.textContent = `${pageHex(base)}  ${blockLabel(base, cps)}  (${count}/256)`;
        el.pageSelector.appendChild(opt);
    }
    el.pageSelector.value = String(state.page);

    const total = cps.size;
    el.chartStatus.textContent =
        `${state.font.label} — ${total} glyphs across ${pages.length} page${pages.length === 1 ? '' : 's'}`;
}

/* ============================================================
   16x16 文字タイル
   ============================================================ */
function renderGrid() {
    const font = state.font;
    const cps = state.cov.get(font.family);
    const base = state.page;

    // このページの収録文字の送り幅を実測し、共通の整数倍率を決める
    let maxAdvance = 1;
    const advances = new Map();
    for (let i = 0; i < 256; i++) {
        const cp = base + i;
        if (!cps.has(cp)) continue;
        const adv = advanceOf(font.family, font.emPx, String.fromCodePoint(cp));
        advances.set(cp, adv);
        if (adv > maxAdvance) maxAdvance = adv;
    }

    // 右カラムの実幅に収まる範囲で最大の整数倍率を採る
    const available = el.chartScroll.clientWidth - 12;   // .chart-scroll の padding 分
    const perColumn = Math.floor((available - ROWHEAD_W) / 16);

    // 幅に収まる倍率を基本にしつつ、読める下限は割らない。
    // 下限のほうが勝った場合はタイルが幅からはみ出すので、枠内を横スクロールさせる。
    const byWidth = Math.floor((perColumn - CELL_PAD_X) / Math.ceil(maxAdvance));
    const byHeight = Math.max(1, Math.floor(MAX_GLYPH_H / font.emPx));
    const minScale = Math.ceil(MIN_GLYPH_H / font.emPx);
    const scale = font.pixelGrid
        ? Math.max(1, Math.min(Math.max(byWidth, minScale), byHeight))
        : 1;

    const fontSize = font.pixelGrid ? font.emPx * scale : font.emPx;
    const cellW = font.pixelGrid
        ? Math.max(MIN_CELL_W, Math.ceil(maxAdvance) * scale + CELL_PAD_X)
        : Math.max(MIN_CELL_W, Math.min(perColumn, fontSize * 2));
    const cellH = font.pixelGrid ? fontSize + CELL_PAD_Y : fontSize * 2;
    const lineHeight = font.pixelGrid ? fontSize : cellH;
    const padTop = font.pixelGrid ? Math.floor((cellH - lineHeight) / 2) : 0;

    state.cell = { w: cellW, h: cellH };

    el.charGrid.style.setProperty('--cell-w', `${cellW}px`);
    el.charGrid.style.setProperty('--cell-h', `${cellH}px`);
    el.charGrid.style.setProperty('--missing-size', `${Math.min(24, Math.max(11, Math.floor(cellH * 0.45)))}px`);

    const frag = document.createDocumentFragment();

    // 列ヘッダ
    frag.appendChild(makeCell('grid-corner', ''));
    for (let col = 0; col < 16; col++) {
        frag.appendChild(makeCell('grid-colhead', col.toString(16).toUpperCase()));
    }

    for (let row = 0; row < 16; row++) {
        const rowBase = base + row * 16;
        frag.appendChild(makeCell(
            'grid-rowhead',
            (rowBase >> 4).toString(16).toUpperCase().padStart(3, '0') + 'x'
        ));

        for (let col = 0; col < 16; col++) {
            const cp = rowBase + col;
            frag.appendChild(makeTile(cp, cps, font, fontSize, lineHeight, padTop, scale, advances, cellW));
        }
    }

    el.charGrid.style.gridTemplateColumns = `${ROWHEAD_W}px repeat(16, ${cellW}px)`;
    el.charGrid.replaceChildren(frag);
    el.charGrid.tabIndex = 0;
}

function makeCell(className, text) {
    const div = document.createElement('div');
    div.className = className;
    div.textContent = text;
    return div;
}

function makeTile(cp, cps, font, fontSize, lineHeight, padTop, scale, advances, cellW) {
    const tile = document.createElement('div');
    tile.dataset.cp = String(cp);
    tile.title = codeHex(cp);

    const covered = cps.has(cp);
    const ch = String.fromCodePoint(cp);

    if (covered) {
        tile.className = 'tile covered';
        tile.textContent = ch;
        tile.style.fontFamily = `"${font.family}"`;
        tile.style.fontSize = `${fontSize}px`;
        tile.style.lineHeight = `${lineHeight}px`;
        tile.style.paddingTop = `${padTop}px`;
        if (font.pixelGrid) {
            // 横方向も整数pxに載せる（.5px ずれると縦エッジが滲む）
            const width = Math.round((advances.get(cp) || 0) * scale);
            tile.style.paddingLeft = `${Math.max(0, Math.floor((cellW - width) / 2))}px`;
        } else {
            tile.style.textAlign = 'center';   // 非グリッド書体は等倍拘束がないので中央寄せ
        }
    } else if (isVoidCodepoint(cp) || !fallbackCanRender(ch)) {
        tile.className = 'tile void';
    } else {
        // 未収録だが字形は存在する文字。汎用フォントで薄く出す
        tile.className = 'tile missing';
        tile.textContent = ch;
    }

    if (cp === state.cp) tile.classList.add('sel');
    tile.addEventListener('click', () => selectCodepoint(cp));
    return tile;
}

function onGridKeydown(ev) {
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -16, ArrowDown: 16 };
    const delta = moves[ev.key];
    if (delta === undefined) return;
    ev.preventDefault();

    const next = state.cp + delta;
    if (next < state.page || next > state.page + 0xFF) return; // ページ内に留める
    selectCodepoint(next);
}

function selectCodepoint(cp) {
    const prev = el.charGrid.querySelector('.tile.sel');
    if (prev) prev.classList.remove('sel');

    state.cp = cp;

    const next = el.charGrid.querySelector(`.tile[data-cp="${cp}"]`);
    if (next) next.classList.add('sel');

    renderBigGlyph();
}

/* ============================================================
   中央上: 大プレビュー / 書体横断ストリップ
   ============================================================ */
function renderBigGlyph() {
    const font = state.font;
    const cp = state.cp;
    const ch = String.fromCodePoint(cp);
    const covered = state.cov.get(font.family).has(cp);

    const box = el.glyphBig;
    box.className = '';
    box.removeAttribute('style');

    if (covered) {
        const adv = advanceOf(font.family, font.emPx, ch);
        const scale = pixelScale(font, BIG_BOX, BIG_BOX, adv);
        const fontSize = font.pixelGrid ? font.emPx * scale : Math.floor(BIG_BOX * 0.6);
        box.textContent = ch;
        box.style.fontFamily = `"${font.family}"`;
        box.style.fontSize = `${fontSize}px`;
        if (font.pixelGrid) {
            box.style.lineHeight = `${fontSize}px`;
            box.style.paddingTop = `${Math.floor((BIG_BOX - fontSize) / 2)}px`;
            box.style.paddingLeft =
                `${Math.max(0, Math.floor((BIG_BOX - Math.round(adv * scale)) / 2))}px`;
        } else {
            box.style.lineHeight = `${BIG_BOX}px`;
            box.style.width = `${BIG_BOX}px`;
            box.style.textAlign = 'center';
        }
    } else if (isVoidCodepoint(cp) || !fallbackCanRender(ch)) {
        box.className = 'void';
        box.textContent = '';
    } else {
        box.className = 'missing';
        box.textContent = ch;
    }

    el.glyphCode.innerHTML = covered
        ? `${codeHex(cp)} <em>:</em> <span class="ok">${escapeHtml(ch)}</span>`
        : `${codeHex(cp)} <em>:</em> <span class="ng">NOT IN THIS FONT</span>`;

    renderFontStrip();
}

/** 選択中の1文字を全書体で並べる。持っていない書体はグレーアウト */
function renderFontStrip() {
    const cp = state.cp;
    const ch = String.fromCodePoint(cp);
    const frag = document.createDocumentFragment();

    for (const font of state.fonts) {
        const covered = state.cov.get(font.family).has(cp);

        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'strip-item' + (covered ? '' : ' off')
            + (font.family === state.font.family ? ' current' : '');
        item.title = `${font.label}${covered ? '' : ' — not covered'}`;

        const cell = document.createElement('span');
        cell.className = 'strip-glyph';
        if (covered) {
            const adv = advanceOf(font.family, font.emPx, ch);
            const scale = pixelScale(font, STRIP_BOX, STRIP_BOX, adv);
            const fontSize = font.pixelGrid ? font.emPx * scale : font.emPx;
            cell.textContent = ch;
            cell.style.fontFamily = `"${font.family}"`;
            cell.style.fontSize = `${fontSize}px`;
            cell.style.lineHeight = `${font.pixelGrid ? fontSize : STRIP_BOX}px`;
            if (font.pixelGrid) {
                cell.style.paddingTop = `${Math.floor((STRIP_BOX - fontSize) / 2)}px`;
                cell.style.paddingLeft =
                    `${Math.max(0, Math.floor((STRIP_BOX - Math.round(adv * scale)) / 2))}px`;
            }
        }

        const tag = document.createElement('span');
        tag.className = 'strip-label';
        tag.textContent = font.label.replace(/^Teno(Text|Glyph)\s*/, '');

        item.append(cell, tag);
        item.addEventListener('click', () => selectFont(font));
        frag.appendChild(item);
    }

    el.fontStrip.replaceChildren(frag);
}

/* ============================================================
   中央下: 入力テキストと未収録文字の報告
   ============================================================ */
function renderInputPreview() {
    const font = state.font;
    const cps = state.cov.get(font.family);
    const text = el.input.value;

    if (!text) {
        el.inputPreview.replaceChildren();
        el.inputPreview.textContent = '';
        el.missingReport.textContent = '';
        return;
    }

    const frag = document.createDocumentFragment();
    const missing = new Map();   // 文字 -> コードポイント

    for (const ch of text) {          // サロゲートペアを正しく1文字として扱う
        const cp = ch.codePointAt(0);
        const span = document.createElement('span');
        span.textContent = ch;
        if (cps.has(cp)) {
            span.className = 'in-ok';
            span.style.fontFamily = `"${font.family}"`;
        } else {
            span.className = 'in-ng';
            span.title = `${codeHex(cp)} not covered`;
            if (!/\s/.test(ch)) missing.set(ch, cp);
        }
        frag.appendChild(span);
    }

    el.inputPreview.replaceChildren(frag);
    el.inputPreview.style.fontSize = `${Math.max(16, font.pixelGrid ? font.emPx * 2 : 20)}px`;

    if (missing.size === 0) {
        el.missingReport.innerHTML = `<span class="all-ok">ALL COVERED</span>`;
    } else {
        const list = [...missing.entries()]
            .map(([ch, cp]) => `<span class="miss-chip" title="${codeHex(cp)}">${escapeHtml(ch)}</span>`)
            .join('');
        el.missingReport.innerHTML =
            `<span class="miss-head">MISSING ${missing.size}</span>${list}`;
    }
}

/* ============================================================
   COMPARE: 書体 x ページ のマトリクス
   ============================================================ */
function setMode(mode) {
    state.mode = mode;
    for (const btn of el.modeButtons) {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    }
    const isPage = mode === 'page';
    el.charGrid.hidden = !isPage;
    el.compareView.hidden = isPage;
    el.pageSelector.disabled = !isPage;
    if (!isPage) renderCompare();
}

function renderCompare() {
    // 全書体のページの和集合を列にする
    const allPages = new Set();
    for (const font of state.fonts) {
        for (const [base] of pagesOf(state.cov.get(font.family))) allPages.add(base);
    }
    const columns = [...allPages].sort((a, b) => a - b);

    const table = document.createElement('table');
    table.className = 'compare-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.appendChild(makeEl('th', 'FONT', 'c-fontname'));
    for (const base of columns) {
        const th = makeEl('th', pageHex(base));
        th.title = blockLabel(base, unionCoverage());
        headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const font of state.fonts) {
        const cps = state.cov.get(font.family);
        const tr = document.createElement('tr');
        if (font.family === state.font.family) tr.className = 'current';

        const name = makeEl('th', font.label, 'c-fontname');
        name.addEventListener('click', () => selectFont(font));
        tr.appendChild(name);

        for (const base of columns) {
            let count = 0;
            for (let i = 0; i < 256; i++) if (cps.has(base + i)) count++;

            const td = document.createElement('td');
            if (count === 0) {
                td.className = 'c-empty';
            } else {
                td.className = 'c-has';
                td.textContent = String(count);
                // 収録率をそのまま濃さにする
                td.style.background =
                    `color-mix(in srgb, var(--accent) ${Math.round(12 + (count / 256) * 78)}%, transparent)`;
                td.title = `${font.label} / ${pageHex(base)} — ${count}/256`;
                td.addEventListener('click', () => {
                    state.page = base;
                    setMode('page');
                    selectFont(font);
                });
            }
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    el.compareView.replaceChildren(table);
}

/** COMPARE のヘッダ用: 全書体の収録を合わせた集合 */
let _union = null;
function unionCoverage() {
    if (_union) return _union;
    _union = new Set();
    for (const set of state.cov.values()) for (const cp of set) _union.add(cp);
    return _union;
}

/* ── 小物 ── */
function makeEl(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
}

function escapeHtml(str) {
    return str.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
