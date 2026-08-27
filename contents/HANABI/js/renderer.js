/* ============================================================
   renderer.js — 描画パス

   1 フレームの流れ：
     0. 背景（星空／地面／樹立）を専用バッファへ描く
     1. trailA を減衰させて trailB へ書く（背景を消さない＝光跡が残る）
     2. trailB に加算合成でハロー → 実体 → 昇り星を描く
     3. A/B を入れ替え
     4. 低解像度の trailA と背景を足し、「整数倍・NEAREST」でキャンバスへ

   0 を trail と分けているのは、あれがフィードバックループだから。
   静止した空でも毎フレーム減衰と再加算を受けて飽和するうえ、
   TRAIL スライダーが空の明るさを兼ねてしまう（sky.js 冒頭に詳細）。

   4 が効く。パーティクル壁紙は頂点律速ではなく加算合成のオーバードローで
   フラグメント律速になるので、内部解像度を 1/3 にすると塗る量が 1/9 になる。
   同時に、点が画面グリッドに乗るのでドット絵らしい質感が副産物で手に入る。

   多色化と分裂は uniform が増えるだけで、パスの構造は変わらない。
   星ごとの色分けは静的属性 aMeta.x の抽選で決まるので、何色使っても
   draw call も帯域も増えない。
   ============================================================ */

import { createProgram, createTarget, destroyTarget } from './glutil.js';
import * as S from './shaders.js';
import { MAX_SHELLS, buildStarBuffer } from './shells.js';
import { perspective, lookAt } from './mat.js';
import { Sky, SKY_BRIGHT } from './sky.js';
import { WIND } from './presets.js';

const REF_IH = 360;      // 輝度の基準になる内部解像度の高さ
const REF_DT = 1 / 60;   // 露出補正の基準フレーム時間
const REF_TAIL = 0.11;   // 露出補正の基準トレイル時定数 [s]

/* 星の芯は必ず 1px。ドット絵として揃えるためにここを固定した。
   代わりに丸め補償 vComp = (sWant/sUse)^2 が効いて、近い星ほど明るくなる。
   つまり遠近の手がかりは「大きさの差」ではなく「明るさの差」で出る。
   README の実測ではサイズ差のほうが強い手がかりなので、これは
   見た目のために奥行きを一段譲る選択になっている */
const MAX_PX = 1;

/* 内部解像度は PIXEL SIZE で整数倍にするので、DPR は 1 に固定して
   「1 内部ピクセル = PIXEL SIZE 個の CSS ピクセル」を保証する */
export const MAX_DPR = 1;

