// world.js — 4096x4096 のセル配列を表面・裏面の 2 枚ぶん持つ。非空セルの管理（チャンク数）と、HOLE の対の維持
// セル番号 i = (面 << 24) | (y << 12) | x。面 0 = FRONT、面 1 = BACK。番号の組み立て・分解はここの関数・定数だけで行う
// （速さが要るループは、関数を呼ばずに X_MASK / Y_SHIFT / LAYER_SHIFT を直接使う）
import { M } from './materials.js';

export const W = 4096, H = 4096;
const N = W * H, N2 = N * 2;   // N = 1 面のセル数
const LAYER_SHIFT = 24;
export const X_MASK = W - 1, Y_SHIFT = 12;
export const CH_SHIFT = 6, CH_SIZE = 64, CH_MASK = CH_SIZE - 1, CHX = W >> CH_SHIFT, CHN = CHX * CHX;
export const LAYER_NAMES = ['FRONT', 'BACK'];

export const cellIndex = (layer, x, y) => (layer << LAYER_SHIFT) + (y << Y_SHIFT) + x;
export const cellX = (i) => i & X_MASK;
export const cellY = (i) => (i >> Y_SHIFT) & X_MASK;
export const cellLayer = (i) => i >> LAYER_SHIFT;
export const layerBase = (layer) => layer << LAYER_SHIFT;   // 面の先頭のセル番号
export const otherLayer = (i) => i ^ N;                     // 反対の面の同じ位置（HOLE の対）
export const inCanvas = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

export class World {
  constructor() {
    this.mat = new Uint8Array(N2);
    this.aux = new Uint8Array(N2);      // LAMP: 色 / TFF: bit0 初期状態の ON（実行中の状態は topo 側）
    this.owner = new Int32Array(N2);    // トポロジー作り直し時に振る要素 ID
    this.chunkCount = new Uint32Array(CHN * 2);
    this.nonEmpty = 0;
    this.dirty = true;                  // トポロジー要再構築
    this.version = 0;                   // 画面再描画・自動保存のトリガ
    this.recorder = null;
    this.touched = null;
  }

  // 1 セルを書く。HOLE は常に両面の同じ位置に対で存在させる
  //  - HOLE を置く：もう一方の面の同じ位置も HOLE で上書きする
  //  - HOLE の上に別の素材（EMPTY を含む）を置く：HOLE を両面から消してから置く
  edit(i, m, a) {
    const om = this.mat[i];
    if (om === m && this.aux[i] === a) return false;
    if (om === M.HOLE && m !== M.HOLE) this.setRaw(otherLayer(i), 0, 0);
    else if (m === M.HOLE) this.setRaw(otherLayer(i), M.HOLE, 0);
    this.setRaw(i, m, a);
    return true;
  }

  // 対の処理なしの書き込み（UNDO / REDO 用。記録された状態は対が保たれている）
  setRaw(i, m, a) {
    const om = this.mat[i];
    if (om === m && this.aux[i] === a) return false;
    this.dirty = true;
    if (this.recorder) this.recorder.touch(i, om, this.aux[i]);
    if (om === 0 && m !== 0) { this.chunkCount[this.chunkOf(i)]++; this.nonEmpty++; }
    else if (om !== 0 && m === 0) { this.chunkCount[this.chunkOf(i)]--; this.nonEmpty--; }
    this.mat[i] = m; this.aux[i] = a;
    this.version++;
    return true;
  }

  chunkOf(i) { return cellLayer(i) * CHN + (cellY(i) >> CH_SHIFT) * CHX + (cellX(i) >> CH_SHIFT); }

  // 非空セルを含むチャンクごとに fn(x0, y0, base) を呼ぶ（base = 面 << 24）。mask: bit0 = FRONT, bit1 = BACK
  forChunks(fn, mask = 3) {
    for (let l = 0; l < 2; l++) {
      if (!(mask & (1 << l))) continue;
      const o = l * CHN, base = layerBase(l);
      for (let cy = 0; cy < CHX; cy++) for (let cx = 0; cx < CHX; cx++) {
        if (this.chunkCount[o + cy * CHX + cx]) fn(cx << CH_SHIFT, cy << CH_SHIFT, base);
      }
    }
  }

  forEachNonEmpty(fn, mask = 3) {
    const mat = this.mat;
    this.forChunks((x0, y0, base) => {
      for (let y = y0; y < y0 + CH_SIZE; y++) {
        let i = base + (y << Y_SHIFT) + x0;
        for (let x = 0; x < CH_SIZE; x++, i++) if (mat[i]) fn(i);
      }
    }, mask);
  }

  // 非空セルを囲む最小矩形（mask の面だけ）。空なら null
  bounds(mask = 3) {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    this.forEachNonEmpty((i) => {
      const x = cellX(i), y = cellY(i);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }, mask);
    return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  beginRecord() {
    if (!this.touched) this.touched = new Uint8Array(N2);
    this.recorder = new Recorder(this);
  }
  endRecord() {
    const r = this.recorder; this.recorder = null;
    return r ? r.finish() : null;
  }
}

class Recorder {
  constructor(world) {
    this.world = world; this.n = 0;
    this.idx = new Int32Array(4096); this.om = new Uint8Array(4096); this.oa = new Uint8Array(4096);
  }
  touch(i, om, oa) {
    const t = this.world.touched;
    if (t[i]) return;
    t[i] = 1;
    if (this.n === this.idx.length) {
      const g = (a, C) => { const b = new C(a.length * 2); b.set(a); return b; };
      this.idx = g(this.idx, Int32Array); this.om = g(this.om, Uint8Array); this.oa = g(this.oa, Uint8Array);
    }
    this.idx[this.n] = i; this.om[this.n] = om; this.oa[this.n] = oa; this.n++;
  }
  finish() {
    const w = this.world, t = w.touched, n = this.n;
    let keep = 0;
    const idx = this.idx, om = this.om, oa = this.oa;
    const nm = new Uint8Array(n), na = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const i = idx[k]; t[i] = 0;
      if (w.mat[i] !== om[k] || w.aux[i] !== oa[k]) {
        idx[keep] = i; om[keep] = om[k]; oa[keep] = oa[k]; nm[keep] = w.mat[i]; na[keep] = w.aux[i]; keep++;
      }
    }
    if (!keep) return null;
    return { n: keep, idx: idx.slice(0, keep), om: om.slice(0, keep), oa: oa.slice(0, keep), nm: nm.slice(0, keep), na: na.slice(0, keep) };
  }
}

export function applyEntry(world, e, undo) {
  const m = undo ? e.om : e.nm, a = undo ? e.oa : e.na;
  for (let k = 0; k < e.n; k++) world.setRaw(e.idx[k], m[k], a[k]);
}
