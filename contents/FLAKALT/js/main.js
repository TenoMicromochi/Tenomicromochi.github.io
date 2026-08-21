/* ============================================================
   FLAKALT — main.js
   起動、画面の整数倍スケーリング、モード遷移、メインループ。

   物理は 200Hz の固定ステップ。描画は rAF まかせ。フレームが飛んでも
   弾道が変わらないようにアキュムレータで刻む（上限つき）。

   Pointer Lock は必ずクリック（本物のユーザー操作）からしか要求しない。
   ESC で外れたときは「CLICK TO TAKE CONTROL」を出して止めるだけにする。
   ============================================================ */

import { Raster } from './raster.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Game } from './game.js';
import { Screens } from './screens.js';
import { nationOf } from './guns.js';
import { C } from './palette.js';

const W = 640, H = 400;
const STEP = 1 / 200;
const MAX_STEPS = 40;
const STORE_KEY = 'flakalt.options.v1';

const DEFAULT_OPTS = {
  realistic: true,
  aid: 'EASY',          // EASY = 見越し点を出せる / HARD = 一切出さない
  freeRange: false,     // 攻撃されない練習場モード
  difficulty: 'VETERAN',
  nation: 'USA',        // 兵装セット。data/guns.json の nations の id
  mouseAim: true,       // OFF にすると砲は方向キーだけで動かす
  zoom: 2.5,            // 望遠の倍率。ズーム中にホイール / W・S で変える
  leadRange: 2000,      // 見越し点を出す上限距離 [m]
  sensitivity: 0.10,
  crt: true,
  sound: true,
  scale: 0,             // 0 = 画面に合わせて自動
};

function loadOpts() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULT_OPTS };
    return { ...DEFAULT_OPTS, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULT_OPTS };
  }
}

function saveOpts(o) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch (e) { /* 保存できなくても続行 */ }
}

class App {
  constructor(canvas, data) {
    this.data = data;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.r = new Raster(W, H);
    this.input = new Input(canvas);
    this.sfx = new Sfx();
    this.opts = loadOpts();
    document.body.classList.toggle('nocrt', !this.opts.crt);

    // 保存されていた国が data 側から消えていることもあるので、必ず引き直す
    this.opts.nation = nationOf(data, this.opts.nation).id;

    this.fsCtl = { isActive: () => this.isFullscreen(), toggle: () => this.toggleFullscreen() };
    this.game = new Game(nationOf(data, this.opts.nation).guns, this.sfx, this.opts);
    this.screens = new Screens(this.sfx, this.opts, data, this.fsCtl);

    this.mode = 'BOOT';
    this.acc = 0;
    this.last = performance.now();

    this.initScaleBar();
    this.initFullscreen();
    this.fit();
    addEventListener('resize', () => this.fit());

    // 音は最初のクリック・キー入力まで作れない
    const wake = () => {
      this.sfx.init();
      this.sfx.resume();
      this.sfx.setMuted(!this.opts.sound);
    };
    canvas.addEventListener('mousedown', wake);
    addEventListener('keydown', wake);

    requestAnimationFrame((t) => this.loop(t));
  }

  /* --- 表示倍率 ----------------------------------------------- */

