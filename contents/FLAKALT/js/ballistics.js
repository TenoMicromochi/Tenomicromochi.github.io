/* ============================================================
   FLAKALT — ballistics.js
   弾道。ここがこのゲームの本体。

   運動方程式は
       dv/dt = -k * rho(h) * |v| * v  -  g
   の二乗抗力。k = 0.5 * Cd * A / m を弾ごとに持つ（A は弾丸断面積）。
   空気密度は rho(h) = exp(-h/8500) の指数大気で近似。

   この式だと弾速の距離減衰は v(x) = v0 * exp(-k*rho*x) になるので、
   .303 なら 300m で 744 -> 約 600 m/s、.50 なら 500m で 887 -> 約 690 m/s。
   実測値とほぼ合う。つまり「当てるのに必要なリード量」も実物どおりになる。

   積分は 200Hz 固定ステップ。1 ステップの速度変化は初速の 0.3% 程度なので
   単純な半陰的オイラー + 速度平均で十分持つ。
   ============================================================ */

import { C } from './palette.js';

export const GRAVITY = 9.80665;
const SCALE_HEIGHT = 8500;   // 指数大気のスケールハイト [m]
const MAX_TIME = 24;         // これを超えたら消す [s]
const MAX_RANGE2 = 7500 * 7500;

/* 抗力係数 k を作る。caliber は mm、mass は kg。 */
export function dragFactor(caliberMm, massKg, cd) {
  const rMeters = caliberMm / 2000;
  const area = Math.PI * rMeters * rMeters;
  return 0.5 * cd * area * 1.225 / massKg;
}

/* 距離 R まで飛ぶのにかかる時間。上の抗力モデルの 1 次元解。
   rho は平均的な密度比（低空なら 1 でよい）。 */
export function flightTime(R, v0, k, rho = 0.97) {
  const kk = k * rho;
  if (kk < 1e-9) return R / v0;
  return (Math.exp(kk * R) - 1) / (kk * v0);
}

/* 出した照準点を実弾道で検算して詰める。

   上の解析解は重力が速度に与える影響（鉛直成分が増えたぶん抗力が増える）を
   無視しているので、飛翔時間が 5 秒を超えるあたりから弾が手前に落ちる。
   4000m で 40m ほど。時限信管の砲（40mm ボフォース）はこの時間をそのまま
   信管秒時に使うので、ここがずれると炸裂位置そのものがずれて効いてくる。

   そこで、出した方向へ実際に弾を飛ばしてみて、目標にいちばん近づく瞬間の
   ずれを照準点に足し戻す。ニュートン法の 1 ステップに相当する。
   粗いステップで最接近までしか回さないので、1 回 300 ステップ程度で済む。 */
function refineIntercept(gx, gy, gz, tx, ty, tz, tvx, tvy, tvz, v0, k, out) {
  const dt = 1 / 100;
  for (let pass = 0; pass < 2; pass++) {
    let dx = out.x - gx, dy = out.y - gy, dz = out.z - gz;
    const len = Math.hypot(dx, dy, dz);
    if (!(len > 1)) return;
    dx /= len; dy /= len; dz /= len;

    let x = gx, y = gy, z = gz;
    let vx = dx * v0, vy = dy * v0, vz = dz * v0;
    let best = Infinity, bt = 0, bx = x, by = y, bz = z;
    let rising = 0;

    for (let i = 0; i < 2600; i++) {
      const t0 = i * dt;
      const px = x, py = y, pz = z;

      const rho = Math.exp(-y / SCALE_HEIGHT);
      const v = Math.hypot(vx, vy, vz);
      const a = -k * rho * v;
      const nvx = vx + a * vx * dt;
      const nvy = vy + (a * vy - GRAVITY) * dt;
      const nvz = vz + a * vz * dt;
      x += (vx + nvx) * 0.5 * dt;
      y += (vy + nvy) * 0.5 * dt;
      z += (vz + nvz) * 0.5 * dt;
      vx = nvx; vy = nvy; vz = nvz;

      /* 1 ステップの中では弾も目標も直線運動とみなせるので、
         相対運動から最接近の瞬間を解析的に求める。これをやらないと
         最接近の時刻がステップ幅（近距離だと 8m 相当）に量子化されて、
         せっかくの補正がかえって精度を落とす。 */
      const r0x = px - (tx + tvx * t0);
      const r0y = py - (ty + tvy * t0);
      const r0z = pz - (tz + tvz * t0);
      const t1 = t0 + dt;
      const r1x = x - (tx + tvx * t1);
      const r1y = y - (ty + tvy * t1);
      const r1z = z - (tz + tvz * t1);
      const ex = r1x - r0x, ey = r1y - r0y, ez = r1z - r0z;
      const e2 = ex * ex + ey * ey + ez * ez;
      let u = e2 > 1e-9 ? -(r0x * ex + r0y * ey + r0z * ez) / e2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const cx = r0x + ex * u, cy = r0y + ey * u, cz = r0z + ez * u;
      const d = cx * cx + cy * cy + cz * cz;

      if (d < best) {
        best = d;
        bt = t0 + dt * u;
        bx = px + (x - px) * u;
        by = py + (y - py) * u;
        bz = pz + (z - pz) * u;
        rising = 0;
      } else if (++rising > 2 && i > 3) {
        break;   // 最接近を過ぎた
      }
      if (y < 0 || t1 > MAX_TIME) break;
    }
    if (bt <= 0) return;

    out.x += (tx + tvx * bt) - bx;
    out.y += (ty + tvy * bt) - by;
    out.z += (tz + tvz * bt) - bz;
    out.t = bt;
  }
  out.range = Math.hypot(out.x - gx, out.y - gy, out.z - gz);
  out.drop = out.y - (ty + tvy * out.t);
}

