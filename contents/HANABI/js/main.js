/* ============================================================
   main.js — 起動とフレームループ

   時刻は「開花からの経過秒」しかシェーダに渡さない。
   グローバルな経過秒を float32 の uniform で渡すと、常時稼働で
   一日回した頃には分解能が 0.01 秒台まで落ちて動きがガタつく。
   玉ごとの uAge（0〜数秒）なら構造的にその問題が起きない。
   ============================================================ */

import { Renderer, MAX_DPR } from './renderer.js';
import { ShellSystem } from './shells.js';
import { OrbitCamera } from './camera.js';
import { params, state, buildUI, updateHud, pickRecipe, currentRecipe } from './ui.js';
import { loadRecipes } from './recipes.js';

const canvas = document.getElementById('view');

function fatal(msg) {
  const box = document.getElementById('fatal');
  box.style.display = 'block';
  box.textContent = msg;
}

let renderer;
try {
  renderer = new Renderer(canvas);
} catch (e) {
  fatal(String(e.message || e));
  throw e;
}

/* recipes.json は fetch で読むので file:// では動かない。
   このマシンでは python が Microsoft Store のスタブに当たることがあるので py を案内する */
let recipes;
try {
  recipes = await loadRecipes();
} catch (e) {
  fatal(`recipes.json を読めませんでした: ${e.message || e}\n\n` +
        `file:// で開くと fetch がブロックされます。サーバー経由で開いてください:\n` +
        `  py -m http.server 8103   →   http://localhost:8103/`);
  throw e;
}

const cam = new OrbitCamera(params);
const sys = new ShellSystem(cam);

const t0 = performance.now();
const clock = () => (performance.now() - t0) / 1000;

function doResize() {
  renderer.resize(Math.round(params.pixelSize), MAX_DPR);
}

/* SODENMIR の上部ナビ（#sodenmir-topbar, sticky）の高さを測って
   --nav-h に入れる。端タブとパネルはこのぶん下げてナビの下から始まる。
   ナビは flex-wrap するので、幅によって 1〜2 段に変わる。固定値だと
   段が増えたときにパネルの頭がナビに潜るので、毎回測り直す。 */
function syncNavHeight() {
  const bar = document.getElementById('sodenmir-topbar');
  const h = bar ? Math.ceil(bar.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty('--nav-h', h + 'px');
}

function launch(recipe) {
  sys.launchRecipe(params, clock(), recipe || pickRecipe());
}

const ui = buildUI(recipes, {
  onCount: () => renderer.setStarCount(Math.round(params.count)),
  onResize: doResize,
  onLaunch: () => launch(currentRecipe()),
  skyStatus: () => ({ texReady: renderer.sky.texReady, texName: renderer.sky.texName }),
  // 等角図法の空テクスチャは任意。HDRI を押されたときだけ読みに行く
  loadSky: () => renderer.sky.loadTexture(),
});

// ドラッグとホイールは params.dist を直接動かすので、スライダーを追従させる
cam.attach(canvas, () => ui.syncSlider('dist'));

renderer.setStarCount(Math.round(params.count));
syncNavHeight();
doResize();
window.addEventListener('resize', () => { syncNavHeight(); doResize(); });
// 遅れて効くレイアウト（フォント適用でナビの高さが変わる等）に一度追従
window.addEventListener('load', syncNavHeight);

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    launch();
  }
});

/* 画面のダブルクリックで「没入モード」を切り替える。
   フルスクリーンに入り、端タブ・設定パネル・HUD・サイトの上部ナビを
   すべて隠して花火だけにする。もう一度ダブルクリックで戻る。
   Esc でフルスクリーンだけ抜けたときも没入モードを解除する。 */
let immersive = false;
function setImmersive(on) {
  immersive = on;
  document.body.classList.toggle('immersive', on);
  if (on) {
    // パネルが開いたままだと戻したとき中途半端に残るので閉じる
    for (const id of ['leftWrap', 'rightWrap']) document.getElementById(id)?.classList.remove('open');
    for (const id of ['tabLeft', 'tabRight']) document.getElementById(id)?.classList.remove('on');
    document.body.classList.remove('left-open', 'right-open');
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else if (document.fullscreenElement) {
    document.exitFullscreen?.();
  }
  // ナビの表示が変わると高さも変わる（隠すと 0）。パネル位置の基準を取り直す
  syncNavHeight();
}
canvas.addEventListener('dblclick', () => setImmersive(!immersive));
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && immersive) setImmersive(false);
});

// 起動直後に 1 発だけ手前に上げて、画面が空のまま始まらないようにする
launch(currentRecipe());

let frames = 0, fpsT = 0, fps = 0;
let last = clock();

/* コンソールから中身を触れるようにしておく。
   パラメータの当たりを付けるときにスライダーより速い */
window.HANABI = {
  params, state, sys, cam, renderer, clock, step, launch, resize: doResize,
  exportConfig: ui.exportConfig,
  loadConfig: (data) => { if (ui.applyConfig(data)) { ui.reapply(); launch(currentRecipe()); } },
};

function step(now, dt = 1 / 60) {
  cam.step();
  sys.update(params, now, pickRecipe);
  return renderer.render(sys, cam, params, now, dt);
}

function frame() {
  requestAnimationFrame(frame);

  const now = clock();
  const dt = now - last;
  last = now;

  // タブ復帰などで巨大な dt が来ても、解析解なので位置は正しく評価される。
  // 影響を受けるのはトレイルの減衰と打ち上げ間隔だけ
  if (dt > 0.5) sys.nextAuto = now + 0.2;

  const stats = step(now, dt);

  frames++;
  fpsT += dt;
  if (fpsT >= 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }

  updateHud(cam, {
    drawn: stats.drawn, calls: stats.calls,
    iw: renderer.iw, ih: renderer.ih, fps,
  });
}

requestAnimationFrame(frame);
