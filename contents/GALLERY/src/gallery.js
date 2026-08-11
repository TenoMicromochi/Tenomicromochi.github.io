// PIXEL ART GALLERY - sidebar & grid
// 左サイドバー（カテゴリ一覧）と右メイン（作品グリッド）の構築・フィルタリングを担当。
const grid = document.getElementById('galleryGrid');
const categoryList = document.getElementById('categoryList');
const currentCategoryLabel = document.getElementById('currentCategoryLabel');
const sizeGroup = document.getElementById('sizeGroup');

let activeCategory = 'all';
// S/M/Lで選ばれたサムネイル枠の高さ。カテゴリ切替で作り直しても維持する。
let thumbHeight = 112;

// カード内で画像に使える最大幅。
// グリッド幅からカードの padding/border と枠線分を引いた値で、
// .thumb-frame の max-width:320px（border-box）を上限にする。
function thumbBoxWidth() {
    return Math.min(318, Math.max(48, grid.clientWidth - 24));
}

// サムネイル1枚を「1ドット=実機の整数ピクセル」なサイズに合わせる。
// CSSのmax-width/max-heightに任せると端数倍率になり補間で滲むため、
// 明示的にwidth/heightを指定する。
function applyThumbSize(img) {
    if (!img.naturalWidth) return;
    const frame = img.closest('.thumb-frame');
    // --thumb-h は枠の外寸(border-box)。枠線2px分を除いた内容領域に収めないと
    // CSSの max-height:100% に切り詰められて端数倍率に戻ってしまう。
    const boxH = (frame && frame.clientHeight) || (thumbHeight - 2);
    const { cssW, cssH } = integerDeviceScale(
        img.naturalWidth, img.naturalHeight, thumbBoxWidth(), boxH
    );
    img.style.width = cssW + 'px';
    img.style.height = cssH + 'px';
}

function applyAllThumbSizes() {
    grid.querySelectorAll('.thumb-frame img').forEach(applyThumbSize);
}

function buildSidebar() {
    categoryList.innerHTML = '';

    const counts = { all: ITEMS.length };
    CATEGORIES.forEach(c => { counts[c.key] = ITEMS.filter(i => i.category === c.key).length; });

    const entries = [{ key: 'all', ja: 'すべて', en: 'All' }, ...CATEGORIES];

    entries.forEach(c => {
        const row = document.createElement('div');
        row.className = 'category-item' + (c.key === activeCategory ? ' active' : '');

        const icon = document.createElement('img');
        icon.className = 'category-icon';
        icon.src = FOLDER_ICON;
        icon.alt = '';

        const labels = document.createElement('div');
        labels.className = 'category-labels';
        const ja = document.createElement('span');
        ja.className = 'category-ja';
        ja.textContent = c.ja;
        const en = document.createElement('span');
        en.className = 'category-en';
        en.textContent = c.en;
        labels.appendChild(ja);
        labels.appendChild(en);

        const count = document.createElement('span');
        count.className = 'category-count';
        count.textContent = counts[c.key];

        row.appendChild(icon);
        row.appendChild(labels);
        row.appendChild(count);

        row.addEventListener('click', () => {
            activeCategory = c.key;
            buildSidebar();
            renderGrid();
            const lbl = categoryLabel(activeCategory);
            currentCategoryLabel.textContent = lbl.en + ' / ' + lbl.ja;
        });

        categoryList.appendChild(row);
    });
}

function buildCard(item) {
    const card = document.createElement('div');
    card.className = 'gallery-card';

    const frame = document.createElement('div');
    frame.className = 'thumb-frame';
    frame.style.setProperty('--thumb-h', thumbHeight + 'px');

    const displayTitle = item.titleJa || titleFromFile(item.file);

    const img = document.createElement('img');
    img.src = encodePath(item.file);
    img.alt = displayTitle;
    img.loading = 'lazy';
    frame.appendChild(img);

    const titles = document.createElement('div');
    titles.className = 'card-titles';
    const titleJa = document.createElement('div');
    titleJa.className = 'card-title-ja';
    titleJa.textContent = displayTitle;
    titles.appendChild(titleJa);
    if (item.titleEn) {
        const titleEn = document.createElement('div');
        titleEn.className = 'card-title-en';
        titleEn.textContent = item.titleEn;
        titles.appendChild(titleEn);
    }

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const ext = extOf(item.file);
    const badge = document.createElement('img');
    badge.className = 'ext-badge';
    badge.src = EXT_BADGE[ext];
    badge.alt = ext;
    const dims = document.createElement('span');
    dims.className = 'dims';
    meta.appendChild(badge);
    meta.appendChild(dims);

    img.addEventListener('load', () => {
        dims.textContent = img.naturalWidth + '×' + img.naturalHeight;
        applyThumbSize(img);
    });

    card.appendChild(frame);
    card.appendChild(titles);
    card.appendChild(meta);

    card.addEventListener('click', () => openModal(item));

    return card;
}

function renderGrid() {
    grid.innerHTML = '';
    const items = activeCategory === 'all' ? ITEMS : ITEMS.filter(i => i.category === activeCategory);
    items.forEach(item => grid.appendChild(buildCard(item)));
}

// button_size_s/m/l_ON/OFF.png を差し替えてサムネイル行の高さ(S/M/L)を切り替える。
function setActiveSizeButton(sizePx) {
    sizeGroup.querySelectorAll('.size-btn').forEach(btn => {
        const img = btn.querySelector('img');
        img.src = buttonAssetSrc(img.dataset.asset, Number(btn.dataset.size) === sizePx);
    });
}

sizeGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.size-btn');
    if (!btn) return;
    thumbHeight = Number(btn.dataset.size);
    setActiveSizeButton(thumbHeight);
    grid.querySelectorAll('.thumb-frame').forEach(f => {
        f.style.setProperty('--thumb-h', thumbHeight + 'px');
    });
    applyAllThumbSizes();
});

// 画面回転や幅変更で使える枠サイズが変わると整数倍率もずれるため、
// レイアウト確定後に計算し直す。
let resizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyAllThumbSizes, 150);
});

setActiveSizeButton(thumbHeight);

loadWorks()
    .then(() => {
        buildSidebar();
        renderGrid();
    })
    .catch(err => {
        grid.textContent = 'works.json の読み込みに失敗しました（ローカルサーバー経由で開いてください。file:// では fetch がブロックされます）: ' + err.message;
    });