/* 未来位置に当てるための照準点を出す。
   弾着までの時間を反復で詰めてから、その時間ぶんの落下を足す。 */
export function solveIntercept(gx, gy, gz, tx, ty, tz, tvx, tvy, tvz, v0, k, out) {
  let R = Math.hypot(tx - gx, ty - gy, tz - gz);
  let t = R / v0;
  let px = tx, py = ty, pz = tz;
  for (let i = 0; i < 5; i++) {
    px = tx + tvx * t;
    py = ty + tvy * t;
    pz = tz + tvz * t;
    R = Math.hypot(px - gx, py - gy, pz - gz);
    const rho = Math.exp(-((gy + py) / 2) / SCALE_HEIGHT);
    t = flightTime(R, v0, k, rho);
    if (!isFinite(t) || t > MAX_TIME) { t = MAX_TIME; break; }
  }
  /* 落下量。真空なら 0.5*g*t^2 だが、抗力は鉛直方向の速度にも効くので
     実際にはそこまで落ちない。平均速度 v = R/t から減衰の時定数
     c = k*rho*v を出して、vy' = -g - c*vy の解を使う。
     c -> 0 で 0.5*g*t^2 に一致する。 */
  const rho = Math.exp(-((gy + py) / 2) / SCALE_HEIGHT);
  const vbar = t > 1e-6 ? R / t : v0;
  const c = k * rho * vbar;
  const drop = c > 1e-5
    ? (GRAVITY / c) * (t - (1 - Math.exp(-c * t)) / c)
    : 0.5 * GRAVITY * t * t;

  out.x = px;
  out.y = py + drop;
  out.z = pz;
  out.t = t;
  out.drop = drop;
  out.range = R;

  refineIntercept(gx, gy, gz, tx, ty, tz, tvx, tvy, tvz, v0, k, out);
  return out;
}

export class Bullet {
  constructor() {
    this.live = false;
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.rx = 0; this.ry = 0; this.rz = 0; // 前フレーム描画位置（曳光の尾）
    this.k = 0; this.t = 0;
    this.dmg = 0; this.he = false; this.splash = 0;
    this.tracer = false; this.sd = 0;
  }
}

export class BulletSystem {
  constructor(max = 900) {
    this.pool = [];
    for (let i = 0; i < max; i++) this.pool.push(new Bullet());
    this.cursor = 0;
    this.live = 0;
    this.fired = 0;
  }

  reset() {
    for (const b of this.pool) b.live = false;
    this.live = 0;
    this.fired = 0;
  }

  /* dir は正規化済みの発射方向。 */
  fire(x, y, z, dx, dy, dz, spec, tracer) {
    // 空きを線形に探す。満杯なら最古を潰す
    let b = null;
    for (let i = 0; i < this.pool.length; i++) {
      const cand = this.pool[(this.cursor + i) % this.pool.length];
      if (!cand.live) { b = cand; this.cursor = (this.cursor + i + 1) % this.pool.length; break; }
    }
    if (!b) b = this.pool[this.cursor = (this.cursor + 1) % this.pool.length];
    else this.live++;

    const v0 = spec.v0 * (1 + (Math.random() - 0.5) * spec.mvSpread);
    b.live = true;
    b.x = x; b.y = y; b.z = z;
    b.rx = x; b.ry = y; b.rz = z;
    b.vx = dx * v0; b.vy = dy * v0; b.vz = dz * v0;
    b.k = spec.k;
    b.t = 0;
    b.dmg = spec.damage;
    b.he = spec.he;
    b.splash = spec.splash || 0;
    b.sd = spec.selfDestruct || 0;
    b.tracer = tracer;
    this.fired++;
    return b;
  }

