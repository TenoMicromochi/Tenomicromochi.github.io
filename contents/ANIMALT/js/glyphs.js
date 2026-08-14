/* ============================================================
   ANIMALT — font / glyph table（パイプライン1）

   フォントは TTF/OTF ではなく、Kaname が用意したビットマップシートから
   直接切り出す。仕様は3つだけ:

     ・白地に黒でインクが書いてある
     ・U+0000..U+00FF の 256 字ぶんを 16x16 のマス目に並べてある
       （左上が U+0000、右下が U+00FF）
     ・1マスの寸法はファイル名に書いてある（tenotext_8x11_cool.png なら 8x11）

   つまりシートの寸法は必ず「セル幅x16 × セル高x16」になる。読み込み時に
   そこを検算していて、合わなければ落とす（黙って字がずれるほうが困る）。

   TTF/OTF をやめた理由は、ラスタライザ任せだと字がセルのどこに乗るか
   （ベースライン・送り幅・ヒンティング）を握れないこと。ドット絵は1px
   ずれれば別物になるので、打った通りの点を打った通りに使えるほうがいい。

   切り出したマスクは 0/1 の Uint8Array にして 256 字ぶん通しで持ち、
   build() では subarray で参照するだけにしてある（複製しない）。
   マスクは描画用、そこから出すブロック塗り率はマッチング用。
   ============================================================ */
const Glyphs = (() => {

  /* シートの並び。U+0000..U+00FF を 16列 x 16行 */
  const GRID = 16;
  const CODEPOINTS = GRID * GRID;
  const MAX_CP = CODEPOINTS - 1;

  const FONTS = [
    { id: '8x8',      label: 'TenoText 8x8',       file: 'fonts/tenotext_8x8.png',       w: 8, h: 8  },
    { id: '8x11cool', label: 'TenoText 8x11 COOL', file: 'fonts/tenotext_8x11_cool.png', w: 8, h: 11 },
    { id: '8x11pop',  label: 'TenoText 8x11 POP',  file: 'fonts/tenotext_8x11_pop.png',  w: 8, h: 11 },
  ];

  const cvs = document.createElement('canvas');
  const ctx = cvs.getContext('2d', { willReadFrequently: true });

  function loadImage(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error(`${src} を読み込めなかった`));
      im.src = src;
    });
  }

  /** シート1枚を 256 字ぶんのビットマスクに割る */
  async function loadSheet(f) {
    const img = await loadImage(f.file);
    const sw = f.w * GRID, sh = f.h * GRID;
    const gw = img.naturalWidth, gh = img.naturalHeight;
    if (gw !== sw || gh !== sh) {
      throw new Error(
        `${f.file}: ${sw}x${sh}px のはずが ${gw}x${gh}px ` +
        `（1セル ${f.w}x${f.h} x ${GRID}x${GRID}字）`);
    }

    cvs.width = sw; cvs.height = sh;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, sw, sh);
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, sw, sh).data;

    const cellPx = f.w * f.h;
    const masks = new Uint8Array(CODEPOINTS * cellPx);
    let ink = 0;
    for (let cp = 0; cp < CODEPOINTS; cp++) {
      const cx = (cp % GRID) * f.w;
      const cy = ((cp / GRID) | 0) * f.h;
      const base = cp * cellPx;
      for (let y = 0; y < f.h; y++) {
        const row = (cy + y) * sw + cx;
        for (let x = 0; x < f.w; x++) {
          const i = (row + x) * 4;
          // 白地に黒。透けている画素は地色（＝インクではない）として扱う
          const on = (d[i + 3] >= 128 && d[i] < 128) ? 1 : 0;
          masks[base + y * f.w + x] = on;
          ink += on;
        }
      }
    }
    if (!ink) throw new Error(`${f.file}: インクが1画素も見つからない（白黒が逆かも）`);

    f.masks = masks;
    f.cellPx = cellPx;
  }

  async function loadAll() {
    await Promise.all(FONTS.map(loadSheet));
  }

  function getFont(id) { return FONTS.find((f) => f.id === id) || FONTS[0]; }

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
    let outOfRange = 0;

    for (const ch of [...chars]) {
      // シートは U+00FF までしかない。CHARS は手打ちできるので範囲外が来うる
      const cp = ch.codePointAt(0);
      if (cp > MAX_CP) { outOfRange++; continue; }

      const mask = f.masks.subarray(cp * f.cellPx, (cp + 1) * f.cellPx);
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
      font: f, cellW, cellH, quadCount, outOfRange,
      chars: list.map((g) => g.ch),
      masks: list.map((g) => g.mask),
      fillFlat, fillSq, blockFlat,
    };
  }

  return { FONTS, loadAll, getFont, build, MAX_CP };
})();
