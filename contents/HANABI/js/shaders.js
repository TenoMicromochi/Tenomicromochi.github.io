/* ============================================================
   shaders.js — GLSL 一式（WebGL2 / GLSL ES 3.00）

   設計の中心は「星の軌道を積分しない」こと。
   線形抵抗 dv/dt = G - (v - w)/tau は閉じた解を持つ：

     v_T  = tau*G + w                          (終端速度)
     p(t) = p0 + v_T*t + tau*(v0 - v_T)*(1 - exp(-t/tau))
     v(t) = v_T + (v0 - v_T)*exp(-t/tau)       (速度も閉じている)

   これを頂点シェーダで直接評価する。前フレームの状態を一切参照しないので、
   VBO は起動時に一度書くだけ、毎フレーム更新するのは uAge ひとつになる。

   ---- 2 段軌道（分砲 / 千輪）----
   速度まで閉じているので、分裂を「もう一区間の解析評価」として書ける。
   分裂時刻 ts での状態 (p(ts), v(ts)) を初期値に第 2 区間を評価するだけで、
   積分もフィードバックも要らない。1 玉 = 1 draw call のまま、
   フレームレート非依存もタブ復帰耐性もそのまま保たれる。

   ただし子の粒子数は親と同数になる（各粒子が 1 本の子へ continue する）。
   実物の千輪のような 1 粒 → 20 粒の fan-out ではない。分裂時に方向・速度・
   色を全部振り直すので二段咲きには見えるが、粒子密度は増えない。
   密度が欲しければ STARS を上げる（頂点律速ではないので安い）。
   ============================================================ */

/* 画面いっぱいの三角形。頂点バッファを持たず gl_VertexID から座標を作る。 */
export const FS_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/* パレットの最大色数。これを超える色は UI 側で弾く。
   星ごとの色分けは「どの色を引くか」を静的属性 aMeta.x で決めるので、
   何色使っても毎フレームのコストは変わらない。 */
export const MAX_PAL = 4;

