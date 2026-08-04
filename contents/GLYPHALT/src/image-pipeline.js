
// 0〜255にクランプ
export function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

// 横→縦の2パス分離型ボックスブラー(移動平均)。BLURスライダー用
export function boxBlur(d, w, h, radius) {
  if (radius <= 0) return;
  const r2 = Math.floor(radius), size = r2*2+1;
  const tmp = new Float32Array(d.length);
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let x = -r2; x <= r2; x++) sum += d[(y*w + Math.max(0, Math.min(w-1, x)))*4+c];
      for (let x = 0; x < w; x++) {
        tmp[(y*w+x)*4+c] = sum / size;
        sum += d[(y*w + Math.max(0, Math.min(w-1, x+r2+1)))*4+c]
             - d[(y*w + Math.max(0, Math.min(w-1, x-r2  )))*4+c];
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let y = -r2; y <= r2; y++) sum += tmp[(Math.max(0, Math.min(h-1, y))*w+x)*4+c];
      for (let y = 0; y < h; y++) {
        d[(y*w+x)*4+c] = Math.round(sum / size);
        sum += tmp[(Math.max(0, Math.min(h-1, y+r2+1))*w+x)*4+c]
             - tmp[(Math.max(0, Math.min(h-1, y-r2  ))*w+x)*4+c];
      }
    }
  }
}

// Sobelオペレータでエッジ抽出し、元画像とstrength比率でブレンド。SOBELスライダー用
export function sobelFilter(d, w, h, amount) {
  if (amount <= 0) return;
  const src = new Uint8ClampedArray(d);
  const strength = amount / 10;
  const luminanceAt = (x, y) => {
    const px = Math.max(0, Math.min(w - 1, x));
    const py = Math.max(0, Math.min(h - 1, y));
    const i = (py * w + px) * 4;
    return src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = -luminanceAt(x-1,y-1) + luminanceAt(x+1,y-1)
               - 2*luminanceAt(x-1,y)   + 2*luminanceAt(x+1,y)
               - luminanceAt(x-1,y+1)   + luminanceAt(x+1,y+1);
      const gy = -luminanceAt(x-1,y-1) - 2*luminanceAt(x,y-1) - luminanceAt(x+1,y-1)
               + luminanceAt(x-1,y+1) + 2*luminanceAt(x,y+1) + luminanceAt(x+1,y+1);
      const edge = Math.min(255, Math.hypot(gx, gy));
      const i = (y * w + x) * 4;
      d[i]   = clamp(src[i]   * (1-strength) + edge * strength);
      d[i+1] = clamp(src[i+1] * (1-strength) + edge * strength);
      d[i+2] = clamp(src[i+2] * (1-strength) + edge * strength);
    }
  }
}

// アンシャープマスク: ぼかしたコピーとの差分を強調して輪郭を鋭くする。SHARPNESSスライダー用
export function unsharpMask(d, w, h, amount) {
  if (amount <= 0) return;
  const bl = new Uint8ClampedArray(d);
  boxBlur(bl, w, h, 1);
  const str = amount * 0.3;
  for (let i = 0; i < d.length; i += 4)
    for (let c = 0; c < 3; c++) d[i+c] = clamp(d[i+c] + str*(d[i+c]-bl[i+c]));
}

// RGB(0-255)→HSV(h:度, s/v:0-1)変換。色相シフト用
export function rgbToHsv(r, g, b) {
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  let h = 0;
  if (d) {
    if      (max===r) h = ((g-b)/d) % 6;
    else if (max===g) h = (b-r)/d + 2;
    else              h = (r-g)/d + 4;
    h = h * 60; if (h < 0) h += 360;
  }
  return [h, max ? d/max : 0, max];
}

// HSV→RGB(0-255)変換。色相シフト用
export function hsvToRgb(h, s, v) {
  h = ((h%360)+360)%360;
  const c=v*s, x=c*(1-Math.abs((h/60)%2-1)), m=v-c;
  let r=0, g=0, b=0;
  if      (h<60)  { r=c; g=x; }
  else if (h<120) { r=x; g=c; }
  else if (h<180) { g=c; b=x; }
  else if (h<240) { g=x; b=c; }
  else if (h<300) { r=x; b=c; }
  else            { r=c; b=x; }
  return [(r+m)*255, (g+m)*255, (b+m)*255];
}

