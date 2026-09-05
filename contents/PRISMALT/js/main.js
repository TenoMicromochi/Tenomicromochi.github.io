'use strict';
// ============================================================================
// WALLPAPER EDITOR — sample（SPEC.md 準拠）
//
// 光がガラスを通って減衰する現象を、ガラスの配置全体で見せる壁紙生成ツール。
// 転換前（分光ラボ）の js/ とは別物として sample/ に置いている。
//
// 画面は ALT 系共通フォーマット（/theme.css + /alt.css）の3カラム:
//   左   … ガラスの形状・配置・光・背景・ビュー
//   中央 … レンダと書き出し範囲の枠
//   右   … 発光 / 吸収A / 吸収B のスペクトルと、PNG / WebM の書き出し
//
// このファイルは状態（scene）と DOM の配線だけを持つ。分光の焼き込みは renderer.rebake、
// 描画は renderer.draw、書き出しは export.js。シェーダ本体は shader.js。
// ============================================================================

import { scene, PATTERNS, ASPECTS, FPS, frameRect } from './scene.js';
import { LIGHT_PRESETS, LIGHT_KEYS, GLASS, GLASS_KEYS, clonePeaks } from './presets.js';
import { WHITE, N, absOf, buildEmission, normFor, integrate, planckNorm } from './spectrum.js';
import { LMIN, LSTEP } from './cmf.js';
import { hexOf, gamutMap } from './colorspace.js';
import { BandEditor } from './band-editor.js';
import { initGL, rebake, draw, drawRefine, fitCam, panCam,
         gpuMs, gpuMsPerMpx, hasGpuTimer } from './renderer.js';
import { exportPNG, cancelPNG, exportVideo, cancelVideo, videoSize } from './export.js';

const $ = id => document.getElementById(id);
const cv = $('gl');

initGL(cv);

// ------------------------------------------------------------------ トースト
let toastT = 0;
function toast(msg, kind = 'ok'){
  const el = $('toast');
  el.textContent = msg;
  el.className = 'alt-toast ' + kind;
  el.style.display = 'block';
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.style.display = 'none'; }, 2200);
}

// ------------------------------------------------------------------ 描画の段取り
// 2段構え。まず軽い解像度で即出し、手が止まったらタイルに割って本来の解像度で描き直す。
//
// 落とす倍率を固定値（前は 0.6 決め打ち）にしないのは、公開先の GPU が分からないため。
// 実測した「100万画素あたりの GPU 時間」から必要な倍率を逆算するので、
// 速い機種では粗くならず、遅い機種では重くならない。
// 一気に描いても速いと分かっている場合は、下描きを挟まずそのまま本描画する
const TARGET_MS = 22;    // 操作中の1フレームで狙う時間
const SNAP_MS   = 40;    // 本描画がこれ以下で終わる見込みなら、下描きを挟まない

let pending = false, dragging = false, lastMs = 0, liveSS = 0;
let refineT = 0, refineGen = 0;

const cssPixels = () => { const r = cv.getBoundingClientRect(); return r.width * r.height; };
// 操作中に使う解像度倍率。実測が無い間は従来どおりの 0.6
function liveScale(){
  const k = gpuMsPerMpx();
  if (!k) return Math.min(scene.ss, 0.6);
  const s = Math.sqrt(TARGET_MS / (k * cssPixels() / 1e6));
  return Math.max(0.22, Math.min(scene.ss, s));
}
// 本描画にかかる見込み時間（ms）
const fullMs = () => gpuMsPerMpx() * cssPixels() * scene.ss * scene.ss / 1e6;

// 手が止まってから本描画。操作が再開したら途中でやめる
function scheduleRefine(){
  clearTimeout(refineT);
  refineT = setTimeout(async () => {
    const gen = ++refineGen;
    const done = await drawRefine(scene, () => dragging || gen !== refineGen);
    if (done) liveSS = scene.ss;       // 画面に出ているのは本来の解像度になった
    updateInfo();
  }, 140);
}

