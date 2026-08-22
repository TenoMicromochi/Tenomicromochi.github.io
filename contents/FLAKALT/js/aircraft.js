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

/* ---- 自壊（DOOMED） ----------------------------------------
   火を噴いた機体がそのまま平然と飛び続けるのはおかしいので、HP が
   一定を割ったら「燃えている＝もう助からない」状態に落とす。

   二段構えにしてある。

   BURNING … HP が毎秒 hpMax*BURN_RATE 減る。まだ飛べるし、まだ
             攻撃してくる。DOOM_AT から FALL_AT まで 7.5 秒。
   FALLING … HP の減少を止めて 1 に固定し、制御を失って螺旋降下。
             以降 HP では死なない。死ぬのは地面に当たったときだけ。

   HP 0 を死因にしなかったのは、それだと高空の爆撃機が空中で HP を
   使い切ってしまうため。CONDOR は 1900m にいるので -55° で突っ込ませても
   地面まで 20 秒以上かかり、「空中で消える」という直したかった不自然さが
   そのまま残る。 */
const DOOM_AT = 0.20;    // ここを割ると発火
const FALL_AT = 0.05;    // ここで制御喪失
const BURN_RATE = 0.02;  // hpMax に対する毎秒の減少
const BURN_SPAN = (DOOM_AT - FALL_AT) / BURN_RATE;  // = 7.5 秒
const FALL_LIMIT = 13;   // これだけ落ちても接地しなければ空中分解

/* FALLING 中の弾道。

   ここだけ updateVel() を使わない。あれは速度を毎フレーム機首方向から
   作り直すので、ピッチを下げた瞬間に速度がそっくり真下へ付け替わって
   しまう。「落ちている」ではなく「下方向へ飛んでいる」絵になる。

   制御を失った機体は、前進の勢いを持ったまま重力で落ちる。だから速度は
   姿勢と切り離してベクトルで持ち、姿勢のほうを軌道に遅れて追従させる。
   機首は勝手に下がるのではなく、軌道が寝てくるから下がる。

   FALL_G が実際の 9.8 より強いのは、画面のスケール（陣地の半径 1km を
   数百 px に圧縮している）だと本物の重力ではほとんど落ちて見えないため。 */
