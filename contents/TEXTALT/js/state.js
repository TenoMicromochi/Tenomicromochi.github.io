/** ============================================================
 * AA Generator v6 — state.js
 * 共有ステート・DOM参照・canvasコンテキスト
 * ============================================================ */

let charVectors = [];
// 文字ごとの 8×11 インクマスク（1 = インク）
let charMasks = new Map();

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
    fontFile:           document.getElementById('fontInput'),
    manualLoadArea:     document.getElementById('manual-font-load'),
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
