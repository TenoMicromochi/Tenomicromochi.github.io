/* ============================================================
   FLAKALT — guns.js
   砲そのものと砲架。

   砲架は「指令方向」と「実際の方向」を別に持つ。マウスが動かすのは
   指令方向で、砲身は旋回速度の上限まででしか追従しない。
   20mm が 30°/s しか回らないのに対し 7.7mm は 62°/s 回るので、
   同じ目標でも口径が上がるほど早く先回りして置いておく必要が出る。
   これが偏差射撃のいちばん面白いところ。

   弾は必ず銃口位置から出す。連装の銃身は左右にずれているので、
   近距離だと弾道も左右にずれる。
   ============================================================ */

import { dragFactor } from './ballistics.js';
import { clamp, wrapDeg, DEG } from './camera.js';

export const ELEV_MIN = -4;
export const ELEV_MAX = 85;

/* 銃口の配置（右, 上, 前）[m]。見た目と弾道の両方でこれを使う。 */
const BARREL_LAYOUT = {
  1: [[0, 0, 1.6]],
  2: [[-0.19, 0, 1.7], [0.19, 0, 1.7]],
  4: [[-0.24, -0.11, 1.5], [0.24, -0.11, 1.5], [-0.24, 0.13, 1.5], [0.24, 0.13, 1.5]],
};

function gauss() {
  // Box-Muller の片側だけ使う
  let u = Math.random();
  if (u < 1e-9) u = 1e-9;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

export class Gun {
  constructor(spec) {
    Object.assign(this, spec);
    this.k = dragFactor(this.caliber, this.projectileMass, this.dragCd);
    this.v0 = this.muzzleVelocity;
    this.shotInterval = 60 / (this.rpmPerBarrel * this.barrels);
    this.layout = BARREL_LAYOUT[this.barrels] || BARREL_LAYOUT[1];

    this.ammo = this.magazine;
    this.stock = this.reserve;
    this.heat = 0;
    this.overheated = false;
    this.reloadT = 0;
    this.shotT = 0;
    this.barrelIdx = 0;
    this.shotCount = 0;
    this.recoilT = 0;      // 発砲直後の跳ね（描画用）
    this.flashT = 0;
    this.flashBarrel = 0;

    /* 弾のスペック。ballistics 側にはこれだけ渡す。
       時限信管の砲は selfDestruct を発射のたびに書き換える。 */
    this.round = {
      v0: this.v0,
      k: this.k,
      mvSpread: this.mvSpread,
      damage: this.damage,
      he: this.he,
      splash: this.splash,
      selfDestruct: this.selfDestruct,
    };
  }

  get magFrac() { return this.ammo / this.magazine; }
  get heatFrac() { return clamp(this.heat / 100, 0, 1); }
  get reloading() { return this.reloadT > 0; }

  resupply() {
    this.stock = this.reserve;
    this.ammo = this.magazine;
    this.heat = 0;
    this.overheated = false;
    this.reloadT = 0;
  }

  startReload() {
    if (this.reloadT > 0 || this.stock <= 0 || this.ammo === this.magazine) return false;
    this.reloadT = this.reloadTime;
    return true;
  }

  update(dt, firing) {
    // 冷却。撃っていないときのほうが速く冷える
    const cool = this.coolRate * (firing ? 0.45 : 1);
    this.heat = Math.max(0, this.heat - cool * dt);
    if (this.overheated && this.heat < 42) this.overheated = false;

    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.reloadT = 0;
        const take = Math.min(this.magazine - this.ammo, this.stock);
        this.ammo += take;
        this.stock -= take;
      }
    }
    this.recoilT = Math.max(0, this.recoilT - dt * 9);
    this.flashT = Math.max(0, this.flashT - dt);
  }

  canFire() {
    return this.ammo > 0 && !this.overheated && this.reloadT <= 0;
  }
}

export class Mount {
  constructor(specs) {
    this.guns = specs.map((s) => new Gun(s));
    this.index = 0;

    this.cmdYaw = 0;    // マウスが動かす指令方向
    this.cmdPitch = 12;
    this.yaw = 0;       // 実際に砲身が向いている方向
    this.pitch = 12;

    this.realistic = true;
    this.firing = false;
    this.shakeX = 0;
    this.shakeY = 0;
    this.hits = 0;

    /* 時限信管の設定値。指定目標の弾着時間から game 側が毎フレーム入れる。
       0 なら「解なし」＝信管を切って撃つ（着弾するまで炸裂しない）。 */
    this.fuzeTime = 0;

    this.updateBasis();
  }

  get gun() { return this.guns[this.index]; }

  select(i) {
    if (i < 0 || i >= this.guns.length || i === this.index) return false;
    this.index = i;
    return true;
  }

  aimCmd(dYaw, dPitch) {
    this.cmdYaw = wrapDeg(this.cmdYaw + dYaw);
    this.cmdPitch = clamp(this.cmdPitch + dPitch, ELEV_MIN, ELEV_MAX);
  }

