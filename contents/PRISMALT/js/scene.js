// ============================================================ シーン状態
// 「いま編集している壁紙の構図」を1つのオブジェクトに集約する。
// renderer.js はこれを読んでシェーダの uniform を作るだけ。SPEC の用語に合わせてある。
//
//  軸（axis）    : x / y / z。フィールドごとに複数ONにできる
//  パターン       : 複数軸をどう1つの値にまとめるかの型（下の PATTERNS）
//  フィールド     : ある座標を入れると1つの数値を返す関数。lo/hi はユーザーが自由に決める
//  4つの field を「同じ1つの仕組み」で回す（SPEC §5.1）:
//    height  … ハイトマップの高さ（割合 0..1）
//    density … Beer-Lambert の吸収係数
//    ior     … 屈折率。光がガラスに当たった点で1回だけ引く（SPEC §4.2）
//    mix     … A_A / A_B のブレンド率 t（SPEC §4.3）

// パターン = 基準(basis) x 合成(combine) の直交表。id = basis * 4 + combine
//   basis   0 = 端から   t = 0..1
//           1 = 中央から 中心からの距離 |2t-1| を取り、最後に 1- で反転して山にする
//   combine 0 = mean  1 = max  2 = min  3 = dist（ユークリッド）
// 軸が1本のときは combine が効かず、basis の違い（ramp / fold）だけが残る。
// 名前は x+y の2軸で出る形に由来する。z も混ぜた3軸では、
// dome は球状の盛り上がり、pyramid は立方体状になる（名前は近似）。
// 中央基準は「中心が高い山」で出る。invert でそのまま窪みになり、
// dome + invert が転換前の radial（中心が低いお椀）と一致する。
export const PATTERNS = [
  { id: 0, key: 'diagonal', hint: '端から / mean — 対角の坂' },
  { id: 1, key: 'ridge',    hint: '端から / max — L字の尾根' },
  { id: 2, key: 'valley',   hint: '端から / min — L字の谷' },
  { id: 3, key: 'corner',   hint: '端から / dist — 角からの1/4円' },
  { id: 4, key: 'diamond',  hint: '中央から / mean — 斜め45度の四角錐' },
  { id: 5, key: 'pyramid',  hint: '中央から / max — 四角錐（invert で四角い窪み）' },
  { id: 6, key: 'cross',    hint: '中央から / min — 十字の尾根' },
  { id: 7, key: 'dome',     hint: '中央から / dist — ドーム（invert で転換前の radial）' },
];

export const scene = {
  // --- 配置（アレンジメント）
  // grid はセルの個数。セルは x/y のピッチ 1.0。
  // useZ を ON にすると高さが grid.z 段にスナップし、セルは立方体になる。
  // このとき maxH は使われない（＝ MAX HEIGHT を無視する）
  grid:  { x: 6, y: 6, z: 8, useZ: false },
  maxH:  2.8,    // useZ が OFF のときだけ使う、連続の高さ
  gap:   0.18,   // x/y の隙間。0 = 隣接列が継ぎ目なく融合 / >0 = 別々の柱（SPEC §5.2）
  gapZ:  0.00,   // z の隙間。use grid z のときだけ効く。0 = 縦に融合して1本の柱、
                 // >0 = 段ごとに分かれて独立したキューブが積まれる
  bevel: 0.05,   // 露出した稜線の面取り

  // --- 4つの field。axes は複数ONにできる。pat は上の PATTERNS の id
  fields: {
    height:  { axes: { x: false, y: true,  z: false }, pat: 0, inv: false, lo: 0.28, hi: 1.00 },
    density: { axes: { x: false, y: false, z: true  }, pat: 0, inv: false, lo: 0.10, hi: 0.55 },
    ior:     { axes: { x: false, y: false, z: false }, pat: 0, inv: false, lo: 1.48, hi: 1.48 },
    mix:     { axes: { x: true,  y: false, z: false }, pat: 0, inv: false, lo: 0.00, hi: 1.00 },
  },

  // --- 光。スペクトルは帯エディタで編集する（SPEC §2 のとおりシーンで1つに固定）。
  // 向きは右ドラッグで動かす（SPEC §8）。既定は手前・右・上から
  light: {
    base: 1.0, bb: true, K: 6500, peaks: [],      // 発光スペクトル（連続光 + ガウス帯）
    az: -0.60, el: 0.55,                          // 空間上の向き
    intensity: 1.9, wb: 0.82, ambient: 0.16,
  },

  // --- ブレンドの両端に入れる色ガラス（吸収スペクトル）。こちらも帯エディタで編集する
  glassA: { base: 0.05, peaks: [{ l: 500, a: 4.0, q: 2.6 }, { l: 565, a: 2.2, q: 6.0 }] }, // ruby
  glassB: { base: 0.10, peaks: [{ l: 540, a: 2.6, q: 4.5 }, { l: 600, a: 3.0, q: 5.0 }] }, // cobalt

  // --- 背景（void color の面）。バックライトとは独立（SPEC §6・§8.1）
  bg: {
    mode: 1,               // 0 off / 1 floor / 2 wall / 3 floor+wall / 4 cyclorama
    dist: 0.5,             // 背景面とガラスの距離
    cycloR: 1.8,           // ホリゾントのフィレット半径
    color: '#8b909c',      // sRGB。スペクトルでは計算しない単なる合成色
  },

  // --- カメラ（自由回転）。target まわりを az/el/dist で周回
  cam: { az: -1.05, el: 0.24, dist: 15, target: [0, 0, 1.0] },

  // --- ガラスだけの回転角（プランB）。動画書き出し中だけ動く
  spin: 0,

  // --- 表示品質と書き出し
  ss: 1.15,       // ライブ表示のスーパーサンプル倍率
  segs: 4,        // 1本の視線が積算するガラスの最大枚数
  exposure: 1.0,

  // --- 書き出し。PNG は設定なし（正方形 4096 決め打ち）、動画は秒/1回転だけ
  out: {
    aspect: '1:1',   // 枠の比率。動画のレンダ範囲になる。1:1 は PNG の範囲でもある
    turn: 8,         // 秒 / 1回転。1回転 = 1ループなので、これが尺そのもの
  },
};

// 書き出しの決め打ち値。UI には出さない
export const PNG_SIDE = 4096;   // PNG は常に正方形
export const VIDEO_SHORT = 720; // 動画は短辺 720（16:9 なら 1280x720）
export const FPS = 30;

// 枠の比率。値は 幅/高さ
export const ASPECTS = {
  '1:1':  1,
  '3:4':  3 / 4,
  '9:16': 9 / 16,
  '16:9': 16 / 9,
};

// ビューに収まる最大の枠（中央固定・インセットなし）。
// インセットを付けないので、1:1 の枠が PNG の書き出し範囲とピクセル単位で一致する
export function frameRect(viewW, viewH, aspect){
  const a = ASPECTS[aspect] ?? 1;
  let w = viewH * a, h = viewH;
  if (w > viewW){ w = viewW; h = w / a; }
  return { w, h, x: (viewW - w) / 2, y: (viewH - h) / 2 };
}

// シーンの高さ。useZ ON なら格子の段数がそのまま world 高さ（セル1辺 = 1.0）
export const sceneH = s => (s.grid.useZ ? s.grid.z : s.maxH);
// 高さをスナップさせる段数。0 = 連続（量子化しない）
export const levelsOf = s => (s.grid.useZ ? s.grid.z : 0);

// input[type=color] の #rrggbb を リニアRGB へ
export function hexToLinear(hex){
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255), (n >> 8 & 255), (n & 255)]
    .map(v => v / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
}
