// 既定値と MASK ごとの定数を、ここ1か所にまとめる。見た目の調整はこのファイルだけで済む。
// 値はどれも叩き台（見た目は Kaname が決める）。

export const MAX_CHOICES = [320, 480, 640, 960, 1280];

// スライダーの範囲と既定値（下の欄 SIGNAL・MASK・LIGHT の組に、層の順で並ぶ）
export const SLIDERS = {
  yMHz:     { label: 'Y MHZ',    min: 0.5,  max: 6.0, step: 0.1,  def: 3.0, sec: 'signal' },   // 0 明るさ（Y）の帯域
  cMHz:     { label: 'C MHZ',    min: 0.2,  max: 3.0, step: 0.1,  def: 1.0, sec: 'signal' },   // 0 色（I・Q）の帯域
  pitch:    { label: 'PITCH',    min: 0.5,  max: 3.0, step: 0.05, def: 1.0, sec: 'mask' },   // 1 格子
  beam:     { label: 'BEAM',     min: 0.2,  max: 1.0, step: 0.05, def: 0.85, sec: 'mask' },   // 1・2 ビームの縦の太さ
  knee:     { label: 'KNEE',     min: 0.01, max: 0.5, step: 0.01, def: 0.15, sec: 'mask' },   // 2 これ以上の強さで穴いっぱいに満ちる
  min:      { label: 'MIN',      min: 0,    max: 1,   step: 0.05, def: 0.6, sec: 'mask' },   // 2 弱い素子の大きさ（満ちた形に対する割合の下限）
  soft:     { label: 'SOFT',     min: 0,    max: 1,   step: 0.05, def: 0.95, sec: 'mask' },   // 2 弱い素子の中心からの淡さ
  gapX:     { label: 'GAP X',    min: 0,    max: 0.6, step: 0.01, def: 0.3, sec: 'mask' },   // 3 縦の網
  gapY:     { label: 'GAP Y',    min: 0,    max: 0.6, step: 0.01, def: 0.1, sec: 'mask' },   // 3 横の網（GRILLE・DELTA では使わない）
  exposure: { label: 'EXPOSURE', min: 0.25, max: 8,   step: 0.05, def: 1.5, sec: 'light' },   // 4
  bloom:    { label: 'BLOOM',    min: 0,    max: 2,   step: 0.05, def: 0.05, sec: 'light' },   // 4 明るい色の表面のにじみの量
  bsize:    { label: 'B SIZE',   min: 0.5,  max: 6.0, step: 0.1,  def: 4.0, sec: 'light' },   // 4 BLOOM の広がり σ1（元画素）
  halo:     { label: 'HALO',     min: 0,    max: 0.5, step: 0.01, def: 0.05, sec: 'light' },  // 4
};

// 層 0：信号。SIGNAL が COMPOSITE のとき、画像の各行を走査線1本（lineUs µs）とみなし、
// Y と I・Q を別の帯域（MHz）で横にガウスでぼかす。σ（画素）= sigmaK / f / (lineUs / 幅)、範囲は ±range σ
export const SIGNAL_CHOICES = ['RGB', 'COMPOSITE'];
export const DEFAULT_SIGNAL = 'COMPOSITE';
export const SIGNAL = { lineUs: 52.6, sigmaK: 0.1325, range: 3 };

export const DIV_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8];   // 1/n 縮小の n
export const DEFAULT_MAX = 640;
export const DEFAULT_DIV = 1;
export const DEFAULT_MASK = 'GRILLE';

// MASK ごとの格子と穴の形
//   id      シェーダー側の番号
//   n       穴の超楕円の n（|dx/a|^n + |dy/b|^n <= 1）。半幅・半高さは GAP X・GAP Y と PITCH から logic.js の maskGeometry が決める
//   aspect  素子の高さ ÷ 素子の幅 cw（GRILLE は元画像の1行なので使わない。DELTA は行の間隔）
export const MASKS = {
  GRILLE: { id: 0, n: 8, aspect: 0 },
  SLOT:   { id: 1, n: 4, aspect: 2.5 },
  SQUARE: { id: 2, n: 4, aspect: 1.0 },
  DELTA:  { id: 3, n: 2, aspect: 0.8660254 },
};
// GAP Y を使わない MASK（スライダーを disabled にする）
export const NO_GAP_Y = ['GRILLE', 'DELTA'];

