/* ============================================================
   FLAKALT — aircraft.js
   紙飛行機。標的側の運動と行動。

   まっすぐ飛んでくれると偏差射撃の練習にならないので、基本は陣地を
   横切るように旋回しながら、ときどき降下してくる。旋回率に上限を
   持たせてあるので、機種が大きいほど素直な軌道になる（＝狙いやすい）。

   蛇行（ジンク）は正弦波を進路に足しているだけだが、これが入るだけで
   「置き撃ち」の難度が一気に上がる。
   ============================================================ */

import { C } from './palette.js';
import { PLANE_MESHES, drawMesh } from './models.js';
import { orientation, clamp, wrapDeg, DEG, RAD } from './camera.js';

export const TYPES = {
  DART: {
    mesh: 'DART', name: 'DART', scale: 3.6, hp: 45,
    speed: 96, diveSpeed: 132, turn: 30, hitR: 3.4,
    color: C.LGREEN, score: 100, jink: 1.0,
  },
  GLIDER: {
    mesh: 'GLIDER', name: 'GLIDER', scale: 4.4, hp: 95,
    speed: 62, diveSpeed: 92, turn: 19, hitR: 5.2,
    color: C.LCYAN, score: 150, jink: 0.6,
  },
  HEAVY: {
    mesh: 'HEAVY', name: 'HEAVY', scale: 5.2, hp: 180,
    speed: 76, diveSpeed: 104, turn: 12, hitR: 6.6,
    color: C.YELLOW, score: 240, jink: 0.35,
  },
};

let nextId = 1;

export class Aircraft {
  constructor(typeKey, opts = {}) {
    const t = TYPES[typeKey];
    this.type = typeKey;
    this.t = t;
    this.mesh = PLANE_MESHES[t.mesh];
    this.id = nextId++;
    this.tag = 'T' + String(this.id).padStart(2, '0');

    this.hpMax = t.hp * (opts.hpScale || 1);
    this.hp = this.hpMax;
    this.hitR = t.hitR;
    this.scale = t.scale;
    this.alive = true;
    this.escaped = false;

    this.speed = t.speed * (opts.speedScale || 1);
    this.cruiseSpeed = this.speed;
    this.diveSpeed = t.diveSpeed * (opts.speedScale || 1);
    this.turnRate = t.turn * (opts.turnScale || 1);

    this.heading = 0;
    this.pitch = 0;
    this.roll = 0;
    this.x = 0; this.y = 300; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;

    this.state = 'INGRESS';
    this.stateT = 0;
    this.runs = 0;
    this.maxRuns = opts.maxRuns || 3;
    this.orbitDir = Math.random() < 0.5 ? 1 : -1;
    this.orbitR = 600 + Math.random() * 700;
    this.orbitAlt = 180 + Math.random() * 380;
    this.jinkPh = Math.random() * 6.28;
    this.jinkFreq = 0.35 + Math.random() * 0.5;
    this.jinkAmp = 26 * this.t.jink * (opts.jinkScale || 1);
    this.smokeT = 0;
    this.hitFlash = 0;

    this.m = new Float64Array(9);
  }

  /* 遠方の適当な方位から進入させる */
  spawnAt(bearingDeg, range, alt) {
    const b = bearingDeg * DEG;
    this.x = Math.sin(b) * range;
    this.z = Math.cos(b) * range;
    this.y = alt;
    this.heading = wrapDeg(bearingDeg + 180 + (Math.random() - 0.5) * 30);
    this.orbitAlt = alt;
    this.state = 'INGRESS';
    this.updateVel();
    return this;
  }

  get range() { return Math.hypot(this.x, this.z); }
  get slant() { return Math.hypot(this.x, this.y, this.z); }
  get damaged() { return this.hp < this.hpMax * 0.5; }
  get critical() { return this.hp < this.hpMax * 0.22; }

  updateVel() {
    const cp = Math.cos(this.pitch * DEG);
    this.vx = Math.sin(this.heading * DEG) * cp * this.speed;
    this.vy = Math.sin(this.pitch * DEG) * this.speed;
    this.vz = Math.cos(this.heading * DEG) * cp * this.speed;
  }

