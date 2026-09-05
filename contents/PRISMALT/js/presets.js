// ============================================================ プリセット
// 帯エディタの初期値として流し込むデータ。読み込んだあとはエディタ側で自由に編集する
// （プリセットは「出発点」であって、選択中の状態ではない）。

// 光（発光スペクトル）。base = 連続光の強さ、bb = 黒体にするか、K = 色温度
export const LIGHT_PRESETS = {
  EE:   { base: 1.00, bb: false, K: 6500, peaks: [] },
  DAY:  { base: 1.00, bb: true,  K: 6500, peaks: [] },
  WARM: { base: 1.00, bb: true,  K: 3000, peaks: [] },
  COOL: { base: 1.00, bb: true,  K: 9000, peaks: [] },
  NA:   { base: 0.00, bb: false, K: 6500, peaks: [{ l: 589, a: 1.00, q: 300 }] },
  RGB:  { base: 0.00, bb: false, K: 6500, peaks: [{ l: 630, a: 1.00, q: 16 },
                                                  { l: 530, a: 0.90, q: 14 },
                                                  { l: 455, a: 0.70, q: 18 }] },
  FL:   { base: 0.18, bb: false, K: 6500, peaks: [{ l: 436, a: 0.55, q: 60 },
                                                  { l: 546, a: 1.00, q: 60 },
                                                  { l: 611, a: 0.75, q: 50 }] },
};
export const LIGHT_KEYS = Object.keys(LIGHT_PRESETS);

// ガラス（吸収スペクトル）。SPEC §4 の A_A / A_B（ブレンドの両端）に入れる。
// mix フィールドが空間ごとに t を返し、A_mix = (1-t)·A + t·B で中間の色ガラスになる
export const GLASS = {
  CLEAR:  { base: 0.00, peaks: [] },
  SMOKE:  { base: 0.95, peaks: [] },
  COBALT: { base: 0.10, peaks: [{ l: 540, a: 2.6, q: 4.5 }, { l: 600, a: 3.0, q: 5.0 }] },
  BOTTLE: { base: 0.15, peaks: [{ l: 440, a: 1.8, q: 5.0 }, { l: 640, a: 2.2, q: 4.0 }] },
  AMBER:  { base: 0.12, peaks: [{ l: 430, a: 3.4, q: 3.0 }, { l: 470, a: 1.6, q: 4.0 }] },
  RUBY:   { base: 0.05, peaks: [{ l: 500, a: 4.0, q: 2.6 }, { l: 565, a: 2.2, q: 6.0 }] },
  TEAL:   { base: 0.10, peaks: [{ l: 430, a: 2.0, q: 4.0 }, { l: 660, a: 2.6, q: 3.4 }] },
  VIOLET: { base: 0.10, peaks: [{ l: 520, a: 2.4, q: 3.0 }] },
};
export const GLASS_KEYS = Object.keys(GLASS);

// プリセットは配列ごとコピーして渡す。参照のまま渡すと、
// エディタでピンを動かした瞬間にプリセット定義そのものが書き換わる
export const clonePeaks = ps => ps.map(p => ({ l: p.l, a: p.a, q: p.q }));
