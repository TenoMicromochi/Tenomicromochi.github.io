/* ============================================================
   recipes.js — レシピの正規化と解決

   レシピは「プレイヤーが組み替える対象」で、玉の物理そのものではない。
   ここでやるのは 2 つだけ：

     normalize — JSON の穴あきスペックを、UI が安心して触れる完全な形にする
     resolve   — 完全なスペックを、シェーダが必要とする数値へ落とす

   分離してあるのは、UI が編集するのは normalize 済みの構造だけで、
   resolve は発火の瞬間に一度走ればよいため。UI 操作のたびに
   tau や |v0| を計算し直す必要はない。

   入れ子は深さ 1（shell → split）まで。深くしないのは、方向属性が
   段数ぶん必要になるうえ、UI が指数的に複雑になる割に、見た目は
   shells[] を重ねればほぼ代替できるため。
   ============================================================ */

import { COLORS, COLOR_KEYS, TYPES, SIZES } from './presets.js';
import { MAX_PAL } from './shaders.js';

export const MAX_SPLIT_DEPTH = 1;

/* 型とサイズから寸法を引く。型が形の性格、サイズがスケール。 */
function dims(typeKey, sizeKey) {
  const T = TYPES[typeKey] || TYPES.peony;
  const S = SIZES[sizeKey] || SIZES.large;
  return {
    radius: T.radius * S.radiusMul,
    fallSpeed: T.fallSpeed,
    life: T.life * S.lifeMul,
  };
}

/* 型／サイズを変えたときに、寸法と性格を引き直す。
   UI のドロップダウンから呼ぶ。個別に詰めたスライダー値は上書きされる
   （型を選び直す＝作り直すという意図なので、それでよい） */
export function applyType(spec, typeKey) {
  const T = TYPES[typeKey] || TYPES.peony;
  spec.type = typeKey;
  Object.assign(spec, dims(typeKey, spec.size), {
    tauSpread: T.tauSpread,
    spdSpread: T.spdSpread,
    lifeSpread: T.lifeSpread,
    flat: T.flat,
    crackle: T.crackle,
  });
  return spec;
}

export function applySize(spec, sizeKey) {
  spec.size = sizeKey;
  Object.assign(spec, dims(spec.type, sizeKey));
  return spec;
}

/* 経時変化（色A→色B）の窓。玉ごと・分裂の段ごとに持つ。
   その段の寿命に対する割合なので、寿命を変えても相対位置は保たれる。
   from < to を必ず満たすようにするのは、逆転すると smoothstep が破綻するため */
function lateWindow(raw) {
  const from = clamp(num(raw.lateFrom, 0.30), 0, 0.96);
  const to = clamp(num(raw.lateTo, 0.75), from + 0.04, 1);
  return {
    colorLate: COLORS[raw.colorLate] ? raw.colorLate : null,
    lateFrom: from,
    lateTo: to,
  };
}

/* 色名の配列を検証する。未知の色と MAX_PAL 超過をここで落として、
   シェーダ側で範囲外を引かないようにする */
function normColors(list, fallback) {
  const out = (Array.isArray(list) ? list : [list])
    .filter(c => typeof c === 'string' && COLORS[c])
    .slice(0, MAX_PAL);
  return out.length ? out : [fallback];
}

export function normalizeSplit(raw) {
  if (!raw) return null;
  const type = TYPES[raw.type] ? raw.type : 'peony';
  const size = SIZES[raw.size] ? raw.size : 'small';
  const d = dims(type, size);
  const T = TYPES[type];
  return {
    at: clamp(num(raw.at, 0.45), 0.05, 0.95),   // 親の寿命に対する割合
    type, size,
    radius: num(raw.radius, d.radius),
    fallSpeed: num(raw.fallSpeed, d.fallSpeed),
    life: num(raw.life, d.life),
    colors: normColors(raw.colors, 'silver'),
    ...lateWindow(raw),
    crackle: num(raw.crackle, T.crackle),
    inherit: clamp(num(raw.inherit, 0.25), 0, 1),  // 親の速度の引き継ぎ量
    spread: clamp(num(raw.spread, 0.18), 0, 0.6),  // 分裂時刻のばらつき
  };
}