/* ---------------------------------------------------------------- 星 */
export const STAR_VS = `#version 300 es
precision highp float;

in vec3 aDir;    // 球面一様の単位ベクトル（第 1 段の方向）
in vec3 aJit;    // [-1,1] の乱数 3 本 → 速度 / tau / 寿命 のばらつき
in vec3 aDir2;   // 第 2 段（分裂後）の方向。使わない玉では単に無視される
in vec2 aMeta;   // x: 色の抽選値 [0,1) / y: 分裂時刻のばらつき [-1,1]

uniform mat4  uView, uProj;
uniform vec3  uOrigin;
uniform mat3  uRot;        // 玉ごとの向き
uniform float uAge;        // 開花からの秒数（CPU 側で倍精度計算して渡す）
uniform float uSpeed;      // |v0|
uniform float uTau;        // 緩和時間 m/k
uniform float uLife;       // 星の総寿命（分裂する玉では親＋子の合計）
uniform float uG;
uniform vec3  uWind;
uniform float uFlat;       // 1.0 = 球 / 小さくすると環（リング／菊咲き）
uniform float uSpdSpread, uTauSpread, uLifeSpread;
uniform float uPxScale;    // starSize * (ih/2) / tan(fov/2)
uniform float uSizeMul;    // 1.0 = 実体 / 5.0 前後 = ハロー
uniform float uMaxPx;

// --- 第 2 段（0 以下なら分裂しない）
uniform float uSplitT;     // 分裂時刻 [s]（開花から）
uniform float uSplitSpread;
uniform float uSpeed2;
uniform float uTau2;
uniform float uInherit;    // 親の速度をどれだけ引き継ぐか

// --- 色
uniform vec3  uPalA[${MAX_PAL}];
uniform int   uPalAN;
uniform vec3  uPalB[${MAX_PAL}];
uniform int   uPalBN;
uniform vec3  uLateA;
uniform vec3  uLateB;
uniform float uLateAOn, uLateBOn;
// 経時変化の開始 / 終了（その段の寿命に対する割合）。段ごとに持つ
uniform vec2  uLateTA;
uniform vec2  uLateTB;

out float vAge01;          // 総寿命に対する経過。全体の減衰に使う
out float vStage01;        // 「その段が始まってから」の経過。発光フラッシュに使う
out float vComp;
out float vSeed;
out vec3  vColor;

vec3 palPick(vec3 pal[${MAX_PAL}], int n, float r) {
  int idx = int(r * float(n));
  return pal[min(idx, n - 1)];
}

void main() {
  float life = uLife * (1.0 + aJit.z * uLifeSpread);

  // 寿命外はクリップ空間の外へ飛ばして捨てる（discard より前段で消える）
  if (uAge < 0.0 || uAge > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  // uFlat < 1 で球を潰して環にする。CPU 側の分布は触らない
  vec3 dir = uRot * normalize(vec3(aDir.x, aDir.y * uFlat, aDir.z));

  float tau = uTau * (1.0 + aJit.y * uTauSpread);
  vec3  v0  = dir * (uSpeed * (1.0 + aJit.x * uSpdSpread));

  // 風は終端速度に足すだけで入る（線形抵抗を選んだことの副産物）
  vec3  vT  = vec3(0.0, -uG * tau, 0.0) + uWind;

  float ts = uSplitT * (1.0 + aMeta.y * uSplitSpread);
  bool  split = (uSplitT > 0.0) && (uAge >= ts);

  vec3  pos;
  float stageAge, stageLife;

  if (!split) {
    pos = uOrigin + vT * uAge + tau * (v0 - vT) * (1.0 - exp(-uAge / tau));
    stageAge  = uAge;
    stageLife = (uSplitT > 0.0) ? ts : life;
    vColor = palPick(uPalA, uPalAN, aMeta.x);
    if (uLateAOn > 0.5) {
      vColor = mix(vColor, uLateA, smoothstep(uLateTA.x, uLateTA.y, uAge / life));
    }
  } else {
    // 分裂点での状態。ここが第 2 区間の初期値になる
    float e  = exp(-ts / tau);
    vec3  ps = uOrigin + vT * ts + tau * (v0 - vT) * (1.0 - e);
    vec3  vs = vT + (v0 - vT) * e;

    float tau2 = uTau2 * (1.0 + aJit.y * uTauSpread);
    vec3  v02  = vs * uInherit + normalize(aDir2) * (uSpeed2 * (1.0 + aJit.x * uSpdSpread));
    vec3  vT2  = vec3(0.0, -uG * tau2, 0.0) + uWind;

    float dt = uAge - ts;
    pos = ps + vT2 * dt + tau2 * (v02 - vT2) * (1.0 - exp(-dt / tau2));
    stageAge  = dt;
    stageLife = max(0.05, life - ts);
    vColor = palPick(uPalB, uPalBN, aMeta.x);
    if (uLateBOn > 0.5) {
      vColor = mix(vColor, uLateB, smoothstep(uLateTB.x, uLateTB.y, dt / stageLife));
    }
  }

  vec4 mv = uView * vec4(pos, 1.0);
  gl_Position = uProj * mv;

  // --- 点サイズ：整数に丸めないとカメラ移動でサブピクセル明滅が出る。
  //     丸めた分は面積比で輝度補償しないと、サイズが切り替わる距離に
  //     輝度の段差が輪になって現れる。
  float r     = max(-mv.z, 1.0);
  float sWant = uPxScale * uSizeMul / r;
  float sUse  = clamp(floor(sWant), 1.0, uMaxPx);
  gl_PointSize = sUse;
  vComp  = (sWant / sUse) * (sWant / sUse);

  vAge01   = uAge / life;
  vStage01 = stageAge / stageLife;
  vSeed    = aJit.x * 0.5 + 0.5;
}`;

