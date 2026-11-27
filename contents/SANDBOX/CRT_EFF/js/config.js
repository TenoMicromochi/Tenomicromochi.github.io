// 既定値と MASK ごとの定数を、ここ1か所にまとめる。見た目の調整はこのファイルだけで済む。
// 値はどれも叩き台（見た目は Kaname が決める）。

export const MAX_CHOICES = [320, 480, 640, 960, 1280];

// スライダーの範囲と既定値
export const SLIDERS = {
  pitch: { label: 'PITCH', min: 0.5, max: 3.0, step: 0.05, def: 1.0 },
  gain:  { label: 'GAIN',  min: 0.5, max: 10,  step: 0.1,  def: 2.0 },
  spot:  { label: 'SPOT',  min: 0.1, max: 1.5, step: 0.05, def: 0.3 },
  beam:  { label: 'BEAM',  min: 0.1, max: 1.0, step: 0.05, def: 0.35 },
  halo:  { label: 'HALO',  min: 0,   max: 0.5, step: 0.01, def: 0.05 },
};

export const DIV_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8];   // 1/n 縮小の n
export const DEFAULT_MAX = 640;
export const DEFAULT_DIV = 1;
export const DEFAULT_MASK = 'GRILLE';

// MASK ごとの格子と穴の形
//   id      シェーダー側の番号
//   n, a, b 超楕円 |dx/a|^n + |dy/b|^n <= 1。dx, dy は点の升目の大きさを 1 とした中心からのずれ
//           （升目の端が 0.5）。b = 0 は縦を切らない（GRILLE）
//   aspect  升目の高さ ÷ 幅（GRILLE は縦に切れ目が無いので大きな値。DELTA は行の間隔）
//   k       明るさ補正 = 3 / (穴の面積の割合 × 飽和(AVG_GAUSS))。白 100% を細かく見たときの平均が元の白になる値
//           （点1つは 1 で頭打ちになるので、拡大して点が見えているときの平均はこれより暗い）
//   （穴の面積 ÷ 升目の面積は logic.js の holeAreaFraction が計算する）
export const MASKS = {
  GRILLE: { id: 0, n: 8, a: 0.40, b: 0,    aspect: 1000,      k: 3.92 },
  SLOT:   { id: 1, n: 4, a: 0.40, b: 0.42, aspect: 2.5,       k: 5.03 },
  SQUARE: { id: 2, n: 4, a: 0.42, b: 0.42, aspect: 1.0,       k: 4.79 },
  DELTA:  { id: 3, n: 2, a: 0.42, b: 0.42, aspect: 0.8660254, k: 4.90 },
};

// 蛍光体の色（リニア）。R, G, B の順
export const PHOSPHORS = [
  [1.0, 0.0, 0.0],
  [0.0, 1.0, 0.0],
  [0.0, 0.0, 1.0],
];

export const GAMMA = 2.2;
// 穴の縁のぼかし幅（超楕円の値 1 のまわり）
export const EDGE_SOFT = 0.08;
// 細かすぎるときの混ぜ方。点1つの幅（出力画素）が avgBelow 以下なら点の平均の明るさだけ、
// detailAbove 以上なら点の形だけ、その間はなめらかに混ぜる
export const DOT_MIX = { avgBelow: 1.5, detailAbove: 3.0 };
// 走査線も同じ。1行の高さ（出力画素）が小さいと、走査線と画素の格子がうなって縞（モアレ）になる
export const ROW_MIX = { avgBelow: 2.0, detailAbove: 4.5 };
// 細かすぎるときの平均の明るさで使う、穴の中のガウスの平均（E = I × この値）
export const AVG_GAUSS = 0.8;
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
// 切り抜きの書き出しで、ハレーションのために枠の周りに足す余白（元画素 = この値 × HALO.sigmas の最大）
export const CROP_MARGIN_SIGMAS = 3;
