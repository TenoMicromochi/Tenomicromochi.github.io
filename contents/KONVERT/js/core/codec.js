// The processing flows (file format v2, SPEC 34): encode, decode and inspect.
// Everything works on raw RGBA8. The spoiler is hidden in the visible image; the original pixels
// of the hidden part (and of a margin around it, for lossy WebP) go, encrypted, into a private
// chunk ('knVt' in PNG, 'KNVT' in WebP). Pixels outside the hidden part are never touched.

import { decodeImage, encodePng } from './pngcodec.js';
import { encodeWebp, WEBP_MAX } from './webpcodec.js';
import { assembleWebp, webpExtras, KNVT } from './riff.js';
import { CHUNK_TYPE, carriedChunks, COLOR_CHUNKS, META_CHUNKS } from './pngchunks.js';
import { bbox, crop, countMask, dilate } from './mask.js';
import { normalizeRender, renderSpoiler } from './render.js';
import { KEY_MODE, deriveKey, seal, open, random } from './crypto.js';
import { buildHeader, parseChunkData, buildPlaintext, parsePlaintext, hintBytes } from './payload.js';
import { concat } from './bytes.js';
import { SpoilerError, EXIT, usage, verify } from './errors.js';

export const FORMATS = {
  png: { ext: 'png', mime: 'image/png' },
  'webp-lossless': { ext: 'webp', mime: 'image/webp' },
  'webp-lossy': { ext: 'webp', mime: 'image/webp' },
};
export const MARGIN = 16; // lossy WebP: extra ring of original pixels around the hidden part

export { decodeImage as loadImage };

function checkMask(image, mask) {
  if (!(mask instanceof Uint8Array) || mask.length !== image.width * image.height) {
    throw usage('mask_size', 'The mask does not match the image size.');
  }
  const box = bbox(mask, image.width, image.height);
  if (!box) throw usage('empty_mask', 'The mask is empty: mark the part to hide first.');
  return box;
}

// What the hidden image will look like, for the GUI preview.
export async function preview(image, mask, renderOpts) {
  const box = checkMask(image, mask);
  const { render, warnings } = normalizeRender(renderOpts);
  return { rgba: renderSpoiler(image.rgba, image.width, image.height, mask, box, render), warnings };
}