export const STAR_FS = `#version 300 es
precision highp float;

in float vAge01;
in float vStage01;
in float vComp;
in float vSeed;
in vec3  vColor;

uniform float uBright;
uniform float uCrackle;
uniform float uHalo;     // 0 = 実体 / 1 = ハロー

out vec4 outColor;

float hash(float x) { return fract(sin(x * 127.1) * 43758.5453); }

void main() {
  // 誕生直後は白〜黄白、そこから指定色相へ寄る。
  // 段が変わるとここが 0 に戻るので、分裂の瞬間にもう一度白く光る＝再点火に見える
  vec3 c = mix(vec3(1.0, 0.96, 0.86), vColor, smoothstep(0.0, 0.22, vStage01));

  // 減衰は総寿命で。段ごとにリセットすると分裂した玉が消えなくなる
  float b = 1.0 - smoothstep(0.55, 1.0, vAge01);
  b *= 1.0 + 5.0 * exp(-vStage01 * 55.0);             // 開花／再点火のフラッシュ

  // クラックル（終盤の再発光）。粒ごとに点き始めをずらす
  float ct = 0.70 + 0.12 * hash(vSeed * 7.3);
  float cr = step(ct, vAge01) * max(0.0, 1.0 - (vAge01 - ct) * 4.0);
  cr *= step(0.55, hash(vSeed * 31.7 + floor(vAge01 * 90.0)));
  b += uCrackle * cr * 7.0;

  b *= vComp * uBright;

  if (uHalo > 0.5) {
    vec2 d = gl_PointCoord - 0.5;
    b *= max(0.0, 1.0 - dot(d, d) * 4.0);
  }

  outColor = vec4(c * b, 1.0);   // 加算合成なので alpha は使わない
}`;

/* ------------------------------------------------- 昇り星（打ち上げの尾）
   高度スケールの物差しになるので、粒子数の割に効きが大きい。
   尾はトレイルバッファが勝手に描いてくれるので、頭を打つだけでよい。 */
export const SPARK_VS = `#version 300 es
precision highp float;
in vec3  aPos;
in vec2  aMeta;            // x: 明るさ / y: サイズ(px)
uniform mat4 uView, uProj;
out float vB;
void main() {
  vec4 mv = uView * vec4(aPos, 1.0);
  gl_Position = uProj * mv;
  gl_PointSize = aMeta.y;
  vB = aMeta.x;
}`;

export const SPARK_FS = `#version 300 es
precision highp float;
in float vB;
uniform vec3 uColor;
out vec4 outColor;
void main() { outColor = vec4(uColor * vB, 1.0); }`;

/* ------------------------------------------------------------ トレイル
   毎フレーム背景を消さず、前フレームを減衰させて重ねる。
   8bit だと乗算だけでは低輝度域で丸めにより下げ止まり、残像が永久に
   消えず画面が薄汚れる。定数を引いて 0 に到達させるのはその保険。 */
export const FADE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uFade;
uniform float uEps;
out vec4 outColor;
void main() {
  vec3 c = texture(uTex, vUv).rgb * uFade - uEps;
  outColor = vec4(max(c, vec3(0.0)), 1.0);
}`;

/* -------------------------------------------------------------- 出力
   低解像度バッファを整数倍で引き伸ばす（NEAREST）。
   トーンマップを切ると単純クリップになる＝密集部の階調が全部白に潰れ、
   球の縁が明るく見える手がかりが消えるのを確認できる。

   空はここで足す。トレイルバッファに描くとフィードバックで飽和するし、
   TRAIL スライダーが空の明るさを兼ねてしまう（sky.js 冒頭に詳細）。
   空と花火は同じ内部解像度の別バッファなので、同じ NEAREST 整数倍で
   引き伸ばされて完全に同じピクセルグリッドに乗る。 */
export const PRESENT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uSky;
uniform float uExposure;
uniform float uSkyBright;
uniform float uToneMap;
out vec4 outColor;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec3 c = texture(uTex, vUv).rgb * uExposure
         + texture(uSky, vUv).rgb * uSkyBright;
  c = (uToneMap > 0.5) ? aces(c) : min(c, vec3(1.0));
  outColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
}`;
