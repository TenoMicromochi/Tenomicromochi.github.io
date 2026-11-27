// WebGL2 の CRT 描画。
//   1. 元画像の値をリニアにする
//   2. ビーム（走査線）
//   3. マスク（蛍光体の格子）
//   4. 点の光り方（穴の形 × 飽和(強さ × ガウス)）
//   5. 細かすぎるときは点の平均の明るさへ混ぜる（fwidth）
//   6. ハレーション（幅の違うガウス4枚を縮小ピラミッドで作って重ね、HALO の割合で足す。画像の外にも漏れる）
//   7. ガンマ 2.2 で戻して表示
import { MASKS, PHOSPHORS, GAMMA, EDGE_SOFT, DOT_MIX, ROW_MIX, AVG_GAUSS, HALO, CROP_MARGIN_SIGMAS } from './config.js';
import { holeAreaFraction } from './logic.js';

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
uniform float uPixScale;   // 描画先の1画素が出力の何画素か（ハレーション用の縮小描画で 4）
uniform sampler2D uHalo;
uniform vec2 uHaloInv;     // 出力位置 → ハレーションのテクスチャ座標
uniform float uHaloAmt;
uniform float uLinearOut;  // 1 のときガンマを掛けずリニアのまま出す（ハレーションの元）

uniform float uPitch, uGain, uSpot, uBeam;
uniform int uMask;
uniform vec4 uShape;       // n, a, b, aspect
uniform float uArea;       // 穴の面積 / 升目の面積
uniform float uK;          // 明るさ補正（MASK ごと）
uniform vec3 uPhos[3];

const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
const float GAMMA = ${GAMMA.toFixed(1)};
const float EDGE_SOFT = ${EDGE_SOFT.toFixed(3)};
const float AVG_GAUSS = ${AVG_GAUSS.toFixed(3)};

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

// ---- 2. ビーム ----
// 走査線は元画像の1行につき1本。縦はガウス形で幅 σ = BEAM × (0.35 + 0.65 × 明るさ)。
// 上下の2行の寄与を足す。tb は 1 に近いほど、細かすぎる走査線を平均の明るさに混ぜる
vec3 beamAt(vec2 p, float tb) {
  int h = int(uSrcSize.y);
  float ty = p.y - 0.5;
  float k0f = floor(ty);
  float fr = ty - k0f;
  int k0 = int(k0f);
  float v0 = (k0 >= 0 && k0 < h) ? 1.0 : 0.0;
  float v1 = (k0 + 1 >= 0 && k0 + 1 < h) ? 1.0 : 0.0;
  vec3 b0 = rowLin(k0, p.x) * v0;
  vec3 b1 = rowLin(k0 + 1, p.x) * v1;
  float s0 = max(uBeam * (0.35 + 0.65 * dot(b0, LUM)), 1e-3);
  float s1 = max(uBeam * (0.35 + 0.65 * dot(b1, LUM)), 1e-3);
  float d0 = fr, d1 = 1.0 - fr;
  vec3 scan = b0 * exp(-d0 * d0 / (2.0 * s0 * s0)) + b1 * exp(-d1 * d1 / (2.0 * s1 * s1));
  if (tb <= 0.0) return scan;
  // 走査線が1画素に入りきらないとき：行の間を線形に混ぜ、走査線の平均の明るさ（σ√(2π)、最大 1）を掛ける
  vec3 c0 = v0 > 0.0 ? b0 : b1;
  vec3 c1 = v1 > 0.0 ? b1 : b0;
  vec3 lin = mix(c0, c1, fr) * min(1.0, 2.5066 * mix(s0, s1, fr));
  return mix(scan, lin, tb);
}

// 細かすぎるとき用：出力1画素の高さ（fwy）の中を縦に 6 点で測って平均する。走査線とのうなり（モアレ）を消す
vec3 beamAvg(vec2 p, float tb, float fwy) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    sum += beamAt(vec2(p.x, p.y + ((float(i) + 0.5) / 6.0 - 0.5) * fwy), tb);
  }
  return sum / 6.0;
}

