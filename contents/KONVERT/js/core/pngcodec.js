// PNG decode / encode on raw RGBA8 buffers (SPEC 2.1, 3). Replaces pngjs + imageio.js.
// Nothing here goes through a canvas: the stored sample values are used as they are, without
// colour management. 16-bit samples are scaled to 8 bit the way pngjs does it.

import { readChunks, writeChunks, isPng, ANIMATION_CHUNKS } from './pngchunks.js';
import { inflate, deflate, concat } from './bytes.js';
import { usage } from './errors.js';
import { isJpeg, decodeJpeg } from './jpegcodec.js';
import { isWebp } from './riff.js';
import { decodeWebp } from './webpcodec.js';

const MAX_PIXELS = 100_000_000; // 100 MP: far above any screenshot, well below memory limits

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
// Adam7: [x0, y0, dx, dy]
const PASSES = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

const hasTransparency = (rgba) => {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return true;
  return false;
};

function checkSize(width, height) {
  if (!(width > 0 && height > 0) || width * height > MAX_PIXELS) {
    throw usage('image_too_large', `Image size ${width}x${height} is not supported (max ${MAX_PIXELS / 1e6} MP).`);
  }
}

// -> { width, height, rgba, hasAlpha, format, chunks, warnings }
export async function decodeImage(bytes) {
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (isPng(bytes)) return decodePng(bytes);
  if (isJpeg(bytes)) return decodeJpeg(bytes);
  if (isWebp(bytes)) return decodeWebp(bytes);
  throw usage('unsupported_format', 'Unsupported image format (PNG, JPEG or WebP only).');
}

async function decodePng(bytes) {
  const chunks = readChunks(bytes);
  const ihdr = chunks[0];
  if (ihdr?.type !== 'IHDR' || ihdr.data.length !== 13) throw usage('png_broken', 'Broken PNG: missing IHDR.');
  const dv = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, 13);
  const width = dv.getUint32(0), height = dv.getUint32(4);
  checkSize(width, height);
  const damaged = chunks.find((c) => !c.crcOk && c.type !== 'knVt');
  if (damaged) throw usage('png_crc', `Broken PNG: bad CRC in ${damaged.type} chunk.`);

  let rgba;
  try {
    rgba = await decodePixels(chunks, { width, height, depth: ihdr.data[8], colorType: ihdr.data[9], compression: ihdr.data[10], filter: ihdr.data[11], interlace: ihdr.data[12] });
  } catch (e) {
    if (e.name === 'SpoilerError') throw e;
    throw usage('png_broken', `Cannot decode PNG: ${e.message}`);
  }
  const warnings = [];
  if (chunks.some((c) => ANIMATION_CHUNKS.has(c.type))) warnings.push('Animated PNG: only the default image is used.');
  return { width, height, rgba, hasAlpha: hasTransparency(rgba), format: 'png', chunks, warnings };
}

function passGeometry({ width, height, interlace }) {
  if (!interlace) return [{ w: width, h: height, x0: 0, y0: 0, dx: 1, dy: 1 }];
  return PASSES.map(([x0, y0, dx, dy]) => ({
    w: width > x0 ? Math.ceil((width - x0) / dx) : 0,
    h: height > y0 ? Math.ceil((height - y0) / dy) : 0,
    x0, y0, dx, dy,
  })).filter((p) => p.w > 0 && p.h > 0);
}

