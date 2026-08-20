/* ============================================================
   FLAKALT — game.js
   ゲーム全体の状態。ウェーブ、得点、陣地の耐久、目標の指定。

   物理は 200Hz 固定ステップで回す（main.js のループ側）。弾速 900m/s の
   弾でも 1 ステップ 4.5m しか進まないので、線分と球の判定で取りこぼさない。

   目標の指定は「砲軸にいちばん近い機体」。一度掴んだら少し粘るように
   してあるので、蛇行しても表示が飛ばない。
   ============================================================ */

import { C } from './palette.js';
import { Camera, clamp, wrapDeg, DEG, RAD } from './camera.js';
import { Scene } from './scene.js';
import { BulletSystem, solveIntercept } from './ballistics.js';
import { Mount } from './guns.js';
import { Aircraft, TYPES, LOW_BAND, HIGH_BAND } from './aircraft.js';
import { Fx } from './fx.js';
import { drawHud, VIEW } from './hud.js';

export const DIFFICULTY = {
  ROOKIE: { speed: 0.85, jink: 0.5, runs: 2, hp: 0.85, ammo: 1.4, strike: 0.7, label: 'ROOKIE' },
  VETERAN: { speed: 1.0, jink: 1.0, runs: 3, hp: 1.0, ammo: 1.0, strike: 1.0, label: 'VETERAN' },
  ACE: { speed: 1.15, jink: 1.6, runs: 4, hp: 1.15, ammo: 0.8, strike: 1.35, label: 'ACE' },
};

/* ウェーブの編成に使える機種。褒賞機（PRISM）は予算の外なので入れない。 */
const LOW_TYPES = Object.keys(TYPES).filter((k) => TYPES[k].band === 'LOW' && !TYPES[k].bonus);
const HIGH_TYPES = Object.keys(TYPES).filter((k) => TYPES[k].band === 'HIGH');
const GUN_HEIGHT = 1.9;

/* 望遠照準の倍率。素の画角 52 度を割って画角を作るので、
   x2.5 が以前の固定値（画角 21 度）とほぼ同じ見え方になる。 */
export const BASE_FOV = 52;
export const ZOOM_MIN = 2.0;
export const ZOOM_MAX = 8.0;
export const ZOOM_STEP = 0.5;

/* FREE RANGE で空に浮かべておく的の数。ウェーブ 10 相当。 */
export const FREE_RANGE_TARGETS = 10;