function requestDraw(){
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    refineGen++;                                   // 走っている描き直しは捨てる
    clearTimeout(refineT);
    const heavy = dragging || (gpuMsPerMpx() && fullMs() > SNAP_MS);
    liveSS = heavy ? liveScale() : scene.ss;
    const t0 = performance.now();
    draw(scene, liveSS);
    lastMs = performance.now() - t0;
    updateInfo();
    layoutFrame();
    if (heavy) scheduleRefine();
  });
}
// スペクトルを触ったときは LUT を焼き直してから描く
function fullRebuild(){ rebake(scene); requestDraw(); }

function updateInfo(){
  const c = scene.cam, l = scene.light, g = scene.grid;
  $('chipCam').innerHTML = `cam <strong>az ${c.az.toFixed(2)} el ${c.el.toFixed(2)}</strong> · light az ${l.az.toFixed(2)} el ${l.el.toFixed(2)}`;
  $('chipGrid').innerHTML = `grid <strong>${g.x}x${g.y}${g.useZ ? 'x' + g.z : ''}</strong>`;
  // 前は drawArrays を投げるまでの CPU 時間を出していて、GPU の仕事量と関係が無かった。
  // 拡張が使えるなら実測の GPU 時間、無ければ CPU 時間だとわかるように出す
  const scale = liveSS < scene.ss ? ` · x${liveSS.toFixed(2)}` : '';
  $('chipMs').innerHTML = hasGpuTimer()
    ? `<strong>${gpuMs().toFixed(1)}</strong> ms gpu${scale}`
    : `<strong>${lastMs.toFixed(1)}</strong> ms cpu${scale}`;
  $('ldir').textContent = ` az ${l.az.toFixed(2)} el ${l.el.toFixed(2)}`;
}

// 書き出し範囲の枠を canvas に重ねる。中央固定・収まる最大サイズ（インセットなし）なので、
// 1:1 の枠は PNG の書き出し範囲とピクセル単位で一致する
function layoutFrame(){
  const r = cv.getBoundingClientRect();
  const f = frameRect(r.width, r.height, scene.out.aspect);
  const g = $('frameGuide');
  g.style.left = `${f.x}px`;
  g.style.top = `${f.y}px`;
  g.style.width = `${f.w}px`;
  g.style.height = `${f.h}px`;
}

// スライダーのつまみ左側を accent で塗る（alt.css の --pct）
function paint(el){
  const min = +el.min || 0, max = +el.max || 100;
  el.style.setProperty('--pct', `${((+el.value - min) / (max - min)) * 100}%`);
}
function slider(id, apply, fmt, rebuild){
  const el = $(id), out = $(id + 'V');
  const run = () => {
    const v = +el.value;
    apply(v);
    if (out) out.textContent = fmt(v);
    paint(el);
    rebuild ? fullRebuild() : requestDraw();
  };
  el.addEventListener('input', run);
  run();
}

// ------------------------------------------------------------ FIELDS（軸→値）
// height は z を使わない（列の高さは z に依らない）ので x/y だけ出す
const FIELD_UI = [
  { key: 'height',  axes: ['x', 'y'],      note: 'x scene height', step: 0.01 },
  { key: 'density', axes: ['x', 'y', 'z'], note: 'Beer-Lambert',   step: 0.05 },
  { key: 'ior',     axes: ['x', 'y', 'z'], note: 'once per glass', step: 0.01 },
  { key: 'mix',     axes: ['x', 'y', 'z'], note: 'glass A - B',    step: 0.05 },
];

