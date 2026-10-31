// Minimal RIFF / WebP container reader and writer (SPEC 33). WebP carries our chunk as an extra
// RIFF chunk 'KNVT' at the end of the file, which needs the extended format (a VP8X chunk first).

import { usage } from './errors.js';
import { concat } from './bytes.js';

const td = new TextDecoder('latin1');
const fourcc = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export const KNVT = 'KNVT';
const META = new Set(['ICCP', 'EXIF', 'XMP ']);

export function isWebp(b) {
  return b.length >= 12 && td.decode(b.subarray(0, 4)) === 'RIFF' && td.decode(b.subarray(8, 12)) === 'WEBP';
}

// -> [{ type, data }] (data without the padding byte)
export function readRiff(bytes) {
  if (!isWebp(bytes)) throw usage('not_webp', 'Not a WebP file.');
  const end = Math.min(bytes.length, 8 + u32le(bytes, 4));
  const chunks = [];
  let pos = 12;
  while (pos + 8 <= end) {
    const type = td.decode(bytes.subarray(pos, pos + 4));
    const len = u32le(bytes, pos + 4);
    if (pos + 8 + len > bytes.length) throw usage('webp_truncated', 'The WebP file is truncated.');
    chunks.push({ type, data: bytes.subarray(pos + 8, pos + 8 + len) });
    pos += 8 + len + (len & 1);
  }
  if (!chunks.length) throw usage('webp_broken', 'Broken WebP: no chunks.');
  return chunks;
}

export function writeRiff(chunks) {
  const parts = [];
  for (const { type, data } of chunks) {
    const head = new Uint8Array(8);
    head.set(fourcc(type), 0);
    new DataView(head.buffer).setUint32(4, data.length, true);
    parts.push(head, data);
    if (data.length & 1) parts.push(new Uint8Array(1));
  }
  const body = concat(...parts);
  const head = new Uint8Array(12);
  head.set(fourcc('RIFF'), 0);
  new DataView(head.buffer).setUint32(4, body.length + 4, true);
  head.set(fourcc('WEBP'), 8);
  return concat(head, body);
}

export const isAnimated = (chunks) => chunks.some((c) => c.type === 'ANIM' || c.type === 'ANMF')
  || (chunks[0].type === 'VP8X' && chunks[0].data.length >= 1 && (chunks[0].data[0] & 0x02) !== 0);

// Does the image data use an alpha channel? (ALPH chunk, or the alpha bit of a VP8L header)
function usesAlpha(imageChunks) {
  return imageChunks.some((c) => c.type === 'ALPH' || (c.type === 'VP8L' && c.data.length >= 5 && c.data[0] === 0x2f && ((c.data[4] >> 4) & 1) === 1));
}

// Takes a WebP made by the encoder (simple or extended format) and puts it back together as an
// extended-format file: VP8X, ICCP, image data, EXIF, XMP, KNVT (SPEC 33). Colour profile and
// metadata (`extra.iccp` / `exif` / `xmp`, raw chunk data) and our chunk (`knvt`) are optional.
export function assembleWebp(encoded, { width, height, iccp, exif, xmp, knvt } = {}) {
  const image = readRiff(encoded).filter((c) => c.type !== 'VP8X' && !META.has(c.type) && c.type !== KNVT);
  const flags = (iccp ? 0x20 : 0) | (usesAlpha(image) ? 0x10 : 0) | (exif ? 0x08 : 0) | (xmp ? 0x04 : 0);
  const vp8x = new Uint8Array(10);
  vp8x[0] = flags;
  const w = width - 1, h = height - 1;
  vp8x.set([w & 255, (w >> 8) & 255, (w >> 16) & 255, h & 255, (h >> 8) & 255, (h >> 16) & 255], 4);
  const out = [{ type: 'VP8X', data: vp8x }];
  if (iccp) out.push({ type: 'ICCP', data: iccp });
  out.push(...image);
  if (exif) out.push({ type: 'EXIF', data: exif });
  if (xmp) out.push({ type: 'XMP ', data: xmp });
  if (knvt) out.push({ type: KNVT, data: knvt });
  return writeRiff(out);
}

// The colour profile and metadata chunks of a WebP: { iccp, exif, xmp } (raw data or undefined).
export function webpExtras(chunks) {
  const get = (t) => chunks.find((c) => c.type === t)?.data;
  return { iccp: get('ICCP'), exif: get('EXIF'), xmp: get('XMP ') };
}
