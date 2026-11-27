// APNG の組み立て（純粋な関数。画面にも Worker にも node のテストにも使う）
// 色は RGB 8bit（カラータイプ 2）。行ごとのフィルタは、差の絶対値の合計が一番小さいものを選ぶ

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable = null;
export function crc32(bytes, crc = 0) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
  }
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

// RGBA（alpha は捨てる）を、行頭にフィルタ番号を付けた RGB の行に並べる。戻り：h × (1 + 3w) バイト
export function filterImage(rgba, w, h) {
  const L = w * 3;
  const out = new Uint8Array(h * (L + 1));
  let prev = new Uint8Array(L), cur = new Uint8Array(L);
  const cand = [0, 1, 2, 3, 4].map(() => new Uint8Array(L));
  for (let y = 0; y < h; y++) {
    let o = y * w * 4;
    for (let i = 0; i < L; i += 3, o += 4) { cur[i] = rgba[o]; cur[i + 1] = rgba[o + 1]; cur[i + 2] = rgba[o + 2]; }
    const s = [0, 0, 0, 0, 0];
    const [c0, c1, c2, c3, c4] = cand;
    for (let i = 0; i < L; i++) {
      const x = cur[i];
      const a = i >= 3 ? cur[i - 3] : 0;
      const b = prev[i];
      const c = i >= 3 ? prev[i - 3] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      const v0 = x, v1 = (x - a) & 255, v2 = (x - b) & 255, v3 = (x - ((a + b) >> 1)) & 255, v4 = (x - pr) & 255;
      c0[i] = v0; c1[i] = v1; c2[i] = v2; c3[i] = v3; c4[i] = v4;
      s[0] += v0 < 128 ? v0 : 256 - v0;
      s[1] += v1 < 128 ? v1 : 256 - v1;
      s[2] += v2 < 128 ? v2 : 256 - v2;
      s[3] += v3 < 128 ? v3 : 256 - v3;
      s[4] += v4 < 128 ? v4 : 256 - v4;
    }
    let best = 0;
    for (let t = 1; t < 5; t++) if (s[t] < s[best]) best = t;
    out[y * (L + 1)] = best;
    out.set(cand[best], y * (L + 1) + 1);
    const t = prev; prev = cur; cur = t;
  }
  return out;
}

// filterImage の逆。戻り：RGB（h × 3w バイト）。テスト用
export function unfilterImage(filtered, w, h) {
  const L = w * 3;
  const out = new Uint8Array(h * L);
  for (let y = 0; y < h; y++) {
    const t = filtered[y * (L + 1)];
    for (let i = 0; i < L; i++) {
      const f = filtered[y * (L + 1) + 1 + i];
      const a = i >= 3 ? out[y * L + i - 3] : 0;
      const b = y > 0 ? out[(y - 1) * L + i] : 0;
      const c = (i >= 3 && y > 0) ? out[(y - 1) * L + i - 3] : 0;
      let add = 0;
      if (t === 1) add = a;
      else if (t === 2) add = b;
      else if (t === 3) add = (a + b) >> 1;
      else if (t === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        add = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      out[y * L + i] = (f + add) & 255;
    }
  }
  return out;
}

// zlib 形式の圧縮（CompressionStream）
export async function deflateZlib(bytes) {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  const writing = (async () => { await writer.write(bytes); await writer.close(); })();
  const buf = await new Response(cs.readable).arrayBuffer();
  await writing;
  return new Uint8Array(buf);
}

function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
const PART = 8 << 20;   // IDAT / fdAT の1つの大きさの上限

// frames：zlib 形式に圧縮済みの各コマ（filterImage の出力を deflateZlib したもの）
// delays：各コマの待ち時間（ms）。戻り：ファイルの並び（Uint8Array の配列。Blob にそのまま渡せる）
export function assembleApng(w, h, frames, delays) {
  const parts = [new Uint8Array(SIG)];
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 2;          // 8bit、RGB
  parts.push(chunk('IHDR', ihdr));
  const actl = new Uint8Array(8);
  new DataView(actl.buffer).setUint32(0, frames.length);   // num_plays = 0（無限）
  parts.push(chunk('acTL', actl));
  let seq = 0;
  frames.forEach((z, k) => {
    const fc = new Uint8Array(26);
    const f = new DataView(fc.buffer);
    f.setUint32(0, seq++); f.setUint32(4, w); f.setUint32(8, h);   // x, y = 0
    f.setUint16(20, Math.min(65535, Math.max(0, Math.round(delays[k]))));   // delay_num（ms）
    f.setUint16(22, 1000);                                                 // delay_den
    fc[24] = 0; fc[25] = 0;          // dispose_op NONE、blend_op SOURCE
    parts.push(chunk('fcTL', fc));
    for (let p = 0; p < z.length || p === 0; p += PART) {
      const piece = z.subarray(p, Math.min(z.length, p + PART));
      if (k === 0) parts.push(chunk('IDAT', piece));
      else {
        const d = new Uint8Array(4 + piece.length);
        d.set(u32(seq++), 0); d.set(piece, 4);
        parts.push(chunk('fdAT', d));
      }
    }
  });
  parts.push(chunk('IEND', new Uint8Array(0)));
  return parts;
}
