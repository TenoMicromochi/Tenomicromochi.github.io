/* ============================================================
   sky.js — 背景（星空 / 地面 / 樹立）

   ---- なぜ専用バッファなのか ----
   空をトレイルバッファに描いてはいけない。あれは前フレームを減衰させて
   足し込むフィードバックループなので、静止した空でも毎フレーム
   「減衰して再加算」され、蓄積利得 1/(1-fade) 倍まで飽和する。
   しかも fade は TRAIL スライダーで動くから、尾の長さを変えた瞬間に
   空の明るさが変わってしまう。

   なので空は独立したバッファに描き、present パスで
     tonemap(sky*skyBright + trail*exposure)
   として足す。トレイルバッファは花火専用のまま、既存の露出補正も壊れない。

   ---- なぜ内部解像度なのか ----
   キャンバス解像度で描くと、カリカリの花火となめらかな写真が同じ画面に乗る。
   trail と同じ 1/n バッファに描いて同じ NEAREST 整数倍で引き伸ばせば、
   空も花火もまったく同じピクセルグリッドに乗る。ドット絵の不変条件を
   背景にも通すのと、fbm を 1/9 の画素数で済ませるのを兼ねている。

   ---- 全部フラグメント 1 枚で出す ----
   地面も樹立もジオメトリを持たず、画素ごとの視線ベクトルから解く。
   カメラは目線高さ 1.6m 固定で必ず地平線が見えるので、地面は
   dir.y < 0 の側、樹立は方位角の関数として高さを引くだけで足りる。
   ============================================================ */

import { createProgram, createTarget, destroyTarget } from './glutil.js';
import { FS_VS } from './shaders.js';

export const SKY_MODES = [
  { key: 0, label: 'NONE' },
  { key: 1, label: 'STARS' },
  { key: 2, label: 'HDRI' },
];

/* 星の見た目は詰めたあと固定した。スライダーに残しておくと
   毎回いじって迷うだけで、決まったあとは動かす理由がない。
   触りたくなったら window.HANABI から書き換えられる */
export const SKY_BRIGHT = 2.0;     // 背景の合成利得
export const STAR_FREQ = 600;      // 天球を切る格子の細かさ
export const STAR_DENSITY = 0.05;  // セルに星が置かれる確率
export const STAR_SIZE = 0.15;     // セル内での星の半径

/* 地平線のもや。切り替えの段だけ持つ */
export const HAZE_STEPS = [
  { key: 0.25, label: 'HIGH' },
  { key: 0.15, label: 'MID' },
  { key: 0.05, label: 'MIN' },
  { key: 0, label: 'OFF' },
];

/* 樹立の高さ。UI 上は度で見せる（treeLine の最大が約 1.84 倍なので、
   6 度指定なら実際の梢は 11 度あたりに来る） */
export const TREE_ON = 6.0 * Math.PI / 180;

/* 等角図法テクスチャの置き場。ambientCG の Night Sky HDRI は CC0 だが
   .exr / .hdr はブラウザが読めないので、JPG か WebP に変換して置く。
   手順は sky/README.md にある。無ければ HDRI モードは選べないだけ。
   先頭で見つかったものを使う。 */
export const SKY_TEXTURE_CANDIDATES = [
  'image/NightSkyHDRI.jpg',
  'sky/nightsky.webp',
  'sky/nightsky.jpg',
  'sky/nightsky.png',
];

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUv;

uniform mat3      uBasis;      // 列 = right, up, zback（ビュー行列の回転の転置）
uniform float     uTanHalf;    // tan(fov/2)
uniform float     uAspect;
uniform float     uMode;       // 0 = 黒 / 1 = 手続き / 2 = テクスチャ
uniform sampler2D uTex;        // 等角図法（equirectangular）
uniform float     uStarFreq, uStarDensity, uStarSize;
uniform float     uTreeH;
uniform float     uHaze;

out vec4 outColor;

/* iq の 3D ハッシュ。星の位置決めに使う */
float hash31(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453); }

float noise1(float x) {
  float i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), f);
}

/* 星。方向ベクトルを 3D 格子で切ってセルごとに 1 個置く。
   スクリーン空間ではなくワールド方向で決めるので、カメラを回しても
   星が流れない（＝ちゃんと天球に貼り付いて見える） */
vec3 stars(vec3 d) {
  vec3 p = d * uStarFreq;
  vec3 c = floor(p);
  float h = hash31(c);
  if (h > uStarDensity) return vec3(0.0);

  vec3 off = vec3(hash31(c + 11.3), hash31(c + 27.7), hash31(c + 41.1));
  float dist = length(fract(p) - off);
  float m = smoothstep(uStarSize, 0.0, dist);
  if (m <= 0.0) return vec3(0.0);

  // 明るさは冪で散らす。一様だと粒が揃いすぎて模様に見える
  float b = pow(hash31(c + 63.9), 3.0) * 0.95 + 0.05;
  // 色温度。青白い星と赤い星が混じるだけで一気に空らしくなる
  float t = hash31(c + 88.1);
  vec3 tint = mix(vec3(1.0, 0.78, 0.62), vec3(0.72, 0.83, 1.0), smoothstep(0.25, 0.85, t));
  return tint * (m * b);
}

