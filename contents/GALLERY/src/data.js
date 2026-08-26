// PIXEL ART GALLERY - data layer
// DOMに依存しない純粋なヘルパー群と、works.json から読み込むカテゴリ/作品データの状態。
// works.json は src/generate-works-json.js で my_works/ から自動生成できる。
const IMG_BASE = '/images/';
const BTN_BASE = IMG_BASE + 'buttons/';
// アイコン類は images/icons/ 配下。images/ 直下ではない
const FOLDER_ICON = IMG_BASE + 'icons/FOLDER.png';
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

// ドット絵を滲ませずに表示するための倍率計算。
// 端数倍率で拡縮するとブラウザが補間してドットが潰れる（特にスマホは
// devicePixelRatio が2〜3あるため、CSS上は縮小でも実機では拡大になり得る）。
// そこで「1ドット = 実機の整数ピクセル」になる倍率だけを選ぶ。
// 拡大側は整数倍(1,2,3…)、縮小側は整数分の1(1/2,1/3…)に切り下げる。
// 返り値の cssW/cssH は devicePixelRatio を割り戻したCSSピクセル値。
function integerDeviceScale(naturalW, naturalH, boxW, boxH) {
    const dpr = window.devicePixelRatio || 1;
    const fit = Math.min((boxW * dpr) / naturalW, (boxH * dpr) / naturalH);
    const deviceScale = fit >= 1 ? Math.floor(fit) : 1 / Math.ceil(1 / fit);
    return {
        deviceScale,
        cssW: (naturalW * deviceScale) / dpr,
        cssH: (naturalH * deviceScale) / dpr,
    };
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