  /* ctx = { targets, onAircraftHit, onGroundHit, onAirburst } */
  update(dt, ctx) {
    const targets = ctx.targets;
    for (const b of this.pool) {
      if (!b.live) continue;

      const x0 = b.x, y0 = b.y, z0 = b.z;
      const vx0 = b.vx, vy0 = b.vy, vz0 = b.vz;

      const rho = Math.exp(-b.y / SCALE_HEIGHT);
      const v = Math.hypot(vx0, vy0, vz0);
      const a = -b.k * rho * v;

      b.vx += a * vx0 * dt;
      b.vy += (a * vy0 - GRAVITY) * dt;
      b.vz += a * vz0 * dt;

      b.x += (vx0 + b.vx) * 0.5 * dt;
      b.y += (vy0 + b.vy) * 0.5 * dt;
      b.z += (vz0 + b.vz) * 0.5 * dt;
      b.t += dt;

      // --- 命中判定（線分 vs 球） ---
      const sx = b.x - x0, sy = b.y - y0, sz = b.z - z0;
      const segLen2 = sx * sx + sy * sy + sz * sz;
      const segLen = Math.sqrt(segLen2);
      let hit = null, hitT = 2;
      for (const ac of targets) {
        if (!ac.alive) continue;
        const ox = ac.x - x0, oy = ac.y - y0, oz = ac.z - z0;
        // 線分の届く範囲より遠ければ即棄却
        const reach = segLen + ac.hitR;
        if (ox * ox + oy * oy + oz * oz > reach * reach) continue;
        const tproj = segLen2 > 0 ? (ox * sx + oy * sy + oz * sz) / segLen2 : 0;
        const tc = tproj < 0 ? 0 : tproj > 1 ? 1 : tproj;
        const dx = ox - sx * tc, dy = oy - sy * tc, dz = oz - sz * tc;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= ac.hitR * ac.hitR && tc < hitT) { hit = ac; hitT = tc; }
      }

      if (hit) {
        const hx = x0 + sx * hitT, hy = y0 + sy * hitT, hz = z0 + sz * hitT;
        ctx.onAircraftHit(hit, b, hx, hy, hz);
        if (b.he && b.splash > 0) {
          for (const ac of targets) {
            if (!ac.alive || ac === hit) continue;
            const d = Math.hypot(ac.x - hx, ac.y - hy, ac.z - hz);
            if (d < b.splash) ctx.onAircraftHit(ac, b, ac.x, ac.y, ac.z, 1 - d / b.splash);
          }
        }
        b.live = false; this.live--;
        continue;
      }

      // --- 着弾・自爆・寿命 ---
      if (b.y <= 0) {
        const t = (y0 <= 0) ? 0 : y0 / (y0 - b.y);
        ctx.onGroundHit(x0 + sx * t, z0 + sz * t, b);
        b.live = false; this.live--;
        continue;
      }
      if (b.sd > 0 && b.t >= b.sd) {
        ctx.onAirburst(b.x, b.y, b.z, b);
        b.live = false; this.live--;
        continue;
      }
      if (b.t > MAX_TIME || (b.x * b.x + b.z * b.z) > MAX_RANGE2) {
        b.live = false; this.live--;
      }
    }
  }

  /* 曳光弾だけ描く。通常弾は見えない — そのための曳光弾。 */
  draw(r, cam) {
    for (const b of this.pool) {
      if (!b.live) continue;
      if (!b.tracer) { b.rx = b.x; b.ry = b.y; b.rz = b.z; continue; }
      const d = Math.hypot(b.x - cam.x, b.y - cam.y, b.z - cam.z);
      const col = d < 380 ? C.WHITE : d < 950 ? C.YELLOW : d < 1900 ? C.LRED : C.RED;
      cam.line3(r, b.rx, b.ry, b.rz, b.x, b.y, b.z, col);
      b.rx = b.x; b.ry = b.y; b.rz = b.z;
    }
  }
}
