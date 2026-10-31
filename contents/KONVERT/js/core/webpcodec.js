// WebP decode / encode on raw RGBA8 (SPEC 32). libwebp compiled to wasm by jSquash
// (@jsquash/webp 1.5.0, js/vendor/jsquash-webp, unchanged). Nothing goes through a canvas.
//
// jSquash's own decode.js / encode.js are not imported: encode.js has a bare import
// ('wasm-feature-detect') that a module Worker cannot resolve without a bundler, so this file
// does the same few steps (pick the SIMD build, start the module, call decode / encode) with
// the vendored codec files and utils.js as they are.

import webpDec from '../vendor/jsquash-webp/codec/dec/webp_dec.js';
import { initEmscriptenModule } from '../vendor/jsquash-webp/utils.js';
import { defaultOptions } from '../vendor/jsquash-webp/meta.js';
import { simd } from '../vendor/wasm-feature-detect/dist/esm/index.js';
import { readRiff, isAnimated } from './riff.js';
import { usage } from './errors.js';

export const WEBP_MAX = 16383;
const MAX_PIXELS = 100_000_000;

// Tests (Node) pass compiled wasm: { dec, enc, encSimd } (WebAssembly.Module). In the browser
// nothing is needed: the codec fetches its .wasm next to its .js file.
let mods = null;
let decP = null;
let encP = null;

export function initWebp(modules = null) {
  mods = modules;
  decP = encP = null;
}

const getDec = () => (decP ??= initEmscriptenModule(webpDec, mods?.dec));

async function getEnc() {
  if (!encP) {
    const useSimd = mods ? !!mods.encSimd : await simd();
    const factory = useSimd
      ? (await import('../vendor/jsquash-webp/codec/enc/webp_enc_simd.js')).default
      : (await import('../vendor/jsquash-webp/codec/enc/webp_enc.js')).default;
    encP = initEmscriptenModule(factory, useSimd ? mods?.encSimd : mods?.enc);
  }
  return encP;
}

const hasTransparency = (rgba) => {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return true;
  return false;
};

// -> { width, height, rgba, hasAlpha, format: 'webp', chunks: null, riff, warnings }
export async function decodeWebp(bytes) {
  const riff = readRiff(bytes);
  if (isAnimated(riff)) throw usage('webp_animated', 'Animated WebP is not supported.');
  let res;
  try {
    res = (await getDec()).decode(bytes);
  } catch (e) {
    throw usage('webp_broken', `Cannot decode WebP: ${e.message ?? e}`);
  }
  if (!res) throw usage('webp_broken', 'Cannot decode WebP.');
  const { width, height } = res;
  if (!(width > 0 && height > 0) || width * height > MAX_PIXELS) {
    throw usage('image_too_large', `Image size ${width}x${height} is not supported (max ${MAX_PIXELS / 1e6} MP).`);
  }
  const rgba = new Uint8Array(res.data.buffer, res.data.byteOffset, res.data.byteLength).slice();
  return { width, height, rgba, hasAlpha: hasTransparency(rgba), format: 'webp', chunks: null, riff, warnings: [] };
}

// lossless: true -> exact lossless (transparent pixels keep their RGB); otherwise `quality` 1-100.
// Returns the encoder's WebP file (simple or extended format).
export async function encodeWebp({ width, height, rgba }, { lossless = false, quality = 80 } = {}) {
  if (width > WEBP_MAX || height > WEBP_MAX) throw usage('webp_too_large', `WebP supports up to ${WEBP_MAX} x ${WEBP_MAX} pixels.`);
  const options = lossless ? { ...defaultOptions, lossless: 1, exact: 1 } : { ...defaultOptions, quality };
  const m = await getEnc();
  const res = m.encode(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height, options);
  if (!res) throw usage('webp_encode', 'Could not encode the WebP image.');
  return new Uint8Array(res.buffer ?? res).slice();
}