export class Game {
  constructor(gunSpecs, sfx, opts) {
    this.gunSpecs = gunSpecs;
    this.sfx = sfx;
    this.opts = opts;

    this.cam = new Camera();
    this.cam.setViewport(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
    this.scene = new Scene(20250817);
    this.bullets = new BulletSystem(900);
    this.fx = new Fx();
    this.gunPos = { x: 0, y: GUN_HEIGHT, z: 0 };
    this.mount = new Mount(gunSpecs);
    this.solution = { x: 0, y: 0, z: 0, t: 0, range: 0 };
    this.reset();
  }

  reset() {
    this.mount = new Mount(this.gunSpecs);
    this.mount.realistic = this.opts.realistic;
    this.bullets.reset();
    this.fx.reset();
    this.aircraft = [];
    this.spawnQueue = [];
    this.target = null;
    this.lock = null;       // TAB で固定した目標。null なら砲軸に近い機体を自動で拾う
    this.targetHold = 0;    // 自動追尾の粘り。乗り換えた直後は動かさない
    this.hasSolution = false;
    this.solveT = 0;
    this.solvedFor = null;
    this.solvedGun = null;

    this.wave = 0;
    this.score = 0;
    this.kills = 0;
    this.shots = 0;
    this.hits = 0;
    this.integrity = 100;
    this.elapsed = 0;
    this.log = [];
    this.hitMarker = 0;
    this.damageFlash = 0;
    this.state = 'BRIEF';
    this.stateT = 0;
    this.over = false;

    // 望遠の倍率は前回の続きから。保存されていなければ以前の固定値相当
    this.zoom = clamp(this.opts.zoom || 2.5, ZOOM_MIN, ZOOM_MAX);

    this.freeRange = !!this.opts.freeRange;
    /* 見越し点を今この瞬間出すかどうか。HARD では最初から false のまま、
       Q キーでも上げられない（それをやると HARD の意味が消えるため）。 */
    this.leadOn = this.opts.aid === 'EASY';

    const d = DIFFICULTY[this.opts.difficulty] || DIFFICULTY.VETERAN;
    for (const g of this.mount.guns) {
      g.reserve = Math.round(g.reserve * d.ammo);
      g.stock = g.reserve;
    }
    if (this.freeRange) {
      this.pushLog('FREE RANGE -- PRACTICE AREA. NOTHING SHOOTS BACK.', C.LCYAN);
    } else {
      this.pushLog('BATTERY ONLINE. AWAITING CONTACT.', C.LGREEN);
    }
    if (this.leadOn) this.pushLog('LEAD AID ON -- PRESS Q TO TOGGLE', C.LMAGENTA);
  }

  pushLog(text, c = C.LGREEN) {
    this.log.push({ text, c, t: this.elapsed });
    if (this.log.length > 24) this.log.shift();
  }

  /* --- ウェーブ ---------------------------------------------- */

  /* 敵側に予算を与えて、その範囲で編成を買わせる。

     財布を低空と高空で分けているのがこの方式の肝。1 つの財布にすると
     「爆撃機 2 機だけのウェーブ」が普通に出てしまい、低空の砲が完全に
     暇になる。高空に回す割合を WAVE とともに増やすことで、
     「はじめは低空だけ、やがて上からも来る」という進み方になる。

     重み（コスト^bias）の bias が WAVE とともに上がるので、
     予算が同じでも後半ほど「高いのを 1 機」に寄る。 */
  waveBudget(n) { return Math.round(20 + 17 * (n - 1) + 0.9 * n * n); }
  /* 高空に回す割合。WAVE 5 の予算 111 に対して双発が 55 なので、
     0.42 あたりから始めないと「解禁したのに買えない」状態が続く。
     0.55 で頭打ちにしてあるのは、半分以上を上空に持っていかれると
     低空の砲が暇になるため。 */
  highShare(n) { return n < 5 ? 0 : Math.min(0.55, 0.42 + 0.02 * (n - 5)); }

  buyWave(n) {
    const bias = Math.min(1.7, 0.25 + 0.11 * (n - 1));
    const affordable = (pool, budget) =>
      pool.filter((k) => n >= TYPES[k].from && TYPES[k].cost <= budget);
    const draw = (pool) => {
      const w = pool.map((k) => Math.pow(TYPES[k].cost, bias));
      let r = Math.random() * w.reduce((a, x) => a + x, 0);
      let i = 0;
      while (i < w.length - 1 && r > w[i]) { r -= w[i]; i++; }
      return pool[i];
    };

    const B = this.waveBudget(n);
    let high = Math.round(B * this.highShare(n));
    let low = B - high;
    const bought = [];

    /* 高空機が解禁されたウェーブ以降は、いちばん安い爆撃機を 1 機だけ
       予算を無視して先に確保する。高空の財布は WAVE 5 の時点で 22 しかなく、
       素直に買わせると「初登場した次のウェーブから数回、上空がまた空になる」
       という妙な間ができる。高射砲の出番を毎回作るための下駄。 */
    const cheapest = HIGH_TYPES
      .filter((k) => n >= TYPES[k].from)
      .sort((a, b) => TYPES[a].cost - TYPES[b].cost)[0];
    if (cheapest) { bought.push(cheapest); high -= TYPES[cheapest].cost; }

    /* 解禁されたそのウェーブだけは、その新型も 1 機だけ確保する。
       初登場が予算の綾で数ウェーブ遅れると、何が新しいのか分からなくなる。 */
    for (const k of HIGH_TYPES) {
      if (TYPES[k].from === n && !bought.includes(k)) {
        bought.push(k); high -= TYPES[k].cost;
      }
    }
    // 高空は同時に出せる数を絞る。上から一斉に来ると手がまったく足りない
    const hcap = Math.min(4, 1 + Math.floor((n - 5) / 3));
    while (bought.length < hcap) {
      const pool = affordable(HIGH_TYPES, high);
      if (!pool.length) break;
      const k = draw(pool);
      bought.push(k); high -= TYPES[k].cost;
    }
    low += Math.max(0, high);   // 高空で余った予算は低空へ回す

    let lowCount = 0;
    while (bought.length < 10) {
      const pool = affordable(LOW_TYPES, low);
      if (!pool.length) break;
      const k = draw(pool);
      bought.push(k); low -= TYPES[k].cost; lowCount++;
    }
    // 低空が 2 機を切ったら DART で埋める（爆撃機だけのウェーブを作らない）
    while (lowCount < 2) { bought.push('DART'); lowCount++; }
    return bought;
  }

  beginWave(n) {
    this.wave = n;
    const d = DIFFICULTY[this.opts.difficulty] || DIFFICULTY.VETERAN;
    const pool = this.buyWave(n);
    const spd = d.speed * (1 + (n - 1) * 0.025);
    const jink = d.jink * (1 + (n - 1) * 0.04);
    const gap = 2.6 - Math.min(1.4, n * 0.12);
    this.spawnQueue = pool.map((key, i) => {
      const high = TYPES[key].band === 'HIGH';
      const band = high ? HIGH_BAND : LOW_BAND;
      return {
        t: i * gap,
        key,
        bearing: Math.random() * 360,
        // 高空機は遠くから入って真上を抜けるので、進入距離も長めに取る
        range: high ? 3600 + Math.random() * 700 : 2300 + Math.random() * 900,
        alt: band[0] + Math.random() * (band[1] - band[0]),
        opts: {
          speedScale: spd, turnScale: 1 + (n - 1) * 0.02, jinkScale: jink,
          hpScale: d.hp * (1 + (n - 1) * 0.05), maxRuns: d.runs,
        },
      };
    });
    this.queuePrism(n, pool.length * gap);
    this.state = 'FIGHT';
    this.stateT = 0;
    this.pushLog('WAVE ' + n + ' INBOUND -- ' + pool.length + ' CONTACTS', C.YELLOW);
    const bombers = pool.filter((k) => TYPES[k].band === 'HIGH').length;
    if (bombers) {
      this.pushLog('HIGH ALTITUDE FORMATION -- ' + bombers + ' BOMBERS', C.LRED);
    }
    this.sfx.beep(700, 0.08); setTimeout(() => this.sfx.beep(950, 0.12), 110);
  }

  /* 虹色の褒賞機。数ウェーブに 1 度だけ、予算とは別枠で湧く。
     耐久が減っているほど出やすくして、詰みだけは避ける。 */
  queuePrism(n, after) {
    if (n < 2) return;
    const p = this.integrity < 30 ? 0.75 : this.integrity < 60 ? 0.45 : 0.25;
    if (Math.random() > p) return;
    this.spawnQueue.push({
      t: after * 0.5 + 3 + Math.random() * 6,
      key: 'PRISM',
      bearing: Math.random() * 360,
      range: 1900 + Math.random() * 700,
      alt: 500 + Math.random() * 300,
      opts: { speedScale: 1, jinkScale: 1 },
    });
  }

  /* --- FREE RANGE ---------------------------------------------- */

  /* 攻撃してこない的を空に浮かべておくだけのモード。ウェーブも耐久も無い。
     撃ち落とした分はしばらくしてから静かに補充される。 */
  beginFreeRange() {
    this.state = 'FREE';
    this.stateT = 0;
    this.wave = 0;
    for (let i = 0; i < FREE_RANGE_TARGETS; i++) this.queueFreeTarget(i * 0.4);
    this.pushLog('TARGETS ADRIFT -- ' + FREE_RANGE_TARGETS + ' CONTACTS', C.LCYAN);
    this.sfx.beep(760, 0.08);
  }

  queueFreeTarget(delay) {
    // ダーツが多め。たまに大きいのを混ぜて的の大きさに幅を出す
    const pool = ['DART', 'DART', 'LANCE', 'WEDGE', 'CRANE', 'CONDOR'];
    this.spawnQueue.push({
      t: delay,
      key: pool[Math.floor(Math.random() * pool.length)],
      bearing: Math.random() * 360,
      range: 1100 + Math.random() * 1400,
      alt: 200 + Math.random() * 380,
      quiet: true, // 「CONTACT ...」のログを出さない
      opts: {
        passive: true,
        speedScale: 0.85 + Math.random() * 0.35,
        jinkScale: 0.7 + Math.random() * 0.6,
      },
    });
  }

  endWave() {
    this.state = 'REARM';
    this.stateT = 0;
    const bonus = 250 * this.wave + this.integrity * 10;
    this.score += bonus;
    this.pushLog('WAVE ' + this.wave + ' CLEAR. BONUS ' + bonus, C.LCYAN);
    for (const g of this.mount.guns) g.resupply();
    this.integrity = Math.min(100, this.integrity + 8);
  }

  /* --- 入力（フレームごとに 1 回） ---------------------------- */

  applyInput(input, dt) {
    if (this.over) return;
    const zoom = input.zoom || input.down('KeyZ');
    const wheel = input.takeWheel();

    /* ズーム中だけ、ホイールと W/S が倍率の変更に化ける（そのあいだ
       兵装の切り替えは効かない）。倍率は撃ち方の癖そのものなので、
       ズームを解いても覚えたままにしておく — 次にズームしたとき
       前回の倍率で覗ける。 */
    if (zoom) {
      let dz = 0;
      if (wheel) dz += wheel < 0 ? ZOOM_STEP : -ZOOM_STEP;
      if (input.pressed('KeyW')) dz += ZOOM_STEP;
      if (input.pressed('KeyS')) dz -= ZOOM_STEP;
      if (dz) {
        const before = this.zoom;
        this.zoom = clamp(this.zoom + dz, ZOOM_MIN, ZOOM_MAX);
        this.opts.zoom = this.zoom;
        if (this.zoom !== before) this.sfx.beep(dz > 0 ? 880 : 660, 0.03);
      }
    }
    const wantFov = zoom ? BASE_FOV / this.zoom : BASE_FOV;
    this.cam.fov += (wantFov - this.cam.fov) * clamp(dt * 14, 0, 1);

    // 感度は画角に比例させる。望遠にすると自動的に細かく狙える
    const mouseAim = this.opts.mouseAim !== false;
    const sens = this.opts.sensitivity * (this.cam.fov / 52);
    const m = input.takeMouse();
    if (mouseAim && input.locked) this.mount.aimCmd(m.x * sens, -m.y * sens);

    /* 方向キー。マウスと併用しているときは微調整の速さ、マウスを切って
       いるときは砲を主に動かす手段になるので倍以上まで上げる。 */
    const kb = (mouseAim ? 22 : 52) * (this.cam.fov / 52) * dt;
    let ky = 0, kp = 0;
    if (input.down('ArrowLeft')) ky -= kb;
    if (input.down('ArrowRight')) ky += kb;
    if (input.down('ArrowUp')) kp += kb;
    if (input.down('ArrowDown')) kp -= kb;
    if (ky || kp) this.mount.aimCmd(ky, kp);

    this.mount.firing = (input.locked || !mouseAim) && (input.fire || input.down('Space'));

    const nGuns = this.mount.guns.length;
    for (let i = 0; i < nGuns; i++) {
      if (input.pressed('Digit' + (i + 1)) && this.mount.select(i)) {
        this.pushLog('SELECTED ' + this.mount.gun.name, C.CYAN);
        this.sfx.beep(520, 0.05);
      }
    }
    // ズーム中のホイールは倍率に取られているので、兵装は切り替わらない
    if (wheel && !zoom) {
      const n = (this.mount.index + (wheel > 0 ? 1 : -1) + nGuns) % nGuns;
      if (this.mount.select(n)) this.sfx.beep(520, 0.05);
    }
    if (input.pressed('KeyR')) {
      if (this.mount.gun.startReload()) {
        this.sfx.reload();
        this.pushLog('RELOADING ' + this.mount.gun.name, C.YELLOW);
      } else {
        this.sfx.empty();
      }
    }
    if (input.pressed('Tab')) this.toggleLock();

    // 見越し点の表示切り替え。HARD では最初から積んでいない扱い
    if (input.pressed('KeyQ')) {
      if (this.opts.aid === 'EASY') {
        this.leadOn = !this.leadOn;
        this.pushLog('LEAD AID ' + (this.leadOn ? 'ON' : 'OFF'),
          this.leadOn ? C.LMAGENTA : C.DGRAY);
        this.sfx.beep(this.leadOn ? 900 : 560, 0.05);
      } else {
        this.sfx.empty();
        this.pushLog('NO LEAD COMPUTER FITTED (HARD)', C.DGRAY);
      }
    }
  }

  /* TAB。レティクルの中に機体を入れて押すとロック、何もない空で押すと解除。
     複数機が重なると自動追尾が細かく乗り換えて見越し点が暴れるので、
     「この一機だけ見る」と宣言できる手段がいる。 */
  toggleLock() {
    /* 掴む円錐は画角に比例させる。望遠にしても画面上の見かけの広さが
       変わらないので、レティクルの中央付近という感覚がずれない。 */
    const cone = clamp(6 * (this.cam.fov / 52), 2.2, 6);
    let best = null, bestAng = cone;
    for (const ac of this.aircraft) {
      if (!ac.alive) continue;
      const a = this.angleTo(ac);
      if (a < bestAng) { best = ac; bestAng = a; }
    }

    if (best) {
      const again = best === this.lock;
      this.lock = best;
      this.target = best;
      this.targetHold = 0;
      if (!again) {
        this.pushLog('LOCKED ' + best.tag + ' -- ' + Math.round(best.slant) + 'M', C.WHITE);
        this.sfx.beep(1150, 0.06);
      }
    } else if (this.lock) {
      this.lock = null;
      this.pushLog('LOCK RELEASED -- AUTO TRACK', C.DGRAY);
      this.sfx.beep(520, 0.05);
    } else {
      this.sfx.empty();
      this.pushLog('NO CONTACT IN RETICLE', C.DGRAY);
    }
  }

  /* --- 更新（固定ステップ） ---------------------------------- */

  update(dt) {
    this.elapsed += dt;
    this.stateT += dt;
    this.hitMarker = Math.max(0, this.hitMarker - dt * 4);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.6);

    this.mount.realistic = this.opts.realistic;
    this.mount.slew(dt);

    // 視点は砲身の向き。発砲の揺れだけ乗せる
    this.cam.x = this.gunPos.x; this.cam.y = this.gunPos.y; this.cam.z = this.gunPos.z;
    this.cam.yaw = this.mount.yaw + this.mount.shakeX;
    this.cam.pitch = clamp(this.mount.pitch + this.mount.shakeY, -8, 89);
    this.cam.update();

    if (!this.over) {
      this.mount.update(dt, this.gunPos, this.bullets, this.events);
    } else {
      this.mount.firing = false;
    }

    // 出撃予定
    for (let i = this.spawnQueue.length - 1; i >= 0; i--) {
      const s = this.spawnQueue[i];
      s.t -= dt;
      if (s.t <= 0) {
        const ac = new Aircraft(s.key, s.opts);
        ac.spawnAt(s.bearing, s.range, s.alt);
        this.aircraft.push(ac);
        this.spawnQueue.splice(i, 1);
        if (!s.quiet) {
          this.pushLog('CONTACT ' + ac.tag + ' BRG ' +
            String(Math.round((s.bearing + 360) % 360)).padStart(3, '0'), C.YELLOW);
        }
      }
    }

    for (const ac of this.aircraft) ac.update(dt, this.elapsed, this.actx);
    this.bullets.update(dt, this.bctx);
    this.fx.update(dt);

    // 撃墜・離脱した機体を外す
    for (let i = this.aircraft.length - 1; i >= 0; i--) {
      const ac = this.aircraft[i];
      if (!ac.alive) {
        if (ac.escaped) this.pushLog(ac.tag + ' EGRESSED', C.DGRAY);
        if (this.target === ac) this.target = null;
        // ロック相手が居なくなったら黙って自動追尾に戻る
        if (this.lock === ac) this.lock = null;
        this.aircraft.splice(i, 1);
      }
    }

    this.updateTarget(dt);

    if (this.freeRange) {
      // 弾は尽きない。撃墜されたぶんだけ的を補充する
      for (const g of this.mount.guns) g.stock = g.reserve;
      if (this.state === 'BRIEF' && this.stateT > 2.0) this.beginFreeRange();
      else if (this.state === 'FREE' &&
        this.aircraft.length + this.spawnQueue.length < FREE_RANGE_TARGETS) {
        this.queueFreeTarget(2 + Math.random() * 3);
      }
    } else {
      // ウェーブの進行
      if (this.state === 'BRIEF' && this.stateT > 2.5) this.beginWave(1);
      else if (this.state === 'FIGHT' && !this.aircraft.length && !this.spawnQueue.length) this.endWave();
      else if (this.state === 'REARM' && this.stateT > 8) this.beginWave(this.wave + 1);
    }

    if (this.integrity <= 0 && !this.over && !this.freeRange) {
      this.integrity = 0;
      this.over = true;
      this.state = 'DOWN';
      this.stateT = 0;
      this.pushLog('*** BATTERY DESTROYED ***', C.LRED);
      this.sfx.explode(1.4);
    }
  }

