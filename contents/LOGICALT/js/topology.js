// topology.js — セルからネット・入口/出口の塊・ゲートの接続表を作る（SPEC 2節）
// 全 1600 万セル x 2 面は走査せず、非空セルを含むチャンクだけ読む。
// CROSS は透明なセル：隣を調べるとき CROSS を飛ばし、通り抜けた先の最初の CROSS 以外のセルを隣接とみなす。
import { M, isNet, isBody, lampColorOf, tffOnOf } from './materials.js';
import { initState } from './sim.js';
import { W, CH_SIZE, X_MASK, Y_SHIFT, cellLayer, otherLayer } from './world.js';

let cap = 0;
let scratch = null; // 再利用する作業バッファ

function ensure(cells) {
  if (cells <= cap && scratch) return;
  cap = Math.max(1024, cells + (cells >> 1));
  scratch = { cells: new Int32Array(cap), edges: [] };
  for (let k = 0; k < 5; k++) scratch.edges.push({ a: new Int32Array(cap * 2 + 8), b: new Int32Array(cap * 2 + 8), n: 0 });
}

function find(p, x) {
  while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; }
  return x;
}
function union(p, a, b) {
  a = find(p, a); b = find(p, b);
  if (a !== b) { if (a < b) p[b] = a; else p[a] = b; }
}
const identity = (n) => { const p = new Int32Array(n); for (let k = 0; k < n; k++) p[k] = k; return p; };
// 根ごとに 0.. の番号を振る。返り値 { map: 元の番号 -> 新しい番号, count }
function compress(p, n) {
  const map = new Int32Array(n), root = new Int32Array(n).fill(-1);
  let count = 0;
  for (let k = 0; k < n; k++) {
    const r = find(p, k);
    if (root[r] < 0) root[r] = count++;
    map[k] = root[r];
  }
  return { map, count };
}

// Edge 種別（a -> b）
//  0 出口の塊 -> ネット
//  1 出口の塊 -> 入口の塊
//  2 ネット   -> 入口の塊
//  3 入口の塊 -> ゲート
//  4 ゲート   -> 出口の塊

