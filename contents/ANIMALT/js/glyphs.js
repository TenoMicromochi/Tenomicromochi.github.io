/* ============================================================
   ANIMALT — font / glyph table（パイプライン1）

   フォントは TTF/OTF ではなく、Kaname が用意したビットマップシートから
   直接切り出す。仕様は3つだけ:

     ・白地に黒でインクが書いてある
     ・1枚 = Unicode の1ページ（256字）を 16x16 のマス目に並べたもの。
       左上がそのページの先頭、右下が末尾
     ・1マスの寸法はファイル名に書いてある（tenotext_8x11_cool.png なら 8x11）

   つまりシートの寸法は必ず「セル幅x16 × セル高x16」になる。読み込み時に
   そこを検算していて、合わなければ落とす（黙って字がずれるほうが困る）。

   1フォントは複数ページを持てる。ページ番号は符号位置の上位バイト
   （`cp >> 8`）で、`tenotext_8x11_25xx.png` なら 0x25 ＝ U+2500..U+25FF。
   8x11 の COOL / POP は同じ罫線・ブロックのシートを共有するので、
   同じファイルは1度だけ読んで使い回す。

   TTF/OTF をやめた理由は、ラスタライザ任せだと字がセルのどこに乗るか
   （ベースライン・送り幅・ヒンティング）を握れないこと。ドット絵は1px
   ずれれば別物になるので、打った通りの点を打った通りに使えるほうがいい。

   切り出したマスクは 0/1 の Uint8Array にしてページ単位で持ち、
   build() では subarray で参照するだけにしてある（複製しない）。
   マスクは描画用、そこから出すブロック塗り率はマッチング用。
   ============================================================ */
