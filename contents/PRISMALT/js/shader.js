// ============================================================ WebGL2 シェーダ
// ハイトマップに並んだガラスの塊を1枚のフラグメントシェーダで自前レイトレする。
//
//   * グリッドは「比較の一覧」ではなく「壁紙の構図そのもの」。列ごとに高さフィールドで
//     占有を決め、隣接列は overlap で継ぎ目なく融合する（SPEC §5）
//   * density / IOR / mix は空間の連続フィールド。ピース単位ではなく、その場その場で引く
//   * 光は向きを持ち、背景面に色つきの影（ステンドグラス）を落とす（SPEC §8）
//   * 色は (光路長 d, 混合率 t) の 2次元 LUT を引くだけ（SPEC §4.3）
//
// カメラは透視投影で自由回転（SPEC §2 で正射影＋固定角の不変条件は引き継がない）。

export const VS = `#version 300 es
in vec2 p;
void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

// ---------- field（軸 → 1つの値）— レンダ用と高さ焼き用の共通チャンク
// 軸ごとに 0..1 へ正規化してから、有効な軸だけで合成する。
// 先に軸ごとに正規化するので、3x4x7 のような非正方の格子でも dome が歪まない。
//
// 落とし穴: 無効な軸を min にそのまま混ぜると 0 が入って常に 0 になる。
// min のときだけ無効軸を 1.0 に差し替えて無害化している（max は 0 のままで無害）。
//
// **この1本を BAKE_FS と FS の両方に差し込んでいる。** height だけテクスチャに焼く形に
// したので、もし2か所に写して片方だけ直すと、柱の高さと density/ior/mix の勾配が
// 別々の式で出ることになる。式は必ずここ1か所に置く。
// 使う側で uGridXY と uSceneH を宣言しておくこと
const FIELD_GLSL = `
float fieldT(vec3 axes, int pat, vec3 q){
  float k = axes.x + axes.y + axes.z;
  if (k < 0.5) return 0.0;                              // 軸ゼロ = const

  vec3 t = clamp(vec3(q.x / uGridXY.x + 0.5,
                      q.y / uGridXY.y + 0.5,
                      q.z / uSceneH), 0.0, 1.0);

  bool ctr = pat >= 4;                                   // 基準: 中央から
  if (ctr) t = abs(2.0 * t - 1.0);                       // = 中心からの距離
  int cmb = ctr ? pat - 4 : pat;                         // 合成

  float T;
  if      (cmb == 0) T = dot(t * axes, vec3(1.0)) / k;                        // mean
  else if (cmb == 1) T = max(max(t.x * axes.x, t.y * axes.y), t.z * axes.z);  // max
  else if (cmb == 2){                                    // min（無効軸を 1.0 に）
    vec3 m = mix(vec3(1.0), t, axes);
    T = min(min(m.x, m.y), m.z);
  }
  else { vec3 s = t * axes; T = sqrt(dot(s, s)) / sqrt(k); }                  // dist

  // 中央基準はここで反転して「中心が高い山」にする。こうしないと中心からの距離が
  // そのまま出るので、pyramid も dome も名前と逆の「窪み」になる。
  // 反転を畳み込んでも invert は使えるままで、dome + invert が
  // 転換前の radial（中心が低いお椀）とちょうど一致する
  return ctr ? 1.0 - T : T;
}
// フィールドの値。軸ゼロのときは renderer 側が hi = lo を送るので lo に落ちる
float fieldVal(vec3 axes, int pat, float inv, float lo, float hi, vec3 q){
  float T = fieldT(axes, pat, q);
  T = inv > 0.5 ? 1.0 - T : T;
  return mix(lo, hi, T);
}
`;

// ---------- 高さを焼くシェーダ
// 1画素 = 1列。gl_FragCoord から列番号を取り、高さフィールドを1回だけ評価して
// 「world 高さに対する割合」を 24bit（RGB の3バイト）で書き出す。
// R32F を使わないのは EXT_color_buffer_float に頼らないため（公開先の端末を選ばない）。
// 24bit あれば float32 の仮数と同程度で、量子化による柱の高さのズレは実質消える
// （16bit で試したときは、シルエットの際で 0.3% の画素が1段ぶんずれた）。
// 段へのスナップもここで済ませるので、レンダ側は取り出して uSceneH を掛けるだけでよい
export const BAKE_FS = `#version 300 es
precision highp float;
out vec4 O;
uniform vec2  uGridXY;
uniform float uSceneH, uLevels;
uniform vec3  uHAxes; uniform int uHPat; uniform float uHInv, uHLo, uHHi;
` + FIELD_GLSL + `
void main(){
  vec2 ci = floor(gl_FragCoord.xy);                     // 列番号（i, j）
  vec3 c = vec3(ci + 0.5 - 0.5 * uGridXY, 0.0);         // 列の中心。height は z を使わない
  float r = clamp(fieldVal(uHAxes, uHPat, uHInv, uHLo, uHHi, c), 0.0, 1.0);
  if (uLevels > 0.5) r = floor(r * uLevels + 0.5) / uLevels;
  // r = 1.0 のとき 16777215.5 になるが、float32 は 24bit しか持たないのでこれが
  // 16777216 に丸め上がり、4バイト目へ溢れて上3バイトが 0 になる（＝いちばん高い柱が
  // 高さ0で焼かれる）。段にスナップすると r がちょうど 1.0 になるので普通に踏む。
  // 最後に uint 側で頭打ちにして塞ぐ
  uint v = min(uint(r * 16777215.0 + 0.5), 16777215u);
  O = vec4(float((v >> 16u) & 255u) / 255.0,
           float((v >>  8u) & 255u) / 255.0,
           float( v         & 255u) / 255.0, 1.0);
}`;

// ---------- 貼り付け用
// レイトレは画面に直接描かず、いったんオフスクリーンのテクスチャに描いてからこれで貼る。
// 低い解像度で描いた下描きを消さずに高解像度で描き直せるようになるのが狙い（renderer.js）。
// uDst は貼り先の画素数。gl_FragCoord は貼り先の絶対座標なので、
// ビューポートを一部だけにすればその範囲だけを貼り直せる
export const BLIT_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uDst;
out vec4 O;
void main(){ O = texture(uSrc, gl_FragCoord.xy / uDst); }`;