for (const spec of FIELD_UI){
  const f = scene.fields[spec.key];
  const row = document.createElement('div');
  row.className = 'fld';
  row.innerHTML =
    `<div class="fld-head"><span>${spec.key.toUpperCase()}</span><em>${spec.note}</em></div>` +
    `<div class="fld-axes">` +
      spec.axes.map(a =>
        `<label class="check-row"><input type="checkbox" data-ax="${a}"${f.axes[a] ? ' checked' : ''}>${a}</label>`
      ).join('') +
      `<label class="check-row"><input type="checkbox" data-inv${f.inv ? ' checked' : ''}>inv</label>` +
    `</div>` +
    `<div class="pat-grid">` +
      PATTERNS.map(p =>
        `<button data-pat="${p.id}" title="${p.hint}"${p.id === f.pat ? ' class="active"' : ''}>${p.key}</button>`
      ).join('') +
    `</div>` +
    `<div class="level-hint patmsg"></div>` +
    `<div class="fld-range">` +
      `<label>lo <input type="number" data-lo step="${spec.step}" value="${f.lo}"></label>` +
      `<label>hi <input type="number" data-hi step="${spec.step}" value="${f.hi}"></label>` +
    `</div>`;
  $('fields').appendChild(row);

  // 軸が1本だと合成が効かず ramp / fold の2択に縮退することを出す
  const msg = row.querySelector('.patmsg');
  const refreshMsg = () => {
    const on = spec.axes.filter(a => f.axes[a]);
    if (on.length === 0) msg.textContent = 'no axis — const (uses lo)';
    else if (on.length === 1)
      msg.textContent = `1 axis: ${f.pat >= 4 ? 'fold (from center)' : 'ramp (from edge)'}`;
    else msg.textContent = `${on.join('+')} · ${PATTERNS[f.pat].hint}`;
  };

  row.querySelectorAll('[data-ax]').forEach(el => el.addEventListener('change', () => {
    f.axes[el.dataset.ax] = el.checked; refreshMsg(); requestDraw();
  }));
  row.querySelector('[data-inv]').addEventListener('change', e => {
    f.inv = e.target.checked; requestDraw();
  });
  row.querySelector('.pat-grid').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    f.pat = +b.dataset.pat;
    row.querySelectorAll('.pat-grid button').forEach(x => x.classList.toggle('active', x === b));
    refreshMsg(); requestDraw();
  });
  row.querySelector('[data-lo]').addEventListener('input', e => { f.lo = +e.target.value; requestDraw(); });
  row.querySelector('[data-hi]').addEventListener('input', e => { f.hi = +e.target.value; requestDraw(); });
  refreshMsg();
}

// ------------------------------------------------------------ 左カラムの配線
slider('gx',   v => scene.grid.x = v, v => String(v));
slider('gy',   v => scene.grid.y = v, v => String(v));
slider('gz',   v => scene.grid.z = v, v => String(v));
slider('sh',   v => scene.maxH = v / 10, v => (v / 10).toFixed(1));
slider('gap',  v => scene.gap = v / 100, v => (v / 100).toFixed(2));
slider('gapz', v => scene.gapZ = v / 100, v => (v / 100).toFixed(2));
slider('bev',  v => scene.bevel = v / 100, v => (v / 100).toFixed(2));

// use grid z: 高さを段にスナップし、セルを立方体にする。このとき max height は使われない
function syncZ(){
  const on = scene.grid.useZ;
  $('shRow').classList.toggle('off', on);
  $('gzRow').classList.toggle('off', !on);
  $('gapzRow').classList.toggle('off', !on);
  $('zhint').textContent = on
    ? `height snaps to ${scene.grid.z} levels / cells are cubes / scene height = ${scene.grid.z}`
    : 'height is continuous / max height sets the scene height / gap z has no effect';
}
$('useZ').addEventListener('change', e => { scene.grid.useZ = e.target.checked; syncZ(); requestDraw(); });
$('gz').addEventListener('input', syncZ);
$('refit').addEventListener('click', () => { Object.assign(scene.cam, fitCam(scene)); requestDraw(); });

slider('lint', v => scene.light.intensity = v / 100, v => (v / 100).toFixed(2));
slider('lamb', v => scene.light.ambient = v / 100, v => (v / 100).toFixed(2));
slider('lwb',  v => scene.light.wb = v / 100, v => (v / 100).toFixed(2), true);

