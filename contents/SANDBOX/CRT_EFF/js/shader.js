// WebGL2 の CRT 描画。4つの層を順に重ねる（式は logic.js の maskGeometry・shapeP・holeMask・elementLight と同じ）
//   0. 信号：SIGNAL が COMPOSITE のとき、元画像を YIQ にして Y と I・Q を別の帯域で横にぼかしたものを、層 1 以降の元画像にする（式は logic.js の compositeRow）
//   1. 格子：素子の中心・色・素子の強さ I（元画像をリニアにして、素子の中心の位置で読む）
//   2. 素子の光り方：I が KNEE 以上なら穴いっぱいで明るさだけが変わり、弱いと円く縮みながら中心から淡くなる
//   3. 網：穴の外は 0
//   4. にじみ：元画像の上で作った BLOOM（明るい色ほど強い。元画素の単位）と、全体を HALO でぼかしたものを足す（画像の外にも漏れる）。肩のある曲線で 1 に収め、ガンマで戻す
// 素子が細かすぎるときは（fwidth）、2 と 3 を素子の升目で平均した明るさへ混ぜる
import { MASKS, PHOSPHORS, GAMMA, EDGE_SOFT, DOT_MIX, B_TABLE, BLOOM, HALO, CROP_MARGIN_SIGMAS } from './config.js';
import { maskGeometry, buildTable, compositeSigma, compositeRadius, bloomKernel } from './logic.js';

