// Minimal PNG chunk reader / writer (SPEC 6, 7.3). Pixels are left to pngjs; this module
// only lists chunks, checks CRCs and puts files back together in a controlled order.

import { usage } from './errors.js';

export const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const CHUNK_TYPE = 'knVt'; // ancillary, private, reserved, safe to copy

// Chunks copied from the source to the output and from a spoiler file to its restoration.
export const COLOR_CHUNKS = new Set(['sRGB', 'gAMA', 'cHRM', 'iCCP', 'cICP', 'pHYs']);
export const META_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
export const ANIMATION_CHUNKS = new Set(['acTL', 'fcTL', 'fdAT']);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(...parts) {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function isPng(bytes) {
  return bytes.length >= 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

const typeBytes = (type) => Uint8Array.from(type, (ch) => ch.charCodeAt(0));

// -> [{ type, data, crcOk }]. Stops at IEND. A broken CRC is reported, not thrown, so the
// caller can tell a damaged knVt (verification failure) from a damaged image (usage error).
export function readChunks(bytes) {
  if (!isPng(bytes)) throw usage('not_png', 'Not a PNG file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const len = view.getUint32(pos);
    if (pos + 12 + len > bytes.length) throw usage('png_truncated', 'The PNG file is truncated.');
    const typeRaw = bytes.subarray(pos + 4, pos + 8);
    const type = String.fromCharCode(...typeRaw);
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    const crcOk = view.getUint32(pos + 8 + len) === crc32(typeRaw, data);
    chunks.push({ type, data, crcOk });
    pos += 12 + len;
    if (type === 'IEND') return chunks;
  }
  throw usage('png_truncated', 'The PNG file has no IEND chunk.');
}

export function writeChunks(chunks) {
  let size = 8;
  for (const c of chunks) size += 12 + c.data.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(SIGNATURE, 0);
  let pos = 8;
  for (const { type, data } of chunks) {
    const t = typeBytes(type);
    view.setUint32(pos, data.length);
    out.set(t, pos + 4);
    out.set(data, pos + 8);
    view.setUint32(pos + 8 + data.length, crc32(t, data));
    pos += 12 + data.length;
  }
  return out;
}

// Rebuilds a freshly encoded PNG (IHDR, IDAT…, IEND) with extra chunks:
// `before` goes between IHDR and the first IDAT, `tail` right before IEND.
export function assemble(encoded, { before = [], tail = [] } = {}) {
  const own = readChunks(encoded);
  const ihdr = own.filter((c) => c.type === 'IHDR');
  const idat = own.filter((c) => c.type === 'IDAT');
  return writeChunks([...ihdr, ...before, ...idat, ...tail, { type: 'IEND', data: new Uint8Array(0) }]);
}

// The chunks to carry over from `chunks` (SPEC 7.3). Order among them is kept.
export function carriedChunks(chunks, { keepMetadata = false } = {}) {
  const idatAt = chunks.findIndex((c) => c.type === 'IDAT');
  return chunks.filter((c, i) => {
    if (!c.crcOk) return false;
    if (COLOR_CHUNKS.has(c.type)) return i < idatAt; // colour info is only valid before IDAT
    return keepMetadata && META_CHUNKS.has(c.type);
  });
}