for (const id of ['bgtabs', 'bgtabs2']){
  $(id).addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    scene.bg.mode = +b.dataset.bg;
    for (const g of ['bgtabs', 'bgtabs2'])
      $(g).querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    requestDraw();
  });
}
$('void').addEventListener('input', () => { scene.bg.color = $('void').value; requestDraw(); });
slider('bgd', v => scene.bg.dist = v / 100, v => (v / 100).toFixed(2));
slider('bgr', v => scene.bg.cycloR = v / 100, v => (v / 100).toFixed(2));

slider('ss',  v => scene.ss = v / 100, v => (v / 100).toFixed(2));
slider('seg', v => scene.segs = v, v => String(v));

// ==================================================== スペクトラムエディタ（3枚）
const SPECTRA = [
  { id: 'L', title: 'EMISSION',   maxY: 1.2, stroke: '#e8e8b0', kind: 'light'  },
  { id: 'A', title: 'ABSORB A',   maxY: 6.0, stroke: '#e88f9f', kind: 'glassA' },
  { id: 'B', title: 'ABSORB B',   maxY: 6.0, stroke: '#8fd6e8', kind: 'glassB' },
];
const editors = {};

for (const s of SPECTRA){
  const isLight = s.kind === 'light';
  const opts = (isLight ? LIGHT_KEYS : GLASS_KEYS)
    .map(k => `<option value="${k}">${k.toLowerCase()}</option>`).join('');
  const box = document.createElement('div');
  box.className = 'spec';
  box.innerHTML =
    `<div class="spec-head">
       <div class="section-title">${s.title}</div>
       <i class="chip" id="chip${s.id}"></i><span class="chipv" id="chipv${s.id}"></span>
     </div>
     <canvas id="cv${s.id}"></canvas>
     <div class="spec-row">
       <label>${isLight ? 'cont' : 'base'}
         <input type="range" id="base${s.id}" min="0" max="${isLight ? 100 : 300}" value="0">
         <span id="baseV${s.id}">0.00</span></label>
       ${isLight ? `<label><input type="checkbox" id="bbL"> bb</label>
         <label>K <input type="range" id="kL" min="1000" max="12000" step="100" value="6500">
           <span id="kVL">6500</span></label>` : ''}
     </div>
     <div class="spec-row">
       <select id="pre${s.id}"><option value="">preset --</option>${opts}</select>
       <button class="btn secondary" id="clr${s.id}">CLEAR</button>
     </div>
     <div class="spec-row">
       <label>&lambda; <input type="number" id="lam${s.id}" step="1"></label>
       <label>${isLight ? 'amp' : 'A'} <input type="number" id="amp${s.id}" step="0.05"></label>
       <label>Q <input type="number" id="q${s.id}" step="0.1"></label>
     </div>`;
  $('spectra').appendChild(box);
}

// 帯を触ったら LUT を焼き直す。エディタの再描画と数値欄の同期もここで
function onBands(){
  for (const s of SPECTRA){
    const ed = editors[s.id], p = ed.peaks[ed.sel];
    $('lam' + s.id).value = p ? Math.round(p.l) : '';
    $('amp' + s.id).value = p ? p.a.toFixed(2)  : '';
    $('q'   + s.id).value = p ? p.q.toFixed(1)  : '';
    ed.draw();
  }
  updateChips();
  fullRebuild();
}

