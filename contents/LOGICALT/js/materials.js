// materials.js — 素材コードと色表（SPEC 1節）。素材コードは内部の番号（キー・並び順とは別。並びは MAT_ORDER）
export const M = { EMPTY: 0, WIRE: 1, INPUT: 2, OUTPUT: 3, INVERT: 4, TFF: 5, LAMP: 6, CROSS: 7, HOLE: 8, BUFFER: 9 };
export const MAT_NAMES = ['EMPTY', 'WIRE', 'INPUT', 'OUTPUT', 'INVERT', 'TFF', 'LAMP', 'CROSS', 'HOLE', 'BUFFER']; // ステータス用（素材コードで引く）
// ドックの表示名（EMPTY は ERASER、TFF は T-FF）
export const MAT_LABEL = { [M.WIRE]: 'WIRE', [M.INPUT]: 'INPUT', [M.OUTPUT]: 'OUTPUT', [M.INVERT]: 'INVERT', [M.BUFFER]: 'BUFFER', [M.CROSS]: 'CROSS',
  [M.TFF]: 'T-FF', [M.LAMP]: 'LAMP', [M.HOLE]: 'HOLE', [M.EMPTY]: 'ERASER' };
const MAT_COUNT = 10;
// 並び順（キー・メニューとも）：キー 1〜9 と 0（ERASER）がこの順に対応する
export const MAT_ORDER = [M.WIRE, M.INPUT, M.OUTPUT, M.INVERT, M.BUFFER, M.CROSS, M.TFF, M.LAMP, M.HOLE, M.EMPTY];
export const matKey = (m) => (MAT_ORDER.indexOf(m) + 1) % 10;

const hex = (s) => parseInt(s.slice(1), 16);
export const cssHex = (rgb) => '#' + rgb.toString(16).padStart(6, '0');   // 0xRRGGBB -> '#RRGGBB'

// aux の持ち方：LAMP は下位 4 bit = 色、TFF は bit0 = 初期状態の ON（実行中の状態は topo 側だけが持つ）
export const lampColorOf = (aux) => aux & 15;
export const tffOnOf = (aux) => aux & 1;

// [ON, OFF]
const TABLE = {
  [M.WIRE]:   ['#A0A0A0', '#505050'],
  [M.CROSS]:  ['#E0E0E0', '#787878'],
  [M.INPUT]:  ['#E04040', '#702020'],
  [M.OUTPUT]: ['#4060E0', '#203070'],
  [M.INVERT]: ['#40C040', '#206020'],
  [M.TFF]:    ['#40C0E0', '#206070'],
  [M.HOLE]:   ['#E0904C', '#64401E'],
  [M.BUFFER]: ['#A060E0', '#402060'],
};
const EMPTY_RGB = 0x000000;
const LAMP_OFF_RGB = 0x262626; // 消灯中の LAMP の表示色（表示のみ。PNG には出さない）

// 虹色15色＋白（OKLCH L=0.75、色相 25° から 24° ずつ、彩度は sRGB の限界まで・上限 0.17）
export const LAMP_NAMES = ['WHITE', 'RED', 'ORANGE', 'AMBER', 'YELLOW', 'LIME', 'GREEN', 'MINT',
  'TEAL', 'CYAN', 'SKY', 'BLUE', 'VIOLET', 'PURPLE', 'MAGENTA', 'PINK'];
const LAMP_ON_HEX = ['#FFFFFF', '#FF847D', '#FF8A44', '#EA9B05', '#CAAD04', '#9FBD23', '#5EC966', '#01CC9D',
  '#05C7C4', '#09C2E4', '#4BB8FF', '#86ACFF', '#AC9EFF', '#D38AFA', '#F080D5', '#FF7DA8'];

export const RGB_ON = new Array(MAT_COUNT).fill(0);   // 0xRRGGBB
export const RGB_OFF = new Array(MAT_COUNT).fill(0);
for (const k in TABLE) { RGB_ON[k] = hex(TABLE[k][0]); RGB_OFF[k] = hex(TABLE[k][1]); }
export const LAMP_ON = LAMP_ON_HEX.map(hex);
RGB_ON[M.LAMP] = LAMP_ON[0]; RGB_OFF[M.LAMP] = LAMP_OFF_RGB;

const OOB_RGB = 0x2a1a3a; // キャンバス範囲外

// PNG に出す色の (rgb -> {mat, aux, on}) 表。重複があれば例外
function buildColorMap() {
  const map = new Map();
  const add = (rgb, v) => {
    if (map.has(rgb)) throw new Error('duplicate color #' + rgb.toString(16).padStart(6, '0'));
    map.set(rgb, v);
  };
  add(EMPTY_RGB, { mat: M.EMPTY, aux: 0, on: 0 });
  for (const m of [M.WIRE, M.CROSS, M.INPUT, M.OUTPUT, M.INVERT, M.TFF, M.HOLE, M.BUFFER]) {
    add(RGB_ON[m], { mat: m, aux: 0, on: 1 });
    add(RGB_OFF[m], { mat: m, aux: 0, on: 0 });
  }
  for (let c = 0; c < 16; c++) add(LAMP_ON[c], { mat: M.LAMP, aux: c, on: 1 });
  if (map.has(LAMP_OFF_RGB)) throw new Error('lamp off display color collides with a PNG color');
  return map;
}
export const COLOR_MAP = buildColorMap();

// 保存用の色：TFF は状態色、LAMP は常に ON 色、ほかは OFF 色
export function saveRgb(mat, aux) {
  if (mat === M.EMPTY) return EMPTY_RGB;
  if (mat === M.LAMP) return LAMP_ON[lampColorOf(aux)];
  if (mat === M.TFF) return tffOnOf(aux) ? RGB_ON[mat] : RGB_OFF[mat];
  return RGB_OFF[mat];
}

// 画面用 ABGR (Uint32, リトルエンディアン)
const abgr = (rgb) => (0xff000000 | ((rgb & 255) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 255)) >>> 0;
const mix = (a, b, t) => {
  const f = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (f(16) << 16) | (f(8) << 8) | f(0);
};

export const FADE_STEPS = 4; // 残光の段数
export const COL_ON = RGB_ON.map(abgr);
export const COL_OFF = RGB_OFF.map(abgr);
// LAMP: [color*(FADE_STEPS+1) + level]  level 0=消灯色 .. FADE_STEPS=ON
export const COL_LAMP = new Uint32Array(16 * (FADE_STEPS + 1));
for (let c = 0; c < 16; c++) {
  for (let l = 0; l <= FADE_STEPS; l++) COL_LAMP[c * (FADE_STEPS + 1) + l] = abgr(mix(LAMP_OFF_RGB, LAMP_ON[c], l / FADE_STEPS));
}
// STOP 中（編集中）の消灯 LAMP：点灯色の各チャンネルを 0.35 倍（表示のみ）
export const COL_LAMP_EDIT = new Uint32Array(16);
for (let c = 0; c < 16; c++) COL_LAMP_EDIT[c] = abgr(mix(0, LAMP_ON[c], 0.35));
export const COL_OOB = abgr(OOB_RGB);
export const COL_EMPTY = abgr(EMPTY_RGB);

export const isNet = (m) => m === M.WIRE || m === M.HOLE;   // ネットを作る素材（CROSS は透明なので含めない）
export const isBody = (m) => m === M.INVERT || m === M.TFF || m === M.LAMP || m === M.BUFFER;   // 遅延のあるゲート本体（BUFFER も1ティック遅れる）
