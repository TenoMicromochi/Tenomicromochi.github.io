// GIF の減色（メディアンカット）・LZW 圧縮・書き出し、と、テスト用の読み直し。
// DOM にも GL にも触らない純粋な関数。Web Worker（gif_worker.js）と node --test の両方から使う。

// ---- 減色：256 色のパレットを作り、各画素を番号にする（ディザなし・透明色なし） ----
// 色は 5bit x 3 = 32768 個の箱に数え、箱をメディアンカットで 256 個以下のかたまりに分ける。
// パレットはかたまりの中の実際の色の平均。単色なら元の色と完全に同じになる
export function quantize(rgba, w, h, maxColors = 256) {
  const n = w * h;
  const cnt = new Uint32Array(32768);
  const sr = new Float64Array(32768), sg = new Float64Array(32768), sb = new Float64Array(32768);
  const binOf = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    binOf[i] = k;
    cnt[k]++; sr[k] += r; sg[k] += g; sb[k] += b;
  }
  const bins = [];
  for (let k = 0; k < 32768; k++) if (cnt[k]) bins.push(k);
  const ch = (k, c) => (c === 0 ? k >> 10 : c === 1 ? (k >> 5) & 31 : k & 31);

  // かたまり = { bins: [...], pop }
  let boxes = [{ bins, pop: n }];
  const range = (box) => {
    const lo = [31, 31, 31], hi = [0, 0, 0];
    for (const k of box.bins) for (let c = 0; c < 3; c++) { const v = ch(k, c); if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; }
    return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  };
  while (boxes.length < maxColors) {
    // 分けられる（箱が2個以上）かたまりのうち、色の幅 × 画素数が一番大きいもの
    let bi = -1, bs = -1, bc = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].bins.length < 2) continue;
      const r = range(boxes[i]);
      const m = Math.max(r[0], r[1], r[2]);
      const score = m * boxes[i].pop;
      if (score > bs) { bs = score; bi = i; bc = r.indexOf(m); }
    }
    if (bi < 0) break;
    const box = boxes[bi];
    const sorted = box.bins.slice().sort((a, b) => ch(a, bc) - ch(b, bc));
    // 画素数が半分になるところで分ける（両側に最低 1 箱）
    let acc = 0, cut = 1;
    for (let i = 0; i < sorted.length - 1; i++) { acc += cnt[sorted[i]]; cut = i + 1; if (acc * 2 >= box.pop) break; }
    const a = sorted.slice(0, cut), b = sorted.slice(cut);
    const pa = a.reduce((s, k) => s + cnt[k], 0);
    boxes.splice(bi, 1, { bins: a, pop: pa }, { bins: b, pop: box.pop - pa });
  }
  const palette = new Uint8Array(256 * 3);
  const binToIdx = new Uint8Array(32768);
  boxes.forEach((box, idx) => {
    let r = 0, g = 0, b = 0, p = 0;
    for (const k of box.bins) { r += sr[k]; g += sg[k]; b += sb[k]; p += cnt[k]; binToIdx[k] = idx; }
    palette[idx * 3] = Math.round(r / p); palette[idx * 3 + 1] = Math.round(g / p); palette[idx * 3 + 2] = Math.round(b / p);
  });
  const indices = new Uint8Array(n);
  for (let i = 0; i < n; i++) indices[i] = binToIdx[binOf[i]];
  return { palette, indices };
}

// ---- LZW 圧縮（GIF 方式。最小コードサイズ 8、4096 でクリア） ----
export function lzwEncode(indices, minCode = 8) {
  const clear = 1 << minCode, eoi = clear + 1;
  const out = [];
  let cur = 0, bits = 0;
  const put = (code, size) => {
    cur |= code << bits; bits += size;
    while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; }
  };
  let size = minCode + 1, next = eoi + 1;
  let dict = new Map();
  put(clear, size);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i];
    const key = prefix * 256 + c;       // prefix は 0〜4095、c は 0〜255
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    put(prefix, size);
    if (next < 4096) {
      dict.set(key, next++);
      if (next - 1 === (1 << size) && size < 12) size++;
    } else {
      put(clear, size);
      dict = new Map(); size = minCode + 1; next = eoi + 1;
    }
    prefix = c;
  }
  put(prefix, size);
  put(eoi, size);
  if (bits > 0) out.push(cur & 255);
  return Uint8Array.from(out);
}