  /* 目標針路を状態ごとに決める。戻り値は [針路, 目標高度, 目標速度] */
  desired(t) {
    const R = this.range;
    const bearingToBase = wrapDeg(Math.atan2(-this.x, -this.z) * RAD);

    switch (this.state) {
      case 'INGRESS': {
        if (R < this.orbitR * 1.25) { this.state = 'ORBIT'; this.stateT = 0; }
        return [bearingToBase, this.orbitAlt, this.cruiseSpeed];
      }
      case 'ORBIT': {
        // 陣地を中心に回る。接線方向 + 半径のずれを補正
        const tangent = bearingToBase + 90 * this.orbitDir;
        const err = clamp((R - this.orbitR) / this.orbitR, -1, 1);
        const hdg = tangent - err * 45 * this.orbitDir;
        if (this.stateT > 6 + Math.random() * 4 && this.runs < this.maxRuns) {
          this.state = 'ATTACK'; this.stateT = 0;
        }
        return [hdg, this.orbitAlt, this.cruiseSpeed];
      }
      case 'ATTACK': {
        // 陣地の直上まで押し込んだら一撃入れて離脱に移る
        if (R < 130 || this.y < 40) {
          this.runs++;
          this.pendingStrike = true;
          this.state = this.runs >= this.maxRuns ? 'ESCAPE' : 'BREAK';
          this.stateT = 0;
        }
        return [bearingToBase, 25, this.diveSpeed];
      }
      case 'BREAK': {
        if (R > 700) { this.state = 'ORBIT'; this.stateT = 0; }
        return [wrapDeg(bearingToBase + 180 - 30 * this.orbitDir), this.orbitAlt + 60, this.cruiseSpeed];
      }
      case 'ESCAPE':
      default: {
        if (R > 3600) { this.alive = false; this.escaped = true; }
        return [wrapDeg(bearingToBase + 180), 600, this.diveSpeed];
      }
    }
  }

  update(dt, t, ctx) {
    if (!this.alive) return;
    this.stateT += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);

    let [wantHdg, wantAlt, wantSpd] = this.desired(t);

    // 蛇行。攻撃降下中はやめる（そのぶん狙いやすくなる）
    if (this.state !== 'ATTACK' && this.state !== 'STRIKE') {
      wantHdg += Math.sin(t * this.jinkFreq * 6.28 + this.jinkPh) * this.jinkAmp;
    }

    // 針路
    const dh = wrapDeg(wantHdg - this.heading);
    const maxTurn = this.turnRate * dt;
    const turn = clamp(dh, -maxTurn, maxTurn);
    this.heading = wrapDeg(this.heading + turn);

    // バンクは旋回率に比例。見た目のためだけだが、これがないと紙に見えない
    const wantRoll = clamp((dh / Math.max(1, this.turnRate)) * 55, -68, 68);
    this.roll += (wantRoll - this.roll) * clamp(dt * 3.2, 0, 1);

    // 高度
    const dAlt = wantAlt - this.y;
    const wantPitch = clamp(dAlt * 0.06, -32, 26);
    this.pitch += clamp(wantPitch - this.pitch, -60 * dt, 60 * dt);

    // 速度。損傷すると出なくなる
    const cap = this.damaged ? 0.82 : 1;
    const target = wantSpd * cap;
    this.speed += clamp(target - this.speed, -28 * dt, 18 * dt);

    this.updateVel();
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;

    if (this.y < 12) this.y = 12;

    if (this.pendingStrike) {
      this.pendingStrike = false;
      ctx.onStrike && ctx.onStrike(this);
    }

    // 被弾機は煙を引く
    if (this.damaged) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = this.critical ? 0.06 : 0.14;
        ctx.fx.smoke(this.x, this.y, this.z, this.critical);
      }
    }
  }

  hit(dmg) {
    this.hp -= dmg;
    this.hitFlash = 1;
    return this.hp <= 0;
  }

  color() {
    if (this.hitFlash > 0.5) return C.WHITE;
    if (this.critical) return C.LRED;
    if (this.damaged) return C.YELLOW;
    return this.t.color;
  }

  draw(r, cam, designated) {
    orientation(this.heading, this.pitch, this.roll, this.m);
    drawMesh(r, cam, this.mesh, this.x, this.y, this.z, this.m, this.scale, this.color());

    // 影と高度線。ワイヤーフレームだと距離感が掴めないので、
    // これを出すだけで「どのくらい上にいるか」が読めるようになる
    const d = this.slant;
    if (d < 2600) {
      const s = clamp(this.scale * 0.5, 1, 4);
      cam.line3(r, this.x - s, 0.2, this.z, this.x + s, 0.2, this.z, C.DGRAY);
      cam.line3(r, this.x, 0.2, this.z - s, this.x, 0.2, this.z + s, C.DGRAY);
      if (designated) {
        cam.line3(r, this.x, 0.2, this.z, this.x, this.y - this.hitR, this.z, C.BLUE);
      }
    }
  }
}
