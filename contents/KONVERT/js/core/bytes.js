// Small byte helpers. deflate / inflate use the zlib format (CompressionStream 'deflate'),
// which is what spoiler-png writes and reads.

import { usage } from './errors.js';

export function concat(...parts) {
  let size = 0;
  for (const p of parts) size += p.length;
  const out = new Uint8Array(size);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export const fromHex = (hex) => Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));

// Pushes `bytes` through a (De)CompressionStream. `limit` caps the output size.
async function pipe(bytes, stream, limit = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw usage('inflate_limit', 'The data is larger than allowed.');
    }
    parts.push(value);
  }
  return concat(...parts);
}

export const deflate = (bytes) => pipe(bytes, new CompressionStream('deflate'));

// Throws on corrupt input or when the output would exceed `limit`.
export const inflate = (bytes, limit) => pipe(bytes, new DecompressionStream('deflate'), limit);