// ---- 書き出し：コマを1枚ずつ足していく ----
export function createGifEncoder(width, height) {
  const parts = [];
  const u16 = (v) => [v & 255, (v >> 8) & 255];
  parts.push(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...u16(width), ...u16(height), 0x00, 0, 0]));   // 全体のパレットなし
  // ループ指定（Netscape 拡張）：0 = 無限
  parts.push(Uint8Array.from([0x21, 0xff, 0x0b, ...Array.from('NETSCAPE2.0', (c) => c.charCodeAt(0)), 0x03, 0x01, 0x00, 0x00, 0x00]));
  let frames = 0;
  return {
    addFrame(rgba, delayMs) {
      const { palette, indices } = quantize(rgba, width, height);
      const cs = Math.max(0, Math.round(delayMs / 10));
      // 画像制御：処置 1（そのまま残す）、透明色なし
      parts.push(Uint8Array.from([0x21, 0xf9, 0x04, 0x04, ...u16(cs), 0x00, 0x00]));
      parts.push(Uint8Array.from([0x2c, 0, 0, 0, 0, ...u16(width), ...u16(height), 0x87]));   // ローカルパレット 256 色
      parts.push(palette);
      parts.push(Uint8Array.from([8]));
      const lzw = lzwEncode(indices, 8);
      for (let p = 0; p < lzw.length; p += 255) {
        const len = Math.min(255, lzw.length - p);
        parts.push(Uint8Array.from([len]));
        parts.push(lzw.subarray(p, p + len));
      }
      parts.push(Uint8Array.from([0]));
      frames++;
    },
    get frames() { return frames; },
    finish() {
      parts.push(Uint8Array.from([0x3b]));
      let total = 0;
      for (const p of parts) total += p.length;
      const out = new Uint8Array(total);
      let o = 0;
      for (const p of parts) { out.set(p, o); o += p.length; }
      return out;
    },
  };
}

export function encodeGif(width, height, frames) {
  const enc = createGifEncoder(width, height);
  for (const f of frames) enc.addFrame(f.rgba, f.delay);
  return enc.finish();
}

// ---- テスト用の読み直し（本物の GIF のうち、このファイルが作る形と一般的な形を読める） ----
// 戻り値 { width, height, loop, frames: [{ rgba, delay(ms) }] }。コマは重ね合わせ済みにはしない（作った形のまま）
export function decodeGif(buf) {
  let p = 6;
  const u16 = () => { const v = buf[p] | (buf[p + 1] << 8); p += 2; return v; };
  const width = u16(), height = u16();
  const flags = buf[p++]; p += 2;
  let gpal = null;
  if (flags & 0x80) { const n = 3 << ((flags & 7) + 1); gpal = buf.subarray(p, p + n); p += n; }
  const res = { width, height, loop: null, frames: [] };
  let delay = 0, transparent = -1;
  for (;;) {
    const t = buf[p++];
    if (t === 0x3b) break;
    if (t === 0x21) {
      const label = buf[p++];
      if (label === 0xf9) { const f = buf[p + 1]; delay = (buf[p + 2] | (buf[p + 3] << 8)) * 10; transparent = (f & 1) ? buf[p + 4] : -1; }
      if (label === 0xff && buf[p] === 0x0b && String.fromCharCode(...buf.subarray(p + 1, p + 12)) === 'NETSCAPE2.0') res.loop = buf[p + 14] | (buf[p + 15] << 8);
      while (buf[p]) p += buf[p] + 1;
      p++;
    } else if (t === 0x2c) {
      p += 4; const w = u16(), h = u16(); const f = buf[p++];
      let pal = gpal;
      if (f & 0x80) { const n = 3 << ((f & 7) + 1); pal = buf.subarray(p, p + n); p += n; }
      const minCode = buf[p++];
      const data = [];
      while (buf[p]) { for (let i = 1; i <= buf[p]; i++) data.push(buf[p + i]); p += buf[p] + 1; }
      p++;
      const idx = lzwDecode(data, minCode, w * h);
      const rgba = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        const c = idx[i];
        rgba[i * 4] = pal[c * 3]; rgba[i * 4 + 1] = pal[c * 3 + 1]; rgba[i * 4 + 2] = pal[c * 3 + 2];
        rgba[i * 4 + 3] = c === transparent ? 0 : 255;
      }
      res.frames.push({ rgba, delay, w, h });
      delay = 0; transparent = -1;
    } else throw new Error('bad gif block ' + t);
  }
  return res;
}

function lzwDecode(data, minCode, count) {
  const clear = 1 << minCode, eoi = clear + 1;
  const out = new Uint8Array(count);
  let o = 0, bitPos = 0;
  let size = minCode + 1, next = eoi + 1;
  let prefix = new Int32Array(4096), suffix = new Uint8Array(4096), lenA = new Int32Array(4096);
  for (let i = 0; i < clear; i++) { suffix[i] = i; lenA[i] = 1; prefix[i] = -1; }
  let prev = -1;
  const emit = (code) => {
    const len = lenA[code];
    let c = code;
    for (let i = len - 1; i >= 0; i--) { if (o + i < count) out[o + i] = suffix[c]; c = prefix[c]; }
    o += len;
  };
  const first = (code) => { let c = code; while (prefix[c] >= 0) c = prefix[c]; return suffix[c]; };
  while (o < count) {
    let code = 0;
    for (let i = 0; i < size; i++) { const b = (data[(bitPos + i) >> 3] >> ((bitPos + i) & 7)) & 1; code |= b << i; }
    bitPos += size;
    if (code === clear) { size = minCode + 1; next = eoi + 1; prev = -1; continue; }
    if (code === eoi) break;
    if (prev < 0) { emit(code); prev = code; continue; }
    if (code < next) {
      emit(code);
      if (next < 4096) { prefix[next] = prev; suffix[next] = first(code); lenA[next] = lenA[prev] + 1; next++; }
    } else {
      if (next < 4096) { prefix[next] = prev; suffix[next] = first(prev); lenA[next] = lenA[prev] + 1; next++; }
      emit(next - 1);
    }
    prev = code;
    if (next === (1 << size) && size < 12) size++;
  }
  return out;
}