async function decodePixels(chunks, hdr) {
  const { width, height, depth, colorType, interlace } = hdr;
  if (!DEPTHS[colorType]?.includes(depth)) throw new Error(`unsupported colour type ${colorType} / bit depth ${depth}`);
  if (hdr.compression !== 0 || hdr.filter !== 0) throw new Error('unknown compression or filter method');
  if (interlace !== 0 && interlace !== 1) throw new Error('unknown interlace method');
  const channels = CHANNELS[colorType];
  const bitsPerPixel = channels * depth;
  const bpb = Math.max(1, bitsPerPixel >> 3); // bytes per pixel for the filters

  // Palette and simple transparency (colour types 0 and 2 keep one transparent colour).
  let palette = null, alphaTable = null, transColor = null;
  for (const c of chunks) {
    if (c.type === 'PLTE' && !palette) {
      palette = c.data;
    } else if (c.type === 'tRNS') {
      if (colorType === 3) alphaTable = c.data;
      else if (colorType === 0 && c.data.length >= 2) transColor = [(c.data[0] << 8) | c.data[1]];
      else if (colorType === 2 && c.data.length >= 6) transColor = [(c.data[0] << 8) | c.data[1], (c.data[2] << 8) | c.data[3], (c.data[4] << 8) | c.data[5]];
    }
  }
  if (colorType === 3) {
    if (!palette) throw new Error('Expected palette not found');
    if (alphaTable && alphaTable.length > palette.length / 3) throw new Error('More transparent colors than palette size');
  }

  const passes = passGeometry(hdr);
  let expected = 0;
  for (const p of passes) expected += p.h * (1 + Math.ceil((p.w * bitsPerPixel) / 8));
  const idat = concat(...chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = await inflate(idat, expected);
  if (raw.length < expected) throw new Error('Ran out of data');

  const rgba = new Uint8Array(width * height * 4);
  const max = (1 << depth) - 1; // for depth 16 this is 65535
  const scale = depth !== 8 && colorType !== 3;
  const s = [0, 0, 0, 0];
  let pos = 0;
  for (const p of passes) {
    const rowBytes = Math.ceil((p.w * bitsPerPixel) / 8);
    unfilter(raw, pos, p.h, rowBytes, bpb);
    for (let y = 0; y < p.h; y++) {
      const row = pos + y * (rowBytes + 1) + 1;
      const oy = p.y0 + y * p.dy;
      for (let x = 0; x < p.w; x++) {
        const o = (oy * width + p.x0 + x * p.dx) * 4;
        for (let ch = 0; ch < channels; ch++) s[ch] = sample(raw, row, x * channels + ch, depth);
        let r, g, b, a;
        if (colorType === 3) {
          if (s[0] * 3 >= palette.length) throw new Error(`index ${s[0]} not in palette`);
          r = palette[s[0] * 3]; g = palette[s[0] * 3 + 1]; b = palette[s[0] * 3 + 2];
          a = alphaTable && s[0] < alphaTable.length ? alphaTable[s[0]] : 255;
        } else {
          if (colorType === 0 || colorType === 4) { r = g = b = s[0]; a = colorType === 4 ? s[1] : max; }
          else { r = s[0]; g = s[1]; b = s[2]; a = colorType === 6 ? s[3] : max; }
          if (transColor && (colorType === 0 ? transColor[0] === r : transColor[0] === r && transColor[1] === g && transColor[2] === b)) {
            r = g = b = a = 0;
          } else if (scale) {
            r = Math.floor((r * 255) / max + 0.5); g = Math.floor((g * 255) / max + 0.5);
            b = Math.floor((b * 255) / max + 0.5); a = Math.floor((a * 255) / max + 0.5);
          }
        }
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
      }
    }
    pos += p.h * (rowBytes + 1);
  }
  return rgba;
}

// The i-th sample of a scanline that starts at `row`.
function sample(raw, row, i, depth) {
  if (depth === 8) return raw[row + i];
  if (depth === 16) return (raw[row + 2 * i] << 8) | raw[row + 2 * i + 1];
  const bit = i * depth;
  return (raw[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
}

// Undoes the five PNG filters in place. Each row is [filter type, ...rowBytes].
function unfilter(raw, start, rows, rowBytes, bpb) {
  for (let y = 0; y < rows; y++) {
    const at = start + y * (rowBytes + 1);
    const type = raw[at];
    const cur = at + 1;
    const up = y > 0 ? cur - (rowBytes + 1) : -1;
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bpb ? raw[cur + i - bpb] : 0;
      const b = up >= 0 ? raw[up + i] : 0;
      const c = up >= 0 && i >= bpb ? raw[up + i - bpb] : 0;
      let add;
      if (type === 0) add = 0;
      else if (type === 1) add = a;
      else if (type === 2) add = b;
      else if (type === 3) add = (a + b) >> 1;
      else if (type === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else throw new Error(`unrecognised filter type ${type}`);
      raw[cur + i] = (raw[cur + i] + add) & 0xff;
    }
  }
}

// Picks, row by row, the filter with the smallest sum of absolute values.
function filterRows(rgba, width, height, bpp) {
  const rowBytes = width * bpp;
  const out = new Uint8Array(height * (rowBytes + 1));
  const rows = [0, 1, 2, 3, 4].map(() => new Uint8Array(rowBytes));
  const cur = new Uint8Array(rowBytes), prev = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) for (let k = 0; k < bpp; k++) cur[x * bpp + k] = rgba[(y * width + x) * 4 + k];
    let best = 0, bestSum = Infinity;
    for (let t = 0; t < 5; t++) {
      const f = rows[t];
      let sum = 0;
      for (let i = 0; i < rowBytes; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        let pred;
        if (t === 0) pred = 0;
        else if (t === 1) pred = a;
        else if (t === 2) pred = b;
        else if (t === 3) pred = (a + b) >> 1;
        else {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const v = (cur[i] - pred) & 0xff;
        f[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = t; }
    }
    out[y * (rowBytes + 1)] = best;
    out.set(rows[best], y * (rowBytes + 1) + 1);
    prev.set(cur);
  }
  return out;
}

// RGBA8 -> 8-bit RGB (colour type 2) or RGBA (6), non-interlaced, with extra chunks:
// `before` goes between IHDR and IDAT, `tail` right before IEND (the order of pngchunks assemble).
export async function encodePng({ width, height, rgba, hasAlpha }, { before = [], tail = [] } = {}) {
  const head = new Uint8Array(13);
  const dv = new DataView(head.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height);
  head[8] = 8; head[9] = hasAlpha ? 6 : 2;
  const data = await deflate(filterRows(rgba, width, height, hasAlpha ? 4 : 3));
  return writeChunks([
    { type: 'IHDR', data: head },
    ...before,
    { type: 'IDAT', data },
    ...tail,
    { type: 'IEND', data: new Uint8Array(0) },
  ]);
}
