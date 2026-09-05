// ============================================================ レンダラ（WebGL2）
// scene.js の状態を読んで uniform を作り、シェーダを1回 draw するだけ。
// 色 LUT（2次元）の焼き込みと、書き出し用の高解像度再レンダリングもここが持つ。

import { N, buildEmission, absOf, blendAbs, normFor, integrate } from './spectrum.js';
import { hexToLinear, sceneH, levelsOf, frameRect } from './scene.js';
import { VS, FS, BAKE_FS, BLIT_FS } from './shader.js';

// LUT は (光路長 d, 混合率 t) の2次元。d は log10 で -2.5..2.5、t は 0..1
const LUT_D = 96, LUT_T = 32, LUT_DMIN = -2.5, LUT_DMAX = 2.5;
const FOV = 42 * Math.PI / 180;
// 隣接列を「継ぎ目のない1つの塊」にするための重なり幅と、それに切り替える gap のしきい値
const MERGE_OVERLAP = 0.03, MERGE_EPS = 0.03;

let gl, prog, tex, U = {};
let cv;
// 高さの焼き込み（列ごとの高さを小さなテクスチャに1回だけ描く）。
// レイマーチの中で高さフィールドを毎歩計算し直さないための下ごしらえ
let bakeProg, hTex, hFbo, BU = {}, mainVao, bakeVao;

// オフスクリーンの描き先と、それをキャンバスへ貼るためのもの。
// レイトレを画面に直接描かないのは、低解像度の下描きを残したまま
// 高解像度でタイルごとに描き直せるようにするため
let sceneFbo, sceneTex, texW = 0, texH = 0, blitNearest = null;
let blitProg, blitVao, LB = {};

// GPU の実測時間。drawArrays を投げるまでの時間は GPU の仕事量と無関係なので、
// 拡張が使えるときはタイマークエリで本当の時間を取る（表示と自動調整の両方で使う）
let timerExt = null, timerQ = null, timerPx = 0, gpuLast = 0, gpuPx = 0, gpuK = 0;

// タイルに割った描画はタイルごとにブラウザへ制御を返すので、その隙間に
// 別の描画が割り込むと、描き先のテクスチャを違うサイズに作り直されて
// 途中まで描いた絵が壊れる。書き出しの間はライブ描画をまるごと止める
// （画面の描き直しのほうは、割り込まれたら降りればいいので世代番号で捌く）
let busy = false, refineGen = 0;

// タイルの合間にブラウザへ制御を返すためのもの。
// setTimeout(0) を使わないのは、入れ子だと 4ms に丸められるうえ、**タブが裏に回ると
// 1秒まで延ばされる**ため（64タイルの書き出しが1分以上かかることになる）。
// requestAnimationFrame は裏に回ると止まってしまうのでもっと悪い。
// MessageChannel はどちらの制限も受けない
export const yieldToBrowser = () => new Promise(r => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { ch.port1.close(); r(); };
  ch.port2.postMessage(0);
});

const BAKE_UNIFORMS = ['uGridXY', 'uSceneH', 'uLevels', 'uHAxes', 'uHPat', 'uHInv', 'uHLo', 'uHHi'];
const TILE_LIVE = 256;   // 画面の描き直しを割るタイルの一辺
const TILE_OUT  = 512;   // 書き出しを割るタイルの一辺

const UNIFORMS = [
  'uRes', 'uCamPos', 'uCamRight', 'uCamUp', 'uCamFwd', 'uTanHalf',
  'uGridXY', 'uSceneH', 'uLevels', 'uHalfXY', 'uHalfZ', 'uCellH', 'uBevel',
  'uHAxes', 'uHPat', 'uHInv', 'uHLo', 'uHHi',
  'uDAxes', 'uDPat', 'uDInv', 'uDLo', 'uDHi',
  'uNAxes', 'uNPat', 'uNInv', 'uNLo', 'uNHi',
  'uMAxes', 'uMPat', 'uMInv', 'uMLo', 'uMHi',
  'uSpin', 'uLightDir', 'uLightInt', 'uAmbient', 'uExposure',
  'uBgMode', 'uBgDist', 'uCycloR', 'uVoid',
  'uLUT', 'uLutDMin', 'uLutDMax', 'uSegs', 'uHMap',
];

