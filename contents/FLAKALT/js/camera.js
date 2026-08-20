/* ============================================================
   FLAKALT — camera.js
   ワールド座標系と、そこから画面へ落とすところ。

   座標系は X=東 / Y=上 / Z=北 の右手系。距離の単位は全部メートル。
   砲は原点 (0, 銃身高, 0) に据えてあり、カメラは砲の向きそのもの。

   投影は素直な透視投影。ニアプレーンでの線分クリップだけ自前で持つ
   （後ろに回った点をそのまま割ると画面の反対側に線が飛ぶため）。
   ============================================================ */

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
const NEAR = 0.35;

/* 口径の対数上でアンカー表を補間する。表は [口径, 値] の昇順。

   節点そのものの口径では表の値がそのまま返るので、砲を増やしても
   既存の調整値（発砲音の 7.7 / 12.7 / 20 / 40mm や砲身の太さ）は
   1 も動かないまま、間の口径だけが埋まる。
   geometric を立てると値も対数側で補間する（周波数のように
   桁で効く量に使う）。 */
export function lerpByCaliber(table, cal, geometric = false) {
  const n = table.length;
  if (cal <= table[0][0]) return table[0][1];
  if (cal >= table[n - 1][0]) return table[n - 1][1];
  for (let i = 1; i < n; i++) {
    const [c0, v0] = table[i - 1];
    const [c1, v1] = table[i];
    if (cal > c1) continue;
    const f = (Math.log(cal) - Math.log(c0)) / (Math.log(c1) - Math.log(c0));
    if (geometric) return Math.exp(Math.log(v0) + (Math.log(v1) - Math.log(v0)) * f);
    return v0 + (v1 - v0) * f;
  }
  return table[n - 1][1];
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }

/* -180..180 に畳む */
export function wrapDeg(a) {
  a = (a + 180) % 360;
  if (a < 0) a += 360;
  return a - 180;
}

/* a から b への最短角度差 */
export function angleDelta(a, b) { return wrapDeg(b - a); }

export class Camera {
  constructor() {
    this.x = 0; this.y = 0; this.z = 0;
    this.yaw = 0;    // 度。0 = 北(+Z)、90 = 東(+X)
    this.pitch = 0;  // 度。+ が上
    this.fov = 52;   // 水平画角（度）

    this.vx = 0; this.vy = 0; this.vw = 640; this.vh = 320;
    this.setViewport(0, 0, 640, 320);
    this.update();
  }

  setViewport(x, y, w, h) {
    this.vx = x; this.vy = y; this.vw = w; this.vh = h;
    this.ccx = x + w / 2;
    this.ccy = y + h / 2;
    this.update();
  }

  update() {
    const cy = Math.cos(this.yaw * DEG), sy = Math.sin(this.yaw * DEG);
    const cp = Math.cos(this.pitch * DEG), sp = Math.sin(this.pitch * DEG);

    // 前方
    this.fx = cp * sy; this.fy = sp; this.fz = cp * cy;
    // 右（ワールドの上と前方の外積）
    this.rx = cy; this.ry = 0; this.rz = -sy;
    // 上（前方 x 右）
    this.ux = this.fy * this.rz - this.fz * this.ry;
    this.uy = this.fz * this.rx - this.fx * this.rz;
    this.uz = this.fx * this.ry - this.fy * this.rx;

    this.focal = (this.vw / 2) / Math.tan(this.fov * DEG / 2);
    // 画面中心 1px あたりの角度（ミル換算やリード表示に使う）
    this.pxPerRad = this.focal;
  }

  /* ワールド → カメラ座標。戻り値は使い回しの一時オブジェクト。 */
  toCam(x, y, z, out) {
    const dx = x - this.x, dy = y - this.y, dz = z - this.z;
    out.x = dx * this.rx + dy * this.ry + dz * this.rz;
    out.y = dx * this.ux + dy * this.uy + dz * this.uz;
    out.z = dx * this.fx + dy * this.fy + dz * this.fz;
    return out;
  }

  /* カメラ座標 → 画面。z > NEAR であること。 */
  projX(cx, cz) { return this.ccx + (cx / cz) * this.focal; }
  projY(cy, cz) { return this.ccy - (cy / cz) * this.focal; }

  /* 点をひとつ投影する。画面外/背面なら null。 */
  project(x, y, z, out) {
    const c = this.toCam(x, y, z, _t0);
    if (c.z <= NEAR) return null;
    out.x = this.projX(c.x, c.z);
    out.y = this.projY(c.y, c.z);
    out.z = c.z;
    return out;
  }

