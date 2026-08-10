// PIXEL ART GALLERY - sidebar & grid
// 左サイドバー（カテゴリ一覧）と右メイン（作品グリッド）の構築・フィルタリングを担当。
const grid = document.getElementById('galleryGrid');
const categoryList = document.getElementById('categoryList');
const currentCategoryLabel = document.getElementById('currentCategoryLabel');
const sizeGroup = document.getElementById('sizeGroup');

let activeCategory = 'all';

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
    const sizePx = Number(btn.dataset.size);
    setActiveSizeButton(sizePx);
    document.querySelectorAll('.thumb-frame').forEach(f => {
        f.style.setProperty('--thumb-h', sizePx + 'px');
    });
});

setActiveSizeButton(112);

loadWorks()
    .then(() => {
        buildSidebar();
        renderGrid();
    })
    .catch(err => {
        grid.textContent = 'works.json の読み込みに失敗しました（ローカルサーバー経由で開いてください。file:// では fetch がブロックされます）: ' + err.message;
    });
