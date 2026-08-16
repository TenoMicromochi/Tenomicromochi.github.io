/* ============================================================
   FLAKALT — models.js
   ワイヤーフレームのメッシュ定義。

   面は持たない。頂点と稜線だけ。隠面消去もしない（ワイヤーフレームは
   裏側の線が透けて見えるほうがそれらしい）。
   ローカル座標は +Z が機首方向、+Y が上、+X が右。
   ============================================================ */

/* mesh = { v: [[x,y,z]...], e: [[i,j]...], r: 当たり判定半径(ローカル) } */

function mesh(v, e) {
  let r = 0;
  for (const p of v) r = Math.max(r, Math.hypot(p[0], p[1], p[2]));
  return { v, e, r };
}

/* --- 紙飛行機 3種 --------------------------------------------- */

/* いちばん普通の「ダーツ折り」。細くて速い。 */
export const DART = mesh(
  [
    [0.00, 0.00, 1.20],   // 0 機首
    [-0.85, 0.06, -0.90], // 1 左翼端
    [0.85, 0.06, -0.90],  // 2 右翼端
    [-0.30, 0.00, -0.90], // 3 左の折り目
    [0.30, 0.00, -0.90],  // 4 右の折り目
    [0.00, 0.08, -0.90],  // 5 背の後端
    [0.00, -0.30, -0.90], // 6 キール下端
  ],
  [
    [0, 1], [0, 2],          // 前縁
    [0, 3], [0, 4],          // 内側の折り目
    [0, 5], [0, 6], [6, 5],  // 背とキール
    [1, 3], [3, 5], [5, 4], [4, 2], // 後縁
  ]
);

/* 翼を大きく広げた滑空型。遅いが硬い。 */
export const GLIDER = mesh(
  [
    [0.00, 0.00, 1.00],   // 0
    [-1.30, 0.12, -1.00], // 1
    [1.30, 0.12, -1.00],  // 2
    [-0.55, 0.02, -0.50], // 3
    [0.55, 0.02, -0.50],  // 4
    [0.00, 0.10, -1.00],  // 5
    [0.00, -0.22, -1.00], // 6
  ],
  [
    [0, 1], [0, 2],
    [0, 3], [3, 1], [0, 4], [4, 2],
    [0, 5], [0, 6], [6, 5],
    [1, 5], [2, 5],
    [3, 5], [4, 5],
  ]
);

/* 分厚く折り込んだ重爆型。当たり判定も体力も大きい。 */
export const HEAVY = mesh(
  [
    [0.00, 0.00, 1.40],   // 0 機首
    [-0.36, 0.26, 0.20],  // 1 前枠
    [0.36, 0.26, 0.20],   // 2
    [0.36, -0.26, 0.20],  // 3
    [-0.36, -0.26, 0.20], // 4
    [-0.36, 0.26, -1.10], // 5 後枠
    [0.36, 0.26, -1.10],  // 6
    [0.36, -0.26, -1.10], // 7
    [-0.36, -0.26, -1.10],// 8
    [-1.55, 0.10, -0.60], // 9 左翼端
    [1.55, 0.10, -0.60],  // 10 右翼端
    [0.00, 0.85, -1.05],  // 11 垂直尾翼
  ],
  [
    [0, 1], [0, 2], [0, 3], [0, 4],
    [1, 2], [2, 3], [3, 4], [4, 1],
    [5, 6], [6, 7], [7, 8], [8, 5],
    [1, 5], [2, 6], [3, 7], [4, 8],
    [9, 1], [9, 5], [9, 4],
    [10, 2], [10, 6], [10, 3],
    [11, 5], [11, 6],
  ]
);

/* --- 地上物 ---------------------------------------------------- */

export function makeBox(w, h, d) {
  const x = w / 2, z = d / 2;
  return mesh(
    [
      [-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z],
      [-x, h, -z], [x, h, -z], [x, h, z], [-x, h, z],
    ],
    [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ]
  );
}

/* かまぼこ屋根の格納庫 */
export function makeHangar(w, h, d) {
  const b = makeBox(w, h, d);
  const x = w / 2, z = d / 2;
  const ridge = h + w * 0.28;
  const i0 = b.v.length;
  b.v.push([0, ridge, -z], [0, ridge, z]);
  b.e.push([4, i0], [5, i0], [7, i0 + 1], [6, i0 + 1], [i0, i0 + 1]);
  return mesh(b.v, b.e);
}

/* 見張り塔。脚 4 本 + 台 + 空中線 */
export function makeTower(h, base, top) {
  const v = [];
  const e = [];
  const b = base / 2, t = top / 2;
  const foot = [[-b, 0, -b], [b, 0, -b], [b, 0, b], [-b, 0, b]];
  const head = [[-t, h, -t], [t, h, -t], [t, h, t], [-t, h, t]];
  for (const p of foot) v.push(p);
  for (const p of head) v.push(p);
  for (let i = 0; i < 4; i++) {
    e.push([i, (i + 1) % 4]);
    e.push([4 + i, 4 + (i + 1) % 4]);
    e.push([i, 4 + i]);
  }
  // 中段の帯とアンテナ
  const m = v.length;
  const mid = (base + top) / 4;
  for (let i = 0; i < 4; i++) {
    const a = [(i === 1 || i === 2 ? mid : -mid), h * 0.5, (i >= 2 ? mid : -mid)];
    v.push(a);
  }
  for (let i = 0; i < 4; i++) e.push([m + i, m + (i + 1) % 4]);
  v.push([0, h + h * 0.45, 0]);
  e.push([4, v.length - 1], [6, v.length - 1]);
  return mesh(v, e);
}

/* 頂点をワールドへ移してから稜線を引く。
   姿勢行列 m は camera.js の orientation() が作る 9 要素。 */
const _wx = new Float64Array(64);
const _wy = new Float64Array(64);
const _wz = new Float64Array(64);

export function drawMesh(r, cam, ms, px, py, pz, m, scale, color) {
  const v = ms.v;
  const n = v.length;
  for (let i = 0; i < n; i++) {
    const lx = v[i][0] * scale, ly = v[i][1] * scale, lz = v[i][2] * scale;
    _wx[i] = px + m[0] * lx + m[1] * ly + m[2] * lz;
    _wy[i] = py + m[3] * lx + m[4] * ly + m[5] * lz;
    _wz[i] = pz + m[6] * lx + m[7] * ly + m[8] * lz;
  }
  const e = ms.e;
  for (let i = 0; i < e.length; i++) {
    const a = e[i][0], b = e[i][1];
    cam.line3(r, _wx[a], _wy[a], _wz[a], _wx[b], _wy[b], _wz[b], color);
  }
}

/* 回転しない地上物用。行列を組まずに済ませる。 */
export function drawMeshFlat(r, cam, ms, px, py, pz, yawDeg, scale, color) {
  const c = Math.cos(yawDeg * Math.PI / 180), s = Math.sin(yawDeg * Math.PI / 180);
  const v = ms.v;
  for (let i = 0; i < v.length; i++) {
    const lx = v[i][0] * scale, ly = v[i][1] * scale, lz = v[i][2] * scale;
    _wx[i] = px + c * lx + s * lz;
    _wy[i] = py + ly;
    _wz[i] = pz - s * lx + c * lz;
  }
  const e = ms.e;
  for (let i = 0; i < e.length; i++) {
    const a = e[i][0], b = e[i][1];
    cam.line3(r, _wx[a], _wy[a], _wz[a], _wx[b], _wy[b], _wz[b], color);
  }
}

export const PLANE_MESHES = { DART, GLIDER, HEAVY };