for (const s of SPECTRA){
  const target = scene[s.kind];
  const ed = new BandEditor('cv' + s.id, s.maxY, s.stroke,
    { onChange: onBands, onFlash: m => toast(m, 'error') });
  ed.peaks = target.peaks;                            // scene の配列をそのまま編集させる
  ed.baseAt = () => target.base;
  editors[s.id] = ed;

  if (s.kind === 'light'){
    // 連続光を黒体にできる。曲線は planckNorm（レンダラが焼くのと同じもの）を引く。
    // ここで Planck を手で書き直すと正規化を間違えて曲線が平らに潰れる（実際に踏んだ）
    let bbK = null, bbSpd = null;
    ed.baseAt = l => {
      if (!target.bb) return target.base;
      if (bbK !== target.K){ bbK = target.K; bbSpd = planckNorm(bbK); }
      const f = (l - LMIN) / LSTEP;
      const i = Math.max(0, Math.min(N - 2, Math.floor(f))), t = f - i;
      return target.base * (bbSpd[i] * (1 - t) + bbSpd[i + 1] * t);
    };
    $('bbL').checked = target.bb;
    $('bbL').addEventListener('change', e => { target.bb = e.target.checked; onBands(); });
    const k = $('kL');
    k.value = target.K; $('kVL').textContent = target.K; paint(k);
    k.addEventListener('input', () => {
      target.K = +k.value; $('kVL').textContent = target.K; paint(k); onBands();
    });
  }

  const baseEl = $('base' + s.id);
  baseEl.value = Math.round(target.base * 100);
  $('baseV' + s.id).textContent = target.base.toFixed(2);
  paint(baseEl);
  baseEl.addEventListener('input', () => {
    target.base = +baseEl.value / 100;
    $('baseV' + s.id).textContent = target.base.toFixed(2);
    paint(baseEl); onBands();
  });

  // プリセットは配列ごとコピーして流し込む（参照のまま入れるとプリセット定義が壊れる）
  $('pre' + s.id).addEventListener('change', e => {
    const key = e.target.value;
    if (!key) return;
    const src = s.kind === 'light' ? LIGHT_PRESETS[key] : GLASS[key];
    target.base = src.base;
    target.peaks.length = 0;
    for (const p of clonePeaks(src.peaks)) target.peaks.push(p);
    if (s.kind === 'light'){
      target.bb = src.bb; target.K = src.K;
      $('bbL').checked = src.bb; $('kL').value = src.K; $('kVL').textContent = src.K; paint($('kL'));
    }
    baseEl.value = Math.round(target.base * 100);
    $('baseV' + s.id).textContent = target.base.toFixed(2);
    paint(baseEl);
    ed.sel = -1;
    onBands();
  });

  $('clr' + s.id).addEventListener('click', () => { target.peaks.length = 0; ed.sel = -1; onBands(); });

  const num = (prefix, key, round) => $(prefix + s.id).addEventListener('input', e => {
    const p = ed.peaks[ed.sel];
    if (!p) return;
    p[key] = round ? Math.round(+e.target.value) : +e.target.value;
    onBands();
  });
  num('lam', 'l', true); num('amp', 'a', false); num('q', 'q', false);
}

// 色チップ。EMISSION = その光そのものの色 / ABSORB = 等エネルギー白で見たその色
function updateChips(){
  const S = buildEmission(scene.light);
  const conv = c => hexOf(gamutMap(c));
  const nrm0 = normFor(S, scene.light.wb);
  const probe = integrate(S, new Float64Array(N), 0, nrm0);
  const expo = 1 / Math.max(probe[0], probe[1], probe[2], 1e-9);
  const nrm = nrm0.map(v => v * expo);
  const put = (id, hex) => { $('chip' + id).style.background = hex; $('chipv' + id).textContent = hex; };
  put('L', conv(integrate(S, new Float64Array(N), 0, nrm)));
  const wn = normFor(WHITE, 1);
  put('A', conv(integrate(WHITE, absOf(scene.glassA), 1, wn)));
  put('B', conv(integrate(WHITE, absOf(scene.glassB), 1, wn)));
}

// ==================================================== 書き出し
function vidInfo(){
  const { w, h } = videoSize(scene.out.aspect);
  const frames = Math.round(scene.out.turn * FPS);
  $('vidInfo').textContent = `${w}x${h} / ${frames} frames / ${FPS}fps / webm`;
}
$('aspects').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  scene.out.aspect = b.dataset.a;
  $('aspects').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
  layoutFrame(); vidInfo();
});
slider('turn', v => scene.out.turn = v, v => String(v));
$('turn').addEventListener('input', vidInfo);

