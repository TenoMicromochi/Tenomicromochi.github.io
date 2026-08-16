/* ============================================================
   FLAKALT — fx.js
   爆発・破片・煙・着弾。

   撃墜のとき機体メッシュの稜線をそのまま破片としてばら撒く。
   別に破片用のモデルを作らなくても、翼の折れ線が回りながら落ちて
   いくだけで「壊れた」に見える。

   円は 3D で描くと重いので、中心だけ投影して画面上の半径を
   distance から割り出したビルボードにしてある。
   ============================================================ */

import { C } from './palette.js';
import { orientation, clamp } from './camera.js';

const RAMP = [C.WHITE, C.YELLOW, C.LRED, C.RED, C.DGRAY];

function rampColor(t) {
  // t = 0..1（新しい→古い）
  const i = clamp(Math.floor(t * RAMP.length), 0, RAMP.length - 1);
  return RAMP[i];
}

export class Fx {
  constructor() {
    this.bursts = [];   // 爆発の輪
    this.frags = [];    // 破片
    this.puffs = [];    // 煙
    this.sparks = [];   // 火花
    this.rings = [];    // 地面の着弾輪
    this._m = new Float64Array(9);
  }

  reset() {
    this.bursts.length = 0;
    this.frags.length = 0;
    this.puffs.length = 0;
    this.sparks.length = 0;
    this.rings.length = 0;
  }

  /* --- 発生 -------------------------------------------------- */

  burst(x, y, z, size, life = 0.5) {
    this.bursts.push({ x, y, z, r0: size * 0.25, r1: size, t: 0, life });
  }

