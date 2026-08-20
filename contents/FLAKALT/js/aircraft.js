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

/* 高空帯の上限を 1900m にしてあるのは、20mm の自爆信管（5.5秒）が
   斜距離 2500m 前後で働くため。1900m なら 20mm しか撃てない状況でも
   水平 3200m ぶんの迎撃窓が残り、CONDOR の速度（69m/s）で 46 秒ある。
   2500m まで上げると米英独の 20mm は一発も届かなくなる。 */
export const LOW_BAND = [220, 1000];
export const HIGH_BAND = [1200, 1900];

/* band  … LOW = 回避しながら突っ込んで投弾 / HIGH = 高度を保って直進通過
   cost  … ウェーブの予算。from = 解禁ウェーブ
   strike… 投弾が通ったときの陣地への打撃 */
export const TYPES = {
  DART: {
    mesh: 'DART', name: 'DART', band: 'LOW', scale: 3.6, hp: 45,
    speed: 89, diveSpeed: 97, turn: 30, hitR: 3.4,
    color: C.LGREEN, score: 100, jink: 1.0, strike: 7, cost: 10, from: 1,
  },
  LANCE: {
    // 400 km/h（突入 450）。翼が短いので旋回率が低い（DART の半分以下）
    mesh: 'LANCE', name: 'LANCE', band: 'LOW', scale: 6.0, hp: 70,
    speed: 111, diveSpeed: 125, turn: 14, hitR: 2.6,
    color: C.LRED, score: 130, jink: 0.25, strike: 9, cost: 18, from: 2,
  },
  WEDGE: {
    mesh: 'WEDGE', name: 'WEDGE', band: 'LOW', scale: 5.3, hp: 130,
    speed: 72, diveSpeed: 78, turn: 18, hitR: 5.0,
    color: C.LMAGENTA, score: 200, jink: 0.7, strike: 20, cost: 26, from: 3,
  },
  CRANE: {
    // 双発爆撃機。300 km/h で高度を保ったまま自陣上空を突っ切る
    mesh: 'CRANE', name: 'CRANE', band: 'HIGH', scale: 7.1, hp: 260,
    speed: 83, diveSpeed: 83, turn: 5, hitR: 8.0,
    color: C.LCYAN, score: 380, jink: 0, strike: 20, cost: 55, from: 5,
  },
  CONDOR: {
    // 四発爆撃機。翼幅 32m。1900m に置くと画面上 11px、望遠で 29px
    mesh: 'CONDOR', name: 'CONDOR', band: 'HIGH', scale: 9.9, hp: 480,
    speed: 69, diveSpeed: 69, turn: 3, hitR: 11.0,
    color: C.YELLOW, score: 700, jink: 0, strike: 32, cost: 95, from: 8,
  },
  /* 虹色に光る褒賞機。攻撃してこないし、しばらくすると帰る。
     撃ち落とすと陣地の耐久が戻る。予算とは別枠で湧く。 */
  PRISM: {
    mesh: 'DART', name: 'PRISM', band: 'LOW', scale: 4.2, hp: 60,
    speed: 104, diveSpeed: 104, turn: 26, hitR: 3.6,
    color: C.WHITE, score: 250, jink: 1.3, strike: 0, bonus: true,
    heal: 25, lifetime: 25,
  },
};

