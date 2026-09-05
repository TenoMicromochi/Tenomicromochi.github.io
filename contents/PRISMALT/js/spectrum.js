// ============================================================================
// 分光の核（SPEC 版）。光と素材を分けて持ち、吸光度で扱う。
//
//   XYZ(d, t) = ∫ S(λ) · exp(-A_mix(λ, t)·d) · x̄ȳz̄(λ) dλ
//
//   S(λ)        発光スペクトル（光）      : SPEC §2 で固定。1つの設定でシーン全体を照らす
//   A_mix(λ,t)  2つの吸収スペクトルのブレンド : A_mix = (1-t)·A_A + t·A_B  （SPEC §4.3）
//   d           光路長                    : Beer-Lambert。A に掛かるだけの純粋な掛け算
//
// 帯は λ0 / 振幅 / Q の3つで持つ。Q = λ0 / FWHM なので σ = λ0 / (Q · 2.3548)。
// Q が小さいほど広帯域、大きいほど単波長（レーザー）。
// cmf.js / colorspace.js は数式だけの純粋モジュールなので転換前からそのままコピーしている。
// ============================================================================

import { LMIN, LSTEP, N, CMF, lamOf } from './cmf.js';
import { XYZ2RGB, hexOf, gamutMap } from './colorspace.js';

export const sigmaOf = (l0, Q) => l0 / (Math.max(0.2, Q) * 2.3548);
export const gauss = (l, p) => {
  const t = (l - p.l) / sigmaOf(p.l, p.q);
  return Math.exp(-0.5 * t * t);
};

// 黒体放射（Planck）。380-780 の最大値で 0..1 に正規化
export function planckNorm(T){
  const out = new Float64Array(N);
  let mx = 0;
  for (let i = 0; i < N; i++){
    const x = lamOf(i) * 1e-9;
    out[i] = 1 / (Math.pow(x, 5) * (Math.exp(1.4388e-2 / (x * T)) - 1));
    if (out[i] > mx) mx = out[i];
  }
  for (let i = 0; i < N; i++) out[i] /= mx || 1;
  return out;
}

// 発光スペクトル。連続光（フラット or 黒体）+ ガウス帯の単純加算。クランプしない。
// 光の重ね合わせは加算が物理なので、ここでクランプすると「レーザー2本を足す」が壊れる。
// 明るさは後段の露出で吸収する
export function buildEmission(light){
  const bb = light.bb ? planckNorm(light.K) : null;
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++){
    const l = lamOf(i);
    let v = light.base * (bb ? bb[i] : 1);
    for (const p of light.peaks) v += p.a * gauss(l, p);
    out[i] = v;
  }
  return out;
}

// ベースライン + ガウス帯の加算で吸光度スペクトルを組む。
// 吸光度で加算 = 透過率で乗算。フィルタの重ね合わせがこれで正しくなる
export function absFromPeaks(base, peaks){
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++){
    const l = lamOf(i);
    let v = base;
    for (const p of peaks) v += p.a * gauss(l, p);
    out[i] = v;
  }
  return out;
}
export const absOf = g => absFromPeaks(g.base, g.peaks);

// A_mix(λ) = (1-t)·A_A(λ) + t·A_B(λ)。吸光度は「混ぜたら足し算」なので中間値が素直に作れる
export function blendAbs(A, B, t){
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++) out[i] = (1 - t) * A[i] + t * B[i];
  return out;
}

// 白色点。wb=1 で「その光自身が白に見える」（順応）、0 で「光の色がそのまま乗る」（カメラ）
export function normFor(S, wb){
  let X = 0, Y = 0, Z = 0;
  for (let i = 0; i < N; i++){ X += S[i]*CMF[i*3]; Y += S[i]*CMF[i*3+1]; Z += S[i]*CMF[i*3+2]; }
  const e = 1e-9;
  const full = [0.95047/(X+e), 1/(Y+e), 1.08883/(Z+e)];
  const none = [1/(Y+e), 1/(Y+e), 1/(Y+e)];
  return full.map((v, i) => none[i]*(1-wb) + v*wb);
}

// 「素材そのものの色」を見るための等エネルギー白。光の設定に影響されない基準にする
export const WHITE = new Float64Array(N).fill(1);

// S(λ)·exp(-A(λ)·d) を積分してリニアsRGBへ。指数が乗るのは A だけ
export function integrate(S, A, d, nrm){
  let X = 0, Y = 0, Z = 0;
  for (let i = 0; i < N; i++){
    const e = S[i] * Math.exp(-A[i] * d);
    X += e*CMF[i*3]; Y += e*CMF[i*3+1]; Z += e*CMF[i*3+2];
  }
  X *= nrm[0]; Y *= nrm[1]; Z *= nrm[2];
  return XYZ2RGB.map(r => r[0]*X + r[1]*Y + r[2]*Z);
}

// 波長 -> 表示用の色（帯エディタの下に敷く可視光の帯）。CMF そのものから作るので自己完結
const waveCache = new Map();
export function waveColor(l){
  const k = Math.round(l);
  let h = waveCache.get(k);
  if (h) return h;
  const f = (k - LMIN) / LSTEP, i = Math.max(0, Math.min(N-2, Math.floor(f))), t = f - i;
  const X = CMF[i*3]  *(1-t) + CMF[(i+1)*3]  *t;
  const Y = CMF[i*3+1]*(1-t) + CMF[(i+1)*3+1]*t;
  const Z = CMF[i*3+2]*(1-t) + CMF[(i+1)*3+2]*t;
  let c = XYZ2RGB.map(r => r[0]*X + r[1]*Y + r[2]*Z);
  const mx = Math.max(c[0], c[1], c[2], 1e-6);
  h = hexOf(gamutMap(c.map(v => v/mx)));
  waveCache.set(k, h);
  return h;
}

export { N } from './cmf.js';
