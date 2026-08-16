/* ============================================================
   FLAKALT — palette.js
   EGA 16色。この 16 個以外の色は画面に出さない。

   色番号は EGA/VGA の標準並び（0=黒 … 15=白）をそのまま使う。
   ============================================================ */

export const PAL = [
  0x000000, // 0  black
  0x0000aa, // 1  blue
  0x00aa00, // 2  green
  0x00aaaa, // 3  cyan
  0xaa0000, // 4  red
  0xaa00aa, // 5  magenta
  0xaa5500, // 6  brown
  0xaaaaaa, // 7  light gray
  0x555555, // 8  dark gray
  0x5555ff, // 9  light blue
  0x55ff55, // 10 light green
  0x55ffff, // 11 light cyan
  0xff5555, // 12 light red
  0xff55ff, // 13 light magenta
  0xffff55, // 14 yellow
  0xffffff, // 15 white
];

export const C = {
  BLACK: 0, BLUE: 1, GREEN: 2, CYAN: 3,
  RED: 4, MAGENTA: 5, BROWN: 6, LGRAY: 7,
  DGRAY: 8, LBLUE: 9, LGREEN: 10, LCYAN: 11,
  LRED: 12, LMAGENTA: 13, YELLOW: 14, WHITE: 15,
};

/* 明るい→暗いの並び。距離フェードや爆炎の減衰で使う。 */
export const RAMP_STEEL = [C.WHITE, C.LGRAY, C.DGRAY, C.BLACK];
export const RAMP_FIRE = [C.WHITE, C.YELLOW, C.LRED, C.RED, C.DGRAY];
export const RAMP_SKY = [C.LCYAN, C.CYAN, C.LBLUE, C.BLUE, C.BLACK];

/* パレット番号 → キャンバス用の 0xAABBGGRR（リトルエンディアン前提）。 */
export function toABGR(rgb) {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return (0xff << 24) | (b << 16) | (g << 8) | r;
}

export const PAL32 = new Uint32Array(PAL.map(toABGR));
