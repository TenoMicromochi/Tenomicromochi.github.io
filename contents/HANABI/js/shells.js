/* ============================================================
   shells.js — 玉のプールと打ち上げ管理

   星の属性は起動時に一度だけ生成して、スロットごとに VBO の連続した
   領域を占有させる。発火時に書き込むものは何もなく、drawArrays の
   オフセットを変えるだけで別の玉になる。分裂する玉でも同じで、
   第 2 段の方向 aDir2 もやはり起動時に一度書くだけ。

   1 発 = 1 draw call。玉ごとのパラメータは uniform で渡す。
   uAge を玉ごとに持つのは、グローバルな経過秒を float32 で渡すと
   常時稼働で精度が落ちてアニメーションがガタつくため。

   レシピは複数の玉をまとめて 1 発として扱う。同じ原点・同じ昇り時間を
   共有させないと、composite が「1 つの花火」ではなく「同時に上がった
   別々の花火」に見えてしまう。
   ============================================================ */

import { randomRotation3, rotationTo } from './mat.js';
import { resolveShell } from './recipes.js';
import { GRAVITY } from './presets.js';
import { CAM_AZ } from './camera.js';

export const MAX_SHELLS = 16;

/* 球面一様サンプリング。
   角度を naive に振ると極に密集して上下に塊ができるので、
   z を一様に引いてから方位角を振る。 */
function sphereDir(out, i) {
  const z = 1 - 2 * Math.random();
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  const t = 2 * Math.PI * Math.random();
  out[i] = r * Math.cos(t);
  out[i + 1] = z;
  out[i + 2] = r * Math.sin(t);
}

/* ばらつき用の乱数。一様分布より正規分布寄りのほうが自然なので
   一様乱数を 3 本足して均す */
function jitter() {
  return ((Math.random() + Math.random() + Math.random()) / 1.5) - 1;
}

export function buildStarBuffer(count) {
  const n = MAX_SHELLS * count;
  const dir = new Float32Array(n * 3);
  const dir2 = new Float32Array(n * 3);
  const jit = new Float32Array(n * 3);
  const meta = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    sphereDir(dir, i * 3);
    sphereDir(dir2, i * 3);
    jit[i * 3] = jitter();
    jit[i * 3 + 1] = jitter();
    jit[i * 3 + 2] = jitter();
    // x: 色の抽選値。星ごとに固定なので、何色に分けても毎フレームのコストは同じ
    meta[i * 2] = Math.random();
    meta[i * 2 + 1] = jitter();
  }
  return { dir, dir2, jit, meta, count };
}

export class ShellSystem {
  constructor(cam) {
    this.cam = cam;
    this.shells = [];
    for (let i = 0; i < MAX_SHELLS; i++) {
      this.shells.push({ alive: false, slot: i });
    }
    this.nextAuto = 0;
  }

  free() { return this.shells.find(s => !s.alive) || null; }
  freeCount() { return this.shells.reduce((n, s) => n + (s.alive ? 0 : 1), 0); }

  /* 環をおおむねカメラ正面に向ける。実物の型物も観客側に開くよう
     仕込まれていて、真横を向いた環はただの光の棒になってしまう。
     ±22 度ほど散らして、揃いすぎないようにする。
     カメラ方位は固定になったので、基準は定数でよい */
  facingRotation() {
    const az = CAM_AZ + (Math.random() - 0.5) * 0.78;
    const el = (Math.random() - 0.5) * 0.78;
    const ce = Math.cos(el);
    return rotationTo([Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce]);
  }

  /* レシピを 1 発として打ち上げる。
     原点と昇り時間はグループで共有し、shells[i].delay だけが開花をずらす。

     スロットが足りないときは入るところまで打つ。shells[0] が主玉なので、
     途中で切れても「色数が減った」程度に収まる。全部揃うまで打たない設計に
     すると、混み合った瞬間に画面から花火が消えてしまう。 */
  launchRecipe(params, now, recipe) {
    if (!recipe || !recipe.shells.length) return null;
    if (!this.free()) return null;

    const ang = Math.random() * Math.PI * 2;
    const rad = Math.sqrt(Math.random()) * params.scatter;
    const alt = params.altitude * (0.85 + Math.random() * 0.3);
    const origin = [Math.cos(ang) * rad, alt, Math.sin(ang) * rad];
    const riseTime = 2.6 + Math.random() * 1.2;

    const fired = [];
    for (let i = 0; i < recipe.shells.length; i++) {
      const s = this.free();
      if (!s) break;
      this._fire(s, params, now, recipe.shells[i], origin, riseTime, i === 0);
      fired.push(s);
    }
    return fired;
  }