// ---- 3. マスク ----
// 画面の位置 q（元画素単位）から、一番近い点の中心 center・色 col・中心からのずれ d を出す。
// d は升目の大きさを 1 とした値（GRILLE は縦のずれ 0）
void maskCell(vec2 q, out vec2 center, out int col, out vec2 d) {
  float cw = uPitch / 3.0;
  if (uMask == 3) {
    // DELTA：六角（最密充填）。行の間隔 cw × 0.866、奇数行は半分ずらす
    float rh = cw * 0.8660254;
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
    d = (q - center) / cw;
    return;
  }
  float i = floor(q.x / cw);
  float cx = (i + 0.5) * cw;
  col = int(mod(i, 3.0));
  if (uMask == 0) {
    // GRILLE：縦の帯。縦方向は切らない
    center = vec2(cx, q.y);
    d = vec2((q.x - cx) / cw, 0.0);
    return;
  }
  // SLOT / SQUARE：長方形。SLOT は3列1組ごとに縦へ半分ずらす
  float ch = cw * uShape.w;
  float off = (uMask == 1) ? 0.5 * ch * mod(floor(i / 3.0), 2.0) : 0.0;
  float j = floor((q.y - off) / ch);
  float cy = (j + 0.5) * ch + off;
  center = vec2(cx, cy);
  d = vec2((q.x - cx) / cw, (q.y - cy) / ch);
}

// 飽和：1 - exp(-GAIN × E)。GAIN を変えても最大の明るさが変わらないよう 1 - exp(-GAIN) で割る
float sat(float e) {
  return (1.0 - exp(-uGain * e)) / (1.0 - exp(-uGain));
}

void main() {
  vec2 op = (vec2(gl_FragCoord.x, uTileH - gl_FragCoord.y) + uOffset) * uPixScale;
  vec2 q = (op - uView.xy) / uView.z;       // 画像上の位置（元画素単位、行 k の中心は k + 0.5）
  // 出力1画素の元画素単位の大きさ。画像の外でも早く抜けず最後まで計算する
  // （早く抜けると、画像の縁で fwidth の相手の画素が欠けて値が狂う）
  vec2 fw = fwidth(q);
  float inside = (q.x >= 0.0 && q.y >= 0.0 && q.x < uSrcSize.x && q.y < uSrcSize.y) ? 1.0 : 0.0;

  float cw = uPitch / 3.0;
  float ch = (uMask == 3) ? cw * 0.8660254 : cw * uShape.w;
  // 5. 点1つが何画素か。3 画素より小さくなるにつれて、点の平均の明るさへ混ぜる
  float dotPx = min(cw / fw.x, ch / fw.y);
  float t = 1.0 - smoothstep(${DOT_MIX.avgBelow.toFixed(2)}, ${DOT_MIX.detailAbove.toFixed(2)}, dotPx);
  float tb = 1.0 - smoothstep(${ROW_MIX.avgBelow.toFixed(2)}, ${ROW_MIX.detailAbove.toFixed(2)}, 1.0 / fw.y);

  vec3 dotCol = vec3(0.0);
  vec3 avgCol = vec3(0.0);

  if (t < 1.0) {
    vec2 center; int col; vec2 d;
    maskCell(q, center, col, d);
    // 4. ビームの強さは点の中心の位置で読み、その色の成分を取る
    vec3 Iv = beamAt(center, tb);
    float Ic = col == 0 ? Iv.r : (col == 1 ? Iv.g : Iv.b);
    float s = uSpot * (0.6 + 0.4 * Ic);
    float E = Ic * exp(-dot(d, d) / (2.0 * s * s));
    float L = sat(E);
    // 超楕円の穴 |dx/a|^n + |dy/b|^n（縁を少しぼかす）。b = 0 は縦を切らない
    float n = uShape.x;
    float f = pow(abs(d.x) / uShape.y, n);
    if (uShape.z > 0.0) f += pow(abs(d.y) / uShape.z, n);
    float ap = 1.0 - smoothstep(1.0 - EDGE_SOFT, 1.0 + EDGE_SOFT, pow(f, 1.0 / n));
    dotCol = ap * L * uPhos[col] * uK;
  }
  if (t > 0.0) {
    // 点の形の代わりに、点の平均の明るさ（穴の面積の割合 × L）。3色が1/3ずつ並ぶ
    vec3 Iv = beamAvg(q, tb, fw.y);
    vec3 L = vec3(sat(Iv.r * AVG_GAUSS), sat(Iv.g * AVG_GAUSS), sat(Iv.b * AVG_GAUSS));
    avgCol = (uPhos[0] * L.r + uPhos[1] * L.g + uPhos[2] * L.b) * (uArea / 3.0) * uK;
  }
  vec3 c = mix(dotCol, avgCol, t) * inside;   // 7. 画像の外は黒

  // 6. ハレーション（にじみの元は画像の中だけ。足すときは画像の外にも漏れる）
  if (uHaloAmt > 0.0) c += texture(uHalo, vec2(op.x * uHaloInv.x, 1.0 - op.y * uHaloInv.y)).rgb * uHaloAmt;

  if (uLinearOut > 0.5) { outColor = vec4(c, 1.0); return; }
  outColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(1.0 / GAMMA)), 1.0);
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

