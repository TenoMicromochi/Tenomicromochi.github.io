/* ============================================================
   ANIMALT — GIF89a encoder

   ライブラリを持ち込まずに自前で書いている。理由は、このツールの
   出力が最初から「16色以下のパレット画像」だから。
   ふつう GIF 書き出しが面倒なのは減色とディザリングのせいで、
   そこが済んでいるならエンコーダ本体は LZW とヘッダ組み立てだけになる。
   量子化を挟まないぶん、画面の見た目と完全に一致する GIF が出る。

   フレーム間差分も入れてある。AA は動いていない領域のセルがそのまま
   居座るので、変化していないセルを透明にして捨てるとファイルがかなり縮む。
   透明色にはパレットの直後の番号を使い、カラーテーブルはその分だけ
   大きい 2 のべき乗に切り上げる（16色なら 32 エントリ）。
   ============================================================ */
const GifEncoder = (() => {

  /* ---------- ビット詰め（LSB first） ---------- */
  class BitWriter {
    constructor() { this.out = []; this.acc = 0; this.bits = 0; }
    write(code, size) {
      this.acc |= code << this.bits;
      this.bits += size;
      while (this.bits >= 8) {
        this.out.push(this.acc & 0xff);
        this.acc >>>= 8;
        this.bits -= 8;
      }
    }
    flush() {
      if (this.bits > 0) { this.out.push(this.acc & 0xff); this.acc = 0; this.bits = 0; }
      return this.out;
    }
  }

  /**
   * GIF 版 LZW。符号長を伸ばす条件と辞書リセットの順序は
   * compress 由来の実装（jsgif / gif.js）に合わせてある。
   * ここを 1 ステップずらすとデコーダ側と辞書がずれて画像が崩れる。
   */
  function lzwEncode(minCodeSize, px) {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let maxCode = (1 << codeSize) - 1;
    let next = clearCode + 2;
    let dict = new Map();
    const bw = new BitWriter();

    const emit = (code) => {
      bw.write(code, codeSize);
      // 直前までに払い出した番号が今の符号長で表せなくなったら 1 bit 伸ばす
      if (next > maxCode && codeSize < 12) { codeSize++; maxCode = (1 << codeSize) - 1; }
    };

    emit(clearCode);
    if (px.length === 0) { emit(eoiCode); return bw.flush(); }

    let ent = px[0];
    for (let i = 1; i < px.length; i++) {
      const c = px[i];
      const key = (ent << 8) | c;
      const found = dict.get(key);
      if (found !== undefined) { ent = found; continue; }
      emit(ent);
      if (next < 4096) {
        dict.set(key, next++);
      } else {
        // 辞書が満杯。CLEAR を送って初期状態に戻す
        emit(clearCode);
        dict = new Map();
        next = clearCode + 2;
        codeSize = minCodeSize + 1;
        maxCode = (1 << codeSize) - 1;
      }
      ent = c;
    }
    emit(ent);
    emit(eoiCode);
    return bw.flush();
  }

  /* ---------- バイト列の組み立て ---------- */
  class ByteBuf {
    constructor() { this.a = []; }
    u8(v) { this.a.push(v & 0xff); }
    u16(v) { this.a.push(v & 0xff, (v >> 8) & 0xff); }
    str(s) { for (let i = 0; i < s.length; i++) this.a.push(s.charCodeAt(i)); }
    bytes(arr) { for (let i = 0; i < arr.length; i++) this.a.push(arr[i]); }
    /** LZW 出力を 255 バイト以下のサブブロックに切って書き出す */
    subBlocks(arr) {
      for (let i = 0; i < arr.length; i += 255) {
        const n = Math.min(255, arr.length - i);
        this.a.push(n);
        for (let j = 0; j < n; j++) this.a.push(arr[i + j]);
      }
      this.a.push(0);
    }
    toUint8() { return new Uint8Array(this.a); }
  }

  /**
   * 前のコマとの差分を取り、変化した画素の外接矩形だけを切り出す。
   * 矩形の中でも変わっていない画素は透明色にして、前のコマを透けさせる。
   */
  function makeDiff(px, prev, width, height, transparentIdx, codeSize) {
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        if (px[row + x] !== prev[row + x]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) { minX = minY = 0; maxX = maxY = 0; } // 完全に同じコマ

    const x0 = minX, y0 = minY, w = maxX - minX + 1, h = maxY - minY + 1;
    const sub = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const sr = (y0 + y) * width + x0, dr = y * w;
      for (let x = 0; x < w; x++) {
        const v = px[sr + x];
        sub[dr + x] = (v === prev[sr + x]) ? transparentIdx : v;
      }
    }
    return { x0, y0, w, h, px: sub, codeSize, transparent: true };
  }

  /**
   * @param {Object} o
   * @param {number} o.width
   * @param {number} o.height
   * @param {Array<{r,g,b}>} o.palette          16色以下
   * @param {Array<{indices:Uint8Array, delayMs:number}>} o.frames
   * @param {boolean} o.diff                    変化していない領域を透明で省くか
   * @param {number}  o.loop                    0 で無限ループ
   * @returns {Blob}
   */
  function encode(o) {
    const { width, height, palette, frames } = o;
    const diff = o.diff !== false && frames.length > 1;
    const loop = o.loop || 0;

    // 透明色を1つ余分に確保したうえで、2のべき乗に切り上げる。
    // カラーテーブルは全フレーム共通だが、LZW の最小符号長はフレームごとに
    // 指定できる。透明を使わないフレームはパレットぶんの符号長で済むので、
    // 16色＋透明で 32 エントリになっても、差分でないフレームは 4bit のまま書ける。
    const transparentIdx = diff ? palette.length : -1;
    let gctSize = 2;
    while (gctSize < palette.length + (diff ? 1 : 0)) gctSize *= 2;

    const codeSizeFor = (n) => { let s = 2; while ((1 << s) < n) s++; return s; };
    const fullCodeSize = codeSizeFor(palette.length);
    const diffCodeSize = codeSizeFor(palette.length + 1);

    const b = new ByteBuf();
    b.str('GIF89a');

    // Logical Screen Descriptor
    b.u16(width); b.u16(height);
    b.u8(0x80 | 0x70 | (Math.log2(gctSize) - 1)); // GCT あり / 色深度8bit / GCT サイズ
    b.u8(0);  // 背景色番号
    b.u8(0);  // ピクセル縦横比（指定なし）

    // Global Color Table
    for (let i = 0; i < gctSize; i++) {
      const c = palette[i];
      if (c) b.bytes([c.r, c.g, c.b]); else b.bytes([0, 0, 0]);
    }

    // NETSCAPE2.0（ループ指定）
    if (frames.length > 1) {
      b.u8(0x21); b.u8(0xff); b.u8(0x0b);
      b.str('NETSCAPE2.0');
      b.u8(0x03); b.u8(0x01); b.u16(loop); b.u8(0);
    }

    let prev = null;
    for (const f of frames) {
      const full = { x0: 0, y0: 0, w: width, h: height, px: f.indices,
                     codeSize: fullCodeSize, transparent: false };
      let use = full;

      if (diff && prev) {
        const d = makeDiff(f.indices, prev, width, height, transparentIdx, diffCodeSize);
        // 動きが画面いっぱいだと差分は縮まないうえ、透明色ぶん符号長が
        // 1bit 増えて逆に太る。実際に両方詰めて小さいほうを採る。
        if (d.w * d.h < width * height * 0.9) {
          const a = lzwEncode(d.codeSize, d.px);
          const c = lzwEncode(full.codeSize, full.px);
          use = a.length < c.length ? Object.assign(d, { lzw: a }) : Object.assign(full, { lzw: c });
        }
      }
      if (!use.lzw) use.lzw = lzwEncode(use.codeSize, use.px);
      prev = f.indices;

      // Graphic Control Extension（disposal=1: 前のコマを残す）
      const delayCs = Math.max(1, Math.round(f.delayMs / 10));
      b.u8(0x21); b.u8(0xf9); b.u8(0x04);
      b.u8((1 << 2) | (use.transparent ? 1 : 0));
      b.u16(delayCs);
      b.u8(use.transparent ? transparentIdx : 0);
      b.u8(0);

      // Image Descriptor
      b.u8(0x2c);
      b.u16(use.x0); b.u16(use.y0); b.u16(use.w); b.u16(use.h);
      b.u8(0); // ローカルカラーテーブルなし / インターレースなし

      b.u8(use.codeSize);
      b.subBlocks(use.lzw);
    }

    b.u8(0x3b); // Trailer
    return new Blob([b.toUint8()], { type: 'image/gif' });
  }

  return { encode };
})();