export function initGL(canvas){
  cv = canvas;
  gl = cv.getContext('webgl2',
    { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 unavailable');

  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error('shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const link = (fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error('link: ' + gl.getProgramInfoLog(p));
    return p;
  };
  prog = link(FS);
  bakeProg = link(BAKE_FS);
  blitProg = link(BLIT_FS);

  // 全画面三角形は両方のプログラムで使い回す。attribute の位置はプログラムごとに
  // 違いうるので、VAO を分けて持つ（プログラムを切り替えるたびに張り直さなくて済む）
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const mkVao = (p) => {
    const v = gl.createVertexArray();
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const loc = gl.getAttribLocation(p, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    return v;
  };
  mainVao = mkVao(prog);
  bakeVao = mkVao(bakeProg);
  blitVao = mkVao(blitProg);
  gl.bindVertexArray(mainVao);

  // 色 LUT はテクスチャ0番、高さマップは1番に固定で置く
  tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  hTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, hTex);
  // 列ごとの値をそのまま読むので補間しない（NEAREST）
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.activeTexture(gl.TEXTURE0);
  hFbo = gl.createFramebuffer();

  // レイトレの描き先。貼るときに拡大するので LINEAR（下描きを引き伸ばす用）
  sceneTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, sceneTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.activeTexture(gl.TEXTURE0);
  sceneFbo = gl.createFramebuffer();

  timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');

  gl.useProgram(blitProg);
  LB.uSrc = gl.getUniformLocation(blitProg, 'uSrc');
  LB.uDst = gl.getUniformLocation(blitProg, 'uDst');
  gl.uniform1i(LB.uSrc, 2);

  gl.useProgram(bakeProg);
  for (const n of BAKE_UNIFORMS) BU[n] = gl.getUniformLocation(bakeProg, n);

  gl.useProgram(prog);
  for (const n of UNIFORMS) U[n] = gl.getUniformLocation(prog, n);
  gl.uniform1i(U.uLUT, 0);
  gl.uniform1i(U.uHMap, 1);
  gl.uniform1f(U.uLutDMin, LUT_DMIN);
  gl.uniform1f(U.uLutDMax, LUT_DMAX);
}

// 高さの焼き直しが要るかを判定する鍵。**高さに効くものは全部ここに入れる。**
// 入れ忘れると「パラメータを変えたのに柱の形が変わらない」という、
// このツール群で繰り返し出ているリアルタイム反映漏れの不具合になる
function heightSig(s){
  const f = s.fields.height, a = f.axes;
  return [s.grid.x, s.grid.y, s.grid.z, s.grid.useZ, s.maxH,
          a.x, a.y, a.z, f.pat, f.inv, f.lo, f.hi].join(',');
}

// 列ごとの高さを grid.x x grid.y の小さなテクスチャに焼く。
// 1画素 = 1列なので 6x6 なら36画素、変わったときだけ焼き直すので実質ただ
let hSig = '';
function bakeHeights(s){
  const sig = heightSig(s);
  if (sig === hSig) return;
  hSig = sig;

  const gx = Math.max(1, s.grid.x | 0), gy = Math.max(1, s.grid.y | 0);
  // 呼ばれる時点の描き先を壊さない。**ここを null に戻すのは間違い。**
  // setUniforms 経由で呼ばれるので、そのときすでにオフスクリーンが束ねられている。
  // null に戻すと本体の描画がキャンバスへ流れ、そのあと貼り付けが前フレームの
  // テクスチャで上書きするので、「高さを変えたのに絵が変わらない」ように見える
  const fb0 = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  const vp = gl.getParameter(gl.VIEWPORT);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, hTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gx, gy, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, hFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hTex, 0);
  gl.viewport(0, 0, gx, gy);
  gl.bindVertexArray(bakeVao);
  gl.useProgram(bakeProg);

  const f = s.fields.height, a = f.axes;
  const on = (a.x ? 1 : 0) + (a.y ? 1 : 0) + (a.z ? 1 : 0);
  gl.uniform2f(BU.uGridXY, gx, gy);
  gl.uniform1f(BU.uSceneH, sceneH(s));
  gl.uniform1f(BU.uLevels, levelsOf(s));
  gl.uniform3f(BU.uHAxes, a.x ? 1 : 0, a.y ? 1 : 0, a.z ? 1 : 0);
  gl.uniform1i(BU.uHPat, f.pat | 0);
  gl.uniform1f(BU.uHInv, f.inv ? 1 : 0);
  gl.uniform1f(BU.uHLo, f.lo);
  gl.uniform1f(BU.uHHi, on === 0 ? f.lo : f.hi);   // 軸ゼロ = const（setUniforms と同じ扱い）
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  gl.bindFramebuffer(gl.FRAMEBUFFER, fb0);
  gl.bindVertexArray(mainVao);
  gl.useProgram(prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.viewport(vp[0], vp[1], vp[2], vp[3]);
}

// 色 LUT を焼く。光の SPD・順応（white balance）・露出まで込みで焼くので、
// シェーダは (d, t) を1回引くだけで済む。8bit に sqrt で入れて暗部を稼ぐ。
// 光もガラスも帯エディタの状態から組むので、山を動かせばここが焼き直される
export function rebake(scene){
  const S  = buildEmission(scene.light);
  const Aa = absOf(scene.glassA);
  const Ab = absOf(scene.glassB);

  const nrm0 = normFor(S, scene.light.wb);
  const probe = integrate(S, new Float64Array(N), 0, nrm0);      // d=0 の光そのもの
  const expo = 1 / Math.max(probe[0], probe[1], probe[2], 1e-9); // それがクリップする位置に露出
  const nrm = nrm0.map(v => v * expo);

  const data = new Uint8Array(LUT_D * LUT_T * 4);
  for (let ti = 0; ti < LUT_T; ti++){
    const t = LUT_T === 1 ? 0 : ti / (LUT_T - 1);
    const A = blendAbs(Aa, Ab, t);
    for (let di = 0; di < LUT_D; di++){
      const d = Math.pow(10, LUT_DMIN + di / (LUT_D - 1) * (LUT_DMAX - LUT_DMIN));
      const c = integrate(S, A, d, nrm);
      const o = (ti * LUT_D + di) * 4;
      for (let k = 0; k < 3; k++)
        data[o + k] = Math.round(Math.sqrt(Math.min(1, Math.max(0, c[k]))) * 255);
      data[o + 3] = 255;
    }
  }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, LUT_D, LUT_T, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
}

// az/el/dist から target まわりのカメラ基底を作る（透視投影・自由回転）
function camBasis(cam){
  const { az, el, dist, target } = cam;
  const ce = Math.cos(el), se = Math.sin(el);
  const pos = [
    target[0] + dist * ce * Math.cos(az),
    target[1] + dist * ce * Math.sin(az),
    target[2] + dist * se,
  ];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const nrm = v => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
  const fwd = nrm(sub(target, pos));
  const right = nrm(cross(fwd, [0, 0, 1]));
  const up = cross(right, fwd);
  return { pos, fwd, right, up };
}

// 中ボタン（ホイールクリック）ドラッグの平行移動。
// 注視点をカメラの right/up 平面上で動かす。1px の移動量をその距離での world 幅に
// 合わせてあるので、ズーム倍率を変えても「掴んで動かす」感触が変わらない
export function panCam(cam, dx, dy, viewH){
  const { right, up } = camBasis(cam);
  const wpp = 2 * Math.tan(FOV * 0.5) * cam.dist / Math.max(1, viewH);
  for (let i = 0; i < 3; i++)
    cam.target[i] += (-right[i] * dx + up[i] * dy) * wpp;
}

// 格子の実寸に合わせた既定のカメラ距離と注視点。
// 20x2x3 のような細長い格子でも画面に収まるように、格子の対角から出す
export function fitCam(scene){
  const h = sceneH(scene);
  const r = 0.5 * Math.hypot(scene.grid.x, scene.grid.y, h);
  return { dist: Math.max(4, r / Math.tan(FOV * 0.5) * 1.25), target: [0, 0, h * 0.42] };
}

// tanScale = 枠の高さ / ビューの高さ。
// uv が uRes.y で正規化されているので、縦の画角をこの比率で縮めるだけで
// 「枠の中に見えている範囲」と厳密に一致する（枠は中央固定なのでオフセット不要）
function setUniforms(scene, w, h, tanScale = 1){
  bakeHeights(scene);              // 高さに関わる設定が変わっていれば焼き直す
  const { pos, fwd, right, up } = camBasis(scene.cam);
  gl.uniform2f(U.uRes, w, h);
  gl.uniform3fv(U.uCamPos, pos);
  gl.uniform3fv(U.uCamRight, right);
  gl.uniform3fv(U.uCamUp, up);
  gl.uniform3fv(U.uCamFwd, fwd);
  gl.uniform1f(U.uTanHalf, Math.tan(FOV * 0.5) * tanScale);

  gl.uniform2f(U.uGridXY, scene.grid.x, scene.grid.y);
  gl.uniform1f(U.uSceneH, sceneH(scene));
  gl.uniform1f(U.uLevels, levelsOf(scene));
  // 融合させるときは列を実際に重ねる（SPEC §5.2）。ぴったり接するだけだと共有面で
  // mapGlass が 0 になり、traceInside がそこを出口と誤認して塊の内部に偽の界面が
  // できる（画素ノイズの原因）。重ねてしまえば内部は常に負のままになる。
  // z 方向のセルにも同じことが起きるので、同じ扱いをする
  const lv = levelsOf(scene);
  const cellH = lv > 0 ? sceneH(scene) / lv : 0;
  const halfXY = scene.gap < MERGE_EPS
    ? 0.5 + MERGE_OVERLAP : Math.max(0.02, 0.5 - scene.gap * 0.5);
  const halfZ = scene.gapZ < MERGE_EPS
    ? 0.5 * cellH + MERGE_OVERLAP : Math.max(0.02, 0.5 * (cellH - scene.gapZ));
  gl.uniform1f(U.uHalfXY, halfXY);
  gl.uniform1f(U.uHalfZ, halfZ);
  gl.uniform1f(U.uCellH, cellH);
  // 面取りが半径を超えると SDF が壊れるので、いちばん薄い方向に合わせて抑える
  const lim = 0.9 * Math.min(halfXY, lv > 0 ? halfZ : halfXY);
  gl.uniform1f(U.uBevel, Math.min(scene.bevel, lim));

  const f = scene.fields;
  const setField = (pfx, cfg) => {
    const a = cfg.axes;
    const on = (a.x ? 1 : 0) + (a.y ? 1 : 0) + (a.z ? 1 : 0);
    gl.uniform3f(U[pfx + 'Axes'], a.x ? 1 : 0, a.y ? 1 : 0, a.z ? 1 : 0);
    gl.uniform1i(U[pfx + 'Pat'], cfg.pat | 0);
    gl.uniform1f(U[pfx + 'Inv'], cfg.inv ? 1 : 0);
    gl.uniform1f(U[pfx + 'Lo'], cfg.lo);
    // 軸ゼロ = const。invert が効いて hi 側に飛ばないよう hi も lo に潰しておく
    gl.uniform1f(U[pfx + 'Hi'], on === 0 ? cfg.lo : cfg.hi);
  };
  setField('uH', f.height);
  setField('uD', f.density);
  setField('uN', f.ior);
  setField('uM', f.mix);

  const { az, el } = scene.light;
  const ce = Math.cos(el);
  gl.uniform3f(U.uLightDir, ce * Math.cos(az), ce * Math.sin(az), Math.sin(el));
  gl.uniform1f(U.uLightInt, scene.light.intensity);
  gl.uniform1f(U.uAmbient, scene.light.ambient);
  gl.uniform1f(U.uExposure, scene.exposure);

  gl.uniform1i(U.uBgMode, scene.bg.mode);
  gl.uniform1f(U.uBgDist, scene.bg.dist);
  gl.uniform1f(U.uCycloR, scene.bg.cycloR);
  gl.uniform3fv(U.uVoid, hexToLinear(scene.bg.color));

  gl.uniform1f(U.uSpin, scene.spin || 0);
  gl.uniform1i(U.uSegs, scene.segs);
}

// ライブ表示。ssOverride はドラッグ中に品質を落とすためのもの
// ---------------------------------------------------------------- 描き先まわり
// レイトレはオフスクリーンのテクスチャに描き、それをキャンバスへ貼る。
// (1) 低解像度の下描きを残したまま、高解像度でタイルごとに描き直せる
// (2) パスごとにキャンバスをリサイズしないので、描き直しのたびに黒く飛ばない
function ensureTarget(w, h){
  if (w === texW && h === texH) return;
  texW = w; texH = h;
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, sceneTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.activeTexture(gl.TEXTURE0);
}
// 1枚ぶんの描画の始まり。uRes は常に画像全体を指し、タイルはビューポートで切るだけ
// （gl_FragCoord はビューポートに依らず絶対座標なので、これで構図がずれない）
function beginScene(scene, w, h, tanScale){
  ensureTarget(w, h);
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
  gl.viewport(0, 0, w, h);
  setUniforms(scene, w, h, tanScale);
}
const endScene = () => gl.bindFramebuffer(gl.FRAMEBUFFER, null);

// タイルを1枚。measure は「1枚まるごと描くとき」だけ true にする。
// タイル単位で計ると、空の背景ばかりのタイルとガラスで埋まったタイルで値が何倍も振れ、
// 機種の速さの目安にならない（＝解像度の自動調整がばたつく）
function drawTile(x, y, w, h, measure){
  gl.viewport(x, y, w, h);
  if (measure && timerExt && !timerQ){
    timerQ = gl.createQuery();
    timerPx = w * h;
    gl.beginQuery(timerExt.TIME_ELAPSED_EXT, timerQ);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.endQuery(timerExt.TIME_ELAPSED_EXT);
  } else {
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
// 計測結果は数フレーム遅れて届く。待たずに、取れていたときだけ拾う
function pollTimer(){
  if (!timerQ) return;
  if (gl.getParameter(timerExt.GPU_DISJOINT_EXT)){ gl.deleteQuery(timerQ); timerQ = null; return; }
  if (!gl.getQueryParameter(timerQ, gl.QUERY_RESULT_AVAILABLE)) return;
  gpuLast = gl.getQueryParameter(timerQ, gl.QUERY_RESULT) / 1e6;
  gpuPx = timerPx;
  gl.deleteQuery(timerQ); timerQ = null;
  // 小さすぎる描画は固定費の割合が大きく、機種の速さの目安にならない
  // （畳まれたペインで数百画素だけ描いたときに、実際の 20倍の重さだと誤判定した）。
  // 1枚ごとの揺れも均したいので、指数移動平均で持つ
  if (gpuPx >= 40000){
    const k = gpuLast / (gpuPx / 1e6);
    gpuK = gpuK ? gpuK * 0.7 + k * 0.3 : k;
  }
}
// 動画の収録も1フレームごとに制御を返すので、その間はライブ描画を止める。
// 止めないと、収録用に決めたキャンバスの大きさを描き直しに変えられてしまう
export const lockRender = () => { busy = true; };
export const unlockRender = () => { busy = false; };

// 直近に実測した GPU 時間（ms）。拡張が無い環境では 0
export const gpuMs = () => gpuLast;
export const hasGpuTimer = () => !!timerExt;
// 100万画素あたりの GPU 時間。**これがこの機種の速さそのもの**で、
// 解像度を変えたときの所要時間はここから予測できる。0 = まだ測れていない
export const gpuMsPerMpx = () => gpuK;

// オフスクリーンをキャンバスへ貼る。rect を渡すとその矩形だけ貼り直す
function blit(dstW, dstH, rect){
  // 等倍のときは補間しない。理屈のうえでは LINEAR でもテクセル中心に当たるが、
  // 端で丸めが転ぶことがあり、そのぶん絵がわずかに甘くなる
  const same = (dstW === texW && dstH === texH);
  if (same !== blitNearest){
    blitNearest = same;
    const f = same ? gl.NEAREST : gl.LINEAR;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.activeTexture(gl.TEXTURE0);
  }
  gl.bindVertexArray(blitVao);
  gl.useProgram(blitProg);
  gl.uniform2f(LB.uDst, dstW, dstH);
  gl.viewport(rect ? rect[0] : 0, rect ? rect[1] : 0,
              rect ? rect[2] : dstW, rect ? rect[3] : dstH);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(mainVao);
  gl.useProgram(prog);
}

// キャンバスの画素数は scene.ss で決まる（＝これまでと同じ）。
// パスごとの解像度は変えても、ここは変えない
function fitCanvas(scene){
  const r = cv.getBoundingClientRect();
  const w = Math.max(2, Math.round(r.width * scene.ss));
  const h = Math.max(2, Math.round(r.height * scene.ss));
  if (cv.width !== w || cv.height !== h){ cv.width = w; cv.height = h; }
  return { w, h, css: r };
}

// ---------------------------------------------------------------- ライブ表示
// ssOverride は操作中に解像度を落とすためのもの。落とした絵は貼るときに引き伸ばす
export function draw(scene, ssOverride){
  if (busy) return;
  pollTimer();
  const out = fitCanvas(scene);
  const ss = ssOverride ?? scene.ss;
  const w = Math.max(2, Math.round(out.css.width * ss));
  const h = Math.max(2, Math.round(out.css.height * ss));
  beginScene(scene, w, h, 1);
  drawTile(0, 0, w, h, true);
  endScene();
  blit(out.w, out.h);
}

// 手が止まったあとの描き直し。1回のドローを短く保つためタイルに割り、
// 1タイルごとにブラウザへ制御を返す。**下描きは消さずに、描けたところから精細になる**。
// 非力な GPU で「離した瞬間に固まる」のを避けるのが目的。
// stop() が true を返したら途中でやめる（また操作が始まったとき）
export async function drawRefine(scene, stop){
  if (busy) return false;
  // 新しい描き直しが始まったら、古いほうは次のタイルの手前で降りる
  const gen = ++refineGen;
  const alive = () => gen === refineGen && !busy && !stop?.();
  const out = fitCanvas(scene);
  const w = out.w, h = out.h;            // 描き直しは表示と同じ解像度
  beginScene(scene, w, h, 1);
  const px = new Uint8Array(4);
  for (let y = 0; y < h; y += TILE_LIVE){
    for (let x = 0; x < w; x += TILE_LIVE){
      if (!alive()){ endScene(); return false; }
      const tw = Math.min(TILE_LIVE, w - x), th = Math.min(TILE_LIVE, h - y);
      drawTile(x, y, tw, th);
      endScene();
      blit(w, h, [x, y, tw, th]);
      // 1px 読んでこのタイルの完了を待つ。待たないとタイルに割った意味が無くなり、
      // まとめて投げたぶんが結局ひと続きの長い処理になる
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      pollTimer();
      await yieldToBrowser();
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
    }
  }
  endScene();
  blit(w, h);                            // タイルの境目を最後にならす
  return true;
}

// 枠の高さ / ビューの高さ。書き出しの縦画角の倍率になる
export function tanScaleFor(aspect){
  const r = cv.getBoundingClientRect();
  return frameRect(r.width, r.height, aspect).h / Math.max(1, r.height);
}

// 書き出し用の1枚をキャンバスに出す（動画が毎フレームこれを呼ぶ）。
// 編集用キャンバスを拡大するのではなく、同じシーン状態を指定解像度で描き直す（SPEC §7）
export function drawExport(scene, w, h, tanScale){
  if (cv.width !== w || cv.height !== h){ cv.width = w; cv.height = h; }
  beginScene(scene, w, h, tanScale);
  drawTile(0, 0, w, h, true);
  endScene();
  blit(w, h);
  // 1px 読んで GPU の完了を待つ。待たずに次へ進むと、動画側で
  // requestFrame() が前のフレームを拾ってしまうことがある
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
}

// 静止画の書き出し。**1回のドローで 4096x4096 を描かない。**
// 非力な GPU だと1枚が数秒かかり、Windows の TDR（既定2秒）でドライバがリセットされて
// WebGL のコンテキストごと飛ぶ。タイルに割れば1回のドローは短いままで、進捗も出せる。
// 出来上がりは 2D キャンバスに組み立てて返す（表示用キャンバスは触らない）
export async function renderStill(scene, side, tanScale, onProgress, stop){
  if (busy) return null;
  busy = true;                           // 書き出しの間はライブ描画を止める
  try {
  const out = document.createElement('canvas');
  out.width = side; out.height = side;
  const ctx = out.getContext('2d');

  beginScene(scene, side, side, tanScale);
  const cols = Math.ceil(side / TILE_OUT), rows = Math.ceil(side / TILE_OUT);
  let done = 0;
  for (let y = 0; y < side; y += TILE_OUT){
    for (let x = 0; x < side; x += TILE_OUT){
      if (stop?.()){ endScene(); return null; }
      const tw = Math.min(TILE_OUT, side - x), th = Math.min(TILE_OUT, side - y);
      drawTile(x, y, tw, th);
      const px = new Uint8Array(tw * th * 4);
      gl.readPixels(x, y, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, px);
      // WebGL は左下が原点、2D キャンバスは左上が原点なので行を反転して置く
      const row = tw * 4, tmp = new Uint8Array(row);
      for (let i = 0; i < (th >> 1); i++){
        const a = i * row, b = (th - 1 - i) * row;
        tmp.set(px.subarray(a, a + row));
        px.copyWithin(a, b, b + row);
        px.set(tmp, b);
      }
      ctx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer), tw, th), x, side - y - th);
      onProgress?.(++done, cols * rows);
      pollTimer();
      await yieldToBrowser();
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
    }
  }
  endScene();
  return out;
  } finally { busy = false; }
}

// キャンバスのバッキングストアを元に戻す（動画の書き出し後）
export function restoreCanvas(){
  const r = cv.getBoundingClientRect();
  cv.width = Math.max(2, Math.round(r.width));
  cv.height = Math.max(2, Math.round(r.height));
  gl.viewport(0, 0, cv.width, cv.height);
}

export const glCanvas = () => cv;