const VERT = `#version 300 es
void main() {
  // 画面全体を覆う三角形1枚
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const CRT_FRAG = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uSrc;
uniform vec2 uSrcSize;
uniform vec3 uView;        // 画像の左上の出力位置 ox, oy と、画像1画素あたりの出力画素数
uniform vec2 uOffset;      // 今の描画先の左上が、出力全体のどこか（書き出しのタイル用）
uniform float uTileH;      // 今の描画先の高さ
uniform float uPixScale;   // 描画先の1画素が出力の何画素か（にじみの元の縮小描画で 4）
uniform sampler2D uHalo;
uniform vec2 uHaloInv;     // 出力位置 → にじみのテクスチャ座標
uniform float uHaloOn;     // 1 のとき、HALO（作り終えたもの）を足す
uniform sampler2D uBloom;  // BLOOM（元画像の周りに余白を足した大きさ、元画素 1 = 1 テクセル）
uniform vec3 uBloomGeo;    // 余白（元画素）、テクスチャの幅・高さ
uniform float uBloomAmt;   // BLOOM の量。0 なら足さない
uniform float uLinearOut;  // 1 のとき BLOOM も HALO も肩もガンマも掛けずリニアのまま出す（HALO の元）

uniform float uBeam, uKnee, uSoft, uExposure;
uniform int uMask;
uniform vec2 uCell;        // cw, ch（升目の幅・高さ。GRILLE は 1 行）
uniform vec4 uHole;        // 満ちた形の半幅 hx・半高さ hy、穴の半幅・半高さ（GRILLE の縦は使わない）
uniform float uN;          // 穴の n
uniform vec2 uSize;        // MIN（弱い素子の大きさの下限）、弱いときの n
uniform float uAvgFrac;    // 満ちた形の面積 ÷ 升目の面積
uniform vec4 uTab[${Math.ceil(B_TABLE.na * B_TABLE.ns / 4)}];   // B の表 Q(af, sf)
uniform vec3 uPhos[3];

const float GAMMA = ${GAMMA.toFixed(1)};
const float E = ${EDGE_SOFT.toFixed(3)};
const int NA = ${B_TABLE.na};
const int NS = ${B_TABLE.ns};
const float AFMIN = ${B_TABLE.afMin};

out vec4 outColor;

// ---- 1. 元画像（リニア）。横は線形補間 ----
vec3 rowLin(int r, float x) {
  ivec2 s = ivec2(uSrcSize);
  float tx = x - 0.5;
  float fx = floor(tx);
  float f = tx - fx;
  int x0 = clamp(int(fx), 0, s.x - 1);
  int x1 = clamp(int(fx) + 1, 0, s.x - 1);
  int ry = clamp(r, 0, s.y - 1);
  vec3 a = pow(texelFetch(uSrc, ivec2(x0, ry), 0).rgb, vec3(GAMMA));
  vec3 b = pow(texelFetch(uSrc, ivec2(x1, ry), 0).rgb, vec3(GAMMA));
  return mix(a, b, f);
}

// 位置 c のまわりの行を、σ = BEAM × 0.5 行のガウスで重み付けした平均（重みの合計で割る。画像の外の行は端の行のまま）
vec3 rowGauss(vec2 c) {
  float sg = max(uBeam * 0.5, 1e-3);
  int kc = int(floor(c.y - 0.5));
  vec3 acc = vec3(0.0);
  float ws = 0.0;
  for (int i = -3; i <= 4; i++) {
    int k = kc + i;
    float dy = float(k) + 0.5 - c.y;
    if (abs(dy) > 3.0 * sg) continue;
    float w = exp(-dy * dy / (2.0 * sg * sg));
    acc += w * rowLin(k, c.x);
    ws += w;
  }
  return acc / max(ws, 1e-6);
}

float pick(vec3 v, int col) { return col == 0 ? v.r : (col == 1 ? v.g : v.b); }

// ---- 1. 格子 ----
// 画面の位置 q（元画素単位）から、一番近い素子の中心 center と色 col を出す（GRILLE 以外）
void maskCell(vec2 q, out vec2 center, out int col) {
  float cw = uCell.x;
  if (uMask == 3) {
    // DELTA：六角（最密充填）。行の間隔 ch、奇数行は半分ずらす
    float rh = uCell.y;
    float j0 = floor(q.y / rh);
    float best = 1e30;
    center = vec2(0.0); col = 0;
    for (int t = 0; t < 2; t++) {
      float j = j0 + float(t);
      float shift = 0.5 * mod(j, 2.0);
      float i = floor(q.x / cw - shift + 0.5);
      vec2 c = vec2((i + shift) * cw, j * rh);
      vec2 dd = q - c;
      float dist = dot(dd, dd);
      if (dist < best) {
        best = dist;
        center = c;
        col = int(mod(i + 2.0 * j, 3.0));
      }
    }
    return;
  }
  // SLOT / SQUARE：長方形。SLOT は3列1組ごとに縦へ半分ずらす
  float i = floor(q.x / cw);
  float ch = uCell.y;
  float off = (uMask == 1) ? 0.5 * ch * mod(floor(i / 3.0), 2.0) : 0.0;
  float j = floor((q.y - off) / ch);
  center = vec2((i + 0.5) * cw, (j + 0.5) * ch + off);
  col = int(mod(i, 3.0));
}

// ---- 2. 素子の光り方 ----
float shapeP(float af, float sf, vec2 d) {
  float hx = uHole.x, hy = uHole.y;
  float sz = mix(uSize.x, 1.0, af);
  float ax = hx * sz, ay = hy * sz;
  float n = mix(uSize.y, uN, af);
  float f = pow(pow(abs(d.x) / ax, n) + pow(abs(d.y) / ay, n), 1.0 / n);
  return (1.0 - sf) * (1.0 - smoothstep(1.0 - E, 1.0 + E, f)) + sf * exp(-2.0 * f * f);
}

// ---- 3. 網 ----
float holeMask(vec2 d) {
  float f;
  if (uMask == 0) f = abs(d.x) / uHole.z;
  else f = pow(pow(abs(d.x) / uHole.z, uN) + pow(abs(d.y) / uHole.w, uN), 1.0 / uN);
  return 1.0 - smoothstep(1.0 - E, 1.0 + E, f);
}

// B の表 Q(af, sf)（√af と sf の2方向に線形補間）
float tabAt(int i, int j) {
  int k = j * NA + i;
  return uTab[k >> 2][k & 3];
}
float lookupQ(float af, float sf) {
  float tmin = sqrt(AFMIN);
  float t = sqrt(clamp(af, AFMIN, 1.0));
  float u = (t - tmin) / (1.0 - tmin) * float(NA - 1);
  float v = clamp(sf, 0.0, 1.0) * float(NS - 1);
  int i0 = min(int(floor(u)), NA - 2), j0 = min(int(floor(v)), NS - 2);
  float fu = u - float(i0), fv = v - float(j0);
  float a = mix(tabAt(i0, j0), tabAt(i0 + 1, j0), fu);
  float b = mix(tabAt(i0, j0 + 1), tabAt(i0 + 1, j0 + 1), fu);
  float sz = mix(uSize.x, 1.0, min(af, 1.0));
  return mix(a, b, fv) * sz * sz;
}

// 素子の中心から d ずれた点の光（強さ I）。光 = I × B × min(p, 穴)、B = 1 / Q
float lightOf(float I, vec2 d) {
  if (I <= 1e-4) return 0.0;
  float af = min(1.0, I / uKnee);
  float sf = uSoft * (1.0 - af);
  return I * min(shapeP(af, sf, d), holeMask(d)) / lookupQ(af, sf);
}

// 細かすぎるとき用：出力1画素の高さ（fwy）の中を縦に 6 点で測って平均する。素子の格子とのうなり（モアレ）を消す
vec3 rowAvg(vec2 p, float fwy) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 6; i++) sum += rowGauss(vec2(p.x, p.y + ((float(i) + 0.5) / 6.0 - 0.5) * fwy));
  return sum / 6.0;
}

void main() {
  vec2 op = (vec2(gl_FragCoord.x, uTileH - gl_FragCoord.y) + uOffset) * uPixScale;
  vec2 q = (op - uView.xy) / uView.z;       // 画像上の位置（元画素単位、行 k の中心は k + 0.5）
  // 出力1画素の元画素単位の大きさ。画像の外でも早く抜けず最後まで計算する
  // （早く抜けると、画像の縁で fwidth の相手の画素が欠けて値が狂う）
  vec2 fw = fwidth(q);
  float inside = (q.x >= 0.0 && q.y >= 0.0 && q.x < uSrcSize.x && q.y < uSrcSize.y) ? 1.0 : 0.0;

  // 素子1つが何画素か。3 画素より小さくなるにつれて、素子の平均の明るさへ混ぜる
  float dotPx = min(uCell.x / fw.x, uCell.y / fw.y);
  float t = 1.0 - smoothstep(${DOT_MIX.avgBelow.toFixed(2)}, ${DOT_MIX.detailAbove.toFixed(2)}, dotPx);

  vec3 dotCol = vec3(0.0);
  vec3 avgCol = vec3(0.0);

  if (t < 1.0) {
    if (uMask == 0) {
      // GRILLE：縦の帯 × 元画像の1行。上下に挟む2行の素子の光を足す
      float cw = uCell.x;
      float i = floor(q.x / cw);
      float cx = (i + 0.5) * cw;
      int col = int(mod(i, 3.0));
      int k0 = int(floor(q.y - 0.5));
      float L = 0.0;
      for (int r = 0; r < 2; r++) {
        int k = k0 + r;
        if (k < 0 || k >= int(uSrcSize.y)) continue;
        float I = pick(rowLin(k, cx), col);
        L += lightOf(I, vec2(q.x - cx, q.y - (float(k) + 0.5)));
      }
      dotCol = L * uPhos[col];
    } else {
      vec2 center; int col;
      maskCell(q, center, col);
      float I = pick(rowGauss(center), col);
      dotCol = lightOf(I, q - center) * uPhos[col];
    }
  }
  if (t > 0.0) {
    // 素子の形の代わりに、升目で平均した明るさ（満ちた形の面積の割合 × I）。3色が1/3ずつ並ぶ
    vec3 Iv = rowAvg(q, fw.y);
    avgCol = (uPhos[0] * Iv.r + uPhos[1] * Iv.g + uPhos[2] * Iv.b) * (uAvgFrac / 3.0);
  }
  vec3 c = mix(dotCol, avgCol, t) * inside * uExposure;   // 画像の外は黒

  if (uLinearOut > 0.5) { outColor = vec4(c, 1.0); return; }

  // 4. にじみ（BLOOM と HALO。作り終えたものを足す。画像の外にも漏れる）
  vec3 x = c;
  if (uBloomAmt > 0.0) x += uBloomAmt * texture(uBloom, (q + uBloomGeo.x) / uBloomGeo.yz).rgb;   // 元画素の位置 q で読む
  if (uHaloOn > 0.5) x += texture(uHalo, vec2(op.x * uHaloInv.x, 1.0 - op.y * uHaloInv.y)).rgb;
  x = max(x, 0.0);
  // 肩のある曲線：0.8 までは x、超えたら 1 へなめらかに近づく
  vec3 y = mix(x, 0.8 + 0.2 * (1.0 - exp(-(x - 0.8) / 0.2)), step(0.8, x));
  outColor = vec4(pow(y, vec3(1.0 / GAMMA)), 1.0);
}`;