// ガンマ補正: 255*(v/255)^(1/gamma)のLUTで中間調の明るさを調整。GAMMAスライダー用(amount=100が無補正)
export function applyGamma(d, amount) {
  const g = amount / 100;
  const invG = 1 / g;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.round(255 * Math.pow(i / 255, invG));
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]]; d[i+1] = lut[d[i+1]]; d[i+2] = lut[d[i+2]];
  }
}

// ポスタライズ: 各chをlevels段の階調に丸めてバンド状に減色する。POSTERIZEスライダー用
export function posterize(d, levels) {
  const step = 255 / (levels - 1);
  for (let i = 0; i < d.length; i += 4)
    for (let c = 0; c < 3; c++) d[i+c] = clamp(Math.round(Math.round(d[i+c] / step) * step));
}

// 4x4 Bayer行列による組織的ディザ。しきい値を格子状にずらしてから量子化することで、
// 階調不足のバンディングを網目パターンで擬似的にごまかす。DITHERスライダー用
const BAYER4 = [
  [ 0,  8,  2, 10],
  [12,  4, 14,  6],
  [ 3, 11,  1,  9],
  [15,  7, 13,  5],
];
export function ditherOrdered(d, w, h, levels) {
  const step = 255 / (levels - 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const t = (BAYER4[y & 3][x & 3] / 16 - 0.5) * step;
      for (let c = 0; c < 3; c++)
        d[i+c] = clamp(Math.round(Math.round((d[i+c] + t) / step) * step));
    }
  }
}

// IMAGE ADJUSTセクションの全パラメータを順番に適用。
// 1) 構造/質感(sobel/blur/sharp) → 2) 色調補正(gamma/明度/コントラスト/彩度/色相) →
// 3) 最終段の量子化・スタイライズ(posterize/dither/negative)、という3段構成。
// UI上の並び順もこの処理順と一致させてある
export function applyAdjustments(imgData, p) {
  const d = imgData.data, w = imgData.width, h = imgData.height;

  if (p.sobel > 0) sobelFilter(d, w, h, p.sobel);
  if (p.blur  > 0) boxBlur(d, w, h, p.blur);
  if (p.sharp > 0) unsharpMask(d, w, h, p.sharp);

  if (p.gamma !== 100) applyGamma(d, p.gamma);

  const bF = p.brightness / 100;
  const cRaw = Math.min((p.contrast / 100) * 255, 258.9);
  const cF = (259*(cRaw+255)) / (255*(259-cRaw));
  const sF = p.saturation / 100;

  // 明度→コントラスト→彩度(輝度基準)を1ピクセルずつ適用
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i]*bF, g = d[i+1]*bF, b = d[i+2]*bF;
    r = clamp(cF*(r-128)+128);
    g = clamp(cF*(g-128)+128);
    b = clamp(cF*(b-128)+128);
    const gr = 0.299*r + 0.587*g + 0.114*b;
    d[i]   = clamp(gr + sF*(r-gr));
    d[i+1] = clamp(gr + sF*(g-gr));
    d[i+2] = clamp(gr + sF*(b-gr));
  }

  // 色相シフト(0以外の場合のみHSV経由で回転)
  if (p.hue !== 0) {
    for (let i = 0; i < d.length; i += 4) {
      const [h2,s,v] = rgbToHsv(d[i], d[i+1], d[i+2]);
      const [r2,g2,b2] = hsvToRgb(h2 + p.hue, s, v);
      d[i]=clamp(r2); d[i+1]=clamp(g2); d[i+2]=clamp(b2);
    }
  }

  // ポスタライズ/ディザは「0=オフ、値が大きいほど強い」という他スライダーと同じ向きに合わせるため、
  // スライダー値(0〜10)を段階数(12〜2)へ反転して渡す
  if (p.posterize > 0) posterize(d, Math.max(2, 12 - p.posterize));
  if (p.dither    > 0) ditherOrdered(d, w, h, Math.max(2, 12 - p.dither));

  // ネガ(色反転)
  if (p.negative) {
    for (let i = 0; i < d.length; i += 4) {
      d[i]=255-d[i]; d[i+1]=255-d[i+1]; d[i+2]=255-d[i+2];
    }
  }
  return imgData;
}
