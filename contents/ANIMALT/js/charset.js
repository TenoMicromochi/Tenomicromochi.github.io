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

/* ギリシア文字・キリル文字は外した。ビットマップシートが
   U+0000..U+00FF ぶんしかないので、そもそも字形を持っていない。 */

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
};

/* プリセット選択の並び。TEXTALT-V と同じく用途でまとめる */
const CHAR_SET_GROUPS = [
  ['— Teno —',     ['teno']],
  ['— Minimal —',  ['blocks_dense', 'minimal', 'circles', 'dots', 'bars']],
  ['— Numbers —',  ['numbers']],
  ['— Symbols —',  ['symbols', 'ext_symbols']],
  ['— Alphabet —', ['large', 'small']],
  ['— All —',      ['ascii', 'all']],
];
