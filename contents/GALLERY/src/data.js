// PIXEL ART GALLERY - data layer
// DOMに依存しない純粋なヘルパー群と、works.json から読み込むカテゴリ/作品データの状態。
// works.json は src/generate-works-json.js で my_works/ から自動生成できる。
const IMG_BASE = '/images/';
const BTN_BASE = IMG_BASE + 'buttons/';
const FOLDER_ICON = IMG_BASE + 'FOLDER.png';
const EXT_BADGE = { PNG: BTN_BASE + 'button_extension_png.png', GIF: BTN_BASE + 'button_extension_gif.png' };

// asset名(例: "x2")→ ON/OFF画像の切り替え。ボタン系アイコンは全て images/buttons/ 配下。
function buttonAssetSrc(asset, isActive) {
    return BTN_BASE + 'button_' + asset + (isActive ? '_ON.png' : '_OFF.png');
}

// パスの各セグメントをURLエンコード（日本語・絵文字・空白・括弧などを含むファイル名対応）。
function encodePath(path) {
    return path.split('/').map(encodeURIComponent).join('/');
}

// タイトルはファイル名（拡張子を除いたもの）からそのまま導出する。
function titleFromFile(path) {
    const base = path.split('/').pop();
    return base.replace(/\.[^.]+$/, '');
}

function extOf(filename) {
    return filename.split('.').pop().toUpperCase();
}

let CATEGORIES = [];
let ITEMS = [];

function categoryLabel(key) {
    if (key === 'all') return { ja: 'すべて', en: 'All' };
    const c = CATEGORIES.find(c => c.key === key);
    return c ? { ja: c.ja, en: c.en } : { ja: key, en: key };
}

// works.json を読み込み CATEGORIES/ITEMS を更新する。読み込み後の描画は呼び出し側の責務。
function loadWorks() {
    return fetch('works.json')
        .then(res => {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        })
        .then(data => {
            CATEGORIES = data.categories || [];
            ITEMS = data.items || [];
        });
}