const Glyphs = (() => {

  /* シートの並び。1ページ = 16列 x 16行 = 256字 */
  const GRID = 16;
  const PAGE_SIZE = GRID * GRID;

  const FONTS = [
    { id: '8x8',      label: 'TenoText 8x8',       w: 8, h: 8,
      pages: { 0x00: 'fonts/tenotext_8x8.png' } },
    { id: '8x11cool', label: 'TenoText 8x11 COOL', w: 8, h: 11,
      pages: { 0x00: 'fonts/tenotext_8x11_cool.png',
               0x25: 'fonts/tenotext_8x11_25xx.png' } },
    { id: '8x11pop',  label: 'TenoText 8x11 POP',  w: 8, h: 11,
      pages: { 0x00: 'fonts/tenotext_8x11_pop.png',
               0x25: 'fonts/tenotext_8x11_25xx.png' } },
  ];

  const cvs = document.createElement('canvas');
  const ctx = cvs.getContext('2d', { willReadFrequently: true });

  /* 同じシートを2つのフォントが参照することがあるので、読んだ結果を使い回す */
  const sheetCache = new Map();

  function loadImage(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error(`${src} を読み込めなかった`));
      im.src = src;
    });
  }

  /** シート1枚を 256 字ぶんのビットマスクに割る */
  async function loadSheet(file, w, h) {
    const key = `${file}|${w}x${h}`;
    if (sheetCache.has(key)) return sheetCache.get(key);

    const img = await loadImage(file);
    const sw = w * GRID, sh = h * GRID;
    const gw = img.naturalWidth, gh = img.naturalHeight;
    if (gw !== sw || gh !== sh) {
      throw new Error(
        `${file}: ${sw}x${sh}px のはずが ${gw}x${gh}px ` +
        `（1セル ${w}x${h} x ${GRID}x${GRID}字）`);
    }

    cvs.width = sw; cvs.height = sh;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, sw, sh);
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, sw, sh).data;

    const cellPx = w * h;
    const masks = new Uint8Array(PAGE_SIZE * cellPx);
    let ink = 0;
    for (let i = 0; i < PAGE_SIZE; i++) {
      const cx = (i % GRID) * w;
      const cy = ((i / GRID) | 0) * h;
      const base = i * cellPx;
      for (let y = 0; y < h; y++) {
        const row = (cy + y) * sw + cx;
        for (let x = 0; x < w; x++) {
          const p = (row + x) * 4;
          // 白地に黒。透けている画素は地色（＝インクではない）として扱う
          const on = (d[p + 3] >= 128 && d[p] < 128) ? 1 : 0;
          masks[base + y * w + x] = on;
          ink += on;
        }
      }
    }
    if (!ink) throw new Error(`${file}: インクが1画素も見つからない（白黒が逆かも）`);

    sheetCache.set(key, masks);
    return masks;
  }

  async function loadAll() {
    await Promise.all(FONTS.map(async (f) => {
      f.cellPx = f.w * f.h;
      f.sheets = new Map();
      // ページ番号順に読む。Object のキーは数値文字列なので数に戻す
      await Promise.all(Object.entries(f.pages).map(async ([page, file]) => {
        f.sheets.set(+page, await loadSheet(file, f.w, f.h));
      }));
    }));
  }

  function getFont(id) { return FONTS.find((f) => f.id === id) || FONTS[0]; }

  /** その字がこのフォントに収録されているか。無ければ null */
  function maskOf(f, cp) {
    const sheet = f.sheets.get(cp >> 8);
    if (!sheet) return null;
    const i = cp & 0xFF;
    return sheet.subarray(i * f.cellPx, (i + 1) * f.cellPx);
  }

  /** そのフォントが持っているページの一覧（表示用） */
  function pagesOf(id) {
    return [...getFont(id).sheets.keys()].sort((a, b) => a - b);
  }

  /**
   * 文字列からグリフ表を作る。
   * 同じ形になる文字（シートに未収録の白紙同士など）は 1 つに畳む。
   * マッチャは同点なら先に出てきたグリフを採るので、畳んでも出力は変わらない。
   */
  function build(fontId, chars, rows, cols) {
    const f = getFont(fontId);
    const cellW = f.w, cellH = f.h;

    const blocks = makeBlocks(cellW, cellH, rows, cols);
    const quadCount = blocks.length;

    const list = [];
    const seenMask = new Set();
    const seenRatio = new Set();
    let missing = 0;

    for (const ch of [...chars]) {
      // このフォントが持っていないページの字は落とす。
      // CHARS は手打ちできるし、8x8 には罫線ページが無い
      const mask = maskOf(f, ch.codePointAt(0));
      if (!mask) { missing++; continue; }

      let key = '';
      for (let i = 0; i < mask.length; i++) key += mask[i];
      if (seenMask.has(key)) continue;
      seenMask.add(key);

      const ratios = fillRatiosOf(mask, cellW, blocks);
      const rkey = Array.from(ratios, (v) => v.toFixed(4)).join(',');
      if (seenRatio.has(rkey)) continue;   // 形が違っても塗り率が同じなら結果は同じ
      seenRatio.add(rkey);

      list.push({ ch, mask, ratios });
    }

    // 全部落ちるとマッチャに当てる字が無くなって変換が壊れる。
    // 8x11 用のプリセットを 8x8 で選ぶと起こりうるので、白紙を1つ用意して凌ぐ
    if (!list.length) {
      const mask = new Uint8Array(f.cellPx);
      list.push({ ch: ' ', mask, ratios: fillRatiosOf(mask, cellW, blocks) });
    }

    const nG = list.length;
    const fillFlat = new Float32Array(nG * quadCount);
    const fillSq = new Float32Array(nG);
    for (let i = 0; i < nG; i++) {
      fillFlat.set(list[i].ratios, i * quadCount);
      let s = 0;
      for (let q = 0; q < quadCount; q++) s += list[i].ratios[q] * list[i].ratios[q];
      fillSq[i] = s;
    }

    // ブロック矩形は Worker へ渡すので平坦化しておく
    const blockFlat = new Int32Array(quadCount * 4);
    for (let q = 0; q < quadCount; q++) {
      blockFlat[q * 4] = blocks[q].x0; blockFlat[q * 4 + 1] = blocks[q].x1;
      blockFlat[q * 4 + 2] = blocks[q].y0; blockFlat[q * 4 + 3] = blocks[q].y1;
    }

    return {
      font: f, cellW, cellH, quadCount, missing,
      chars: list.map((g) => g.ch),
      masks: list.map((g) => g.mask),
      fillFlat, fillSq, blockFlat,
    };
  }

  return { FONTS, loadAll, getFont, build, pagesOf };
})();