// 層 0：元画像（sRGB のまま）を YIQ にして、Y と I・Q を横にガウスでぼかし、RGB に戻す（logic.js の compositeRow と同じ式）
//   σ・半径（画素）は JS の compositeSigma・compositeRadius で決めて渡す。重みは範囲全体の合計で割り、画像の外は 0
const SIGNAL_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec4 uBlur;   // Y の σ・半径、I と Q の σ・半径
out vec4 outColor;
vec3 yiq(ivec2 p) {
  vec3 c = texelFetch(uSrc, p, 0).rgb;
  return vec3(dot(c, vec3(0.299, 0.587, 0.114)), dot(c, vec3(0.596, -0.274, -0.322)), dot(c, vec3(0.211, -0.523, 0.312)));
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int W = textureSize(uSrc, 0).x;
  int ry = int(uBlur.y), rc = int(uBlur.w);
  float sy = uBlur.x, sc = uBlur.z;
  float Y = 0.0, wy = 0.0;
  for (int d = -ry; d <= ry; d++) {
    float w = exp(-float(d * d) / (2.0 * sy * sy));
    wy += w;
    int x = p.x + d;
    if (x >= 0 && x < W) Y += w * yiq(ivec2(x, p.y)).x;
  }
  vec2 IQ = vec2(0.0);
  float wc = 0.0;
  for (int d = -rc; d <= rc; d++) {
    float w = exp(-float(d * d) / (2.0 * sc * sc));
    wc += w;
    int x = p.x + d;
    if (x >= 0 && x < W) IQ += w * yiq(ivec2(x, p.y)).yz;
  }
  Y /= wy; IQ /= wc;
  vec3 rgb = vec3(Y + 0.956 * IQ.x + 0.621 * IQ.y, Y - 0.272 * IQ.x - 0.647 * IQ.y, Y - 1.106 * IQ.x + 1.703 * IQ.y);
  outColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}`;

const BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uStep;     // 1 タップ分の進み（テクスチャ座標）
uniform float uSigma;   // 1 タップ分の進みを 1 としたガウスの幅
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uTex, 0));
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int i = -6; i <= 6; i++) {
    float w = exp(-float(i * i) / (2.0 * uSigma * uSigma));
    vec2 p = uv + uStep * float(i);
    if (p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0) sum += texture(uTex, p).rgb * w;   // 範囲の外は黒
    wsum += w;
  }
  outColor = vec4(sum / wsum, 1.0);
}`;