// PNG はタイルに割って描くので、途中経過がそのまま進捗になる。
// 遅い機種だと数秒かかるので、描いている間はもう一度押すと中止できる
let stilling = false;
$('pngGo').addEventListener('click', () => {
  if (stilling){ cancelPNG(); return; }
  stilling = true;
  toast('rendering 4096x4096...');
  exportPNG(
    (done, total) => {
      $('pngGo').textContent = `${Math.round(done / total * 100)}% — CLICK TO CANCEL`;
    },
    msg => {
      toast(msg);
      $('pngGo').textContent = 'DOWNLOAD PNG 4096';
      stilling = false;
      requestDraw();
    });
});

let recording = false;
$('vidGo').addEventListener('click', async () => {
  if (recording) return;
  recording = true;
  $('vidGo').disabled = true; $('vidStop').disabled = false;
  $('prog').classList.add('show');
  await exportVideo(
    (done, total) => {
      $('progBar').style.width = `${(done / total) * 100}%`;
      $('progText').textContent = `${done} / ${total}`;
    },
    msg => {
      toast(msg);
      $('prog').classList.remove('show');
      $('vidGo').disabled = false; $('vidStop').disabled = true;
      recording = false;
      requestDraw();
    });
});
$('vidStop').addEventListener('click', () => cancelVideo());

// ------------------------------------------------------------------ カメラ / 光の操作
let mode = 0;   // 1 = orbit (左) / 2 = light (右) / 3 = pan (中ボタン)
let mx = 0, my = 0;
const CURSOR = { 1: 'drag', 2: 'light', 3: 'pan' };

cv.addEventListener('contextmenu', e => e.preventDefault());
// 中ボタンは既定だと Windows のオートスクロールが始まるので止める
cv.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
cv.addEventListener('mousedown', e => {
  mode = e.button === 1 ? 3 : e.button === 2 ? 2 : e.button === 0 ? 1 : 0;
  if (!mode) return;
  mx = e.clientX; my = e.clientY;
  dragging = true;
  cv.classList.add(CURSOR[mode]);
  e.preventDefault();
});
window.addEventListener('mousemove', e => {
  if (!mode) return;
  const dx = e.clientX - mx, dy = e.clientY - my;
  mx = e.clientX; my = e.clientY;
  if (mode === 1){
    scene.cam.az -= dx * 0.008;
    scene.cam.el = Math.max(-1.45, Math.min(1.45, scene.cam.el + dy * 0.008));
  } else if (mode === 3){
    panCam(scene.cam, dx, dy, cv.clientHeight);
  } else {
    scene.light.az -= dx * 0.010;
    scene.light.el = Math.max(-1.3, Math.min(1.55, scene.light.el + dy * 0.010));
  }
  requestDraw();
});
window.addEventListener('mouseup', () => {
  if (!mode) return;
  mode = 0; dragging = false;
  cv.classList.remove('drag', 'light', 'pan');
  requestDraw();   // フル品質で描き直す
});
cv.addEventListener('wheel', e => {
  e.preventDefault();
  scene.cam.dist = Math.max(3, Math.min(120, scene.cam.dist * Math.exp(e.deltaY / 600)));
  requestDraw();
}, { passive: false });
cv.addEventListener('dblclick', () => {
  Object.assign(scene.cam, { az: -1.05, el: 0.24 }, fitCam(scene));
  requestDraw();
});

window.addEventListener('resize', () => {
  for (const s of SPECTRA) editors[s.id].draw();
  requestDraw();
});

// ------------------------------------------------------------------ 起動
syncZ();
vidInfo();
Object.assign(scene.cam, fitCam(scene));
for (const s of SPECTRA) editors[s.id].draw();
updateChips();
fullRebuild();
