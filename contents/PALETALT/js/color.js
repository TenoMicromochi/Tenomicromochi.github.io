/* ============================================================
   PALETALT-K — color space utilities

   量子化はすべて「ワークスペース座標」上で行う。
   OKLAB / RGB のどちらを選んでも、そこでのユークリッド距離が
   同一スケール（黒→白でおよそ 100）の ΔE になるよう正規化してある。
   これによりマージ閾値スライダーが色空間を変えても同じ意味を保つ。
   ============================================================ */
const Color = (() => {

  const srgbToLinear = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const linearToSrgb = (c) => {
    const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  };

  function rgbToOklab(r, g, b) {
    const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
  }

  function oklabToRgb(L, A, B) {
    const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
    const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
    const s_ = L - 0.0894841775 * A - 1.2914855480 * B;
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    return [
      linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    ];
  }

  // RGB ユークリッド距離を OKLAB と同じ 0〜100 スケールへ揃える係数
  const RGB_K = 100 / Math.sqrt(3 * 255 * 255);

  // sRGB → ワークスペース座標
  function toWork(r, g, b, space) {
    if (space === 'rgb') return [r * RGB_K, g * RGB_K, b * RGB_K];
    const [L, A, B] = rgbToOklab(r, g, b);
    return [L * 100, A * 100, B * 100];
  }

  // ワークスペース座標 → sRGB
  function fromWork(v, space) {
    if (space === 'rgb') {
      const c = (x) => Math.max(0, Math.min(255, Math.round(x / RGB_K)));
      return [c(v[0]), c(v[1]), c(v[2])];
    }
    return oklabToRgb(v[0] / 100, v[1] / 100, v[2] / 100);
  }

  const dist2 = (a, b) => {
    const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2];
    return x * x + y * y + z * z;
  };

  // OKLAB 上の彩度（クロマ）
  function chroma(r, g, b) {
    const [, A, B] = rgbToOklab(r, g, b);
    return Math.hypot(A, B);
  }

  function lightness(r, g, b) {
    return rgbToOklab(r, g, b)[0];
  }

  function hue(r, g, b) {
    const [, A, B] = rgbToOklab(r, g, b);
    let h = Math.atan2(B, A) * 180 / Math.PI;
    return h < 0 ? h + 360 : h;
  }

  const hex2 = (x) => x.toString(16).padStart(2, '0');
  const toHex = (c) => '#' + hex2(c.r) + hex2(c.g) + hex2(c.b);

  return {
    srgbToLinear, linearToSrgb, rgbToOklab, oklabToRgb,
    toWork, fromWork, dist2, chroma, lightness, hue, toHex,
  };
})();
