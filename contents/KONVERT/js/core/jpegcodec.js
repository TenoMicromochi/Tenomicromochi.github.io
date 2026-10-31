// JPEG input (SPEC 18): jpeg-js decodes to RGBA, then the EXIF Orientation is applied so the
// pixels are stored the way viewers show them. ICC is not carried over.

import jpegDecode from '../vendor/jpeg-js/decoder.js';
import { usage } from './errors.js';

const MAX_PIXELS = 100_000_000;

export const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export function decodeJpeg(bytes) {
  let img;
  try {
    img = jpegDecode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_PIXELS / 1e6, maxMemoryUsageInMB: 2048 });
  } catch (e) {
    throw usage('jpeg_broken', `Cannot decode JPEG: ${e.message ?? e}`);
  }
  if (!(img.width > 0 && img.height > 0) || img.width * img.height > MAX_PIXELS) {
    throw usage('image_too_large', `Image size ${img.width}x${img.height} is not supported (max ${MAX_PIXELS / 1e6} MP).`);
  }
  const orientation = exifOrientation(bytes);
  const oriented = orient({ width: img.width, height: img.height, rgba: new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength) }, orientation);
  return { ...oriented, hasAlpha: false, format: 'jpeg', chunks: null, warnings: [], orientation };
}

// EXIF Orientation (tag 0x0112 in IFD0) from the first APP1 "Exif" segment; 1 if absent.
export function exifOrientation(b) {
  let p = 2;
  while (p + 4 <= b.length && b[p] === 0xff) {
    const marker = b[p + 1];
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    const len = (b[p + 2] << 8) | b[p + 3];
    if (marker === 0xe1 && len >= 16 && String.fromCharCode(...b.subarray(p + 4, p + 10)) === 'Exif\0\0') {
      const t = p + 10;
      const le = b[t] === 0x49; // "II" little endian, "MM" big endian
      const u16 = (o) => (le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1]);
      const u32 = (o) => (le ? (u16(o) | (u16(o + 2) << 16)) >>> 0 : ((u16(o) << 16) | u16(o + 2)) >>> 0);
      const end = p + 2 + len;
      const ifd = u32(4);
      if (t + ifd + 2 > end) return 1;
      const n = u16(ifd);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (t + e + 12 > end) return 1;
        if (u16(e) === 0x0112) {
          const v = u16(e + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    p += 2 + len;
  }
  return 1;
}

// Applies an EXIF orientation so the pixels are stored the way viewers display them.
export function orient(img, orientation) {
  if (orientation === 1) return img;
  const { width: w, height: h, rgba } = img;
  const swap = orientation >= 5;
  const ow = swap ? h : w;
  const oh = swap ? w : h;
  const out = new Uint8Array(ow * oh * 4);
  const src = {
    2: (x, y) => [w - 1 - x, y],
    3: (x, y) => [w - 1 - x, h - 1 - y],
    4: (x, y) => [x, h - 1 - y],
    5: (x, y) => [y, x],
    6: (x, y) => [y, h - 1 - x],
    7: (x, y) => [w - 1 - y, h - 1 - x],
    8: (x, y) => [w - 1 - y, x],
  }[orientation];
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const [sx, sy] = src(x, y);
      const s = (sy * w + sx) * 4;
      const d = (y * ow + x) * 4;
      out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
    }
  }
  return { width: ow, height: oh, rgba: out };
}