  updateBasis() {
    const cy = Math.cos(this.yaw * DEG), sy = Math.sin(this.yaw * DEG);
    const cp = Math.cos(this.pitch * DEG), sp = Math.sin(this.pitch * DEG);
    this.fx = cp * sy; this.fy = sp; this.fz = cp * cy;
    this.rx = cy; this.ry = 0; this.rz = -sy;
    this.ux = this.fy * this.rz - this.fz * this.ry;
    this.uy = this.fz * this.rx - this.fx * this.rz;
    this.uz = this.fx * this.ry - this.fy * this.rx;
  }

  /* 砲身を指令方向へ寄せる。realistic なら角速度に上限がつく。 */
  slew(dt) {
    const g = this.gun;
    if (this.realistic) {
      const dy = wrapDeg(this.cmdYaw - this.yaw);
      const dp = this.cmdPitch - this.pitch;
      const maxY = g.traverseRate * dt;
      const maxP = g.elevationRate * dt;
      this.yaw = wrapDeg(this.yaw + clamp(dy, -maxY, maxY));
      this.pitch = clamp(this.pitch + clamp(dp, -maxP, maxP), ELEV_MIN, ELEV_MAX);
    } else {
      this.yaw = this.cmdYaw;
      this.pitch = this.cmdPitch;
    }
    this.updateBasis();
  }

  /* 指令方向と砲身の食い違い（度）。HUD の追従表示に使う。 */
  lagDeg() {
    const dy = wrapDeg(this.cmdYaw - this.yaw);
    const dp = this.cmdPitch - this.pitch;
    return Math.hypot(dy * Math.cos(this.pitch * DEG), dp);
  }

  muzzleWorld(gunPos, i, out) {
    const g = this.gun;
    const o = g.layout[i % g.layout.length];
    const back = g.recoilT * 0.25; // 後退量
    const f = o[2] - back;
    out.x = gunPos.x + this.rx * o[0] + this.ux * o[1] + this.fx * f;
    out.y = gunPos.y + this.ry * o[0] + this.uy * o[1] + this.fy * f;
    out.z = gunPos.z + this.rz * o[0] + this.uz * o[1] + this.fz * f;
    return out;
  }

  /* 発砲。撃った発数を返す。 */
  update(dt, gunPos, bullets, events) {
    const g = this.gun;
    g.update(dt, this.firing);

    // 発砲による揺れの減衰
    this.shakeX *= Math.pow(0.02, dt);
    this.shakeY *= Math.pow(0.02, dt);

    let shots = 0;
    if (this.firing && g.canFire()) {
      g.shotT -= dt;
      let guard = 0;
      while (g.shotT <= 0 && g.canFire() && guard++ < 12) {
        this.shoot(gunPos, bullets, events);
        shots++;
        g.shotT += g.shotInterval;
      }
      if (!g.canFire()) g.shotT = Math.max(g.shotT, 0);
    } else {
      g.shotT = Math.min(g.shotT, 0);
      if (g.shotT < -g.shotInterval) g.shotT = -g.shotInterval;
    }

    // 弾切れなら自動で装填
    if (g.ammo <= 0 && g.stock > 0 && g.reloadT <= 0) {
      g.reloadT = g.reloadTime;
      events.onReload && events.onReload(g);
    }
    return shots;
  }

  shoot(gunPos, bullets, events) {
    const g = this.gun;
    const i = g.barrelIdx++ % g.barrels;
    const m = this.muzzleWorld(gunPos, i, _muzzle);

    // 散布界。銃身が焼けるほど広がる
    const spread = g.dispersionMrad * (1 + g.heatFrac * 0.9) / 1000;
    const e1 = gauss() * spread, e2 = gauss() * spread;
    let dx = this.fx + this.rx * e1 + this.ux * e2;
    let dy = this.fy + this.ry * e1 + this.uy * e2;
    let dz = this.fz + this.rz * e1 + this.uz * e2;
    const inv = 1 / Math.hypot(dx, dy, dz);
    dx *= inv; dy *= inv; dz *= inv;

    // 時限信管。射撃指揮の出した弾着時間をそのまま信管に入れる。
    // 実物の信管も秒単位で刻んだ機械式なので、少しだけ狂わせておく。
    if (g.timeFuze) {
      g.round.selfDestruct = this.fuzeTime > 0
        ? this.fuzeTime * (1 + (Math.random() - 0.5) * (g.fuzeError || 0))
        : 0;
    }

    const tracer = (g.shotCount % g.tracerEvery) === 0;
    bullets.fire(m.x, m.y, m.z, dx, dy, dz, g.round, tracer);

    g.shotCount++;
    g.ammo--;
    g.heat += g.heatPerShot;
    if (g.heat >= 100) { g.heat = 100; g.overheated = true; events.onOverheat && events.onOverheat(g); }
    g.recoilT = 1;
    g.flashT = 0.045;
    g.flashBarrel = i;

    this.shakeX += (Math.random() - 0.5) * g.shake * 0.9;
    this.shakeY += (Math.random() - 0.5) * g.shake * 0.6 - g.shake * 0.12;

    events.onShot && events.onShot(g, m);
  }
}

const _muzzle = { x: 0, y: 0, z: 0 };
