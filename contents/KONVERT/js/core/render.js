// Hiding the spoiler (SPEC 5). Only pixels inside the mask change, RGB and alpha both.
// Averages and blurs work on premultiplied alpha so transparent edges do not go dark.

import { usage } from './errors.js';

export const DEFAULTS = { fill: { color: '#000000' }, mosaic: { block: 16 }, blur: { radius: 16 } };
export const WEAK = { mosaic: 8, blur: 8 }; // below these the content can often be guessed

const int = (v, name, lo, hi) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw usage('bad_render', `${name} must be an integer from ${lo} to ${hi}.`);
  return n;
};

// Fills in defaults and checks ranges. -> { render, warnings }
export function normalizeRender(opts = {}) {
  const mode = opts.mode ?? 'mosaic';
  const warnings = [];
  let render;
  if (mode === 'fill') {
    const color = String(opts.color ?? DEFAULTS.fill.color).toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(color)) throw usage('bad_render', `Bad colour "${opts.color}" (expected #RRGGBB).`);
    render = { mode, color };
  } else if (mode === 'mosaic') {
    render = { mode, block: int(opts.block ?? DEFAULTS.mosaic.block, 'block', 2, 256) };
    if (render.block < WEAK.mosaic) warnings.push(`Mosaic block ${render.block} is small: the hidden part may be guessed.`);
  } else if (mode === 'blur') {
    render = { mode, radius: int(opts.radius ?? DEFAULTS.blur.radius, 'radius', 1, 256) };
    if (render.radius < WEAK.blur) warnings.push(`Blur radius ${render.radius} is weak: the hidden part may be guessed.`);
  } else {
    throw usage('bad_render', `Unknown mode "${mode}" (fill, mosaic or blur).`);
  }
  return { render, warnings };
}

// Returns a new RGBA buffer: `rgba` with the masked pixels hidden. `box` is the mask bbox.
export function renderSpoiler(rgba, width, height, mask, box, render) {
  const out = new Uint8Array(rgba);
  if (render.mode === 'fill') fill(out, mask, box, width, render.color);
  else if (render.mode === 'mosaic') mosaic(out, rgba, width, height, mask, box, render.block);
  else blur(out, rgba, width, height, mask, box, render.radius);
  return out;
}

function fill(out, mask, [bx, by, bw, bh], width, color) {
  const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
  for (let y = by; y < by + bh; y++) {
    for (let x = bx; x < bx + bw; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const o = i * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    }
  }
}

// Premultiplied sums -> straight RGBA written at `o`.
function put(out, o, sr, sg, sb, sa, n) {
  const a = Math.round(sa / n);
  if (a === 0) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; return; }
  out[o] = Math.min(255, Math.round(sr / sa));
  out[o + 1] = Math.min(255, Math.round(sg / sa));
  out[o + 2] = Math.min(255, Math.round(sb / sa));
  out[o + 3] = a;
}

// Blocks on a grid anchored at (0, 0); each block's average covers the whole block.
function mosaic(out, src, width, height, mask, [bx, by, bw, bh], block) {
  const gx0 = Math.floor(bx / block) * block, gy0 = Math.floor(by / block) * block;
  for (let y0 = gy0; y0 < by + bh; y0 += block) {
    const y1 = Math.min(height, y0 + block);
    for (let x0 = gx0; x0 < bx + bw; x0 += block) {
      const x1 = Math.min(width, x0 + block);
      let any = false;
      for (let y = y0; y < y1 && !any; y++) for (let x = x0; x < x1; x++) if (mask[y * width + x]) { any = true; break; }
      if (!any) continue;
      let sr = 0, sg = 0, sb = 0, sa = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * width + x) * 4, a = src[o + 3];
          sr += src[o] * a; sg += src[o + 1] * a; sb += src[o + 2] * a; sa += a;
        }
      }
      const n = (x1 - x0) * (y1 - y0);
      const avg = new Uint8Array(4);
      put(avg, 0, sr, sg, sb, sa, n);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * width + x;
          if (mask[i]) out.set(avg, i * 4);
        }
      }
    }
  }
}

// Box sizes whose three passes approximate a Gaussian of standard deviation sigma.
export function boxesForGauss(sigma, n = 3) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => ((i < m ? wl : wu) - 1) / 2); // radii
}

// One box pass along rows (horizontal) or columns, edges extended.
function boxPass(src, dst, w, h, r, horizontal) {
  const len = horizontal ? w : h, lines = horizontal ? h : w;
  const step = horizontal ? 1 : w, lineStep = horizontal ? w : 1;
  const inv = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    const at = (i) => src[base + (i < 0 ? 0 : i >= len ? len - 1 : i) * step];
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += at(i);
    for (let i = 0; i < len; i++) {
      dst[base + i * step] = acc * inv;
      acc += at(i + r + 1) - at(i - r);
    }
  }
}

function blur(out, src, width, height, mask, [bx, by, bw, bh], sigma) {
  const radii = boxesForGauss(sigma);
  const margin = radii.reduce((a, b) => a + b, 0) + 1;
  // Work on the bbox plus everything that can reach it; the image edges are extended.
  const x0 = Math.max(0, bx - margin), y0 = Math.max(0, by - margin);
  const x1 = Math.min(width, bx + bw + margin), y1 = Math.min(height, by + bh + margin);
  const w = x1 - x0, h = y1 - y0;
  const channels = [0, 1, 2, 3].map(() => new Float32Array(w * h));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = ((y0 + y) * width + x0 + x) * 4, a = src[o + 3], i = y * w + x;
      channels[0][i] = src[o] * a; channels[1][i] = src[o + 1] * a; channels[2][i] = src[o + 2] * a; channels[3][i] = a;
    }
  }
  const tmp = new Float32Array(w * h);
  for (const ch of channels) {
    for (const r of radii) {
      boxPass(ch, tmp, w, h, r, true);
      boxPass(tmp, ch, w, h, r, false);
    }
  }
  for (let y = by; y < by + bh; y++) {
    for (let x = bx; x < bx + bw; x++) {
      const m = y * width + x;
      if (!mask[m]) continue;
      const i = (y - y0) * w + (x - x0);
      put(out, m * 4, channels[0][i], channels[1][i], channels[2][i], channels[3][i], 1);
    }
  }
}