  /* ロック中はその一機。していなければ砲軸にいちばん近い機体を選ぶ。 */
  updateTarget(dt = 0) {
    const mnt = this.mount;
    let best;

    if (this.lock && this.lock.alive) {
      // ロック中は砲をどこへ向けても目標は動かない
      best = this.lock;
    } else {
      best = this.target && this.target.alive ? this.target : null;
      let bestAng = best ? this.angleTo(best) : 999;
      if (bestAng > 30) { best = null; bestAng = 999; }
      this.targetHold = Math.max(0, this.targetHold - dt);

      /* 乗り換えた直後は少し粘る。角度の下駄（0.75 倍）だけだと、
         複数機が近い角度で重なったときに目標が毎フレーム往復して
         見越し点がちらついてしまう。 */
      if (!best || this.targetHold <= 0) {
        for (const ac of this.aircraft) {
          if (!ac.alive || ac === best) continue;
          const a = this.angleTo(ac);
          if (a < 22 && a < bestAng * 0.75) { best = ac; bestAng = a; }
        }
      }
      if (best !== this.target) this.targetHold = 0.5;
    }
    this.target = best;

    if (best) {
      /* 射撃解は実弾道での検算を含むので、物理と同じ 200Hz で回すと無駄が大きい。
         目標は滑らかに動くので 30Hz で十分（目標か砲が変わったら即座に解き直す）。 */
      const g = mnt.gun;
      this.solveT -= dt;
      if (this.solveT <= 0 || best !== this.solvedFor || g !== this.solvedGun) {
        this.solveT = 1 / 30;
        this.solvedFor = best;
        this.solvedGun = g;
        solveIntercept(
          this.gunPos.x, this.gunPos.y, this.gunPos.z,
          best.x, best.y, best.z, best.vx, best.vy, best.vz,
          g.v0, g.k, this.solution);
      }
      this.hasSolution = true;
      // 時限信管はこの弾着時間をそのまま使う
      mnt.fuzeTime = this.solution.t;
    } else {
      this.hasSolution = false;
      this.solvedFor = null;
      mnt.fuzeTime = 0;
    }
  }