const ZERO3 = new Float32Array(3);

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;
    this.canvas = canvas;

    // 加算合成で 1.0 を超えた分を保持できないと、密集部の飽和具合が
    // トーンマップに渡らず、球の縁が明るく見える手がかりが潰れる
    this.float = !!gl.getExtension('EXT_color_buffer_float');

    this.progStar = createProgram(gl, S.STAR_VS, S.STAR_FS);
    this.progSpark = createProgram(gl, S.SPARK_VS, S.SPARK_FS);
    this.progFade = createProgram(gl, S.FS_VS, S.FADE_FS);
    this.progPresent = createProgram(gl, S.FS_VS, S.PRESENT_FS);

    this.emptyVao = gl.createVertexArray();

    this.dirBuf = gl.createBuffer();
    this.dir2Buf = gl.createBuffer();
    this.jitBuf = gl.createBuffer();
    this.metaBuf = gl.createBuffer();
    this.starVao = gl.createVertexArray();
    this.count = 0;

    this.sparkData = new Float32Array(MAX_SHELLS * 5 * 5);
    this.sparkBuf = gl.createBuffer();
    this.sparkVao = gl.createVertexArray();
    gl.bindVertexArray(this.sparkVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sparkBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.sparkData.byteLength, gl.DYNAMIC_DRAW);
    const sp = gl.getAttribLocation(this.progSpark, 'aPos');
    const sm = gl.getAttribLocation(this.progSpark, 'aMeta');
    gl.enableVertexAttribArray(sp);
    gl.vertexAttribPointer(sp, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(sm);
    gl.vertexAttribPointer(sm, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null);

    this.sky = new Sky(gl);

    this.trailA = null;
    this.trailB = null;
    this.iw = 0; this.ih = 0;
  }

  /* 属性は 4 本とも STATIC_DRAW。発火時にも書き込まないので、
     ここを通るのは起動時と STARS を動かしたときだけ */
  setStarCount(count) {
    if (count === this.count) return;
    const gl = this.gl;
    const { dir, dir2, jit, meta } = buildStarBuffer(count);
    gl.bindVertexArray(this.starVao);

    const bind = (buf, data, name, size) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(this.progStar, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };

    bind(this.dirBuf, dir, 'aDir', 3);
    bind(this.dir2Buf, dir2, 'aDir2', 3);
    bind(this.jitBuf, jit, 'aJit', 3);
    bind(this.metaBuf, meta, 'aMeta', 2);

    gl.bindVertexArray(null);
    this.count = count;
  }

  /* キャンバスの実ピクセル数を必ず内部解像度の整数倍にする。
     割り切れないぶんは画面からはみ出させて捨てる。ここを floor で
     詰めると端に隙間が出るし、非整数倍で拡大するとドット絵が滲む。 */
  resize(scale, maxDpr) {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const cssW = window.innerWidth, cssH = window.innerHeight;
    const devW = Math.round(cssW * dpr), devH = Math.round(cssH * dpr);
    const iw = Math.max(2, Math.ceil(devW / scale));
    const ih = Math.max(2, Math.ceil(devH / scale));

    const cw = iw * scale, ch = ih * scale;
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    this.canvas.style.width = (cw / dpr) + 'px';
    this.canvas.style.height = (ch / dpr) + 'px';
    this.canvas.style.left = (-(cw / dpr - cssW) / 2) + 'px';
    this.canvas.style.top = (-(ch / dpr - cssH) / 2) + 'px';

    if (iw !== this.iw || ih !== this.ih) {
      const gl = this.gl;
      destroyTarget(gl, this.trailA);
      destroyTarget(gl, this.trailB);
      this.trailA = createTarget(gl, iw, ih, this.float);
      this.trailB = createTarget(gl, iw, ih, this.float);
      this.sky.resize(iw, ih, this.float);
      this.iw = iw; this.ih = ih;
      for (const t of [this.trailA, this.trailB]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    this.aspect = cw / ch;
  }

  render(sys, cam, p, now, dt) {
    const gl = this.gl;
    const iw = this.iw, ih = this.ih;

    const eye = cam.eye();
    const view = lookAt(eye, cam.target(p.altitude));
    const proj = perspective(p.fov, this.aspect, 1.0, 12000);

    // 星の見かけサイズ [px] = starSize * (ih/2) / (tan(fov/2) * 距離)
    const pxScale = p.starSize * (ih / 2) / Math.tan(p.fov * Math.PI / 360);

    // ピクセル 1 個が受け持つ立体角は内部解像度の 2 乗で変わる。
    // 補正しないと解像度を落としたとき露出がまるごとずれる
    let brightScale = (REF_IH / ih) * (REF_IH / ih);

    /* トレイルは「1 フレームあたりの係数」ではなく時定数で持つ。
       係数のままだと 30fps と 60fps で尾の長さが変わってしまう。 */
    const fade = Math.exp(-Math.min(dt, 0.25) / Math.max(0.005, p.trailTime));

    /* フィードバックバッファの蓄積利得は 1/(1-fade) なので、時定数を
       伸ばすとそのぶん明るくなる。ここを補正しないと TRAIL スライダーが
       露出スライダーを兼ねてしまい、伸ばした瞬間に真っ白に飽和する。 */
    brightScale *= (1 - fade) / (1 - Math.exp(-REF_DT / REF_TAIL));

    /* --- 0. 背景を専用バッファへ（trail とは独立） --- */
    const skyMode = this.sky.render(p, view, this.aspect);

    /* --- 1. 減衰（trailA -> trailB） --- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailB.fbo);
    gl.viewport(0, 0, iw, ih);
    gl.disable(gl.BLEND);
    gl.useProgram(this.progFade);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailA.tex);
    gl.uniform1i(this.progFade.u.uTex, 0);
    gl.uniform1f(this.progFade.u.uFade, fade);
    gl.uniform1f(this.progFade.u.uEps, this.float ? 0.0004 : 0.004);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    /* --- 2. 加算合成でパーティクルを重ねる ---
       加算は可換なので描画順を気にしなくてよい＝深度ソートが要らない */
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    const prog = this.progStar;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(prog.u.uView, false, view);
    gl.uniformMatrix4fv(prog.u.uProj, false, proj);
    gl.uniform3f(prog.u.uWind, WIND, 0, 0);
    gl.bindVertexArray(this.starVao);

    let drawn = 0, calls = 0;
    // ハロー（大きく淡い）→ 実体（小さく硬い）の 2 周。
    // 実体のあとに重ねると縁が滲んで見えるので、先にハローを敷く
    for (const pass of [1, 0]) {
      if (pass === 1 && p.glow <= 0.001) continue;
      gl.uniform1f(prog.u.uHalo, pass);
      gl.uniform1f(prog.u.uSizeMul, pass ? p.glowSize : 1.0);
      gl.uniform1f(prog.u.uMaxPx, pass ? 28.0 : MAX_PX);

      for (const s of sys.shells) {
        if (!s.alive || s.phase !== 'burst') continue;
        const age = now - s.tBurst;
        gl.uniform3fv(prog.u.uOrigin, s.origin);
        gl.uniformMatrix3fv(prog.u.uRot, false, s.rot);
        gl.uniform1f(prog.u.uAge, age);
        gl.uniform1f(prog.u.uSpeed, s.speed);
        gl.uniform1f(prog.u.uTau, s.tau);
        gl.uniform1f(prog.u.uLife, s.life);
        gl.uniform1f(prog.u.uG, s.gravity);
        gl.uniform1f(prog.u.uFlat, s.flat);
        gl.uniform1f(prog.u.uSpdSpread, s.spdSpread);
        gl.uniform1f(prog.u.uTauSpread, s.tauSpread);
        gl.uniform1f(prog.u.uLifeSpread, s.lifeSpread);
        gl.uniform1f(prog.u.uCrackle, s.crackle);

        // 第 2 段。uSplitT <= 0 なら分裂しない玉として扱われる
        gl.uniform1f(prog.u.uSplitT, s.splitT);
        gl.uniform1f(prog.u.uSplitSpread, s.splitSpread);
        gl.uniform1f(prog.u.uSpeed2, s.speed2);
        gl.uniform1f(prog.u.uTau2, s.tau2);
        gl.uniform1f(prog.u.uInherit, s.inherit);

        gl.uniform3fv(prog.u.uPalA, s.palA.buf);
        gl.uniform1i(prog.u.uPalAN, s.palA.n);
        gl.uniform3fv(prog.u.uPalB, s.palB.buf);
        gl.uniform1i(prog.u.uPalBN, s.palB.n);
        gl.uniform3fv(prog.u.uLateA, s.lateA || ZERO3);
        gl.uniform1f(prog.u.uLateAOn, s.lateA ? 1 : 0);
        gl.uniform3fv(prog.u.uLateB, s.lateB || ZERO3);
        gl.uniform1f(prog.u.uLateBOn, s.lateB ? 1 : 0);
        // 経時変化の窓は玉ごと・段ごと（recipes.js が from < to を保証する）
        gl.uniform2f(prog.u.uLateTA, s.lateTA[0], s.lateTA[1]);
        gl.uniform2f(prog.u.uLateTB, s.lateTB[0], s.lateTB[1]);

        gl.uniform1f(prog.u.uPxScale, pxScale);
        gl.uniform1f(prog.u.uBright,
          brightScale * (pass ? p.exposureStar * p.glow * 0.12 : p.exposureStar));
        gl.drawArrays(gl.POINTS, s.slot * this.count, this.count);
        calls++;
        if (!pass) drawn += this.count;
      }
    }

    /* 昇り星。粒子数に対して効きが大きいので入れてある */
    const n = sys.collectSparks(now, this.sparkData);
    if (n > 0) {
      gl.useProgram(this.progSpark);
      gl.uniformMatrix4fv(this.progSpark.u.uView, false, view);
      gl.uniformMatrix4fv(this.progSpark.u.uProj, false, proj);
      gl.uniform3f(this.progSpark.u.uColor,
        1.0 * brightScale, 0.72 * brightScale, 0.32 * brightScale);
      gl.bindVertexArray(this.sparkVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sparkBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.sparkData, 0, n * 5);
      gl.drawArrays(gl.POINTS, 0, n);
      calls++;
    }

    /* --- 3. 入れ替え --- */
    const t = this.trailA; this.trailA = this.trailB; this.trailB = t;

    /* --- 4. 整数倍 NEAREST でキャンバスへ --- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.progPresent);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailA.tex);
    gl.uniform1i(this.progPresent.u.uTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.sky.target.tex);
    gl.uniform1i(this.progPresent.u.uSky, 1);
    gl.uniform1f(this.progPresent.u.uExposure, p.exposure);
    gl.uniform1f(this.progPresent.u.uSkyBright, skyMode ? SKY_BRIGHT : 0);
    gl.uniform1f(this.progPresent.u.uToneMap, p.toneMap ? 1 : 0);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    /* テクスチャユニットを空にしてからフレームを閉じる。
       束ねたままにすると、次フレームの先頭で「そのテクスチャを
       カラーアタッチメントに持つ FBO」へ描き込むことになり、
       GL_INVALID_OPERATION（feedback loop）で描画が捨てられる。
       空バッファと trail の両方が該当する */
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);

    return { drawn, calls, skyMode };
  }
}