  /* 線分を描く。ニアプレーンで切ってから 2D のクリッパに渡す。 */
  line3(r, ax, ay, az, bx, by, bz, color) {
    const a = this.toCam(ax, ay, az, _t0);
    let a_x = a.x, a_y = a.y, a_z = a.z;
    const b = this.toCam(bx, by, bz, _t1);
    let b_x = b.x, b_y = b.y, b_z = b.z;

    if (a_z <= NEAR && b_z <= NEAR) return;
    if (a_z <= NEAR) {
      const t = (NEAR - a_z) / (b_z - a_z);
      a_x += (b_x - a_x) * t; a_y += (b_y - a_y) * t; a_z = NEAR;
    } else if (b_z <= NEAR) {
      const t = (NEAR - b_z) / (a_z - b_z);
      b_x += (a_x - b_x) * t; b_y += (a_y - b_y) * t; b_z = NEAR;
    }

    const sx0 = this.projX(a_x, a_z), sy0 = this.projY(a_y, a_z);
    const sx1 = this.projX(b_x, b_z), sy1 = this.projY(b_y, b_z);

    // 画面から極端に外れた座標は Bresenham に渡す前に潰しておく
    const L = 12000;
    if ((sx0 < -L && sx1 < -L) || (sx0 > L && sx1 > L)) return;
    if ((sy0 < -L && sy1 < -L) || (sy0 > L && sy1 > L)) return;

    r.line(clamp(sx0, -L, L), clamp(sy0, -L, L),
      clamp(sx1, -L, L), clamp(sy1, -L, L), color);
  }

  /* 地平線の画面 Y。ピッチだけで決まる（ロールしないので水平のまま）。 */
  horizonY() {
    return this.ccy + Math.tan(this.pitch * DEG) * this.focal;
  }

  /* ワールド方向 → 方位角/仰角（度） */
  static bearingOf(dx, dz) { return Math.atan2(dx, dz) * RAD; }
  static elevationOf(dx, dy, dz) {
    return Math.atan2(dy, Math.hypot(dx, dz)) * RAD;
  }
}

const _t0 = { x: 0, y: 0, z: 0 };
const _t1 = { x: 0, y: 0, z: 0 };
export const scratch = { x: 0, y: 0, z: 0 };

/* --- 姿勢行列 -------------------------------------------------
   機体のローカル座標（+Z 前 / +Y 上 / +X 右）をワールドへ回す。
   ヨー → ピッチ → ロール の順。9 要素の行ベクトル並び。
   --------------------------------------------------------------- */
export function orientation(yawDeg, pitchDeg, rollDeg, m) {
  const cy = Math.cos(yawDeg * DEG), sy = Math.sin(yawDeg * DEG);
  const cp = Math.cos(pitchDeg * DEG), sp = Math.sin(pitchDeg * DEG);
  const cr = Math.cos(rollDeg * DEG), sr = Math.sin(rollDeg * DEG);

  // ロール（Z軸）
  const r00 = cr, r01 = sr, r02 = 0;
  const r10 = -sr, r11 = cr, r12 = 0;
  const r20 = 0, r21 = 0, r22 = 1;
  // ピッチ（X軸）
  const p00 = 1, p01 = 0, p02 = 0;
  const p10 = 0, p11 = cp, p12 = sp;
  const p20 = 0, p21 = -sp, p22 = cp;
  // ヨー（Y軸）
  const y00 = cy, y01 = 0, y02 = sy;
  const y10 = 0, y11 = 1, y12 = 0;
  const y20 = -sy, y21 = 0, y22 = cy;

  // pr = P * R
  const a00 = p00 * r00 + p01 * r10 + p02 * r20;
  const a01 = p00 * r01 + p01 * r11 + p02 * r21;
  const a02 = p00 * r02 + p01 * r12 + p02 * r22;
  const a10 = p10 * r00 + p11 * r10 + p12 * r20;
  const a11 = p10 * r01 + p11 * r11 + p12 * r21;
  const a12 = p10 * r02 + p11 * r12 + p12 * r22;
  const a20 = p20 * r00 + p21 * r10 + p22 * r20;
  const a21 = p20 * r01 + p21 * r11 + p22 * r21;
  const a22 = p20 * r02 + p21 * r12 + p22 * r22;

  // m = Y * pr
  m[0] = y00 * a00 + y01 * a10 + y02 * a20;
  m[1] = y00 * a01 + y01 * a11 + y02 * a21;
  m[2] = y00 * a02 + y01 * a12 + y02 * a22;
  m[3] = y10 * a00 + y11 * a10 + y12 * a20;
  m[4] = y10 * a01 + y11 * a11 + y12 * a21;
  m[5] = y10 * a02 + y11 * a12 + y12 * a22;
  m[6] = y20 * a00 + y21 * a10 + y22 * a20;
  m[7] = y20 * a01 + y21 * a11 + y22 * a21;
  m[8] = y20 * a02 + y21 * a12 + y22 * a22;
  return m;
}