/* PRISM の巡回色。EGA 16 色しかないので、明るい色を順に出して虹に見せる */
const PRISM_COLORS = [C.LRED, C.YELLOW, C.LGREEN, C.LCYAN, C.LBLUE, C.LMAGENTA];

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
    /* passive = FREE RANGE 用の的。攻撃行動に一切入らない。
       maxRuns 0 なら ORBIT から ATTACK へ遷移する条件が成立しないので、
       状態機械はそのままで「延々と旋回し続ける機体」になる。 */
    this.passive = !!opts.passive;
    /* 褒賞機も攻撃してこない。passive と同じく maxRuns 0 にするだけで
       ORBIT から ATTACK への遷移条件が成立しなくなる。ただし FREE RANGE の
       漂う揺らぎ（passive）は掛けない — こちらは逃げる的なので。 */
    this.bonus = !!t.bonus;
    this.maxRuns = (this.passive || this.bonus) ? 0 : (opts.maxRuns || 3);
    this.age = 0;
    this.dropped = false;
    this.attempts = 0;   // 陣地に届かなかった進入の回数
    this.orbitDir = Math.random() < 0.5 ? 1 : -1;
    this.orbitR = 600 + Math.random() * 700;
    this.orbitAlt = 180 + Math.random() * 380;

    /* 的として漂うための緩い揺らぎ。旋回半径と高度をゆっくり上下させて、
       近づいてきたり離れたりを作る。周期は 35〜80 秒くらい。 */
    this.driftPh = Math.random() * 6.28;
    this.driftFreq = 0.08 + Math.random() * 0.10;
    this.driftR0 = 700 + Math.random() * 450;
    this.driftRAmp = 300 + Math.random() * 220;
    this.driftA0 = 260 + Math.random() * 150;
    this.driftAAmp = 120 + Math.random() * 90;
    this.jinkPh = Math.random() * 6.28;
    this.jinkFreq = 0.35 + Math.random() * 0.5;
    this.jinkAmp = 26 * this.t.jink * (opts.jinkScale || 1);
    this.smokeT = 0;
    this.hitFlash = 0;

    this.m = new Float64Array(9);
  }

  /* 遠方の適当な方位から進入させる。

     高空帯の機体だけは進入方向をばらけさせない。陣地の真上を通す針路を
     固定して、そのまま抜けていくのが爆撃機の役どころなので、
     進入時の乱数（±15°）を入れると投弾線から外れてしまう。 */
  spawnAt(bearingDeg, range, alt) {
    const b = bearingDeg * DEG;
    this.x = Math.sin(b) * range;
    this.z = Math.cos(b) * range;
    this.y = alt;
    this.orbitAlt = alt;
    // FREE RANGE の的（passive）は爆撃機でも通過させず、その場で旋回させる
    if (this.t.band === 'HIGH' && !this.passive) {
      this.heading = wrapDeg(bearingDeg + 180);
      this.runHeading = this.heading;
      this.cruiseAlt = alt;
      this.lastR = this.range;
      this.state = 'OVERFLY';
    } else {
      this.heading = wrapDeg(bearingDeg + 180 + (Math.random() - 0.5) * 30);
      this.state = 'INGRESS';
    }
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
      /* 高空の爆撃機。旋回も降下もせず、入ってきた針路のまま陣地の上を
         突っ切る。投弾は「陣地にいちばん近づいた瞬間」で取る。距離が
         増えに転じたところが最接近なので、そこを 1 回だけ拾えばよい。
         真上を通る針路で入れてあるので、R<130 のような閾値より確実。 */
      case 'OVERFLY': {
        if (!this.dropped && R > this.lastR && R < 900) {
          this.dropped = true;
          this.pendingStrike = true;
        }
        this.lastR = R;
        if (R > 4200) { this.alive = false; this.escaped = true; }
        return [this.runHeading, this.cruiseAlt, this.cruiseSpeed];
      }
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
          this.state = 'ATTACK'; this.stateT = 0; this.minR = R;
        }
        return [hdg, this.orbitAlt, this.cruiseSpeed];
      }
      case 'ATTACK': {
        /* 陣地の直上まで押し込めたときだけ一撃入る。

           以前は「R < 130 または高度 40m 未満」で当たり判定にしていたが、
           これだと LANCE のように旋回率が低い機体（8°/s）が陣地を大きく
           外したまま降下しただけで投弾が成立してしまっていた。
           降下の目標高度が 25m なので、遠く離れていても高度条件のほうが
           先に満たされてしまうため。

           いまは高空の爆撃機と同じく最接近で判定する。距離が増えに転じた
           時点で 150m 以内に入っていなければ、その進入は**失敗**として
           投弾させずに立て直させる。 */
        /* 最接近距離を覚えておいて、そこから明らかに離れ始めたら
           「その進入は外した」と見なす。1 フレームでも距離が増えたら
           打ち切る作りにすると、旋回半径の大きい機体（LANCE は
           125m/s・14°/s で半径 500m ある）が旋回中に離れる区間だけで
           失敗扱いになってしまうため、余裕を持たせてある。 */
        this.minR = Math.min(this.minR, R);
        if (R < 150) {
          this.runs++;
          this.pendingStrike = true;
          this.state = this.runs >= this.maxRuns ? 'ESCAPE' : 'BREAK';
          this.stateT = 0;
        } else if (R > this.minR * 1.6 + 250 || this.stateT > 40) {
          /* 陣地に届かなかった進入。投弾はしないし、攻撃回数にも数えない
             （数えてしまうと外し続けただけで帰ってしまう）。
             代わりに試行回数を数えて、いつまでも粘らないようにする。 */
          this.attempts++;
          this.state = this.attempts >= this.maxRuns + 3 ? 'ESCAPE' : 'BREAK';
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
    this.age += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);

    // 褒賞機は寿命が来たら黙って帰る。逃したぶんは取り返せない
    if (this.bonus && this.age > this.t.lifetime && this.state !== 'ESCAPE') {
      this.state = 'ESCAPE';
      this.stateT = 0;
    }

    // 的モードは旋回半径と高度をゆっくり動かして、寄ったり離れたりさせる
    if (this.passive) {
      const p = t * this.driftFreq + this.driftPh;
      this.orbitR = this.driftR0 + Math.sin(p) * this.driftRAmp;
      this.orbitAlt = this.driftA0 + Math.sin(p * 0.7 + 1.3) * this.driftAAmp;
    }

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
    // 褒賞機は損傷しても色を変えない。虹に見せるほうを優先する
    if (this.bonus) return PRISM_COLORS[Math.floor(this.age * 9) % PRISM_COLORS.length];
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
