// Masks are Uint8Array(width * height): 1 = spoiler, 0 = visible.
// File format v2 also uses a "margin" ring around the spoiler (value 2 in the stored mask).

export function bbox(mask, width, height) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!mask[row + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

export function crop(mask, width, [bx, by, bw, bh]) {
  const out = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) out.set(mask.subarray((by + y) * width + bx, (by + y) * width + bx + bw), y * bw);
  return out;
}

export function countMask(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i] === 1 ? 1 : 0;
  return n;
}

// Sets the part of the rectangle that lies inside the image. Returns false if none does.
export function addRect(mask, width, height, [x, y, w, h], value = 1) {
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  const x1 = Math.min(width, x + w), y1 = Math.min(height, y + h);
  if (x0 >= x1 || y0 >= y1) return false;
  for (let yy = y0; yy < y1; yy++) mask.fill(value, yy * width + x0, yy * width + x1);
  return true;
}

// Chebyshev dilation: a copy of `mask` where every pixel within `m` pixels (square window) of a
// set pixel is set too. Two passes over prefix sums, so the cost does not depend on m.
export function dilate(mask, width, height, m) {
  if (m <= 0) return Uint8Array.from(mask, (v) => (v ? 1 : 0));
  const tmp = new Uint8Array(width * height);
  const pre = new Int32Array(Math.max(width, height) + 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) pre[x + 1] = pre[x] + (mask[y * width + x] ? 1 : 0);
    for (let x = 0; x < width; x++) tmp[y * width + x] = pre[Math.min(width, x + m + 1)] - pre[Math.max(0, x - m)] > 0 ? 1 : 0;
  }
  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) pre[y + 1] = pre[y] + tmp[y * width + x];
    for (let y = 0; y < height; y++) out[y * width + x] = pre[Math.min(height, y + m + 1)] - pre[Math.max(0, y - m)] > 0 ? 1 : 0;
  }
  return out;
}