  angleTo(ac) {
    const dx = ac.x - this.gunPos.x, dy = ac.y - this.gunPos.y, dz = ac.z - this.gunPos.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const dot = (dx * this.mount.fx + dy * this.mount.fy + dz * this.mount.fz) / d;
    return Math.acos(clamp(dot, -1, 1)) * RAD;
  }

  /* --- イベント ---------------------------------------------- */

  get events() {
    if (!this._events) {
      this._events = {
        onShot: (g, m) => {
          this.shots++;
          this.sfx.shot(g);
          this.fx.sparkle(m.x, m.y, m.z, 1, 6, 0.08, C.YELLOW);
        },
        onOverheat: (g) => {
          this.sfx.overheat();
          this.pushLog('!! ' + g.name + ' OVERHEATED -- CEASE FIRE', C.LRED);
        },
        onReload: (g) => {
          this.sfx.reload();
          this.pushLog('AUTO RELOAD ' + g.name, C.YELLOW);
        },
        // 構えていない砲の装填が裏で終わったとき。持ち替えてよいことを知らせる
        onReloadDone: (g) => {
          this.sfx.beep(680, 0.04);
          this.pushLog(g.name + ' RELOADED', C.LGREEN);
        },
      };
    }
    return this._events;
  }

  get actx() {
    if (!this._actx) {
      this._actx = {
        fx: this.fx,
        onStrike: (ac) => {
          const d = DIFFICULTY[this.opts.difficulty] || DIFFICULTY.VETERAN;
          const dmg = Math.round((ac.t.strike || 8) * d.strike);
          this.integrity = Math.max(0, this.integrity - dmg);
          this.damageFlash = 1;
          this.sfx.explode(1.1);
          this.fx.groundHit((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, true);
          this.pushLog('!! POST HIT BY ' + ac.tag + ' -- ' + dmg + '% DAMAGE', C.LRED);
        },
      };
    }
    return this._actx;
  }

  get bctx() {
    if (!this._bctx) {
      this._bctx = {
        targets: this.aircraft,
        onAircraftHit: (ac, b, x, y, z, scale = 1) => {
          const dmg = b.dmg * scale;
          if (scale === 1) { this.hits++; this.hitMarker = 1; }
          this.fx.sparkle(x, y, z, b.he ? 10 : 3, b.he ? 26 : 11, 0.3,
            b.he ? C.YELLOW : C.WHITE);
          if (b.he) {
            this.fx.burst(x, y, z, 7, 0.4);
            this.sfx.explode(0.5);
          } else {
            this.sfx.hit();
          }
          if (ac.hit(dmg)) this.kill(ac, b);
        },
        onGroundHit: (x, z, b) => {
          this.fx.groundHit(x, z, b.he);
          if (b.he && Math.hypot(x, z) < 900) this.sfx.explode(0.45);
        },
        /* 空中炸裂。40mm ボフォースの時限信管と 20mm の自爆信管が通る。
           破片は球状に飛ぶので、半径内の機体をまとめて減衰つきで殴る。 */
        onAirburst: (x, y, z, b) => {
          const big = b.splash > 12;
          this.fx.burst(x, y, z, big ? b.splash * 0.85 : 9, big ? 0.7 : 0.45);
          this.fx.sparkle(x, y, z, big ? 30 : 10, big ? 70 : 24, big ? 0.6 : 0.4, C.YELLOW);
          if (big) this.fx.smoke(x, y, z, false);
          this.sfx.explode(big ? 1.2 : 0.4);

          let any = false;
          for (const ac of this.aircraft) {
            if (!ac.alive || b.splash <= 0) continue;
            const d = Math.hypot(ac.x - x, ac.y - y, ac.z - z);
            if (d >= b.splash) continue;
            any = true;
            if (ac.hit(b.dmg * (1 - d / b.splash))) this.kill(ac, b);
          }
          if (any) { this.hits++; this.hitMarker = 1; }
        },
      };
      // targets は配列参照なので毎フレーム差し替える
      Object.defineProperty(this._bctx, 'targets', {
        get: () => this.aircraft,
      });
    }
    return this._bctx;
  }

  kill(ac, b) {
    if (!ac.alive) return;
    ac.alive = false;
    this.kills++;
    this.fx.wreck(ac);
    this.sfx.explode(1);

    const rangeMult = 1 + ac.slant / 1600;
    const gunMult = this.mount.gun.score;
    const pts = Math.round(ac.t.score * rangeMult * gunMult * (1 + this.wave * 0.05));
    this.score += pts;
    this.pushLog('SPLASH ' + ac.tag + ' (' + ac.t.name + ') ' +
      Math.round(ac.slant) + 'M  +' + pts, C.LCYAN);

    // 褒賞機を落とすと陣地が戻る。FREE RANGE には耐久が無いので効かない
    if (ac.t.heal && !this.freeRange) {
      const before = this.integrity;
      this.integrity = Math.min(100, this.integrity + ac.t.heal);
      this.pushLog('*** PRISM DOWN -- POST REPAIRED ' +
        before + '% -> ' + this.integrity + '% ***', C.LMAGENTA);
      this.sfx.beep(880, 0.09); setTimeout(() => this.sfx.beep(1320, 0.14), 100);
    }
    if (this.target === ac) this.target = null;
  }

  /* --- 描画 -------------------------------------------------- */

  render(r) {
    r.clip(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
    this.scene.draw(r, this.cam, this.elapsed);
    for (const ac of this.aircraft) ac.draw(r, this.cam, ac === this.target);
    this.bullets.draw(r, this.cam);
    this.fx.draw(r, this.cam);
    r.clipAll();
    drawHud(r, this);
  }
}
