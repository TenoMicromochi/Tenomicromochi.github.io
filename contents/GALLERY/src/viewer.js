// PIXEL ART GALLERY - zoom viewer (modal)
// 拡大表示モーダル：日英タイトル/説明文、拡大率切替、ダウンロード、閉じるボタンを担当。
const overlay = document.getElementById('modalOverlay');
const modalTitleJa = document.getElementById('modalTitleJa');
const modalTitleEn = document.getElementById('modalTitleEn');
const modalDescBlock = document.querySelector('.modal-desc-block');
const modalDescJa = document.getElementById('modalDescJa');
const modalDescEn = document.getElementById('modalDescEn');
const zoomStage = document.getElementById('zoomStage');
const zoomImage = document.getElementById('zoomImage');
const metaCategory = document.getElementById('metaCategory');
const metaExt = document.getElementById('metaExt');
const metaSize = document.getElementById('metaSize');
const metaDisplay = document.getElementById('metaDisplay');
const scaleGroup = document.getElementById('scaleGroup');
const downloadBtn = document.getElementById('downloadBtn');
const downloadBtnImg = downloadBtn.querySelector('img');
const modalClose = document.getElementById('modalClose');

let currentScale = 1;
let currentNaturalW = 0;
let currentNaturalH = 0;
let currentItem = null;

function openModal(item) {
    currentItem = item;
    modalTitleJa.textContent = item.titleJa || titleFromFile(item.file);
    modalTitleEn.textContent = item.titleEn || '';
    modalTitleEn.style.display = item.titleEn ? '' : 'none';
    modalDescJa.textContent = item.descriptionJa || '';
    modalDescJa.style.display = item.descriptionJa ? '' : 'none';
    modalDescEn.textContent = item.descriptionEn || '';
    modalDescEn.style.display = item.descriptionEn ? '' : 'none';
    modalDescBlock.style.display = (item.descriptionJa || item.descriptionEn) ? '' : 'none';
    const lbl = categoryLabel(item.category);
    metaCategory.textContent = lbl.ja;
    const ext = extOf(item.file);
    metaExt.src = EXT_BADGE[ext];
    metaExt.alt = ext;
    currentScale = 1;
    setActiveScaleButton(1);

    // ダウンロードは原寸ファイルの読み込みが終わるまでOFF（無効）表示にする。
    downloadBtnImg.src = buttonAssetSrc('download', false);

    zoomImage.src = encodePath(item.file);
    zoomImage.onload = () => {
        currentNaturalW = zoomImage.naturalWidth;
        currentNaturalH = zoomImage.naturalHeight;
        metaSize.textContent = currentNaturalW + '×' + currentNaturalH + ' px (native)';
        applyScale();
        downloadBtnImg.src = buttonAssetSrc('download', true);
    };

    overlay.classList.add('open');
}

function closeModal() {
    overlay.classList.remove('open');
    zoomImage.src = '';
}

// currentScale は「1ドットあたりの実機ピクセル数」。
// スマホは devicePixelRatio が2〜3あるので、CSSピクセルにそのまま原寸を入れると
// 実機では2〜3倍に拡大されてしまう（=等倍にならない・画面からはみ出す）。
// DPRを割り戻して指定することで、x1が実機での本当の等倍になる。
function applyScale() {
    const dpr = window.devicePixelRatio || 1;
    const w = currentNaturalW * currentScale;
    const h = currentNaturalH * currentScale;
    zoomImage.style.width = (w / dpr) + 'px';
    zoomImage.style.height = (h / dpr) + 'px';
    metaDisplay.textContent = 'display: ' + w + '×' + h + ' (' + currentScale + '×)';
}

// button_original(x1)_ON/OFF.png, button_x2/x3/x4_ON/OFF.png を差し替えて
// トグル状態を表現する（ON=選択中）。
function setActiveScaleButton(scale) {
    scaleGroup.querySelectorAll('.scale-btn').forEach(btn => {
        const img = btn.querySelector('img');
        img.src = buttonAssetSrc(img.dataset.asset, Number(btn.dataset.scale) === scale);
    });
}

scaleGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.scale-btn');
    if (!btn) return;
    currentScale = Number(btn.dataset.scale);
    setActiveScaleButton(currentScale);
    applyScale();
});

// 表示中の拡大率(1x〜4x)に関係なく、常に原寸の元ファイルをダウンロードする。
downloadBtn.addEventListener('click', () => {
    if (!currentItem) return;
    const a = document.createElement('a');
    a.href = encodePath(currentItem.file);
    a.download = currentItem.file.split('/').pop();
    document.body.appendChild(a);
    a.click();
    a.remove();
});

// 拡大表示がビューアからはみ出した時、ドラッグでスクロール位置を移動できるようにする。
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panScrollLeft = 0;
let panScrollTop = 0;

zoomStage.addEventListener('mousedown', (e) => {
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panScrollLeft = zoomStage.scrollLeft;
    panScrollTop = zoomStage.scrollTop;
    zoomStage.classList.add('panning');
    e.preventDefault(); // ブラウザ標準の画像ドラッグ(ゴースト表示)を止める
});

window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    zoomStage.scrollLeft = panScrollLeft - (e.clientX - panStartX);
    zoomStage.scrollTop = panScrollTop - (e.clientY - panStartY);
});

window.addEventListener('mouseup', () => {
    isPanning = false;
    zoomStage.classList.remove('panning');
});

modalClose.addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal();
});

setActiveScaleButton(1);
downloadBtnImg.src = buttonAssetSrc('download', false);
