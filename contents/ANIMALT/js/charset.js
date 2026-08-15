/* ============================================================
   ANIMALT — character sets
   TEXTALT の constants.js から引き継いだもの。
   ここでの「文字」は形の担い手でしかないので、字の意味は問わない。
   ============================================================ */
const CHAR_SETS = {
  blocks_dense:    " .:-=+*#%@",
  minimal:         "@%#*+=-:. ",
  teno:            "TENOteno ",
  circles:         "0Oo.º° ",
  dots:            ",.:\";'`·´ ",
  bars:            "¦-_|\\/= ",
  numbers:         "0123456789 ",
  symbols:         "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~ ",
  ext_symbols:     "¡¢£¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿×÷ ",
  large:           "ABCDEFGHIJKLMNOPQRSTUVWXYZ ",
  small:           "abcdefghijklmnopqrstuvwxyz ",
  ascii:           "!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ ",
  all:             "!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~¡¢£¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ ",
};

/* ギリシア文字・キリル文字は外した。0x00 ページのシートに字形が無い。 */

/* ── U+2500..U+25FF（罫線素片・ブロック要素・幾何学模様）──
   8x11 の COOL / POP だけが持つページ。8x8 は持っていないので、
   8x8 でこれらを選ぶと全部落ちる（GLYPH の情報行に落ちた数が出る）。

   AA にとってはここが本命で、ブロック要素は塗り率が設計どおりに並ぶ。
   とくに █ (U+2588) は塗り率 1.00 ちょうど。ASCII だけだと一番濃い字が
   M の 0.55 止まりで、ASCII モードの明部が伸び切らなかった。

   範囲ものは手打ちすると必ず取りこぼすので、符号位置から組み立てる。 */
const cpRange = (from, to) => {
  let s = '';
  for (let c = from; c <= to; c++) s += String.fromCharCode(c);
  return s;
};

Object.assign(CHAR_SETS, {
  // 塗り率 0 → 0.25 → 0.32 → 0.51 → 1.00。いちばん素直な濃度の階段
  shade:         " ░▒▓█",
  // 半分・四分割。縦横の境目を拾えるので、輪郭がぐっと締まる
  blocks_half:   " ▀▄▌▐▖▗▘▝▚▞█",
  // 8分割。0.09 刻みくらいで濃度が並ぶので、階調が滑らかになる
  blocks_eighth: " ▁▂▃▄▅▆▇█▏▎▍▋▊▉",
  box_light:     " ─│┌┐└┘├┤┬┴┼╭╮╯╰",
  box_heavy:     " ━┃┏┓┗┛┣┫┳┻╋",
  box_double:    " ═║╔╗╚╝╠╣╦╩╬",
  box_all:       cpRange(0x2500, 0x257F) + ' ',
  blocks_all:    cpRange(0x2580, 0x259F) + ' ',
  shapes:        cpRange(0x25A0, 0x25FF) + ' ',
  page_25xx:     cpRange(0x2500, 0x25FF) + ' ',
});

// ラテンと罫線・ブロックを全部入れた最大の集合。
// 末尾の空白が重ならないよう、結合してから重複を落とす
CHAR_SETS.everything = [...new Set(CHAR_SETS.all + CHAR_SETS.page_25xx)].join('');

const CHAR_SET_LABELS = {
  blocks_dense:   'DENSITY RAMP',
  minimal:        'MINIMAL',
  teno:           'TENO',
  circles:        'CIRCLES',
  dots:           'DOTS',
  bars:           'BARS',
  numbers:        'NUMBERS',
  symbols:        'SYMBOLS',
  ext_symbols:    'EXT SYMBOLS',
  large:          'A-Z',
  small:          'a-z',
  ascii:          'ASCII',
  all:            'ASCII + EXT-ASCII',
  shade:          'SHADE RAMP',
  blocks_half:    'HALF / QUADRANT',
  blocks_eighth:  'EIGHTHS',
  blocks_all:     'ALL BLOCKS',
  box_light:      'BOX LIGHT',
  box_heavy:      'BOX HEAVY',
  box_double:     'BOX DOUBLE',
  box_all:        'ALL BOX',
  shapes:         'GEOMETRIC',
  page_25xx:      'U+2500-25FF',
  everything:     'ASCII + EXT + 25XX',
};

/* プリセット選択の並び。TEXTALT-V と同じく用途でまとめる。
   Blocks / Box / Shapes は 8x11 専用（8x8 には字形が無い）。 */
const CHAR_SET_GROUPS = [
  ['— Teno —',     ['teno']],
  ['— Minimal —',  ['blocks_dense', 'minimal', 'circles', 'dots', 'bars']],
  ['— Numbers —',  ['numbers']],
  ['— Symbols —',  ['symbols', 'ext_symbols']],
  ['— Alphabet —', ['large', 'small']],
  ['— Blocks (8x11) —', ['shade', 'blocks_half', 'blocks_eighth', 'blocks_all']],
  ['— Box (8x11) —',    ['box_light', 'box_heavy', 'box_double', 'box_all']],
  ['— Shapes (8x11) —', ['shapes']],
  ['— All —',      ['ascii', 'all', 'page_25xx', 'everything']],
];