  /* 画面外の x1/x2/x3 ボタン。GALLERY の拡大率ボタンと同じ作りにしてある
     （.scale-btn[data-scale] と button_<asset>_<ON|OFF>.png の差し替え）。 */
  initScaleBar() {
    this.scaleGroup = document.getElementById('scaleGroup');
    if (!this.scaleGroup) return;
    this.scaleGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.scale-btn');
      if (!btn) return;
      this.opts.scale = Number(btn.dataset.scale);
      saveOpts(this.opts);
      this.fit();
      this.sfx.beep(760, 0.04);
    });
  }

  syncScaleBar(active) {
    if (!this.scaleGroup) return;
    for (const btn of this.scaleGroup.querySelectorAll('.scale-btn')) {
      const img = btn.querySelector('img');
      const on = Number(btn.dataset.scale) === active;
      const src = '/images/buttons/button_' + img.dataset.asset + (on ? '_ON' : '_OFF') + '.png';
      if (img.getAttribute('src') !== src) img.setAttribute('src', src);
      btn.classList.toggle('on', on);
    }
  }

  /* --- フルスクリーン ------------------------------------------ */
  /* #stage（キャンバス+CRTフィルタ）だけをフルスクリーンにする。ページ全体を
     フルスクリーンにしても、画面の中に小さいキャンバスが浮くだけでは
     1600x900 のような並のモニタで何も解決しない。狙いは「フルスクリーンに
     した瞬間、実画面に収まる最大の整数倍を自動で選ぶ」ところにある。

     x1/x2/x3 ボタンは #stage の外（兄弟要素）にあるため、フルスクリーン中は
     ブラウザの仕様でそもそも描画されない（フルスクリーン要素の外は消える）。
     ボタンは「入る」ためのものと割り切り、「出る」は標準の Esc に任せる。
     ゲーム内オプション画面にも同じ切替を用意してあるのはそのため
     （キャンバスの中の描画なのでフルスクリーン中も出続ける）。 */

  isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  toggleFullscreen() {
    if (this.isFullscreen()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
      return;
    }
    const el = this.stageEl;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) { this.sfx.beep(160, 0.15); return; } // 対応していない環境
    const p = req.call(el);
    if (p && p.catch) p.catch(() => {});
  }

  initFullscreen() {
    this.stageEl = document.getElementById('stage');
    this.fsBtn = document.getElementById('fullscreenBtn');
    if (this.fsBtn) {
      this.fsBtn.addEventListener('click', () => this.toggleFullscreen());
    }
    const onChange = () => {
      const active = this.isFullscreen();
      if (this.fsBtn) {
        this.fsBtn.textContent = active ? 'EXIT FULLSCREEN' : 'FULLSCREEN';
        this.fsBtn.classList.toggle('on', active);
      }
      this.fit();
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
  }

  /* 整数倍のみ。半端に伸ばすとドットが潰れる。
     倍率は「実機ピクセル」で数える。DPR が 1 でない環境（Windows の
     125% 表示やスマホ）で CSS ピクセルに直接入れると等倍にならないため、
     GALLERY のビューアと同じく DPR を割り戻して指定する。 */
  fit() {
    const dpr = window.devicePixelRatio || 1;
    const fs = this.isFullscreen();
    let availW, availH, capMax;
    if (fs) {
      // フルスクリーン中はページの段組みを無視して、画面そのものに合わせる。
      // ボタンの上限(x3)はページ内で選べる範囲の上限でしかないので、
      // フルスクリーンならもっと大きい画面まで面倒を見てよい。
      availW = this.stageEl.clientWidth || innerWidth;
      availH = this.stageEl.clientHeight || innerHeight;
      capMax = 6;
    } else {
      // ページの中に置かれているので、使える幅は親要素・高さは画面から
      // 画面本体の上端までを差し引いた残りで見る
      const wrap = document.getElementById('wrap');
      const host = wrap && wrap.parentElement;
      availW = Math.min(host ? host.clientWidth : innerWidth, innerWidth) - 40;
      // 上部ナビと見出しのぶんだけ差し引く。少しはみ出してスクロールするのは許す
      availH = Math.max(H, innerHeight - 130);
      capMax = 3;
    }
    const fitMax = Math.max(1, Math.min(capMax, Math.floor(Math.min(availW * dpr / W, availH * dpr / H))));
    // フルスクリーン中は x1/x2/x3 の手動指定より自動フィットを優先する
    const s = (!fs && this.opts.scale > 0) ? this.opts.scale : fitMax;
    this.canvas.style.width = (W * s / dpr) + 'px';
    this.canvas.style.height = (H * s / dpr) + 'px';
    this.scale = s;
    this.syncScaleBar(fs ? 0 : s);
  }

  startMission() {
    // 出撃のたびに国の兵装セットを積み直す。reset() が Mount を作り直す
    this.game.gunSpecs = nationOf(this.data, this.opts.nation).guns;
    this.game.reset();
    this.mode = 'PLAY';
    this.sfx.init();
    this.sfx.resume();
    if (this.opts.mouseAim) this.input.lock();
  }

  /* --- ループ ------------------------------------------------- */

  loop(ts) {
    const dt = Math.min(0.25, Math.max(0, (ts - this.last) / 1000));
    this.last = ts;

    if (this.input.pressed('KeyM')) {
      this.opts.sound = !this.opts.sound;
      this.sfx.setMuted(!this.opts.sound);
      saveOpts(this.opts);
    }
    if (this.input.pressed('KeyF')) this.toggleFullscreen();

    switch (this.mode) {
      case 'BOOT': this.doBoot(dt); break;
      case 'TITLE': this.doTitle(dt); break;
      case 'MODESEL': this.doModeSelect(dt); break;
      case 'OPTIONS': this.doOptions(dt); break;
      case 'HELP': this.doHelp(dt); break;
      case 'PLAY': this.doPlay(dt); break;
      case 'PAUSE': this.doPause(dt); break;
      case 'PAUSE_OPTIONS': this.doPauseOptions(dt); break;
      case 'OVER': this.doOver(dt); break;
    }

    this.input.endFrame();
    this.r.present(this.ctx);
    requestAnimationFrame((t) => this.loop(t));
  }

  doBoot(dt) {
    if (this.screens.boot(this.r, dt, this.input) === 'done') {
      this.mode = 'TITLE';
      this.sfx.beep(880, 0.06);
    }
  }

  doTitle(dt) {
    const a = this.screens.title(this.r, dt, this.input);
    // クリックでも先へ進めるようにしておく
    if (this.input.takeClick() || a === 'start') { this.mode = 'MODESEL'; return; }
    if (a === 'options') { this.mode = 'OPTIONS'; }
    else if (a === 'help') { this.mode = 'HELP'; this.screens.helpPage = 0; }
  }

  doModeSelect(dt) {
    const a = this.screens.modeSelect(this.r, dt, this.input);
    if (a === 'launch') { saveOpts(this.opts); this.startMission(); }
    else if (a === 'back') this.mode = 'TITLE';
  }

  doOptions(dt) {
    if (this.screens.options(this.r, dt, this.input) === 'back') {
      saveOpts(this.opts);
      this.mode = 'TITLE';
    }
  }

  doHelp(dt) {
    if (this.screens.help(this.r, dt, this.input) === 'back') this.mode = 'TITLE';
  }

  doPlay(dt) {
    const g = this.game;
    // MOUSE AIM を切っているときは Pointer Lock を要求しない。
    // 方向キーだけで砲を回すので、マウスから掴む相手がそもそも無い
    const active = this.input.locked || !this.opts.mouseAim;

    if (this.input.pressed('KeyP')) {
      this.input.unlock();
      this.mode = 'PAUSE';
      return;
    }

    if (active && !g.over) {
      g.applyInput(this.input, dt);
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < MAX_STEPS) { g.update(STEP); this.acc -= STEP; n++; }
      if (this.acc > STEP * MAX_STEPS) this.acc = 0;
    } else {
      this.acc = 0;
      g.mount.firing = false;
    }

    g.render(this.r);
    this.screens.banner(this.r, g);

    if (g.over) {
      // 撃墜されたあと、破片が落ちきるまで少し見せてから戦績へ
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < MAX_STEPS) { g.update(STEP); this.acc -= STEP; n++; }
      if (g.stateT > 3.2) {
        this.input.unlock();
        this.screens.t = 0;
        this.mode = 'OVER';
      }
    } else if (!active) {
      this.drawTakeControl();
      if (this.input.takeClick()) this.input.lock();
    }
  }

  drawTakeControl() {
    const r = this.r;
    const w = 300, h = 46;
    const x = (W - w) / 2, y = 150;
    r.fillRect(x, y, w, h, C.BLACK);
    r.rect(x, y, w, h, C.YELLOW);
    r.rect(x + 2, y + 2, w - 4, h - 4, C.YELLOW);
    r.textCenter(W / 2, y + 12, 'MOUNT CONTROL RELEASED', C.YELLOW);
    r.textCenter(W / 2, y + 26, 'CLICK TO TAKE CONTROL', C.WHITE);
  }

  doPause(dt) {
    this.game.render(this.r);
    const a = this.screens.pause(this.r, dt, this.input);
    if (a === 'resume') { this.mode = 'PLAY'; }
    else if (a === 'options') { this.mode = 'PAUSE_OPTIONS'; }
    else if (a === 'abort') { saveOpts(this.opts); this.mode = 'TITLE'; }
  }

  doPauseOptions(dt) {
    const back = this.screens.options(this.r, dt, this.input,
      () => this.game.render(this.r));
    if (back === 'back') { saveOpts(this.opts); this.mode = 'PAUSE'; }
  }

  doOver(dt) {
    this.game.render(this.r);
    const a = this.screens.gameover(this.r, dt, this.input, this.game);
    if (a === 'restart') this.startMission();
    else if (a === 'title') this.mode = 'TITLE';
  }
}

/* --- 起動 ------------------------------------------------------ */

async function boot() {
  const canvas = document.getElementById('screen');
  try {
    const res = await fetch('data/guns.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data.nations || !data.nations.length) throw new Error('data/guns.json に nations がない');
    for (const n of data.nations) {
      if (!n.guns || !n.guns.length) throw new Error(n.id + ' に guns がない');
    }
    if (data.defaultNation) DEFAULT_OPTS.nation = data.defaultNation;
    // 動作確認用。コンソールから中身を覗けるようにしておく
    window.FLAKALT = new App(canvas, data);
  } catch (err) {
    const el = document.getElementById('fatal');
    el.hidden = false;
    el.textContent =
      'FLAKALT - FATAL ERROR\n\n' +
      String(err && err.message ? err.message : err) + '\n\n' +
      'data/guns.json を読み込めませんでした。\n' +
      'file:// で直接開くと fetch がブロックされます。\n' +
      'ローカルサーバー経由で開いてください:\n\n' +
      '  py -m http.server 8104\n' +
      '  http://localhost:8104/\n';
    console.error(err);
  }
}

boot();