export function normalizeShell(raw) {
  const type = TYPES[raw.type] ? raw.type : 'peony';
  const size = SIZES[raw.size] ? raw.size : 'large';
  const d = dims(type, size);
  const T = TYPES[type];
  return {
    type, size,
    radius: num(raw.radius, d.radius),
    fallSpeed: num(raw.fallSpeed, d.fallSpeed),
    life: num(raw.life, d.life),
    tauSpread: num(raw.tauSpread, T.tauSpread),
    spdSpread: num(raw.spdSpread, T.spdSpread),
    lifeSpread: num(raw.lifeSpread, T.lifeSpread),
    flat: num(raw.flat, T.flat),
    crackle: num(raw.crackle, T.crackle),
    colors: normColors(raw.colors, 'gold'),
    ...lateWindow(raw),
    delay: clamp(num(raw.delay, 0), 0, 2),
    split: normalizeSplit(raw.split),
  };
}

export function normalizeRecipe(raw, i) {
  const shells = (Array.isArray(raw.shells) ? raw.shells : []).map(normalizeShell);
  return {
    name: String(raw.name || `RECIPE ${i + 1}`),
    // on を省略したら有効。無効化したものだけ "on": false を持つ
    on: raw.on !== false,
    shells: shells.length ? shells : [normalizeShell({})],
  };
}

/* UI の「+ SHELL」「+ SPLIT」用。既存の玉に寄せた初期値を入れておくと、
   足した瞬間に見えないほど小さい・短いといった事故が起きない */
export function newShell(base) {
  return normalizeShell({
    type: base?.type || 'peony',
    size: 'medium',
    colors: [COLOR_KEYS[(Math.random() * COLOR_KEYS.length) | 0]],
    delay: 0.08,
  });
}

export function newSplit(parent) {
  return normalizeSplit({
    at: 0.45,
    type: 'peony',
    size: parent?.size === 'large' ? 'small' : 'tiny',
    colors: [COLOR_KEYS[(Math.random() * COLOR_KEYS.length) | 0]],
  });
}

/* ------------------------------------------------------------ 解決
   ここから先はシェーダの語彙。RADIUS / FALL SPEED / LIFE を
   tau と |v0| に落とす（逆算の式は presets.js 冒頭のコメント）。 */
export function resolveShell(spec, g) {
  const tau = Math.max(0.05, spec.fallSpeed / g);
  const out = {
    tau,
    speed: spec.radius / tau,
    life: spec.life,
    flat: spec.flat,
    crackle: spec.crackle,
    tauSpread: spec.tauSpread,
    spdSpread: spec.spdSpread,
    lifeSpread: spec.lifeSpread,
    palA: palette(spec.colors),
    lateA: spec.colorLate ? COLORS[spec.colorLate] : null,
    lateTA: [spec.lateFrom, spec.lateTo],

    splitT: 0,
    splitSpread: 0,
    tau2: 1, speed2: 0, inherit: 0,
    palB: palette(spec.colors),
    lateB: null,
    lateTB: [spec.lateFrom, spec.lateTo],
  };

  if (spec.split) {
    const s = spec.split;
    const tau2 = Math.max(0.05, s.fallSpeed / g);
    out.splitT = s.at * spec.life;
    out.splitSpread = s.spread;
    out.tau2 = tau2;
    out.speed2 = s.radius / tau2;
    out.inherit = s.inherit;
    out.palB = palette(s.colors);
    out.lateB = s.colorLate ? COLORS[s.colorLate] : null;
    out.lateTB = [s.lateFrom, s.lateTo];
    // 総寿命は「分裂まで＋子の寿命」。シェーダには合計だけを渡す
    out.life = out.splitT + s.life;
    // クラックルは最終段に出したいので、分裂する玉では子の値を使う
    out.crackle = s.crackle;
  }
  return out;
}

/* パレットをシェーダの vec3[MAX_PAL] に詰める。
   余りは 0 埋めでよい（uPalAN より先は引かれない） */
function palette(names) {
  const buf = new Float32Array(MAX_PAL * 3);
  const n = Math.min(names.length, MAX_PAL);
  for (let i = 0; i < n; i++) {
    const c = COLORS[names[i]] || COLORS.gold;
    buf[i * 3] = c[0]; buf[i * 3 + 1] = c[1]; buf[i * 3 + 2] = c[2];
  }
  return { buf, n: Math.max(1, n) };
}

/* ------------------------------------------------------------ 読み込み */
export async function loadRecipes(url = 'recipes.json') {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data.recipes) ? data.recipes : [];
  if (!list.length) throw new Error(`${url}: recipes[] is empty`);
  return list.map(normalizeRecipe);
}

const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