// opts: { render, hint, passphrase, format: 'png'|'webp-lossless'|'webp-lossy', quality (1-100),
// keepMetadata, secretHex } -> { bytes, warnings, info }
export async function encode(image, mask, opts = {}) {
  const { width, height, rgba: src, hasAlpha } = image;
  const box0 = checkMask(image, mask);
  const { render, warnings } = normalizeRender(opts.render);
  const hint = opts.hint ?? '';
  hintBytes(hint);
  const format = opts.format ?? 'png';
  if (!FORMATS[format]) throw usage('bad_format', `Bad format "${format}".`);
  if (format !== 'png' && (width > WEBP_MAX || height > WEBP_MAX)) {
    throw usage('webp_too_large', `WebP supports up to ${WEBP_MAX} x ${WEBP_MAX} pixels.`);
  }
  const lossy = format === 'webp-lossy';
  const quality = Math.min(100, Math.max(1, Math.round(opts.quality ?? 80)));
  const keyMode = opts.passphrase ? KEY_MODE.PASS : KEY_MODE.APP;
  const keep = !!opts.keepMetadata;

  // 2. Hide. renderSpoiler only changes pixels inside the mask.
  const out = renderSpoiler(src, width, height, mask, box0, render);

  // 3. Stored mask: 1 = hidden, 2 = margin (lossy WebP only), 0 = the rest.
  const margin = lossy ? MARGIN : 0;
  const ring = margin ? dilate(mask, width, height, margin) : null;
  const stored = new Uint8Array(width * height);
  for (let i = 0; i < stored.length; i++) stored[i] = mask[i] ? 1 : ring && ring[i] ? 2 : 0;
  const box = bbox(stored, width, height);
  const [bx, by, bw, bh] = box;
  const maskBytes = crop(stored, width, box);
  const patch = new Uint8Array(bw * bh * 4);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = (by + y) * width + bx + x;
      if (stored[i]) patch.set(src.subarray(i * 4, i * 4 + 4), (y * bw + x) * 4);
    }
  }

  // 4. Chunk data.
  const kdfSalt = random(16);
  const nonce = random(12);
  const key = deriveKey({ keyMode, kdfSalt, passphrase: opts.passphrase, secretHex: opts.secretHex });
  const meta = { size: [width, height], bbox: box, margin, render, has_alpha: hasAlpha, format };
  const header = buildHeader({ keyMode, kdfSalt, nonce, hint });
  const sealed = seal(key, nonce, header, await buildPlaintext(meta, maskBytes, patch));
  const chunkData = concat(header, sealed);

  // 5. Write the chosen format.
  let bytes;
  let lost = false; // colour profile / metadata that could not be carried over
  if (format === 'png') {
    const carried = image.format === 'png' ? carriedChunks(image.chunks, { keepMetadata: keep }) : [];
    bytes = await encodePng({ width, height, rgba: out, hasAlpha }, { before: carried, tail: [{ type: CHUNK_TYPE, data: chunkData }] });
    if (image.format === 'webp') {
      const e = webpExtras(image.riff);
      lost = !!(e.iccp || (keep && (e.exif || e.xmp)));
    }
  } else {
    const enc = await encodeWebp({ width, height, rgba: out }, { lossless: !lossy, quality });
    const e = image.format === 'webp' ? webpExtras(image.riff) : {};
    bytes = assembleWebp(enc, { width, height, iccp: e.iccp, exif: keep ? e.exif : undefined, xmp: keep ? e.xmp : undefined, knvt: chunkData });
    if (image.format === 'png') lost = image.chunks.some((c) => COLOR_CHUNKS.has(c.type) || (keep && META_CHUNKS.has(c.type)));
  }
  if (lost) warnings.push('Color profile and metadata were not carried over.');

  // 6. Self-check before anything is saved: read the file back and restore it.
  const back = await decode(bytes, { passphrase: opts.passphrase, secretHex: opts.secretHex });
  if (back.width !== width || back.height !== height) {
    throw new SpoilerError(EXIT.VERIFY, 'selfcheck', 'Self-check failed (size); nothing was saved.');
  }
  const n = width * height;
  for (let i = 0; i < n; i++) {
    if (!stored[i] && lossy) continue; // lossy: only the hidden part and its margin must come back exactly
    const o = i * 4;
    if (back.rgba[o] !== src[o] || back.rgba[o + 1] !== src[o + 1] || back.rgba[o + 2] !== src[o + 2] || back.rgba[o + 3] !== src[o + 3]) {
      throw new SpoilerError(EXIT.VERIFY, 'selfcheck', `Self-check failed at pixel ${i % width},${Math.floor(i / width)}; nothing was saved.`);
    }
  }
  return {
    bytes,
    warnings,
    info: { width, height, bbox: box, spoilerPixels: countMask(mask), keyMode, render, format, dataBytes: chunkData.length, fileBytes: bytes.length },
  };
}

// The restore chunks of a decoded image: [{ data, crcOk }]
function findChunks(image) {
  if (image.format === 'png') return image.chunks.filter((c) => c.type === CHUNK_TYPE);
  if (image.format === 'webp') return image.riff.filter((c) => c.type === KNVT).map((c) => ({ data: c.data, crcOk: true }));
  return [];
}

// Reads the header without decrypting. Never throws for a readable image.
export async function inspect(bytes) {
  return inspectImage(await decodeImage(bytes));
}

export function inspectImage(image) {
  const found = findChunks(image);
  const res = {
    format: image.format, width: image.width, height: image.height, hasAlpha: image.hasAlpha,
    chunks: found.length, chunk: null, chunkError: null, dataBytes: found.length === 1 ? found[0].data.length : null,
  };
  if (found.length === 1) {
    try {
      if (!found[0].crcOk) throw verify('chunk_crc', 'The restore data is damaged (bad CRC).');
      const c = parseChunkData(found[0].data);
      res.chunk = { version: c.version, keyMode: c.keyMode, hint: c.hint, ciphertextBytes: c.ciphertext.length };
    } catch (e) {
      res.chunkError = e.message;
    }
  } else if (found.length > 1) {
    res.chunkError = `The file has ${found.length} restore data chunks (expected 1).`;
  }
  res.verdict = found.length === 0 ? 'not' : res.chunkError ? 'broken' : 'processed';
  return res;
}