// ぼかした4枚を重みを掛けて足す（線形補間で拡大）
const SUM_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex0, uTex1, uTex2, uTex3;
uniform vec4 uW;
uniform vec2 uOutSize;  // 足し合わせ先（レベル 0）の大きさ。4枚は段が違っても同じ uv で読む
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uOutSize;
  vec3 c = texture(uTex0, uv).rgb * uW.x + texture(uTex1, uv).rgb * uW.y
         + texture(uTex2, uv).rgb * uW.z + texture(uTex3, uv).rgb * uW.w;
  outColor = vec4(c, 1.0);
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
    this.blur = program(gl, BLUR_FRAG);
    this.down = program(gl, DOWN_FRAG);
    this.sum = program(gl, SUM_FRAG);
    this.pool = {};        // ハレーション用の作業テクスチャ（画面用 S と書き出し用 E で分ける）
    this.vao = gl.createVertexArray();
    this.floatOk = !!gl.getExtension('EXT_color_buffer_float');
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.src = null; this.srcW = 0; this.srcH = 0;
  }

  setImage(rgba, w, h) {
    const gl = this.gl;
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

  // CRT 描画1回。fb = null で画面へ
  _crtPass(o) {
    const gl = this.gl, { p, u } = this.crt, P = o.params, m = MASKS[o.mask];
    gl.bindFramebuffer(gl.FRAMEBUFFER, o.fb);
    gl.viewport(0, 0, o.vw, o.vh);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, o.srcTex || this.src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, o.haloTex || o.srcTex || this.src);
    gl.uniform1i(u.uSrc, 0); gl.uniform1i(u.uHalo, 1);
    gl.uniform2f(u.uSrcSize, o.srcW || this.srcW, o.srcH || this.srcH);
    gl.uniform3f(u.uView, o.view.ox, o.view.oy, o.view.zoom);
    gl.uniform2f(u.uOffset, o.offX || 0, o.offY || 0);
    gl.uniform1f(u.uTileH, o.vh);
    gl.uniform1f(u.uPixScale, o.pixScale);
    gl.uniform2f(u.uHaloInv, o.haloInv ? o.haloInv[0] : 0, o.haloInv ? o.haloInv[1] : 0);
    gl.uniform1f(u.uHaloAmt, o.haloAmt);
    gl.uniform1f(u.uLinearOut, o.linearOut ? 1 : 0);
    gl.uniform1f(u.uPitch, P.pitch); gl.uniform1f(u.uGain, P.gain);
    gl.uniform1f(u.uSpot, P.spot); gl.uniform1f(u.uBeam, P.beam);
    gl.uniform1i(u.uMask, m.id);
    gl.uniform4f(u.uShape, m.n, m.a, m.b, m.aspect);
    gl.uniform1f(u.uArea, holeAreaFraction(m));
    gl.uniform1f(u.uK, m.k);
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

  // 出力全体（outW x outH）のハレーションを作る。
  //   CRT の描画を 1/4 に縮めたもの（レベル 0）から、1/2 ずつ縮めた段を作り、
  //   σ（元画素 HALO.sigmas × 拡大率）ごとに、σ が HALO.maxTexSigma テクセル以内に収まる一番細かい段でぼかす。
  //   ぼかした4枚を重み付きで足して、レベル 0 の大きさの1枚にして返す
  _makeHalo(outW, outH, view, params, mask, ex, key) {
    const gl = this.gl;
    const pre = key === 'haloEx' ? 'E' : 'S';
    const w0 = Math.max(1, Math.ceil(outW / HALO.down)), h0 = Math.max(1, Math.ceil(outH / HALO.down));
    const base = this._work(pre + 'T0', w0, h0);
    this._crtPass({
      ...ex, fb: base.fb, vw: w0, vh: h0, view, params, mask,
      pixScale: HALO.down, haloAmt: 0, linearOut: true,
    });
    // 4 つの σ ごとの段とテクセル単位の σ
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
    const res = plan.map((q, g) => {
      const src = lv[q.l];
      const tmp = this._work(pre + 'B' + g, src.w, src.h);
      const out = this._work(pre + 'C' + g, src.w, src.h);
      this._blurPass(src, tmp, src.w, src.h, 1, 0, q.sigma);
      this._blurPass(tmp, out, src.w, src.h, 0, 1, q.sigma);
      return out;
    });
    const dst = this._work(pre + 'H', w0, h0);
    const { p, u } = this.sum;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, w0, h0);
    gl.useProgram(p);
    res.forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.uniform1i(u['uTex' + i], i);
    });
    gl.uniform4f(u.uW, ...HALO.weights);
    gl.uniform2f(u.uOutSize, w0, h0);
    this._draw();
    return { w: w0, h: h0, a: dst };
  }

  // 画面へ描く。view = { zoom, ox, oy } は canvas の画素単位
  draw(view, params, mask) {
    if (!this.src) return;
    const gl = this.gl, w = this.canvas.width, h = this.canvas.height;
    let H = null;
    if (params.halo > 0) H = this._makeHalo(w, h, view, params, mask);
    this._crtPass({
      fb: null, vw: w, vh: h, view, params, mask, pixScale: 1,
      haloAmt: params.halo, haloTex: H && H.a.tex,
      haloInv: H && [1 / (H.w * HALO.down), 1 / (H.h * HALO.down)],
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // 画像全体を outW x outH で描き、タイル（上から数行ずつ）ごとに onTile(y0, th, rgba) へ渡す。
  // rgba は上の行から並べ直した th 行分。画面の canvas・画面用のテクスチャには触らない
  // src を渡すと、その RGBA（srcW x srcH）を書き出し専用のテクスチャに入れて使う（再生中のコマを動かさない）
  // crop = { x, y, w, h }（処理する画像の画素座標）を渡すと、その枠の中だけを outW x outH で描く。
  //   同じ拡大率（outW / crop.w）で全体を描いたときの、その部分と同じ絵になるよう、枠の周りに余白
  //   （元画素 CROP_MARGIN_SIGMAS × HALO.sigmas の最大。画像の外は削る）を足した範囲を描いてハレーションを作り、枠の部分だけを取り出す
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
      ex = { srcTex: this.exTex, srcW: src.w, srcH: src.h };
      key = 'haloEx';
      srcW = src.w;
    }
    const srcH = src ? src.h : this.srcH;
    let view = { zoom: outW / srcW, ox: 0, oy: 0 };
    let left = 0, top = 0, pw = outW, ph = outH;
    if (crop) {
      const zoom = outW / crop.w;
      const M = CROP_MARGIN_SIGMAS * Math.max(...HALO.sigmas);
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
        ...ex, fb, vw: pw, vh: th, view, params, mask, pixScale: 1, offX: 0, offY: top + y0,
        haloAmt: params.halo, haloTex: H && H.a.tex,
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