export function rebuild(world) {
  const t0 = performance.now();
  const mat = world.mat, aux = world.aux, owner = world.owner;
  ensure(world.nonEmpty + 16);
  const cells = scratch.cells, E = scratch.edges;
  for (const e of E) e.n = 0;

  // pass 1: ID を振る（CROSS は cells に入れない）
  let nc = 0, nodeCnt = 0, inCnt = 0, outCnt = 0, bodyCnt = 0, crossCnt = 0;
  world.forChunks((x0, y0, base) => {
    for (let y = y0; y < y0 + CH_SIZE; y++) {
      let i = base + (y << Y_SHIFT) + x0;
      for (let x = 0; x < CH_SIZE; x++, i++) {
        const m = mat[i];
        if (!m) continue;
        if (m === M.CROSS) { owner[i] = crossCnt++; continue; }
        cells[nc++] = i;
        switch (m) {
          case M.WIRE: case M.HOLE: owner[i] = nodeCnt++; break;
          case M.INPUT: owner[i] = inCnt++; break;
          case M.OUTPUT: owner[i] = outCnt++; break;
          default: owner[i] = bodyCnt++; // INVERT / TFF / LAMP / BUFFER
        }
      }
    }
  });

  const nodeP = identity(nodeCnt), inP = identity(inCnt), outP = identity(outCnt), bodyP = identity(bodyCnt);
  const bodyCells = new Int32Array(bodyCnt);
  // CROSS を通る縦横の線がどのノードか（表示用）。[2c] = 横, [2c+1] = 縦。-1 = 通していない
  const crossNode = new Int32Array(crossCnt * 2).fill(-1);

  const push = (k, a, b) => { const e = E[k]; e.a[e.n] = a; e.b[e.n] = b; e.n++; };

  // 一方向の接続 src -> dst
  const oneWay = (src, ms, dst, md) => {
    if (ms === M.OUTPUT) {
      if (isNet(md)) push(0, owner[src], owner[dst]);
      else if (md === M.INPUT) push(1, owner[src], owner[dst]);
    } else if (isNet(ms)) {
      if (md === M.INPUT) push(2, owner[src], owner[dst]);
    } else if (ms === M.INPUT) {
      if (isBody(md)) push(3, owner[src], owner[dst]);
    } else if (isBody(ms)) {
      if (md === M.OUTPUT) push(4, owner[src], owner[dst]);
    }
  };
  const pair = (a, ma, b, mb) => {
    if (isNet(ma) && isNet(mb)) union(nodeP, owner[a], owner[b]);
    else if (ma === M.INPUT && mb === M.INPUT) union(inP, owner[a], owner[b]);
    else if (ma === M.OUTPUT && mb === M.OUTPUT) union(outP, owner[a], owner[b]);
    else if (ma === mb && isBody(ma)) {
      // 同じ素材の塊。LAMP は同じ色どうしだけ
      if (ma !== M.LAMP || lampColorOf(aux[a]) === lampColorOf(aux[b])) union(bodyP, owner[a], owner[b]);
    } else {
      oneWay(a, ma, b, mb);
      oneWay(b, mb, a, ma);
    }
  };
  // i から step 方向へ、CROSS を飛ばした先の最初のセル。なければ -1。rem = 端までの残りセル数
  const next = (i, step, rem) => {
    while (rem > 0) {
      i += step; rem--;
      const m = mat[i];
      if (m !== M.CROSS) return m ? i : -1;
    }
    return -1;
  };
  // a と b の間の CROSS に、通っているノードを書く（a か b がネットのとき）
  const markCross = (a, b, step, h) => {
    const na = isNet(mat[a]) ? owner[a] : -1, nb = isNet(mat[b]) ? owner[b] : -1;
    const node = na >= 0 ? na : nb;
    if (node < 0) return;
    for (let c = a + step; c !== b; c += step) crossNode[owner[c] * 2 + h] = node;
  };

  for (let k = 0; k < nc; k++) {
    const i = cells[k], m = mat[i];
    if (isBody(m)) bodyCells[owner[i]] = i;
    else if (m === M.HOLE && cellLayer(i) === 0) { const j = otherLayer(i); if (mat[j] === M.HOLE) union(nodeP, owner[i], owner[j]); }
    const x = i & X_MASK, y = (i >> Y_SHIFT) & X_MASK;
    if (x !== X_MASK) {
      const j = next(i, 1, X_MASK - x);
      if (j >= 0) { pair(i, m, j, mat[j]); if (j !== i + 1) markCross(i, j, 1, 0); }
    }
    if (y !== X_MASK) {
      const j = next(i, W, X_MASK - y);
      if (j >= 0) { pair(i, m, j, mat[j]); if (j !== i + W) markCross(i, j, W, 1); }
    }
  }

  // 圧縮
  const nodes = compress(nodeP, nodeCnt), ins = compress(inP, inCnt), outs = compress(outP, outCnt), bodies = compress(bodyP, bodyCnt);
  const nodeNet = nodes.map, netCount = nodes.count, inMap = ins.map, outMap = outs.map, bodyGate = bodies.map, gateCount = bodies.count;
  const inBlocks = ins.count, outBlocks = outs.count;

  for (let k = 0; k < E[0].n; k++) { E[0].a[k] = outMap[E[0].a[k]]; E[0].b[k] = nodeNet[E[0].b[k]]; }
  for (let k = 0; k < E[1].n; k++) { E[1].a[k] = outMap[E[1].a[k]]; E[1].b[k] = inMap[E[1].b[k]]; }
  for (let k = 0; k < E[2].n; k++) { E[2].a[k] = nodeNet[E[2].a[k]]; E[2].b[k] = inMap[E[2].b[k]]; }
  for (let k = 0; k < E[3].n; k++) { E[3].a[k] = inMap[E[3].a[k]]; E[3].b[k] = bodyGate[E[3].b[k]]; }
  for (let k = 0; k < E[4].n; k++) { E[4].a[k] = bodyGate[E[4].a[k]]; E[4].b[k] = outMap[E[4].b[k]]; }
  // INPUT / OUTPUT のセルは、塊の番号を owner に持たせる（表示用）
  for (let k = 0; k < nc; k++) {
    const i = cells[k], m = mat[i];
    if (m === M.INPUT) owner[i] = inMap[owner[i]];
    else if (m === M.OUTPUT) owner[i] = outMap[owner[i]];
  }
  const crossNet = new Int32Array(crossCnt * 2);
  for (let c = 0; c < crossCnt * 2; c++) crossNet[c] = crossNode[c] < 0 ? -1 : nodeNet[crossNode[c]];

  // ゲート種別。TFF の初期状態は塊のセルの OR にそろえる。LAMP の aux は色だけ
  const gateType = new Uint8Array(gateCount), gateOut = new Uint8Array(gateCount), gatePrev = new Uint8Array(gateCount);
  const tffOn = new Uint8Array(gateCount);
  for (let b = 0; b < bodyCnt; b++) {
    const c = bodyCells[b], g = bodyGate[b];
    gateType[g] = mat[c];
    if (mat[c] === M.TFF && tffOnOf(aux[c])) tffOn[g] = 1;
  }
  for (let b = 0; b < bodyCnt; b++) {
    const c = bodyCells[b];
    if (mat[c] === M.TFF) aux[c] = tffOn[bodyGate[b]];
    else if (mat[c] === M.LAMP) aux[c] = lampColorOf(aux[c]);
    else aux[c] = 0;
  }

  // LAMP のゲート（残光用）
  const isLampGate = new Uint8Array(gateCount);
  let lampCount = 0;
  for (let g = 0; g < gateCount; g++) if (gateType[g] === M.LAMP) { isLampGate[g] = 1; lampCount++; }
  const lampGates = new Int32Array(lampCount);
  { let q = 0; for (let g = 0; g < gateCount; g++) if (isLampGate[g]) lampGates[q++] = g; }

  // 同じティックのうちにたどる向き付きのつながり（隣接表）。作り直しのときに作り、毎ティックはたどるだけ
  // 節点の番号：[出口の塊 | ネット | 入口の塊] を 1 本につなげたもの。信号の値 vis は 1 本の配列で、各種別の値はその一部（subarray）
  const OFF_NET = outBlocks, OFF_IN = OFF_NET + netCount, total = OFF_IN + inBlocks;
  const adjStart = new Int32Array(total + 1);
  const eachEdge = (fn) => {
    let e = E[0]; for (let k = 0; k < e.n; k++) fn(e.a[k], OFF_NET + e.b[k]);            // 出口 -> ネット
    e = E[1]; for (let k = 0; k < e.n; k++) fn(e.a[k], OFF_IN + e.b[k]);                 // 出口 -> 入口
    e = E[2]; for (let k = 0; k < e.n; k++) fn(OFF_NET + e.a[k], OFF_IN + e.b[k]);       // ネット -> 入口
  };
  eachEdge((a) => { adjStart[a + 1]++; });
  for (let k = 0; k < total; k++) adjStart[k + 1] += adjStart[k];
  const adj = new Int32Array(adjStart[total]), fillAt = adjStart.slice(0, total);
  eachEdge((a, b) => { adj[fillAt[a]++] = b; });
  const vis = new Uint8Array(total);

  const topo = {
    cells: nc, nodeCnt, netCount, inCnt: inBlocks, outCnt: outBlocks, bodyCnt, gateCount,
    nodeNet, bodyGate, bodyCells, gateType, gateOut, gatePrev, crossNet,
    gateIn: new Uint8Array(gateCount),
    vis, adjStart, adj, stack: new Int32Array(total + 1),
    outVal: vis.subarray(0, outBlocks), netVal: vis.subarray(OFF_NET, OFF_IN), inVal: vis.subarray(OFF_IN, total),
    gateFade: new Float32Array(gateCount), lampGates,
    E, ms: 0, ticks: 0,
  };
  world.dirty = false;
  initState(topo, world);
  topo.ms = performance.now() - t0;
  return topo;
}