export const FS = `#version 300 es
precision highp float;
out vec4 O;

uniform vec2  uRes;
uniform vec3  uCamPos, uCamRight, uCamUp, uCamFwd;
uniform float uTanHalf;

uniform vec2  uGridXY;                   // 列の個数（x, y）。セルのピッチは 1.0
uniform float uSceneH, uLevels;          // world 高さ / 高さの段数（0 = 連続）
uniform float uHalfXY, uHalfZ, uCellH, uBevel;
uniform float uSpin;                     // ガラスだけを回す角度（プランB）

// 4つの field。axes は 0/1 のフラグ、pat は 基準*4 + 合成
uniform vec3  uHAxes; uniform int uHPat; uniform float uHInv, uHLo, uHHi;  // height（割合）
uniform vec3  uDAxes; uniform int uDPat; uniform float uDInv, uDLo, uDHi;  // density
uniform vec3  uNAxes; uniform int uNPat; uniform float uNInv, uNLo, uNHi;  // IOR
uniform vec3  uMAxes; uniform int uMPat; uniform float uMInv, uMLo, uMHi;  // mix

uniform vec3  uLightDir;                 // 光源へ向かう単位ベクトル
uniform float uLightInt, uAmbient, uExposure;

uniform int   uBgMode;                   // 0 off / 1 floor / 2 wall / 3 floor+wall / 4 cyclo
uniform float uBgDist, uCycloR;
uniform vec3  uVoid;                      // 背景色（リニア）。スペクトルでは扱わない

uniform sampler2D uLUT;
uniform float uLutDMin, uLutDMax;        // log10(d) の範囲
uniform int   uSegs;

// 列ごとの高さを焼いたテクスチャ（幅 = grid.x, 高さ = grid.y）。
// 中身は world 高さに対する割合を 24bit で入れた RGB の3バイト（BAKE_FS 参照）。
// 高さフィールドは列ごとの定数なので、レイマーチの中で毎回計算せずここから引く
uniform sampler2D uHMap;

// ---------- オブジェクトの回転（プランB）
// カメラ・背景・光は固定のまま、ガラスだけを世界のZ軸まわりに回す。
// カメラを周回させる案だと、一周のうち半分は背景面の裏へ回り込んで虚無が見えてしまう。
// ここで world -> glass の逆回転を掛け、背景（mapBg）には掛けない。
// mapGlass が world 座標を受けて内部で回すので、有限差分で取る法線は world のまま正しく出る
vec3 toGlass(vec3 p){
  float c = cos(uSpin), s = sin(uSpin);
  return vec3(c * p.x + s * p.y, -s * p.x + c * p.y, p.z);
}

` + FIELD_GLSL + `
// フィールドはガラスと一緒に回る（＝グラデーションが塊に貼り付いたまま回る。これが正しい）
float densityAt(vec3 p){ return fieldVal(uDAxes, uDPat, uDInv, uDLo, uDHi, toGlass(p)); }
float iorAt    (vec3 p){ return fieldVal(uNAxes, uNPat, uNInv, uNLo, uNHi, toGlass(p)); }
float mixAt    (vec3 p){ return clamp(fieldVal(uMAxes, uMPat, uMInv, uMLo, uMHi, toGlass(p)), 0.0, 1.0); }

// 列の高さ。height は z を使わない（列の高さは z に依らない）ので、列ごとの定数になる。
// **レイマーチの毎歩で計算し直さず、格子ぶんを焼いたテクスチャから引く**（renderer.bakeHeights）。
// 元は毎歩 3x3 列ぶん fieldVal を呼んでいて、1画素あたり500回以上の評価になっていた。
// 段へのスナップ（uLevels > 0）も焼く側で済ませてあるので、ここは1回の取得だけ
float heightAt(vec2 ci){
  vec3 e = texelFetch(uHMap, ivec2(ci), 0).rgb;         // 24bit を3バイトに分けてある
  return (e.r * 16711680.0 + e.g * 65280.0 + e.b * 255.0) / 16777215.0 * uSceneH;
}

// ---------- ガラスの占有（ハイトマップ）
// 列を面取りボックスとして持つ。隣接列は renderer 側の MERGE_OVERLAP ぶん実際に
// 重ねてあるので、共有面が塊の内部に埋もれる（＝ SPEC §5.2 の継ぎ目なしの融合）。
// uLevels > 0（use grid z）のときは、列を段ごとのセルに割って z にも隙間を空けられる。
// 全セルをループすると 3x3 近傍 x 段数 になってレイマーチが一気に重くなるので、
// **p.z が入っている段だけ**を見る。同じ列のセルは x/y の広がりが同じなので、
// いちばん近いセルは z だけで決まる → 1個評価すれば厳密に正しい
float sdColumn(vec3 p, vec2 cc, float h){
  vec3 he = vec3(uHalfXY, uHalfXY, h * 0.5);
  float zc = h * 0.5;
  if (uLevels > 0.5){
    float n = floor(h / uCellH + 0.5);
    float k = clamp(floor(p.z / uCellH), 0.0, max(n - 1.0, 0.0));
    zc = (k + 0.5) * uCellH;
    he = vec3(uHalfXY, uHalfXY, uHalfZ);
  }
  vec3 q = abs(vec3(p.xy - cc, p.z - zc)) - he + uBevel;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - uBevel;
}
// グリッド全体を包む箱（ガラス空間）。空の近傍での保険と、シャドウレイの足切りで共有する。
// 高さの上限は段へのスナップぶんも見込む（lo/hi が 1 未満でも、丸めで上の段に乗ることがある）
void gridBox(out vec3 c, out vec3 e){
  float r = clamp(max(uHLo, uHHi), 0.0, 1.0);
  if (uLevels > 0.5) r = floor(r * uLevels + 0.5) / uLevels;
  float hmax = max(uSceneH * r, 1e-3) + 0.06;         // 重なり・面取りぶんの余裕
  c = vec3(0.0, 0.0, hmax * 0.5);
  e = vec3(0.5 * uGridXY + uHalfXY, hmax * 0.5);
}
// 近傍3x3が空（グリッドの外・高さ0の列）のときに返す保険の距離。
// ここを 1e9 のままにすると、背景が無い（bg off）ときに歩幅を抑えるものが何も無くなり、
// 光線が最初の1歩でシーンごと飛び越してガラスが消える
float gridBound(vec3 p){
  vec3 c, e; gridBox(c, e);
  vec3 q = abs(p - c) - e;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}
float mapGlass(vec3 pw){
  vec3 p = toGlass(pw);                               // ここから先はガラス空間
  vec2 base = floor(p.xy + 0.5 * uGridXY);
  float d = 1e9;
  for (int oy = -1; oy <= 1; oy++){
    for (int ox = -1; ox <= 1; ox++){
      vec2 ci = base + vec2(float(ox), float(oy));
      if (ci.x < 0.0 || ci.y < 0.0 || ci.x > uGridXY.x - 0.5 || ci.y > uGridXY.y - 0.5) continue;
      // 高さに依らない下界で足切りする。列の箱の SDF は必ず水平方向の距離以上なので、
      // それが今のベストに届かない列は見るだけ無駄。近傍9列のうち実際に評価するのは
      // 2〜3列で済む（レイマーチの内側なので、ここが効く）
      vec2 cc = ci + 0.5 - 0.5 * uGridXY;
      vec2 dxy = abs(p.xy - cc) - vec2(uHalfXY);
      if (max(dxy.x, dxy.y) >= d) continue;
      float h = heightAt(ci);
      if (h < 0.02) continue;
      d = min(d, sdColumn(p, cc, h));
    }
  }
  return d > 1e8 ? max(gridBound(p), 0.01) : d;
}
vec3 nrmGlass(vec3 p){
  vec2 e = vec2(1.0, -1.0) * 0.0009;
  vec3 g = e.xyy * mapGlass(p + e.xyy) + e.yyx * mapGlass(p + e.yyx) +
           e.yxy * mapGlass(p + e.yxy) + e.xxx * mapGlass(p + e.xxx);
  float l = length(g);
  return l < 1e-7 ? vec3(0.0, 0.0, 1.0) : g / l;      // 勾配が消える点では上向きに逃がす
}

// ---------- 背景面（void color の面）。影もここに落ちる（地面は別に作らない：SPEC §8）
float mapBg(vec3 p){
  if (uBgMode == 0) return 1e9;
  float floorZ = -uBgDist;
  float wallY  = 0.5 * uGridXY.y + uBgDist;
  float df = p.z - floorZ;                            // 床: 法線 +z
  float dw = wallY - p.y;                             // 壁: 法線 -y
  if (uBgMode == 1) return df;
  if (uBgMode == 2) return dw;
  if (uBgMode == 3) return min(df, dw);
  // ホリゾント（撮影スタジオのホリゾント）: 角を半径 R のフィレットで丸める
  float R = uCycloR;
  vec2 rel = vec2(p.y, p.z) - vec2(wallY - R, floorZ + R);
  if (rel.x > 0.0 && rel.y < 0.0) return R - length(rel);
  return min(df, dw);
}
vec3 nrmBg(vec3 p){
  vec2 e = vec2(1.0, -1.0) * 0.0015;
  vec3 g = e.xyy * mapBg(p + e.xyy) + e.yyx * mapBg(p + e.yyx) +
           e.yxy * mapBg(p + e.yxy) + e.xxx * mapBg(p + e.xxx);
  float l = length(g);
  return l < 1e-7 ? vec3(0.0, 0.0, 1.0) : g / l;
}

// ---------- 色 LUT。(光路長 d, 混合率 t) の 2次元。光の色・順応・露出まで焼き込み済み
vec3 lut(float d, float t){
  float u = (log2(max(d, 1e-6)) * 0.30103 - uLutDMin) / (uLutDMax - uLutDMin);
  vec3 c = texture(uLUT, vec2(clamp(u, 0.0, 1.0), clamp(t, 0.0, 1.0))).rgb;
  return c * c;                                       // sqrt で格納しているので戻す
}

float f0Of(float ior){ float f = (1.0 - ior) / (1.0 + ior); return f * f; }
float fres(float f0, float c){ c = clamp(c, 0.0, 1.0); return f0 + (1.0 - f0) * pow(1.0 - c, 5.0); }

// ガラス∪背景を1本の光線で進める。what: 0 何もなし / 1 ガラス / 2 背景
float traceScene(vec3 ro, vec3 rd, out vec3 hp, out int what){
  float t = 2e-3;
  for (int i = 0; i < 240; i++){
    vec3 p = ro + rd * t;
    float dg = mapGlass(p);
    float db = mapBg(p);
    float d  = min(dg, db);
    if (d < 6e-4){ hp = p; what = dg <= db ? 1 : 2; return t; }
    t += max(d * 0.9, 1.5e-3);
    if (t > 260.0) break;
  }
  what = 0; return -1.0;
}
// ガラス内部。出口面まで進んだ距離を返す
float traceInside(vec3 ro, vec3 rd, out vec3 hp){
  float t = 6e-3;
  for (int i = 0; i < 200; i++){
    vec3 p = ro + rd * t;
    float d = -mapGlass(p);
    if (d < 7e-4){ hp = p; return t; }
    t += max(d * 0.92, 2.0e-3);
    if (t > 90.0) break;
  }
  return -1.0;
}
// 光源へ向かう直線のシャドウレイ。Beer-Lambert 用に (density x 長さ) と mix を積む。
// カメラへ向かう光線と同じ計算を、光源へ向かう光線にも使い回すだけ（SPEC §8）
void traceShadow(vec3 ro, vec3 rd, out float so, out float st, out float sw){
  so = 0.0; st = 0.0; sw = 0.0;
  // ガラスの箱に当たらない光線は、どうせ何も積まずに 96 歩を使い切るだけなので先に捨てる。
  // 背景面が広いほど（床・ホリゾント）この足切りに掛かる画素が増える
  {
    vec3 o = toGlass(ro), r = toGlass(rd);
    vec3 c, e; gridBox(c, e);
    vec3 rr = sign(r) * max(abs(r), vec3(1e-6));      // 0 割りだけ避ける
    vec3 m = 1.0 / rr, n0 = m * (c - o), k = abs(m) * e;
    vec3 ta = n0 - k, tb = n0 + k;
    float tN = max(max(ta.x, ta.y), ta.z), tF = min(min(tb.x, tb.y), tb.z);
    if (tN > tF || tF < 0.0) return;
  }
  float t = 4e-3;
  bool inside = false;
  float enter = 0.0;
  for (int i = 0; i < 96; i++){
    vec3 p = ro + rd * t;
    float d = mapGlass(p);
    if (!inside){
      if (d < 6e-4){ inside = true; enter = t; }
    } else if (d > 6e-4){
      float segL = t - enter;
      vec3 mid = ro + rd * ((enter + t) * 0.5);
      so += segL * densityAt(mid);
      st += segL * mixAt(mid); sw += segL;
      inside = false;
    }
    t += max(abs(d) * 0.9, 3.5e-3);
    if (t > 50.0 || so > 12.0) break;                 // 完全に陰ならそれ以上積んでも無駄
  }
  if (inside){
    float segL = t - enter;
    vec3 mid = ro + rd * ((enter + t) * 0.5);
    so += segL * densityAt(mid);
    st += segL * mixAt(mid); sw += segL;
  }
}

// 背景面のシェーディング: void色 x (環境光 + 直射 x ステンドグラスの色つき影)
vec3 shadeBg(vec3 p, vec3 n){
  float so, st, sw;
  traceShadow(p + n * 2e-3, uLightDir, so, st, sw);
  float sT = sw > 0.0 ? st / sw : 0.5;
  vec3 lc = max(lut(0.0, sT), vec3(1e-4));
  vec3 trans = so > 1e-4 ? lut(so, sT) / lc : vec3(1.0);   // 光の色は割って除き、ガラスの色だけ残す
  float ndl = max(dot(n, uLightDir), 0.0);
  vec3 direct = vec3(uLightInt * ndl) * trans;
  return uVoid * (vec3(uAmbient) + direct);
}

void main(){
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;
  vec3 ro = uCamPos;
  vec3 rd = normalize(uCamFwd + (uv.x * uCamRight + uv.y * uCamUp) * uTanHalf);

  vec3 col = vec3(0.0);
  vec3 through = vec3(1.0);                            // フレネル損失（無彩色）
  float optical = 0.0, tSum = 0.0, tW = 0.0;          // 視線が積んだ光学的厚みと経路平均の mix
  int seg = 0;

  for (int b = 0; b < 20; b++){
    vec3 hp; int what;
    if (traceScene(ro, rd, hp, what) < 0.0){          // 何にも当たらず → バックライト（常に光の色）
      col += through * lut(optical, tW > 0.0 ? tSum / tW : 0.5);
      break;
    }
    if (what == 2){                                   // 背景面
      vec3 bn = nrmBg(hp);
      if (dot(rd, bn) >= 0.0){                        // 面の裏から見ている → 虚無（バックライト）
        col += through * lut(optical, tW > 0.0 ? tSum / tW : 0.5);
        break;
      }
      float avgT = tW > 0.0 ? tSum / tW : 0.5;        // → 色つきの影 + void色
      vec3 camTint = optical > 1e-4
        ? lut(optical, avgT) / max(lut(0.0, avgT), vec3(1e-4)) : vec3(1.0);
      col += through * camTint * shadeBg(hp, bn);
      break;
    }
    if (seg >= uSegs){                                // 積算枚数の上限。以降は透過だけ
      col += through * lut(optical, tW > 0.0 ? tSum / tW : 0.5);
      break;
    }
    // --- ガラスに入る
    seg++;
    vec3 n = nrmGlass(hp);
    float ior = iorAt(hp);                            // 入った点で1回だけ引き、抜けるまで使い回す
    float f0  = f0Of(ior);
    float F   = fres(f0, max(dot(-rd, n), 0.0));
    vec3 rdir = reflect(rd, n);
    float envv  = mix(0.12, 1.0, clamp(rdir.z * 0.5 + 0.5, 0.0, 1.0));
    float glint = pow(max(dot(rdir, uLightDir), 0.0), 16.0);
    col += through * F * (envv * 0.45 + glint * 0.5) * lut(0.0, 0.5);
    through *= (1.0 - F);
    vec3 rr = refract(rd, n, 1.0 / ior);
    if (dot(rr, rr) < 0.5){ rd = rdir; ro = hp + rd * 0.02; continue; }   // 入射で全反射
    ro = hp + rr * 0.02; rd = rr;

    // 内部を追う。全反射している間は塊の中に留まり、そのぶん光路長が伸びる
    bool exited = false;
    for (int k = 0; k < 6; k++){   // 内部反射を追う回数。打ち切りが減るほど斑点も減る
      vec3 xp;
      float t2 = traceInside(ro, rd, xp);
      if (t2 < 0.0) break;                            // 出口が見つからない（→ 下の処理へ）
      vec3 mid = ro + rd * (t2 * 0.5);
      optical += t2 * densityAt(mid);                 // 長さではなく「長さ x その場の density」
      tSum += t2 * mixAt(mid); tW += t2;
      vec3 n2 = -nrmGlass(xp);
      vec3 ex = refract(rd, n2, ior);
      if (dot(ex, ex) > 0.5){                         // 出口へ
        through *= (1.0 - fres(f0, max(dot(-rd, n2), 0.0)));
        ro = xp + ex * 0.02; rd = ex; exited = true; break;
      }
      rd = reflect(rd, n2); ro = xp + rd * 0.006;     // 内部で全反射
    }
    // 閉じ込められたまま打ち切った光は 0 にする。ここで素通しの光を足すと、
    // 抜けられた隣の画素との差が「明るい白の斑点」になって塊の表面に乗る
    // （転換前 gl3d.js が踏んで tint=0 で直したのと同じ落とし穴）。
    // 吸収体の中に閉じ込められた光は最終的に消えるので 0 が正しい
    if (!exited) break;
  }

  col *= uExposure;
  col = clamp(col, 0.0, 1.0);
  col = mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));
  O = vec4(col, 1.0);
}`;
