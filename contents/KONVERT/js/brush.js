// Brush shapes (SPEC 28.1). A brush of size s covers the square whose top-left corner is
// (x - ((s-1)>>1), y - ((s-1)>>1)) and whose side is s.
// SQUARE fills it all. ROUND fills the pixels whose centre is inside the inscribed circle:
//   ((px+0.5) - s/2)^2 + ((py+0.5) - s/2)^2 <= (s/2)^2        (px, py counted from the top-left corner)

const cache = new Map();

// -> Uint8Array(s * s), 1 = painted
export function brushShape(size, round) {
  const key = size * 2 + (round ? 1 : 0);
  let shape = cache.get(key);
  if (shape) return shape;
  shape = new Uint8Array(size * size);
  const r = size / 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = px + 0.5 - r, dy = py + 0.5 - r;
      shape[py * size + px] = !round || dx * dx + dy * dy <= r * r ? 1 : 0;
    }
  }
  cache.set(key, shape);
  return shape;
}
