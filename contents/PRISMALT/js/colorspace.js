// ------------------------------------------------------------------ 色変換
// XYZ -> リニアsRGB / sRGB符号化 / OKLab 往復。分光の積分結果を画面色にするだけの
// 純粋関数の置き場（アプリの状態には一切触らない）。

export const XYZ2RGB = [
  [ 3.2404542,-1.5371385,-0.4985314],
  [-0.9692660, 1.8760108, 0.0415560],
  [ 0.0556434,-0.2040259, 1.0572252]
];
export const lin2srgb = v => v <= 0.0031308 ? 12.92*v : 1.055*Math.pow(v,1/2.4) - 0.055;
export const hexOf = c => '#' + c.map(v =>
  Math.round(Math.min(1,Math.max(0,lin2srgb(v)))*255).toString(16).padStart(2,'0')).join('');

export function lin2oklab(r,g,b){
  const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
  const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
  const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
  return [0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
          1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
          0.0259040371*l + 0.7827717662*m - 0.8086757660*s];
}
export function oklab2lin(L,a,b){
  const l = Math.pow(L + 0.3963377774*a + 0.2158037573*b, 3);
  const m = Math.pow(L - 0.1055613458*a - 0.0638541728*b, 3);
  const s = Math.pow(L - 0.0894841775*a - 1.2914855480*b, 3);
  return [ 4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
          -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
          -0.0041960863*l - 0.7034186147*m + 1.7076147010*s];
}
export const inGamut = c => c.every(v => v >= -0.0015 && v <= 1.0015);

// 単波長や高Qの光は sRGB の外に大きく出る。負の成分をそのままクリップすると
// 色相が回るので、OKLab で明度と色相を保ったまま彩度だけ落として押し込む。
export function gamutMap(c){
  if (inGamut(c)) return c.map(v => Math.min(1, Math.max(0, v)));
  const lab = lin2oklab(c[0], c[1], c[2]);
  const L = Math.min(1, Math.max(0, lab[0]));
  let lo = 0, hi = 1;
  for (let k = 0; k < 24; k++){
    const t = (lo + hi) / 2;
    if (inGamut(oklab2lin(L, lab[1]*t, lab[2]*t))) lo = t; else hi = t;
  }
  return oklab2lin(L, lab[1]*lo, lab[2]*lo).map(v => Math.min(1, Math.max(0, v)));
}
