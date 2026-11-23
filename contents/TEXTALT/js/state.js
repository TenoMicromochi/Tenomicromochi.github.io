/** ============================================================
 * AA Generator v6 — state.js
 * 共有ステート・DOM参照・canvasコンテキスト
 * ============================================================ */

let charVectors = [];
// 文字ごとのインク（0〜255。PIXEL は 0 / 255 のみ）。解析のたびに作り直す
let charMasks = new Map();

/* 今のフォントの状態（1か所に持つ）
 *  family : FontFace に付けた TEXTALT 専用の家族名（TextaltFont0, 1, …）
 *  mode   : 'pixel' | 'smooth'    size : px    cellW / cellH : セルの大きさ
 *  autoW / autoH : 測った自動の値  face : 読み込んだ FontFace */
const font = { family: '', name: '', mode: 'pixel', size: 11, cellW: 1, cellH: 1, autoW: 1, autoH: 1, face: null };

// 最後の変換で使った描画の材料（表示・書き出しはこれを使う）
let lastRender = null;   // { masks, cw, ch }

// 最近傍探索の内側ループ用に charVectors を平坦化したもの（順序は charVectors と同一）
let charVecFlat = null;
let charCharList = [];
let charIsSpace = null;
let charVecLen = 0;
let lastAsciiLines = [];
let sourceImage = null;
let isFontReady = false;
let processTimer = null;

// processImage の段ごとのキャッシュ（S 縮小 → P 加工 → F 特徴量 → A 文字の選択）
const _cache = {
    srcImage: null, keyS: null, previewImg: null, srcPixels: null,
    keyP: null, processed: null,
    keyF: null, feats: null,
    keyA: null,
};

// --- Cache States ---
let lastAnalyzeKey = "";

const ui = {
    file:               document.getElementById('imgInput'),
    fontFileInput:      document.getElementById('fontFileInput'),
    fontNameLabel:      document.getElementById('fontNameLabel'),
    fontPresetSelect:   document.getElementById('fontPresetSelect'),
    modePixelBtn:       document.getElementById('modePixelBtn'),
    modeSmoothBtn:      document.getElementById('modeSmoothBtn'),
    cellPixelRow:       document.getElementById('cellPixelRow'),
    cellAutoText:       document.getElementById('cellAutoText'),
    cellSmoothRow:      document.getElementById('cellSmoothRow'),
    cellAutoBtn:        document.getElementById('cellAutoBtn'),
    valSize:            document.getElementById('val-size'),
    valCellW:           document.getElementById('val-cellW'),
    valCellH:           document.getElementById('val-cellH'),
    charSetSelect:      document.getElementById('charSetSelect'),
    customCharsInput:   document.getElementById('customCharsInput'),
    charCount:          document.getElementById('charCount'),
    addPresetBtn:       document.getElementById('addPresetBtn'),
    replacePresetBtn:   document.getElementById('replacePresetBtn'),
    autoApplyCheck:     document.getElementById('autoApplyCheck'),
    width:              document.getElementById('widthInput'),
    invert:             document.getElementById('invertCheck'),
    contrast:           document.getElementById('contrastRange'),
    brightness:         document.getElementById('brightnessRange'),
    gamma:              document.getElementById('gammaRange'),
    posterize:          document.getElementById('posterizeRange'),
    sharpen:            document.getElementById('sharpenRange'),
    threshold:          document.getElementById('thresholdRange'),
    sobel:              document.getElementById('sobelRange'),
    blur:               document.getElementById('blurRange'),
    densityWeight:      document.getElementById('densityWeightRange'),
    gridX:              document.getElementById('gridX'),
    gridY:              document.getElementById('gridY'),
    includeAvg:         document.getElementById('includeAvgCheck'),
    status:             document.getElementById('status-bar'),
    preview:            document.getElementById('previewCanvas'),
    analysis:           document.getElementById('analysisCanvas'),
    valWidth:           document.getElementById('val-width'),
    valContrast:        document.getElementById('val-contrast'),
    valBrightness:      document.getElementById('val-brightness'),
    valGamma:           document.getElementById('val-gamma'),
    valPosterize:       document.getElementById('val-posterize'),
    valSharpen:         document.getElementById('val-sharpen'),
    valThreshold:       document.getElementById('val-threshold'),
    valSobel:           document.getElementById('val-sobel'),
    valBlur:            document.getElementById('val-blur'),
    valDensityWeight:   document.getElementById('val-densityWeight'),
    exportStatus:       document.getElementById('exportStatus'),
    fgColorPicker:      document.getElementById('fgColorPicker'),
    bgColorPicker:      document.getElementById('bgColorPicker'),
    fgColorDot:         document.getElementById('fgColorDot'),
    bgColorDot:         document.getElementById('bgColorDot'),
    swapColorsBtn:      document.getElementById('swapColorsBtn'),
    outputBody:         document.querySelector('.output-body'),
    outputCanvas:       document.getElementById('outputCanvas'),
    copyTextBtn:        document.getElementById('copyTextBtn'),
    saveTxtBtn:         document.getElementById('saveTxtBtn'),
};

const pCtx = ui.preview.getContext('2d', { willReadFrequently: true });
const aCtx = ui.analysis.getContext('2d', { willReadFrequently: true });