// 蛍光体の色（リニア）。R, G, B の順
export const PHOSPHORS = [
  [1.0, 0.0, 0.0],
  [0.0, 1.0, 0.0],
  [0.0, 0.0, 1.0],
];

export const GAMMA = 2.2;
// 素子の縁・穴の縁のぼかし幅 e（超楕円の値 1 のまわり ±e）
export const EDGE_SOFT = 0.08;
// 細かすぎるときの混ぜ方。素子1つの幅（出力画素）が avgBelow 以下なら素子の平均の明るさだけ、
// detailAbove 以上なら素子の形だけ、その間はなめらかに混ぜる
export const DOT_MIX = { avgBelow: 1.5, detailAbove: 3.0 };
// 素子1つの光の総量を I × 満ちた形の面積にそろえる B を、表（満ち具合 af × 柔らかさ sf）で持つ。
// af は √af を na 等分（afMin から 1 まで）、sf は 0〜1 を ns 等分。n は表を作るときの積分の分割数
export const B_TABLE = { na: 24, ns: 9, afMin: 0.003, n: 40 };
// 弱い素子の角の丸さ n（穴の n へ af で混ぜる。穴の n が小さければそちらを使う）
export const N_LOW = 2.5;
// BLOOM：元画像（層 0 を通したもの）の上で作る、明るい色ほど強いにじみ。元画素の単位で広げる
//   pow      元の強さ = c × min(Y, 1)^pow（暗い色ほど小さい）
//   sigmas   2枚のガウスの幅（B SIZE に対する倍率）。σ1 = B SIZE、σ2 = 3 × B SIZE
//   weights  2枚の重み（合計 1）
//   rangeSigmas  ぼかす範囲（±σ の倍数）。にじみのテクスチャの余白もこれ × σ2（切り上げ）
export const BLOOM = { pow: 2.0, sigmas: [1, 3], weights: [0.7, 0.3], rangeSigmas: 3 };
// ハレーション：幅の違うガウス4枚を重ねた、尾の長いにじみ
//   sigmas   σ（元画素単位。出力の画素では × 拡大率）
//   weights  各ガウスの重み（広い方ほど弱く、合計 1）
//   down     CRT の描画を縮める率（ピラミッドの一番細かい段）
//   maxTexSigma / minTexSigma  段ごとのテクセル単位の σ の上限・下限（13 タップに収まる範囲）
export const HALO = {
  sigmas: [2, 6, 18, 54],
  weights: [0.45, 0.28, 0.17, 0.10],
  down: 4,
  maxTexSigma: 4,
  minTexSigma: 0.6,
};

// 書き出しの上限（長い辺）
export const EXPORT_LIMIT = 8192;

// MP4（H.264）のビットレート = 幅 × 高さ × 30 × MP4_BPP。ただし MP4_MAX_BITRATE まで
export const MP4_BPP = 0.25;
export const MP4_MAX_BITRATE = 200e6;

// 切り抜きの枠の比率（CROP セレクトの候補。OFF は枠なし）
export const CROP_RATIOS = { '1:1': [1, 1], '4:3': [4, 3], '3:4': [3, 4], '16:9': [16, 9], '9:16': [9, 16] };
// 枠の短い辺の最小（処理する画像の画素）
export const CROP_MIN_SIDE = 4;
// 切り抜きの書き出しで、にじみのために枠の周りに足す余白（元画素 = この値 × HALO.sigmas の最大。BLOOM の σ2 の方が大きければそちら）
export const CROP_MARGIN_SIGMAS = 3;