// 半分の大きさに縮める（2x2 の平均）
const DOWN_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / (ceil(vec2(textureSize(uTex, 0)) * 0.5));
  outColor = vec4(texture(uTex, uv).rgb, 1.0);
}`;

// ぼかした4枚（HALO）に重みを掛けて足す（線形補間で拡大）
const SUM_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex0, uTex1, uTex2, uTex3;
uniform vec4 uW;        // HALO の4枚の重み（HALO を掛けた値）
uniform vec2 uOutSize;  // 足し合わせ先（レベル 0）の大きさ。4枚は段が違っても同じ uv で読む
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uOutSize;
  vec3 c = texture(uTex0, uv).rgb * uW.x + texture(uTex1, uv).rgb * uW.y
         + texture(uTex2, uv).rgb * uW.z + texture(uTex3, uv).rgb * uW.w;
  outColor = vec4(c, 1.0);
}`;

// BLOOM の元（式は logic.js の bloomSource）。出力は元画像の周りに余白 uM（元画素）を足した大きさ、余白は黒
const BLOOM_SRC_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc;   // 層 0 を通した元画像（sRGB）
uniform float uM;
uniform float uExposure;
out vec4 outColor;
const float GAMMA = ${GAMMA.toFixed(1)};
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) - ivec2(int(uM));
  ivec2 s = textureSize(uSrc, 0);
  if (p.x < 0 || p.y < 0 || p.x >= s.x || p.y >= s.y) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec3 c = pow(texelFetch(uSrc, p, 0).rgb, vec3(GAMMA)) * uExposure;
  float Y = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  outColor = vec4(c * pow(min(Y, 1.0), ${BLOOM.pow.toFixed(3)}), 1.0);
}`;

// BLOOM のぼかし（1 方向）。1 テクセル = 元画素 1 つ。±uR テクセルの重みを、範囲全体の合計で割る（範囲の外は黒）
const BLOOM_BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform ivec2 uDir;
uniform float uSigma;
uniform int uR;
uniform float uWeight;   // 結果に掛ける重み
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 s = textureSize(uTex, 0);
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int d = -uR; d <= uR; d++) {
    float w = exp(-float(d * d) / (2.0 * uSigma * uSigma));
    ivec2 q = p + uDir * d;
    if (q.x >= 0 && q.y >= 0 && q.x < s.x && q.y < s.y) sum += w * texelFetch(uTex, q, 0).rgb;
    wsum += w;
  }
  outColor = vec4(sum / wsum * uWeight, 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}
function program(gl, frag) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false });
    if (!gl) throw new Error('WebGL2 is not available.');
    this.gl = gl;
    this.canvas = canvas;
    this.crt = program(gl, CRT_FRAG);
    this.signal = program(gl, SIGNAL_FRAG);
    this.blur = program(gl, BLUR_FRAG);
    this.down = program(gl, DOWN_FRAG);
    this.sum = program(gl, SUM_FRAG);
    this.bloomSrc = program(gl, BLOOM_SRC_FRAG);
    this.bloomBlur = program(gl, BLOOM_BLUR_FRAG);
    this.bloomKey = {};    // 作り終えた BLOOM の条件（画面用 S）
    this.prepKey = ''; this.prep = null;
    this.pool = {};        // ハレーション・BLOOM 用の作業テクスチャ（画面用 S と書き出し用 E で分ける）
    this.vao = gl.createVertexArray();
    this.floatOk = !!gl.getExtension('EXT_color_buffer_float');
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.src = null; this.srcW = 0; this.srcH = 0;
    this.srcVer = 0; this.sigKey = '';   // 元画像の版（setImage のたびに増える）と、画面用の層 0 を作ったときの条件
  }

  setImage(rgba, w, h) {
    const gl = this.gl;
    this.srcVer++;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (this.src && this.srcW === w && this.srcH === h) {   // アニメーションの次のコマ：流し込むだけ
      gl.bindTexture(gl.TEXTURE_2D, this.src);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      return;
    }
    if (this.src) gl.deleteTexture(this.src);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.src = tex; this.srcW = w; this.srcH = h;
  }

  _target(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.floatOk) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb };
  }

  // 作業テクスチャ。同じ名前で大きさが同じなら使い回す
  _work(key, w, h) {
    const gl = this.gl;
    const cur = this.pool[key];
    if (cur && cur.w === w && cur.h === h) return cur;
    if (cur) { gl.deleteTexture(cur.tex); gl.deleteFramebuffer(cur.fb); }
    const t = this._target(w, h);
    t.w = w; t.h = h;
    this.pool[key] = t;
    return t;
  }

  _draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // MASK と、格子・網に効く値（PITCH・BEAM・GAP X・GAP Y）から、升目・穴・B の表を作る（同じ値のあいだは使い回す）
  _prepare(maskName, P) {
    const key = [maskName, P.pitch, P.beam, P.gapX, P.gapY, P.min].join('|');
    if (this.prepKey === key) return this.prep;
    const mask = MASKS[maskName];
    const g = maskGeometry(mask, P);
    const tab = buildTable(g, EDGE_SOFT, B_TABLE);
    const tabData = new Float32Array(Math.ceil(tab.R.length / 4) * 4);
    tabData.set(tab.R);
    this.prepKey = key;
    this.prep = { id: mask.id, g, tab, tabData };
    return this.prep;
  }

  // CRT 描画1回。fb = null で画面へ
  _crtPass(o) {
    const gl = this.gl, { p, u } = this.crt, P = o.params;
    gl.bindFramebuffer(gl.FRAMEBUFFER, o.fb);
    gl.viewport(0, 0, o.vw, o.vh);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, o.srcTex || this.src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, o.haloTex || o.srcTex || this.src);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, o.bloom ? o.bloom.tex : (o.srcTex || this.src));
    gl.uniform1i(u.uSrc, 0); gl.uniform1i(u.uHalo, 1); gl.uniform1i(u.uBloom, 2);
    gl.uniform3f(u.uBloomGeo, o.bloom ? o.bloom.m : 0, o.bloom ? o.bloom.w : 1, o.bloom ? o.bloom.h : 1);
    gl.uniform1f(u.uBloomAmt, o.bloom && P.bloom > 0 ? P.bloom : 0);
    gl.uniform2f(u.uSrcSize, o.srcW || this.srcW, o.srcH || this.srcH);
    gl.uniform3f(u.uView, o.view.ox, o.view.oy, o.view.zoom);
    gl.uniform2f(u.uOffset, o.offX || 0, o.offY || 0);
    gl.uniform1f(u.uTileH, o.vh);
    gl.uniform1f(u.uPixScale, o.pixScale);
    gl.uniform2f(u.uHaloInv, o.haloInv ? o.haloInv[0] : 0, o.haloInv ? o.haloInv[1] : 0);
    gl.uniform1f(u.uHaloOn, o.haloOn ? 1 : 0);
    gl.uniform1f(u.uLinearOut, o.linearOut ? 1 : 0);
    const pr = this._prepare(o.mask, P);
    gl.uniform1f(u.uBeam, P.beam); gl.uniform1f(u.uKnee, P.knee); gl.uniform1f(u.uSoft, P.soft);
    gl.uniform1f(u.uExposure, P.exposure);
    gl.uniform1i(u.uMask, pr.id);
    gl.uniform2f(u.uCell, pr.g.cw, pr.g.ch);
    gl.uniform4f(u.uHole, pr.g.hx, pr.g.hy, pr.g.holeHx, Number.isFinite(pr.g.holeHy) ? pr.g.holeHy : 1e9);
    gl.uniform1f(u.uN, pr.g.n);
    gl.uniform2f(u.uSize, pr.g.min, pr.g.nLow);
    gl.uniform1f(u.uAvgFrac, pr.tab.avgFrac);
    gl.uniform4fv(u.uTab, pr.tabData);
    gl.uniform3fv(u.uPhos, new Float32Array(PHOSPHORS.flat()));
    this._draw();
  }

  _blurPass(from, to, w, h, dx, dy, sigma) {
    const gl = this.gl, { p, u } = this.blur;
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb);
    gl.viewport(0, 0, w, h);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, from.tex);
    gl.uniform1i(u.uTex, 0);
    // 1 タップの進み = 幅 σ の半分（ただし 0.75 テクセル以上）。13 タップで ±3σ
    const step = Math.max(sigma / 2, 0.75);
    gl.uniform2f(u.uStep, dx * step / w, dy * step / h);
    gl.uniform1f(u.uSigma, sigma / step);
    this._draw();
  }

  _downPass(from, to) {
    const gl = this.gl, { p, u } = this.down;
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb);
    gl.viewport(0, 0, to.w, to.h);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, from.tex);
    gl.uniform1i(u.uTex, 0);
    this._draw();
  }

  // 出力全体（outW x outH）の HALO × halo を作る。
  //   CRT の描画（EXPOSURE まで、リニア）を 1/4 に縮めたもの（レベル 0）から作る。
  //   σ（元画素 HALO.sigmas × 拡大率）ごとにぼかした4枚を重み付きで足した1枚（レベル 0 の大きさ）を返す
  _makeHalo(outW, outH, view, params, mask, ex, key) {
    const gl = this.gl;
    const pre = key === 'haloEx' ? 'E' : 'S';
    const w0 = Math.max(1, Math.ceil(outW / HALO.down)), h0 = Math.max(1, Math.ceil(outH / HALO.down));
    const base = this._work(pre + 'T0', w0, h0);
    this._crtPass({
      ...ex, fb: base.fb, vw: w0, vh: h0, view, params, mask,
      pixScale: HALO.down, haloOn: false, linearOut: true,
    });
    // HALO の4枚。4 つの σ ごとに、σ が収まる一番細かい段を共有のピラミッドから取る
    let res = [base, base, base, base];
    if (params.halo > 0) {
      const plan = HALO.sigmas.map((sg) => {
        const out = sg * view.zoom;
        let l = 0;
        while (out / (HALO.down * 2 ** l) > HALO.maxTexSigma && (w0 >> l) > 1 && (h0 >> l) > 1) l++;
        return { l, sigma: Math.max(HALO.minTexSigma, out / (HALO.down * 2 ** l)) };
      });
      const top = Math.max(...plan.map((q) => q.l));
      const lv = [base];
      for (let l = 1; l <= top; l++) {
        const pw = lv[l - 1].w, ph = lv[l - 1].h;
        const t = this._work(pre + 'T' + l, Math.max(1, Math.ceil(pw / 2)), Math.max(1, Math.ceil(ph / 2)));
        this._downPass(lv[l - 1], t);
        lv.push(t);
      }
      res = plan.map((q, g) => {
        const src = lv[q.l];
        const tmp = this._work(pre + 'B' + g, src.w, src.h);
        const out = this._work(pre + 'C' + g, src.w, src.h);
        this._blurPass(src, tmp, src.w, src.h, 1, 0, q.sigma);
        this._blurPass(tmp, out, src.w, src.h, 0, 1, q.sigma);
        return out;
      });
    }
    const dst = this._work(pre + 'H', w0, h0);
    const { p, u } = this.sum;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, w0, h0);
    gl.useProgram(p);
    res.forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.uniform1i(u['uTex' + i], i);
    });
    gl.uniform4f(u.uW, ...HALO.weights.map((w) => w * (params.halo > 0 ? params.halo : 0)));
    gl.uniform2f(u.uOutSize, w0, h0);
    this._draw();
    return { w: w0, h: h0, a: dst };
  }

  // BLOOM のテクスチャ。srcTex（層 0 を通した元画像、w x h）の周りに余白 m を足した大きさで、元画素 1 = 1 テクセル。
  //   元（bloomSource）→ 2枚のガウス（横・縦）→ 重みを掛けて足す。ver が渡されたら、同じ条件のあいだは作り直さない（画面用）
  _bloomTex(pre, srcTex, w, h, P, ver) {
    const gl = this.gl, k = bloomKernel(P.bsize), m = k.margin, W = w + 2 * m, H = h + 2 * m;
    const key = ver == null ? '' : [ver, w, h, P.signal, P.signal === 'COMPOSITE' ? P.yMHz + ',' + P.cMHz : '', P.exposure, P.bsize].join('|');
    const out = this._work(pre + 'V', W, H);
    const res = { tex: out.tex, m, w: W, h: H };
    if (key && this.bloomKey[pre] === key && out.built === key) return res;
    const S = this._work(pre + 'S', W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, S.fb);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.bloomSrc.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(this.bloomSrc.u.uSrc, 0);
    gl.uniform1f(this.bloomSrc.u.uM, m);
    gl.uniform1f(this.bloomSrc.u.uExposure, P.exposure);
    this._draw();
    const { p, u } = this.bloomBlur;
    gl.useProgram(p);
    gl.uniform1i(u.uTex, 0);
    const pass = (from, to, dir, g, weight) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb);
      gl.viewport(0, 0, W, H);
      gl.bindTexture(gl.TEXTURE_2D, from.tex);
      gl.uniform2i(u.uDir, dir[0], dir[1]);
      gl.uniform1f(u.uSigma, g.sigma);
      gl.uniform1i(u.uR, g.R);
      gl.uniform1f(u.uWeight, weight);
      this._draw();
    };
    k.gauss.forEach((g, i) => {
      const T = this._work(pre + 'H' + i, W, H);
      pass(S, T, [1, 0], g, 1);
      if (i === 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); }
      pass(T, out, [0, 1], g, k.weights[i]);
    });
    gl.disable(gl.BLEND);
    out.built = key;
    this.bloomKey[pre] = key;
    return res;
  }

  // 層 0：srcTex（w x h）を横にぼかしたテクスチャ。SIGNAL が RGB なら srcTex のまま返す
  _signalPass(key, srcTex, w, h, P) {
    if (P.signal !== 'COMPOSITE') return srcTex;
    const gl = this.gl, { p, u } = this.signal;
    const t = this._work(key, w, h);
    const sy = compositeSigma(w, P.yMHz), sc = compositeSigma(w, P.cMHz);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.viewport(0, 0, w, h);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(u.uSrc, 0);
    gl.uniform4f(u.uBlur, sy, compositeRadius(sy), sc, compositeRadius(sc));
    this._draw();
    return t.tex;
  }

  // 画面用の層 0。元画像（版）・SIGNAL・Y MHz・C MHz が変わったときだけ作り直す
  _screenSrc(P) {
    if (P.signal !== 'COMPOSITE') { this.sigKey = ''; return this.src; }
    const key = [this.srcVer, this.srcW, this.srcH, P.yMHz, P.cMHz].join('|');
    const t = this.pool.SIG;
    if (key === this.sigKey && t && t.w === this.srcW && t.h === this.srcH) return t.tex;
    const tex = this._signalPass('SIG', this.src, this.srcW, this.srcH, P);
    this.sigKey = key;
    return tex;
  }

  // 画面へ描く。view = { zoom, ox, oy } は canvas の画素単位
  draw(view, params, mask) {
    if (!this.src) return;
    const gl = this.gl, w = this.canvas.width, h = this.canvas.height;
    let H = null;
    if (params.halo > 0) H = this._makeHalo(w, h, view, params, mask);
    const srcTex = this._screenSrc(params);
    const bloom = params.bloom > 0 ? this._bloomTex('S', srcTex, this.srcW, this.srcH, params, this.srcVer) : null;
    this._crtPass({
      fb: null, vw: w, vh: h, view, params, mask, pixScale: 1, srcTex, bloom,
      haloOn: !!H, haloTex: H && H.a.tex,
      haloInv: H && [1 / (H.w * HALO.down), 1 / (H.h * HALO.down)],
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // 画像全体を outW x outH で描き、タイル（上から数行ずつ）ごとに onTile(y0, th, rgba) へ渡す。
  // rgba は上の行から並べ直した th 行分。画面の canvas・画面用のテクスチャには触らない
  // src を渡すと、その RGBA（srcW x srcH）を書き出し専用のテクスチャに入れて使う（再生中のコマを動かさない）
  // crop = { x, y, w, h }（処理する画像の画素座標）を渡すと、その枠の中だけを outW x outH で描く。
  //   同じ拡大率（outW / crop.w）で全体を描いたときの、その部分と同じ絵になるよう、枠の周りに余白
  //   （元画素 CROP_MARGIN_SIGMAS × HALO.sigmas と BLOOM の σ2 の大きい方。画像の外は削る）を足した範囲を描いてハレーションを作り、枠の部分だけを取り出す
  _renderTiles(outW, outH, params, mask, onTile, src, crop) {
    const gl = this.gl;
    let ex = {};
    let key = 'halo';
    let srcW = this.srcW;
    if (src) {
      if (!this.exTex) {
        this.exTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.exTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      gl.bindTexture(gl.TEXTURE_2D, this.exTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, src.w, src.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.rgba);
      ex = { srcTex: this._signalPass('SIGEx', this.exTex, src.w, src.h, params), srcW: src.w, srcH: src.h };
      key = 'haloEx';
      srcW = src.w;
    }
    const srcH = src ? src.h : this.srcH;
    if (!src && params.signal === 'COMPOSITE') ex = { srcTex: this._screenSrc(params) };   // 画面と同じ層 0
    let view = { zoom: outW / srcW, ox: 0, oy: 0 };
    let left = 0, top = 0, pw = outW, ph = outH;
    if (crop) {
      const zoom = outW / crop.w;
      const M = CROP_MARGIN_SIGMAS * Math.max(...HALO.sigmas, BLOOM.sigmas[1] * params.bsize);
      const capX = Math.max(0, Math.floor((this.maxTex - outW) / 2));
      const capY = Math.max(0, Math.floor((this.maxTex - outH) / 2));
      left = Math.min(capX, Math.round(Math.min(crop.x, M) * zoom));
      top = Math.min(capY, Math.round(Math.min(crop.y, M) * zoom));
      const right = Math.min(capX, Math.round(Math.max(0, Math.min(srcW - crop.x - crop.w, M)) * zoom));
      const bottom = Math.min(capY, Math.round(Math.max(0, Math.min(srcH - crop.y - crop.h, M)) * zoom));
      pw = left + outW + right; ph = top + outH + bottom;
      view = { zoom, ox: left - crop.x * zoom, oy: top - crop.y * zoom };
    }
    let H = null;
    if (params.halo > 0) H = this._makeHalo(pw, ph, view, params, mask, ex, key);
    // BLOOM は元画像の上で作る（切り抜きにも拡大率にも依らない）。全体を1回だけ
    const bloom = params.bloom > 0 ? this._bloomTex('E', ex.srcTex || this.src, srcW, srcH, params) : null;
    const tileH = Math.max(1, Math.min(outH, Math.floor(4000000 / pw)));
    const tile = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tile);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, pw, tileH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tile, 0);
    const buf = new Uint8Array(pw * tileH * 4);
    for (let y0 = 0; y0 < outH; y0 += tileH) {
      const th = Math.min(tileH, outH - y0);
      this._crtPass({
        ...ex, fb, vw: pw, vh: th, view, params, mask, pixScale: 1, offX: 0, offY: top + y0, bloom,
        haloOn: !!H, haloTex: H && H.a.tex,
        haloInv: H && [1 / (H.w * HALO.down), 1 / (H.h * HALO.down)],
      });
      gl.readPixels(0, 0, pw, th, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      // readPixels は下の行から。上下を入れ替えて渡す
      const rgba = new Uint8ClampedArray(outW * th * 4);
      for (let r = 0; r < th; r++) {
        const o = (th - 1 - r) * pw * 4 + left * 4;
        rgba.set(buf.subarray(o, o + outW * 4), r * outW * 4);
      }
      onTile(y0, th, rgba);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tile);
  }

  // 今表示している絵の PNG の Blob
  async exportPng(outW, outH, params, mask, crop) {
    const out = document.createElement('canvas');
    out.width = outW; out.height = outH;
    const ctx = out.getContext('2d');
    this._renderTiles(outW, outH, params, mask, (y0, th, rgba) => {
      ctx.putImageData(new ImageData(rgba, outW, th), 0, y0);
    }, undefined, crop);
    return new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'));
  }

  // 渡した1コマ（RGBA、srcW x srcH）を outW x outH で描いた RGBA（上の行から）
  exportRgba(src, outW, outH, params, mask, crop) {
    const out = new Uint8ClampedArray(outW * outH * 4);
    this._renderTiles(outW, outH, params, mask, (y0, th, rgba) => { out.set(rgba, y0 * outW * 4); }, src, crop);
    return out;
  }
}