/* 樹立のシルエット。方位角に対する高さの 1D ノイズで、
   低い茂み + たまに高い木、という重ね方にする */
float treeLine(float az) {
  float h = 0.55 * noise1(az * 5.0)
          + 0.28 * noise1(az * 13.0 + 3.1)
          + 0.16 * noise1(az * 37.0 + 7.7);
  h += 0.85 * pow(noise1(az * 8.0 + 1.7), 7.0);    // 単木の突出
  return h;
}

void main() {
  if (uMode < 0.5) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 dir = normalize(uBasis * vec3(ndc.x * uTanHalf * uAspect, ndc.y * uTanHalf, -1.0));

  vec3 col;
  if (uMode > 1.5) {
    // 等角図法をそのまま引く
    vec2 uv = vec2(atan(dir.z, dir.x) * 0.1591549 + 0.5,
                   acos(clamp(dir.y, -1.0, 1.0)) * 0.3183099);
    col = texture(uTex, uv).rgb;
  } else {
    col = stars(dir);
  }

  // 地平線付近のもや。高度スケールの手がかりになるので薄く入れる
  float el = asin(clamp(dir.y, -1.0, 1.0));
  col += vec3(0.05, 0.06, 0.09) * uHaze * exp(-max(el, 0.0) * 14.0);

  // 地平線より下は黒。もやもここで打ち切らないと地面が光ってしまう
  if (dir.y < 0.0) col = vec3(0.0);

  /* 樹立。空を切り取る純黒のシルエット。
     地面が黒なので下端は切らなくても成立するが、上端の判定だけで
     「地平線より下」まで塗ると、もやの帯が不自然に食われる */
  if (uTreeH > 0.0) {
    float az = atan(dir.z, dir.x);
    if (el < treeLine(az) * uTreeH) col = vec3(0.0);
  }

  outColor = vec4(col, 1.0);
}`;

export class Sky {
  constructor(gl) {
    this.gl = gl;
    this.prog = createProgram(gl, FS_VS, SKY_FS);
    this.target = null;
    this.tex = null;          // 等角図法テクスチャ（読めたときだけ）
    this.texReady = false;
    this.texName = null;
    this.emptyVao = gl.createVertexArray();

    /* uTex に必ず何かを束ねるための 1x1。
       サンプラが不完全なテクスチャを指していると、そのサンプラを通らない
       分岐しか実行しなくても draw が GL_INVALID_OPERATION で落ちる。
       手続きモード（uTex を読まない）でも塞いでおく必要がある */
    this.dummy = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.dummy);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /* trail と同じ内部解像度で持つ。ここがずれると空だけ別のグリッドに乗る */
  resize(iw, ih, float) {
    const gl = this.gl;
    if (this.target && this.target.w === iw && this.target.h === ih) return;
    destroyTarget(gl, this.target);
    this.target = createTarget(gl, iw, ih, float);
  }

  /* 候補を順に試して、最初に読めたものを使う。
     無くても手続きモードは動くので、失敗しても致命的ではない */
  async loadTexture(candidates = SKY_TEXTURE_CANDIDATES) {
    for (const url of candidates) {
      try {
        const img = await loadImage(url);
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        // 経度方向は継ぎ目でつながるので REPEAT、緯度方向は CLAMP
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        // 空も内部解像度のグリッドに乗せるので、拡大は NEAREST でよい。
        // 縮小側だけは LINEAR_MIPMAP にしないと星がちらつく
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.bindTexture(gl.TEXTURE_2D, null);
        this.tex = tex;
        this.texReady = true;
        this.texName = url;
        return url;
      } catch { /* 次の候補へ */ }
    }
    return null;
  }

  render(p, view, aspect) {
    const gl = this.gl;
    const t = this.target;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
    gl.disable(gl.BLEND);
    gl.useProgram(this.prog);

    // ビュー行列の回転部（world->view）の転置が view->world。
    // 列優先で入っているので、転置は添字を入れ替えるだけ
    gl.uniformMatrix3fv(this.prog.u.uBasis, false, new Float32Array([
      view[0], view[4], view[8],
      view[1], view[5], view[9],
      view[2], view[6], view[10],
    ]));
    gl.uniform1f(this.prog.u.uTanHalf, Math.tan(p.fov * Math.PI / 360));
    gl.uniform1f(this.prog.u.uAspect, aspect);

    const mode = (p.skyMode === 2 && !this.texReady) ? 1 : p.skyMode;
    gl.uniform1f(this.prog.u.uMode, mode);
    // モードによらず必ず束ねる（塞がないと不完全サンプラで draw ごと落ちる）
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, mode === 2 ? this.tex : this.dummy);
    gl.uniform1i(this.prog.u.uTex, 0);
    gl.uniform1f(this.prog.u.uStarFreq, STAR_FREQ);
    gl.uniform1f(this.prog.u.uStarDensity, STAR_DENSITY);
    gl.uniform1f(this.prog.u.uStarSize, STAR_SIZE);
    gl.uniform1f(this.prog.u.uHaze, p.haze);
    gl.uniform1f(this.prog.u.uTreeH, p.treeH);

    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    return mode;
  }
}

function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(url));
    img.src = url;
  });
}