  sparkle(x, y, z, n, speed, life = 0.35, color = C.YELLOW) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.acos(1 - 2 * Math.random());
      const s = speed * (0.4 + Math.random() * 0.9);
      this.sparks.push({
        x, y, z,
        vx: Math.sin(b) * Math.cos(a) * s,
        vy: Math.cos(b) * s,
        vz: Math.sin(b) * Math.sin(a) * s,
        t: 0, life: life * (0.6 + Math.random() * 0.8), color,
      });
    }
  }

  smoke(x, y, z, hot) {
    if (this.puffs.length > 260) return;
    this.puffs.push({
      x, y, z,
      vx: (Math.random() - 0.5) * 3,
      vy: 1.5 + Math.random() * 2,
      vz: (Math.random() - 0.5) * 3,
      r: hot ? 2.5 : 1.6, grow: hot ? 7 : 4.5,
      t: 0, life: hot ? 2.4 : 1.6, hot,
    });
  }

  groundHit(x, z, big) {
    this.rings.push({ x, z, r: 0, grow: big ? 26 : 7, t: 0, life: big ? 0.7 : 0.35 });
    this.sparkle(x, 0.5, z, big ? 10 : 3, big ? 22 : 9, 0.3, big ? C.YELLOW : C.DGRAY);
    if (big) this.burst(x, 3, z, 9, 0.4);
  }

  /* 撃墜。機体の稜線を破片に変える。 */
  wreck(ac) {
    this.burst(ac.x, ac.y, ac.z, ac.hitR * 3.4, 0.6);
    this.sparkle(ac.x, ac.y, ac.z, 16, 30, 0.5, C.YELLOW);

    orientation(ac.heading, ac.pitch, ac.roll, this._m);
    const m = this._m;
    const s = ac.scale;
    const budget = Math.max(0, 150 - this.frags.length);
    const edges = ac.mesh.e;
    for (let i = 0; i < edges.length && i < budget; i++) {
      const a = ac.mesh.v[edges[i][0]];
      const b = ac.mesh.v[edges[i][1]];
      const ax = a[0] * s, ay = a[1] * s, az = a[2] * s;
      const bx = b[0] * s, by = b[1] * s, bz = b[2] * s;
      // 稜線の中点をワールドに置き、両端は中点からの相対で持つ
      const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
      const wx = ac.x + m[0] * mx + m[1] * my + m[2] * mz;
      const wy = ac.y + m[3] * mx + m[4] * my + m[5] * mz;
      const wz = ac.z + m[6] * mx + m[7] * my + m[8] * mz;
      const blast = 9 + Math.random() * 16;
      this.frags.push({
        ax: ax - mx, ay: ay - my, az: az - mz,
        bx: bx - mx, by: by - my, bz: bz - mz,
        x: wx, y: wy, z: wz,
        vx: ac.vx * 0.55 + (Math.random() - 0.5) * blast,
        vy: ac.vy * 0.55 + (Math.random() - 0.2) * blast,
        vz: ac.vz * 0.55 + (Math.random() - 0.5) * blast,
        yaw: Math.random() * 360, pitch: Math.random() * 360, roll: Math.random() * 360,
        ry: (Math.random() - 0.5) * 500,
        rp: (Math.random() - 0.5) * 500,
        rr: (Math.random() - 0.5) * 500,
        t: 0, life: 3.5 + Math.random() * 2.5,
        burn: Math.random() < 0.35,
        smokeT: 0,
      });
    }
  }

  /* --- 更新 -------------------------------------------------- */

  update(dt) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.t += dt;
      if (b.t >= b.life) this.bursts.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const g = this.rings[i];
      g.t += dt;
      g.r += g.grow * dt;
      if (g.t >= g.life) this.rings.splice(i, 1);
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.t += dt;
      s.vy -= 9.8 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.t >= s.life || s.y < 0) this.sparks.splice(i, 1);
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.t += dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.r += p.grow * dt;
      p.vy *= 0.985;
      if (p.t >= p.life) this.puffs.splice(i, 1);
    }
    for (let i = this.frags.length - 1; i >= 0; i--) {
      const f = this.frags[i];
      f.t += dt;
      f.vy -= 9.8 * dt;
      // 紙なので空気抵抗が効く。ひらひら落ちてほしい
      const drag = Math.pow(0.35, dt);
      f.vx *= drag; f.vz *= drag;
      f.vy *= Math.pow(0.6, dt);
      f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
      f.yaw += f.ry * dt; f.pitch += f.rp * dt; f.roll += f.rr * dt;
      if (f.burn) {
        f.smokeT -= dt;
        if (f.smokeT <= 0) { f.smokeT = 0.1; this.smoke(f.x, f.y, f.z, true); }
      }
      if (f.y <= 0.3) {
        this.groundHit(f.x, f.z, false);
        this.frags.splice(i, 1);
        continue;
      }
      if (f.t >= f.life) this.frags.splice(i, 1);
    }
  }

  /* --- 描画 -------------------------------------------------- */

  draw(r, cam) {
    const p = { x: 0, y: 0, z: 0 };

    // 煙。奥のものから描きたいが、細かい前後関係は気にしない
    for (const s of this.puffs) {
      const q = cam.project(s.x, s.y, s.z, p);
      if (!q) continue;
      const rad = (s.r * cam.focal) / q.z;
      if (rad < 0.7) continue;
      const age = s.t / s.life;
      const col = s.hot
        ? (age < 0.25 ? C.LRED : age < 0.6 ? C.DGRAY : C.BLUE)
        : (age < 0.5 ? C.DGRAY : C.BLUE);
      r.circle(q.x, q.y, Math.min(60, rad), col);
    }

    // 破片
    for (const f of this.frags) {
      orientation(f.yaw, f.pitch, f.roll, this._m);
      const m = this._m;
      const ax = f.x + m[0] * f.ax + m[1] * f.ay + m[2] * f.az;
      const ay = f.y + m[3] * f.ax + m[4] * f.ay + m[5] * f.az;
      const az = f.z + m[6] * f.ax + m[7] * f.ay + m[8] * f.az;
      const bx = f.x + m[0] * f.bx + m[1] * f.by + m[2] * f.bz;
      const by = f.y + m[3] * f.bx + m[4] * f.by + m[5] * f.bz;
      const bz = f.z + m[6] * f.bx + m[7] * f.by + m[8] * f.bz;
      const col = f.burn ? (Math.random() < 0.5 ? C.YELLOW : C.LRED) : C.LGRAY;
      cam.line3(r, ax, ay, az, bx, by, bz, col);
    }

    // 火花
    for (const s of this.sparks) {
      const q = cam.project(s.x, s.y, s.z, p);
      if (!q) continue;
      const back = 0.03;
      cam.line3(r, s.x - s.vx * back, s.y - s.vy * back, s.z - s.vz * back,
        s.x, s.y, s.z, s.t / s.life < 0.5 ? C.WHITE : s.color);
    }

    // 爆発の輪。二重にすると厚みが出る
    for (const b of this.bursts) {
      const q = cam.project(b.x, b.y, b.z, p);
      if (!q) continue;
      const age = b.t / b.life;
      const rad = (b.r0 + (b.r1 - b.r0) * age) * cam.focal / q.z;
      if (rad < 1) continue;
      const c0 = rampColor(age);
      const c1 = rampColor(age + 0.22);
      r.circle(q.x, q.y, Math.min(180, rad), c0);
      if (rad > 4) r.circle(q.x, q.y, Math.min(180, rad * 0.62), c1);
      if (age < 0.35 && rad > 3) {
        r.discDither(q.x, q.y, Math.min(90, rad * 0.45), C.YELLOW, C.WHITE, 8);
      }
    }

    // 地面の着弾輪
    for (const g of this.rings) {
      const n = 12;
      const age = g.t / g.life;
      const col = age < 0.4 ? C.LGRAY : C.DGRAY;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * 6.2832, a1 = ((i + 1) / n) * 6.2832;
        cam.line3(r,
          g.x + Math.sin(a0) * g.r, 0.15, g.z + Math.cos(a0) * g.r,
          g.x + Math.sin(a1) * g.r, 0.15, g.z + Math.cos(a1) * g.r, col);
      }
    }
  }
}