const FALL_G = 18;       // 落下加速度 m/s^2
const FALL_DRAG = 0.06;  // 水平方向の減衰（毎秒）。翼が効かなくなるぶん
const FALL_VMAX = 140;   // 終端速度 m/s

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
    this.outbound = false;   // 陣地を通り過ぎたあとか。離脱判定に使う
    this.attempts = 0;   // 陣地に届かなかった進入の回数
    this.headingJitter = opts.headingJitter ?? 30;
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

    /* 自壊。褒賞機だけは対象外 — 撃ち落とせたご褒美なので、勝手に
       落ちて回復量が半分になるのでは筋が通らない。 */
    this.doomed = false;
    this.falling = false;
    this.burnLeft = 0;   // FALLING までの残り秒。特攻の可否判定に使う
    this.fallT = 0;
    this.suicide = false;
    this.canDoom = !this.bonus;

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
      /* 進入針路のばらつき。編隊の僚機は 0 を渡して真っ直ぐ入れる —
         ここで振ってしまうと、せっかく組んだ隊形が進入中に崩れる。 */
      this.heading = wrapDeg(bearingDeg + 180 + (Math.random() - 0.5) * this.headingJitter);
      this.state = 'INGRESS';
    }
    this.updateVel();
    return this;
  }

  /* 編隊の僚機を長機からずらす。spawnAt のあとに呼ぶ。

     高空機は「湧いた位置からの距離」を投弾判定と離脱判定に使っているので、
     位置を動かしたら基準も入れ直す。 */
  displace(off) {
    this.x += off.x;
    this.y = Math.max(60, this.y + off.y);
    this.z += off.z;
    this.orbitAlt = this.y;
    if (this.state === 'OVERFLY') {
      this.cruiseAlt = this.y;
      this.lastR = this.range;
    }
    return this;
  }

  get range() { return Math.hypot(this.x, this.z); }
  get slant() { return Math.hypot(this.x, this.y, this.z); }
  get damaged() { return this.hp < this.hpMax * 0.5; }
  /* critical は発火閾値と同じ。見た目（赤・濃い煙）と自壊の開始を
     ずらすと「燃えてるのに落ちない機体」がまた生まれるため。 */
  get critical() { return this.hp < this.hpMax * DOOM_AT; }

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
        /* 進入距離が 5km 台になったので、離脱判定に「陣地を通り過ぎた
           あとかどうか」を必ず見る。距離だけで切ると、湧いた瞬間に
           R が離脱閾値を超えていて、その場で消えてしまう。 */
        if (!this.outbound && R > this.lastR && this.age > 4) this.outbound = true;
        this.lastR = R;
        // 燃えている機体は離脱させない。落ちるまでが見せ場なので
        if (this.outbound && R > 4200 && !this.doomed) {
          this.alive = false; this.escaped = true;
        }
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
        /* 燃えている機体は最後の一撃を狙う。maxRuns を無視して進入させるが、
           落ちるまでに陣地へ届く見込みがあるときだけ。

           固定距離で切ると機種ごとに意味が変わってしまう（DART は 97m/s、
           CONDOR は 69m/s）ので、残り時間から逆算する。0.75 は旋回で
           膨らむぶんの余裕。時間が経つほど条件が厳しくなるので、遅く
           燃えた機体は自然に諦める。 */
        if (this.canSuicide(R)) {
          this.state = 'ATTACK'; this.stateT = 0; this.minR = R;
          this.suicide = true;
        } else if (this.stateT > 6 + Math.random() * 4 && this.runs < this.maxRuns) {
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
        } else if (!this.suicide && (R > this.minR * 1.6 + 250 || this.stateT > 40)) {
          /* 特攻中は立て直さない。外しても FALLING に入るまで押し込む。
             燃えている機体のほうが健全な機体より危険になるが、それが
             「燃やしただけで放置すると刺される」という狙いどおりの形。 */
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
        if (R > 3600 && !this.doomed) { this.alive = false; this.escaped = true; }
        return [wrapDeg(bearingToBase + 180), 600, this.diveSpeed];
      }
    }
  }

  update(dt, t, ctx) {
    if (!this.alive) return;
    this.stateT += dt;
    this.age += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);

    // 発火判定。一撃で FALL_AT を下回った場合はそのまま制御喪失へ落ちる
    if (!this.doomed && this.canDoom && this.hp < this.hpMax * DOOM_AT) {
      this.doomed = true;
      this.burnLeft = BURN_SPAN;
    }
    if (this.doomed && !this.falling) {
      this.burnLeft = Math.max(0, this.burnLeft - dt);
      this.hp -= this.hpMax * BURN_RATE * dt;
      if (this.hp <= this.hpMax * FALL_AT) this.startFall();
    }
    if (this.falling) { this.updateFall(dt, ctx); return; }

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

  /* 燃えている低空機が、落ちるまでに陣地へ届くか。
     的（passive）と褒賞機は攻撃行動に入らないので対象外。
     高空の爆撃機も外す — 1900m から旋回して戻らせるのは時間的に無理だし、
     絵としても間延びする。投弾点の手前ならそのまま OVERFLY で落とす。 */
  canSuicide(R) {
    if (!this.doomed || this.falling || this.passive || this.bonus) return false;
    if (this.t.band !== 'LOW' || this.burnLeft < 0.5) return false;
    return R < this.diveSpeed * this.burnLeft * 0.75;
  }

  /* 制御喪失。ここから HP は死因ではなくなる（1 に固定）。
     死ぬのは接地したときか、落ちきらずに空中分解したときだけ。 */
  startFall() {
    this.falling = true;
    this.hp = 1;
    this.fallT = 0;
    this.suicide = false;
    this.state = 'FALLING';
    this.stateT = 0;
    this.spinDir = this.orbitDir;
  }

  updateFall(dt, ctx) {
    this.fallT += dt;
    // 崩れ具合。0 → 1 に 2.5 秒かけて移る。いきなり錐揉みにしない
    const s = clamp(this.fallT / 2.5, 0, 1);

    /* 速度。水平の勢いは残したまま、重力で下向きだけが増えていく。
       結果として軌道が放物線を描き、そこから機首が寝ていく。 */
    this.vy -= FALL_G * dt;
    const k = Math.exp(-FALL_DRAG * s * dt);
    this.vx *= k;
    this.vz *= k;
    let v = Math.hypot(this.vx, this.vy, this.vz);
    if (v > FALL_VMAX) {
      const f = FALL_VMAX / v;
      this.vx *= f; this.vy *= f; this.vz *= f;
      v = FALL_VMAX;
    }
    this.speed = v;

    /* 姿勢。ピッチは軌道の傾きを追いかけるだけ。自分から下を向くことは
       ないので「突然真下を向く」が起きない。追従に上限を付けてあるぶん
       常に少し遅れ、機首と進行方向がずれた不安定な絵になる。 */
    const vh = Math.hypot(this.vx, this.vz);
    const pathPitch = Math.atan2(this.vy, Math.max(1, vh)) * RAD;
    this.pitch += clamp(pathPitch - this.pitch, -45 * dt, 45 * dt);

    // ヨーとロールは軌道と無関係に回る。これで初めて「制御を失った」に見える
    this.heading = wrapDeg(this.heading + this.spinDir * 150 * s * dt);
    this.roll += (this.spinDir * 78 * s - this.roll) * clamp(dt * 1.2, 0, 1);

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;

    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.05;
      ctx.fx.smoke(this.x, this.y, this.z, true);
    }

    if (this.y <= 12) {
      this.y = 12;
      ctx.onCrash && ctx.onCrash(this, 'CRASHED');
    } else if (this.fallT > FALL_LIMIT) {
      /* 落ちきらない高空機はここで空中分解する。CONDOR の 20 秒落下を
         最後まで見せられても間が持たないし、燃えた重爆が空中でバラける
         のは絵としても正しい。 */
      ctx.onCrash && ctx.onCrash(this, 'BROKE UP');
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
