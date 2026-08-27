/* ============================================================
   mat.js — 最小限の行列演算

   three.js を使わない素の WebGL2 実装なので、必要なぶんだけ自前で持つ。
   列優先（column-major）で、そのまま uniformMatrix4fv に渡せる並び。
   ============================================================ */

export function perspective(fovYdeg, aspect, near, far) {
  const f = 1 / Math.tan((fovYdeg * Math.PI / 180) / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

export function lookAt(eye, target, up = [0, 1, 0]) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let l = Math.hypot(zx, zy, zz) || 1;
  zx /= l; zy /= l; zz /= l;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1;
  xx /= l; xy /= l; xz /= l;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1,
  ]);
}

/* 局所 +Y を axis に向ける回転行列（mat3, 列優先）。
   環の玉は分布を局所 XZ 平面に潰して作るので、その法線＝局所 +Y を
   カメラ側へ向けたいときに使う。完全ランダムな向きにすると環が
   真横を向く確率が高く、ただの棒に見えてしまう。 */
export function rotationTo(axis) {
  const [tx, ty, tz] = axis;
  const a = Math.abs(ty) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let xx = a[1] * tz - a[2] * ty;
  let xy = a[2] * tx - a[0] * tz;
  let xz = a[0] * ty - a[1] * tx;
  const l = Math.hypot(xx, xy, xz) || 1;
  xx /= l; xy /= l; xz /= l;
  const zx = ty * xz - tz * xy;
  const zy = tz * xx - tx * xz;
  const zz = tx * xy - ty * xx;
  return new Float32Array([xx, xy, xz, tx, ty, tz, zx, zy, zz]);
}

/* 一様ランダムな回転行列（mat3, 列優先）。
   玉ごとに向きを変えるためだけに使う。単位クォータニオンを一様に引いて変換する。 */
export function randomRotation3() {
  const u1 = Math.random(), u2 = Math.random(), u3 = Math.random();
  const s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
  const x = s1 * Math.sin(2 * Math.PI * u2);
  const y = s1 * Math.cos(2 * Math.PI * u2);
  const z = s2 * Math.sin(2 * Math.PI * u3);
  const w = s2 * Math.cos(2 * Math.PI * u3);

  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;

  return new Float32Array([
    1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy),
    2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx),
    2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy),
  ]);
}