  /* params は UI の現在値。発火時にスナップショットする（飛行中の玉の
     軌道が途中で書き換わって飛ぶのを避けるため） */
  _fire(s, params, now, spec, origin, riseTime, isLeader) {
    const r = resolveShell(spec, GRAVITY);

    s.alive = true;
    s.phase = 'rise';
    s.tLaunch = now;
    s.riseTime = riseTime;
    s.tBurst = now + riseTime + spec.delay;
    // 同じ点に完全に重ねると 1 つの玉にしか見えないので、数 m だけ散らす
    s.origin = [
      origin[0] + (Math.random() - 0.5) * 6,
      origin[1] + (Math.random() - 0.5) * 6,
      origin[2] + (Math.random() - 0.5) * 6,
    ];
    // 昇り星はグループで 1 本だけ。全玉が出すと尾が不自然に太くなる
    s.leader = isLeader;

    s.rot = r.flat < 0.5 ? this.facingRotation() : randomRotation3();
    s.tau = r.tau;
    s.speed = r.speed;
    s.life = r.life;
    s.maxLife = r.life * (1 + r.lifeSpread);
    s.flat = r.flat;
    s.crackle = r.crackle;
    s.tauSpread = r.tauSpread;
    s.spdSpread = r.spdSpread;
    s.lifeSpread = r.lifeSpread;
    s.gravity = GRAVITY;

    s.splitT = r.splitT;
    s.splitSpread = r.splitSpread;
    s.tau2 = r.tau2;
    s.speed2 = r.speed2;
    s.inherit = r.inherit;

    s.palA = r.palA;
    s.palB = r.palB;
    s.lateA = r.lateA;
    s.lateB = r.lateB;
    s.lateTA = r.lateTA;
    s.lateTB = r.lateTB;
    return s;
  }

  update(params, now, pickRecipe) {
    for (const s of this.shells) {
      if (!s.alive) continue;
      if (s.phase === 'rise' && now >= s.tBurst) s.phase = 'burst';
      if (s.phase === 'burst' && now - s.tBurst > s.maxLife) s.alive = false;
    }

    if (params.autoLaunch && now >= this.nextAuto) {
      this.launchRecipe(params, now, pickRecipe());
      this.nextAuto = now + params.interval * (0.6 + Math.random() * 0.8);
    }
  }

  /* 昇り星。頂点で速度が 0 になる放物線で、頭と数個の火の粉を返す。
     尾自体はトレイルバッファが描くので、点を打つだけでよい。 */
  collectSparks(now, out) {
    let n = 0;
    for (const s of this.shells) {
      if (!s.alive || s.phase !== 'rise' || !s.leader) continue;
      const u = Math.min(1, (now - s.tLaunch) / s.riseTime);
      const ease = 1 - (1 - u) * (1 - u);
      const y = s.origin[1] * ease;
      const fade = 1 - u * 0.35;
      for (let k = 0; k < 5; k++) {
        const lag = k * 0.012;
        const uk = Math.max(0, u - lag);
        const yk = s.origin[1] * (1 - (1 - uk) * (1 - uk));
        out[n * 5] = s.origin[0] + (Math.random() - 0.5) * (k ? 2.5 : 0);
        out[n * 5 + 1] = (k ? yk : y) + (Math.random() - 0.5) * (k ? 2.5 : 0);
        out[n * 5 + 2] = s.origin[2] + (Math.random() - 0.5) * (k ? 2.5 : 0);
        out[n * 5 + 3] = (k === 0 ? 2.4 : 0.7 * Math.random()) * fade;
        out[n * 5 + 4] = k === 0 ? 2 : 1;
        n++;
      }
    }
    return n;
  }
}
