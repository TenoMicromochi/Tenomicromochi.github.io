/* ============================================================
   presets.js — 語彙（色 / 型 / サイズ）

   ここにあるのは「レシピが参照する固定の語彙」だけ。
   実際に何をどう組み合わせて打ち上げるかは recipes.json 側にある。

   調整するのは (RADIUS, FALL SPEED, LIFE) の 3 つだけ。
   シェーダが必要とする tau と |v0| はここから逆算する：

     tau  = FALL SPEED / g        （終端落下速度 = tau*g）
     |v0| = RADIUS / tau          （最終半径 = tau*|v0|）

   tau や抵抗係数を直接触っても見た目の予測が立たないので、
   目に見える量のほうを入力にしている。
   ============================================================ */

/* 重力と風は固定。風は線形抵抗を選んだ副産物でタダで入るので式には残して
   あるが、動かす理由がないのでスライダーからは外した（README 参照）。
   試したくなったら window.HANABI から書き換えられる */
export const GRAVITY = 9.8;   // m/s2
export const WIND = 0;        // m/s（+X 方向）

export const COLORS = {
  gold:    [1.00, 0.62, 0.20],
  amber:   [1.00, 0.45, 0.12],
  red:     [1.00, 0.20, 0.16],
  green:   [0.35, 1.00, 0.40],
  blue:    [0.28, 0.55, 1.00],
  violet:  [0.62, 0.38, 1.00],
  magenta: [1.00, 0.30, 0.85],
  cyan:    [0.35, 0.95, 1.00],
  silver:  [0.82, 0.88, 1.00],
};

export const COLOR_KEYS = Object.keys(COLORS);

/* 型（TYPE）＝ 形の性格。寸法は 10 号玉（尺玉）を基準にした実スケールで、
   これがサイズ LARGE のときの値になる。

   開花高度 330m / 開花直径 320m 前後、観覧は 300〜400m というのが実物の値で、
   このとき D/R が 3 前後になる。ここを小玉スケールにすると、同じ高度から
   見たときに D/R が 20 を超えて平面に見えてしまう。

   垂れ具合は sag/R = FALL SPEED * LIFE / RADIUS でだいたい読める。
   牡丹 0.27 / 菊 0.41 / 柳 2.7。 */
export const TYPES = {
  /* 牡丹：丸く開いて、球のまま少し沈む。尾はほぼ引かない */
  peony: {
    label: 'PEONY',
    radius: 160, fallSpeed: 18, life: 2.4,
    tauSpread: 0.18, spdSpread: 0.10, lifeSpread: 0.18,
    flat: 1.0, crackle: 0.0,
  },

  /* 菊：牡丹より寿命が長く、よく落ちるので尾が伸びる */
  chrysanthemum: {
    label: 'CHRYSANTH',
    radius: 170, fallSpeed: 22, life: 3.2,
    tauSpread: 0.24, spdSpread: 0.12, lifeSpread: 0.22,
    flat: 1.0, crackle: 0.0,
  },

  /* 柳：初速が小さく寿命が長い。半径が伸びないまま落ち続けるので垂れる。
     牡丹との差は初速と抵抗（＝落下速度）と寿命だけで、他は同一 */
  willow: {
    label: 'WILLOW',
    radius: 70, fallSpeed: 34, life: 5.5,
    tauSpread: 0.34, spdSpread: 0.14, lifeSpread: 0.28,
    flat: 1.0, crackle: 0.0,
  },

  /* 冠菊（クラックル）：終盤で再発光する */
  crackle: {
    label: 'CRACKLE',
    radius: 120, fallSpeed: 16, life: 3.0,
    tauSpread: 0.20, spdSpread: 0.10, lifeSpread: 0.20,
    flat: 1.0, crackle: 1.0,
  },

  /* 環：分布を平面に潰すだけ。シェーダは牡丹とまったく同じものを使う */
  ring: {
    label: 'RING',
    radius: 180, fallSpeed: 17, life: 2.6,
    tauSpread: 0.14, spdSpread: 0.07, lifeSpread: 0.16,
    flat: 0.07, crackle: 0.0,
  },
};

export const TYPE_KEYS = Object.keys(TYPES);

/* サイズ＝ 型に掛かるスケール。LARGE が上の実寸そのもの。
   同じ型の大小を重ねるのが「大サイズ色A + 中サイズ色B」の作り方になる。

   寿命の縮み方を半径より緩くしてあるのは、小玉をそのまま比例縮小すると
   一瞬で消えて重ねたときに見えないため。実物の小玉も相対的には長く残る。 */
export const SIZES = {
  large:  { label: 'L',  radiusMul: 1.00, lifeMul: 1.00 },
  medium: { label: 'M',  radiusMul: 0.62, lifeMul: 0.82 },
  small:  { label: 'S',  radiusMul: 0.38, lifeMul: 0.68 },
  tiny:   { label: 'XS', radiusMul: 0.22, lifeMul: 0.55 },
};

export const SIZE_KEYS = Object.keys(SIZES);