const mismatch = () => verify('meta_mismatch', 'The restore data does not match this image.');

// opts: { passphrase, secretHex }
// -> { width, height, rgba, hasAlpha, meta, hint, keyMode, lossless, source }
export async function decode(bytes, opts = {}) {
  const image = await decodeImage(bytes);
  const { width, height } = image;
  const found = findChunks(image);

  if (found.length === 0) throw new SpoilerError(EXIT.NOT_PROCESSED, 'not_processed', 'This is not a spoiler image.');
  if (found.length > 1) throw verify('chunk_many', `The file has ${found.length} restore data chunks (expected 1).`);
  if (!found[0].crcOk) throw verify('chunk_crc', 'The restore data is damaged (bad CRC).');

  const c = parseChunkData(found[0].data);
  if (c.keyMode === KEY_MODE.PASS && !opts.passphrase) {
    throw usage('need_passphrase', 'This image is locked with a passphrase.', { hint: c.hint });
  }
  const key = deriveKey({ keyMode: c.keyMode, kdfSalt: c.kdfSalt, passphrase: opts.passphrase, secretHex: opts.secretHex });
  const plain = open(key, c.nonce, c.aad, c.ciphertext);
  if (!plain) {
    throw verify('auth_failed', c.keyMode === KEY_MODE.PASS
      ? 'Wrong passphrase, or the image has been changed.'
      : 'The image or its restore data has been changed.', { hint: c.hint });
  }

  const { meta, body } = await parsePlaintext(plain, (1 << 20) + width * height * 5);
  const box = meta.bbox;
  const okBox = Array.isArray(box) && box.length === 4 && box.every(Number.isInteger)
    && box[0] >= 0 && box[1] >= 0 && box[2] > 0 && box[3] > 0 && box[0] + box[2] <= width && box[1] + box[3] <= height;
  if (!Array.isArray(meta.size) || meta.size[0] !== width || meta.size[1] !== height || !okBox) throw mismatch();
  const [bx, by, bw, bh] = box;
  if (body.length !== bw * bh * 5) throw mismatch();
  const maskBytes = body.subarray(0, bw * bh);
  const patch = body.subarray(bw * bh);

  // Put the original pixels back (hidden part and margin); everything else stays as it was read.
  const out = new Uint8Array(image.rgba);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const m = maskBytes[y * bw + x];
      if (m !== 1 && m !== 2) continue;
      const o = ((by + y) * width + bx + x) * 4;
      out.set(patch.subarray((y * bw + x) * 4, (y * bw + x) * 4 + 4), o);
    }
  }
  return { width, height, rgba: out, hasAlpha: !!meta.has_alpha, meta, hint: c.hint, keyMode: c.keyMode, lossless: meta.format !== 'webp-lossy', source: image };
}

// The restored image in the chosen format (DECODE's SAVE). Colour profile and metadata are
// carried over only between files of the same kind (PNG -> PNG, WebP -> WebP).
export async function encodeRestored(result, { format = 'png', quality = 80 } = {}) {
  if (!FORMATS[format]) throw usage('bad_format', `Bad format "${format}".`);
  const { width, height, rgba, hasAlpha, source } = result;
  if (format === 'png') {
    const before = source.format === 'png' ? carriedChunks(source.chunks, { keepMetadata: true }) : [];
    return encodePng({ width, height, rgba, hasAlpha }, { before });
  }
  const enc = await encodeWebp({ width, height, rgba }, { lossless: format === 'webp-lossless', quality: Math.min(100, Math.max(1, Math.round(quality))) });
  const e = source.format === 'webp' ? webpExtras(source.riff) : {};
  return assembleWebp(enc, { width, height, iccp: e.iccp, exif: e.exif, xmp: e.xmp });
}
