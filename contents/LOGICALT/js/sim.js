// sim.js — 信号の計算と 1 ティック（SPEC 3節）
import { M, tffOnOf } from './materials.js';

// 現在のゲート出力から、ネット・入口の塊・出口の塊・ゲート入力の値を求める（キャッシュ）
// 源 = 遅延のあるゲートの ON の出力。そこから、向きのあるつながり（出口 -> ネット / 入口、ネット -> 入口、入口の塊への接続）を
// たどり、たどり着けたものを ON にする。たどり着けるかどうかだけで決まるので、ループがあっても発振しない。
// つながりの表（隣接表）は topology.js が作り直しのときに作る。ここはたどるだけ。
export function computeSignals(topo, world) {
  const { E, gateOut, gateIn, vis, adjStart, adj, stack } = topo;
  vis.fill(0); gateIn.fill(0);
  let sp = 0;
  let e = E[4];
  for (let k = 0; k < e.n; k++) if (gateOut[e.a[k]]) { const o = e.b[k]; if (!vis[o]) { vis[o] = 1; stack[sp++] = o; } } // ゲート -> 出口の塊
  while (sp > 0) {
    const n = stack[--sp];
    for (let q = adjStart[n], end = adjStart[n + 1]; q < end; q++) {
      const m = adj[q];
      if (!vis[m]) { vis[m] = 1; stack[sp++] = m; }
    }
  }
  const inVal = topo.inVal;
  e = E[3]; for (let k = 0; k < e.n; k++) if (inVal[e.a[k]]) gateIn[e.b[k]] = 1;  // 入口の塊 -> ゲート
}

// 全ゲートを同時に更新（入力は更新前のキャッシュだけから読む）
export function tick(topo, world) {
  const { gateCount, gateType, gateOut, gatePrev, gateIn } = topo;
  for (let g = 0; g < gateCount; g++) {
    const inp = gateIn[g], t = gateType[g];
    if (t === M.INVERT) gateOut[g] = inp ? 0 : 1;
    else if (t === M.LAMP || t === M.BUFFER) gateOut[g] = inp;
    else {
      if (inp && !gatePrev[g]) gateOut[g] ^= 1;
      gatePrev[g] = inp;
    }
  }
  topo.ticks++;
  computeSignals(topo, world);
}

// 初期状態へ（STOP の状態）：TFF の出力はセルの aux、INVERT と LAMP は OFF。
// TFF の前の入力は、その時点の入力値に合わせる（最初のティックで立ち上がりと誤判定しないため）
export function initState(topo, world) {
  const { bodyCells, bodyGate, gateOut, gatePrev, gateFade, gateIn } = topo;
  const mat = world.mat, aux = world.aux;
  gateOut.fill(0); gatePrev.fill(0);
  for (let b = 0; b < bodyCells.length; b++) {
    const c = bodyCells[b];
    if (mat[c] === M.TFF && tffOnOf(aux[c])) gateOut[bodyGate[b]] = 1;
  }
  computeSignals(topo, world);
  gatePrev.set(gateIn);
  for (let g = 0; g < gateFade.length; g++) gateFade[g] = gateOut[g];
  topo.ticks = 0;
}

// セル i が今 ON か（0 / 1）。素材ごとの規則はここが正本（render.js の描画ループは速さのため同じ規則を展開している）。
// CROSS は、通している縦か横のネットのどちらかが ON なら ON。LAMP / INVERT / TFF / BUFFER はゲートの出力。
export function cellOn(topo, world, i) {
  const owner = world.owner[i];
  switch (world.mat[i]) {
    case M.WIRE: case M.HOLE: return topo.netVal[topo.nodeNet[owner]];
    case M.CROSS: {
      const horizontal = topo.crossNet[owner * 2], vertical = topo.crossNet[owner * 2 + 1];
      return ((horizontal >= 0 && topo.netVal[horizontal]) || (vertical >= 0 && topo.netVal[vertical])) ? 1 : 0;
    }
    case M.INPUT: return topo.inVal[owner];
    case M.OUTPUT: return topo.outVal[owner];
    case M.INVERT: case M.TFF: case M.LAMP: case M.BUFFER: return topo.gateOut[topo.bodyGate[owner]];
    default: return 0;
  }
}
