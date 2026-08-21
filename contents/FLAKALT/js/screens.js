/* ============================================================
   FLAKALT — screens.js
   起動画面・タイトル・オプション・ポーズ・戦績。

   起動画面に出る弾道定数は飾りではなく、実際に ballistics.js が使う
   k の値をその場で計算して出している。data/guns.json をいじると
   ここの表示も変わる。
   ============================================================ */

import { C } from './palette.js';
import { Camera, orientation, clamp } from './camera.js';
import { DART, CONDOR, drawMesh } from './models.js';
import { dragFactor } from './ballistics.js';
import { nationOf } from './guns.js';
import { TYPES } from './aircraft.js';
import { DIFFICULTY } from './game.js';
import { LEAD_RANGE_MIN, LEAD_RANGE_MAX } from './hud.js';

const W = 640, H = 400;
const PLANE_GLYPH = '✈';

function centerBox(r, w, h, title, color = C.CYAN) {
  const x = Math.round((W - w) / 2), y = Math.round((H - h) / 2);
  r.fillRect(x, y, w, h, C.BLACK);
  r.rect(x, y, w, h, color);
  r.rect(x + 2, y + 2, w - 4, h - 4, color);
  if (title) {
    const tw = r.textW(' ' + title + ' ');
    r.fillRect(x + 14, y - 1, tw, 9, C.BLACK);
    r.text(x + 14, y, ' ' + title + ' ', C.YELLOW);
  }
  return { x, y, w, h };
}

/* --- メニュー -------------------------------------------------- */

class Menu {
  constructor(items) {
    this.items = items;
    this.i = 0;
  }

  move(d, sfx) {
    this.i = (this.i + d + this.items.length) % this.items.length;
    sfx.beep(660, 0.03);
  }

  handle(input, sfx) {
    if (input.pressed('ArrowUp') || input.pressed('KeyW')) this.move(-1, sfx);
    if (input.pressed('ArrowDown') || input.pressed('KeyS')) this.move(1, sfx);
    if (input.pressed('Enter') || input.pressed('Space') || input.pressed('NumpadEnter')) {
      sfx.beep(1040, 0.06);
      return this.items[this.i];
    }
    return null;
  }

  draw(r, x, y, step = 14, width = 220) {
    for (let k = 0; k < this.items.length; k++) {
      const sel = k === this.i;
      const yy = y + k * step;
      if (sel) {
        r.fillRect(x - 8, yy - 2, width, 11, C.BLUE);
        r.text(x - 6, yy, '►', C.YELLOW);
      }
      r.text(x + 8, yy, this.items[k].label, sel ? C.WHITE : C.LGRAY);
      if (this.items[k].value !== undefined) {
        r.textRight(x + width - 16, yy, this.items[k].value(), sel ? C.YELLOW : C.DGRAY);
      }
    }
  }
}

/* --- 画面 ------------------------------------------------------ */

export class Screens {
  constructor(sfx, opts, data, fsCtl) {
    this.sfx = sfx;
    this.opts = opts;
    this.data = data;
    // 起動画面に流す弾道表は、いま選んでいる国の砲のもの
    this.gunSpecs = nationOf(data, opts.nation).guns;
    this.fsCtl = fsCtl; // { isActive(), toggle() } — main.js 側の Fullscreen API 窓口
    this.t = 0;
    this.helpPage = 0; // CONTROLS & DOCTRINE のページ（main.js が 'help' 選択時に 0 へ戻す）

    this.bootPages = this.makeBootPages();
    this.bootT = 0;

    this.titleCam = new Camera();
    this.titleCam.setViewport(0, 0, W, H);
    this.titleCam.x = 0; this.titleCam.y = 0; this.titleCam.z = -30;
    this.titleCam.yaw = 0; this.titleCam.pitch = 0; this.titleCam.fov = 55;
    this.titleCam.update();
    this.m = new Float64Array(9);

    this.mainMenu = new Menu([
      { id: 'start', label: 'START MISSION' },
      { id: 'options', label: 'OPTIONS' },
      { id: 'help', label: 'CONTROLS & DOCTRINE' },
    ]);

    /* MISSION SETUP の縦カーソル。上 3 つが任務、その下が兵装と難易度。
       任務の行はカーソルを乗せた時点で選択が確定する（左右で選ぶ列と
       違って、任務は 1 つしか選べないため）。ENTER はどの行にいても出撃。 */
    this.setupMenu = new Menu([
      { id: 'EASY', label: 'EASY' },
      { id: 'HARD', label: 'HARD' },
      { id: 'FREE', label: 'FREE RANGE' },
      {
        id: 'nation', label: 'WEAPON SET',
        toggle: (d) => {
          const ns = this.data.nations;
          const i = ns.findIndex((n) => n.id === opts.nation);
          opts.nation = ns[(i + (d || 1) + ns.length) % ns.length].id;
        },
      },
      {
        id: 'diff', label: 'DIFFICULTY',
        toggle: (d) => {
          const keys = Object.keys(DIFFICULTY);
          const i = keys.indexOf(opts.difficulty);
          opts.difficulty = keys[(i + (d || 1) + keys.length) % keys.length];
        },
      },
    ]);
    this.setupMenu.i = opts.freeRange ? 2 : (opts.aid === 'HARD' ? 1 : 0);

    this.optMenu = new Menu([
      {
        id: 'drive', label: 'MOUNT DRIVE',
        value: () => (opts.realistic ? 'GEARED' : 'DIRECT'),
        toggle: () => { opts.realistic = !opts.realistic; },
      },
      {
        // マウスを切ると Pointer Lock を要求しなくなり、砲は方向キーだけで動く。
        // 難易度と兵装は MISSION SETUP に移したので、ここは操作の設定だけ
        id: 'maim', label: 'MOUSE AIM',
        value: () => (opts.mouseAim ? 'ON' : 'ARROW KEYS'),
        toggle: () => { opts.mouseAim = !opts.mouseAim; },
      },
      {
        // 見越し点を出す上限。遠くまで出すほど楽になるので、
        // 「どこまで甘やかすか」を撃つ側が決められるようにしてある
        id: 'lead', label: 'LEAD AID RANGE',
        value: () => (opts.leadRange / 1000).toFixed(1) + ' KM',
        toggle: (d) => {
          opts.leadRange = Math.round(
            clamp(opts.leadRange + (d || 1) * 100, LEAD_RANGE_MIN, LEAD_RANGE_MAX));
        },
      },
      {
        id: 'sens', label: 'MOUSE SENSITIVITY',
        value: () => opts.sensitivity.toFixed(3) + ' D/PX',
        toggle: (d) => {
          opts.sensitivity = clamp(opts.sensitivity + (d || 1) * 0.01, 0.03, 0.24);
        },
      },
      {
        id: 'crt', label: 'CRT FILTER',
        value: () => (opts.crt ? 'ON' : 'OFF'),
        toggle: () => { opts.crt = !opts.crt; document.body.classList.toggle('nocrt', !opts.crt); },
      },
      {
        // 画面外のボタンはフルスクリーン中だと非表示になる（ブラウザの仕様で
        // フルスクリーン要素の外側は描画されない）ので、キャンバスの中に
        // 常に効くこの項目を用意してある。ここは ON/OFF ではなく実際の状態を見せる。
        id: 'fullscr', label: 'FULLSCREEN',
        value: () => (fsCtl && fsCtl.isActive() ? 'ON' : 'OFF'),
        toggle: () => { fsCtl && fsCtl.toggle(); },
      },
      {
        id: 'snd', label: 'SOUND',
        value: () => (opts.sound ? 'ON' : 'OFF'),
        toggle: () => { opts.sound = !opts.sound; sfx.setMuted(!opts.sound); },
      },
      { id: 'back', label: 'BACK' },
    ]);

    this.pauseMenu = new Menu([
      { id: 'resume', label: 'RESUME' },
      { id: 'options', label: 'OPTIONS' },
      { id: 'abort', label: 'ABORT MISSION' },
    ]);
  }

  /* 起動画面は 2 画面ぶん。実機と同じで、BIOS の POST が流れたあと
     画面が消えて DOS が起動する。

     1 画面目（POST）は 1997 年の 486 機として辻褄が合う値にしてある。
     486DX2 は FPU を内蔵しているので「80487 を別に積んでいる」とは
     書けない（80487 は FPU を持たない 486SX 用の石）。メモリも
     640K + 7168K + UMA 384K = ちょうど 8192K になる組で並べてある。

     2 画面目の FLAKALT.EXE から下は、実際に読み込んだデータをその場で
     数えて出している。装飾ではなく、data/guns.json や aircraft.js の
     TYPES を書き換えるとここの表示もそのまま変わる。 */
  makeBootPages() {
    return [this.makePostLines(), this.makeLoadLines()];
  }

  makePostLines() {
    const L = [];
    const dot = (label, value, w = 46) =>
      (label + ' ').padEnd(w, '.') + ' ' + value;

    L.push(['MICROMOCHI BIOS  V2.14', C.LGRAY]);
    L.push(['COPYRIGHT (C) 1984-1997  TENO MICROMOCHI SOFTWORKS', C.DGRAY]);
    L.push(['', C.BLACK]);
    L.push(['INTEL 80486DX2 CPU AT 66MHZ      COPROCESSOR : INTEGRATED', C.LGRAY]);
    L.push(['', C.BLACK]);
    L.push(['MEMORY TEST :', C.LGRAY]);
    L.push(['   ' + dot('640K BASE MEMORY', 'OK'), C.LGRAY]);
    L.push(['   ' + dot('7168K EXTENDED MEMORY', 'OK'), C.LGRAY]);
    L.push(['   ' + dot('256K WRITE-BACK CACHE', 'OK'), C.LGRAY]);
    L.push(['', C.BLACK]);
    L.push([dot('DETECTING IDE PRIMARY MASTER', 'IDE-0  540MB  CHS 1050/16/63'), C.LGRAY]);
    L.push([dot('DETECTING IDE PRIMARY SLAVE', 'NONE'), C.DGRAY]);
    L.push([dot('DETECTING FLOPPY DRIVE A', '1.44MB  3.5 IN'), C.LGRAY]);
    L.push([dot('DETECTING DISPLAY ADAPTER', 'VGA 512K  640X400 16 COLOR'), C.LGRAY]);
    L.push([dot('DETECTING KEYBOARD', '101-KEY AT'), C.LGRAY]);
    L.push([dot('DETECTING POINTING DEVICE', 'PS/2 MOUSE'), C.LGRAY]);
    L.push([dot('DETECTING AUDIO ADAPTER', 'MICROMOCHI OPL FM'), C.LGRAY]);
    L.push(['', C.BLACK]);

    /* Award BIOS が POST の最後に出すあの表。左右 2 段組で、
       右側は I/O ポートの割り当て。番地は当時の標準どおり。 */
    const bar = '─'.repeat(66);
    L.push(['┌' + bar + '┐', C.CYAN]);
    const row = (a, b) =>
      L.push(['│ ' + a.padEnd(32) + b.padEnd(32) + ' │', C.LGRAY]);
    row('BASE MEMORY    :   640K', 'DISPLAY TYPE   : VGA / EGA');
    row('EXT. MEMORY    :  7168K', 'SERIAL PORTS   : 3F8  2F8');
    row('CACHE MEMORY   :   256K', 'PARALLEL PORT  : 378');
    L.push(['└' + bar + '┘', C.CYAN]);
    L.push(['', C.BLACK]);
    L.push(['07/14/97-I486-2A4X5MCM-00', C.DGRAY]);
    return L;
  }

  makeLoadLines() {
    const L = [];
    const drv = (name, value) => (name + ' ').padEnd(14, ' ') + ': ' + value;

    L.push(['STARTING TENO-DOS 6.22...', C.WHITE]);
    L.push(['', C.BLACK]);
    L.push([drv('HIMEM.SYS', 'XMS DRIVER INSTALLED'), C.LGRAY]);
    L.push([drv('EMM386.EXE', '7168K EXPANDED MEMORY AVAILABLE'), C.LGRAY]);
    L.push([drv('MOUSE.COM', 'PS/2 MOUSE DRIVER V8.20 INSTALLED'), C.LGRAY]);
    L.push([drv('MMSND.SYS', 'AUDIO PORT 220  IRQ 5  DMA 1'), C.LGRAY]);
    L.push(['', C.BLACK]);
    L.push(['C:\\>CD FLAKALT', C.LGREEN]);
    L.push(['C:\\FLAKALT>FLAKALT.EXE', C.LGREEN]);
    L.push(['', C.BLACK]);
    L.push(['FLAKALT  V1.02   (C) 1997 TENO MICROMOCHI SOFTWORKS', C.WHITE]);
    L.push(['', C.BLACK]);

    L.push(['MOUNTING WEAPON DATABASE -- ' + this.data.nations.length + ' NATIONS', C.CYAN]);
    for (const n of this.data.nations) {
      L.push(['  ' + n.id.padEnd(8) + n.guns.length + ' WEAPON SETS ............. OK', C.LGREEN]);
    }
    L.push(['', C.BLACK]);

    // ここだけは選んでいる国ぶんの実弾道。opts.nation は MISSION SETUP で変わる
    const nation = nationOf(this.data, this.opts.nation);
    L.push(['LOADING BALLISTIC TABLES -- ' + nation.name, C.CYAN]);
    for (const g of this.gunSpecs) {
      const k = dragFactor(g.caliber, g.projectileMass, g.dragCd);
      const name = (g.caliber.toFixed(1) + 'MM').padEnd(7);
      L.push(['  ' + name + 'V0 ' + String(g.muzzleVelocity).padStart(3) +
        ' M/S   K ' + k.toExponential(2).toUpperCase() + '   OK', C.LGREEN]);
    }
    L.push(['', C.BLACK]);

    const roster = Object.keys(TYPES);
    L.push(['LOADING CONTACT DATABASE -- ' + roster.length + ' CLASSES', C.CYAN]);
    for (const key of roster) {
      const t = TYPES[key];
      if (t.bonus) {
        L.push(['  ' + key.padEnd(7) + 'BONUS CONTACT ................ OK', C.LMAGENTA]);
      } else {
        const alt = t.band === 'HIGH' ? 'HIGH ALT' : 'LOW ALT ';
        L.push(['  ' + key.padEnd(7) + alt + '   WAVE ' + String(t.from).padStart(2) + '+ ... OK', C.LGREEN]);
      }
    }
    L.push(['', C.BLACK]);

    L.push(['ALL SYSTEMS NOMINAL', C.LGREEN]);
    L.push(['', C.BLACK]);
    return L;
  }
  /* --- BOOT --------------------------------------------------- */

  /* POST → 一拍おいて画面が消え → DOS 起動、という実機の流れをなぞる。
     ESC でいつでも最後まで飛ばせる。 */
  boot(r, dt, input) {
    this.bootT += dt;
    r.clear(C.BLACK);

    const RATE = 0.055;               // 1 行を打つ時間
    const HOLD = 0.8;                 // POST を読ませる間
    const post = this.bootPages[0], load = this.bootPages[1];
    const tPost = post.length * RATE; // POST を打ち終わる時刻
    const tClear = tPost + HOLD;      // 画面が消える時刻

    const inPost = this.bootT < tClear;
    const page = inPost ? post : load;
    const shown = inPost
      ? Math.min(post.length, Math.floor(this.bootT / RATE))
      : Math.min(load.length, Math.floor((this.bootT - tClear) / RATE));

    for (let i = 0; i < shown; i++) {
      const [text, c] = page[i];
      r.text(16, 16 + i * 9, text, c);
    }

    const done = !inPost && shown >= load.length;
    if (done) {
      const y = 16 + load.length * 9;
      if (Math.floor(this.bootT * 2) % 2 === 0) {
        r.text(16, y, 'PRESS ANY KEY TO CONTINUE', C.YELLOW);
      }
      r.fillRect(16, y + 14, 6, 8, C.LGRAY);
      if (input.anyPressed() || input.takeClick()) return 'done';
    } else {
      // カーソルの点滅
      const y = 16 + shown * 9;
      if (Math.floor(this.bootT * 8) % 2 === 0) r.fillRect(16, y, 6, 8, C.LGRAY);
      if (input.pressed('Escape')) { this.bootT = 999; }
    }
    return null;
  }
  /* --- TITLE -------------------------------------------------- */

  drawTitleBackdrop(r) {
    // 地平線と格子だけの簡単な背景
    r.clear(C.BLACK);
    r.ditherRect(0, 150, W, 26, C.BLACK, C.BLUE, 6);
    r.hline(0, W - 1, 176, C.BLUE);
    for (let i = -12; i <= 12; i++) {
      r.line(W / 2 + i * 26, 176, W / 2 + i * 190, H, C.BLUE);
    }
    let y = 176;
    let step = 3;
    while (y < H) {
      r.hline(0, W - 1, Math.round(y), C.BLUE);
      y += step;
      step *= 1.35;
    }

    // 回っている紙飛行機
    const t = this.t;
    orientation(t * 34, Math.sin(t * 0.7) * 16, Math.sin(t * 0.5) * 22, this.m);
    drawMesh(r, this.titleCam, DART, Math.sin(t * 0.4) * 3, 3.4, 6 + Math.cos(t * 0.3) * 3,
      this.m, 4.4, C.LCYAN);
    orientation(-t * 21 + 60, 8, Math.sin(t * 0.4 + 1) * 26, this.m);
    drawMesh(r, this.titleCam, CONDOR, -14, -5.5, 24, this.m, 2.4, C.CYAN);
  }

  title(r, dt, input) {
    this.t += dt;
    this.drawTitleBackdrop(r);

    // タイトル
    const title = 'FLAKALT';
    r.textCenter(W / 2 + 2, 42, title, C.BLUE, 4);
    r.textCenter(W / 2, 40, title, C.LCYAN, 4);
    r.textCenter(W / 2, 76, 'ANTI-AIRCRAFT GUNNERY SIMULATOR', C.YELLOW);
    r.hline(140, 500, 90, C.CYAN);
    r.hline(140, 500, 92, C.CYAN);

    const box = centerBox(r, 260, 76, null, C.CYAN);
    this.mainMenu.draw(r, box.x + 24, box.y + 14, 16, 220);

    r.textCenter(W / 2, H - 42, 'ARROW KEYS TO SELECT  /  ENTER TO CONFIRM', C.DGRAY);
    r.textCenter(W / 2, H - 30, '(C) 1998 TENO MICROMOCHI SOFTWORKS   BUILD 0817', C.DGRAY);
    r.textCenter(W / 2, H - 18,
      'GUNS: ' + this.opts.nation +
      '   MISSION: ' + (this.opts.freeRange ? 'FREE RANGE' : this.opts.aid) +
      '   ENEMY: ' + this.opts.difficulty, C.DGRAY);

    const sel = this.mainMenu.handle(input, this.sfx);
    return sel ? sel.id : null;
  }

  /* --- 出撃前のモード選択 -------------------------------------- */

  modeSelect(r, dt, input) {
    this.t += dt;
    this.drawTitleBackdrop(r);
    const box = centerBox(r, 468, 292, 'MISSION SETUP', C.CYAN);
    const x = box.x + 22;
    r.text(x, box.y + 20, 'SELECT MISSION', C.LCYAN);
    r.hline(x, box.x + box.w - 22, box.y + 30, C.CYAN);

    const rows = [
      {
        head: 'EASY', c: C.LGREEN,
        lines: [
          'CAMPAIGN. THE LEAD POINT IS DRAWN ON THE DESIGNATED',
          'TARGET ON SCREEN WITHIN ' + this.opts.leadRange + ' METRES. AIM AT THE',
          'BOX:  ' + PLANE_GLYPH + ' - - - - []      Q TOGGLES IT IN FLIGHT',
        ],
      },
      {
        head: 'HARD', c: C.LRED,
        lines: [
          'CAMPAIGN. NO LEAD POINT AT ANY RANGE. THE PANEL STILL',
          'GIVES TIME OF FLIGHT AND THE LEAD IN MILS -- MEASURE',
          'IT AGAINST THE SIGHT RINGS AND JUDGE IT YOURSELF.',
        ],
      },
      {
        head: 'FREE RANGE', c: C.LCYAN,
        lines: [
          'FOR PRACTICE AND IDLING. NOTHING SHOOTS BACK -- THE',
          'PAPER PLANES JUST DRIFT NEARER AND FURTHER. TARGETS',
          'ARE REPLACED AS YOU DOWN THEM. AMMUNITION IS FREE.',
        ],
      },
    ];
    const cur = this.setupMenu.i;
    // 任務の選択はカーソル位置そのもの。カーソルが下の 2 行にいるときは
    // 直前に通った任務が選ばれたままになる
    const chosen = this.opts.freeRange ? 2 : (this.opts.aid === 'HARD' ? 1 : 0);

    let y = box.y + 38;
    for (let i = 0; i < rows.length; i++) {
      const sel = cur === i;
      const row = rows[i];
      if (sel) {
        r.fillRect(x - 10, y - 3, box.w - 24, 13, C.BLUE);
        r.text(x - 8, y, '►', C.YELLOW);
      } else if (chosen === i) {
        r.text(x - 8, y, '►', C.CYAN);
      }
      r.text(x + 6, y, row.head, sel ? C.WHITE : (chosen === i ? row.c : C.DGRAY));
      y += 14;
      for (const line of row.lines) {
        r.text(x + 18, y, line, sel ? C.LGRAY : C.DGRAY);
        y += 9;
      }
      y += 6;
    }

    // --- 兵装セット --------------------------------------------
    const nations = this.data.nations;
    const nIdx = Math.max(0, nations.findIndex((n) => n.id === this.opts.nation));
    y = this.pickerRow(r, x, y, box.w - 44, 'WEAPON SET',
      nations.map((n) => n.id), nIdx, cur === 3);
    r.text(x + 6, y, nations[nIdx].blurb || '', C.DGRAY);
    y += 14;

    // --- 難易度 ------------------------------------------------
    const dKeys = Object.keys(DIFFICULTY);
    const dIdx = Math.max(0, dKeys.indexOf(this.opts.difficulty));
    y = this.pickerRow(r, x, y, box.w - 44, 'DIFFICULTY', dKeys, dIdx, cur === 4);
    r.text(x + 6, y, 'ENEMY SPEED, JINK, ATTACK RUNS AND AMMO SUPPLY', C.DGRAY);

    r.text(x, box.y + box.h - 30, 'MOUNT DRIVE', C.CYAN);
    r.text(x + 78, box.y + box.h - 30, this.opts.realistic ? 'GEARED' : 'DIRECT', C.LGRAY);
    r.textRight(box.x + box.w - 22, box.y + box.h - 30,
      this.opts.mouseAim ? 'MOUSE AIM' : 'ARROW KEYS', C.LGRAY);
    r.textCenter(W / 2, box.y + box.h - 16,
      'UP/DOWN: SELECT   LEFT/RIGHT: CHANGE   ENTER: LAUNCH   ESC: BACK', C.YELLOW);

    if (input.pressed('Escape')) return 'back';

    const item = this.setupMenu.items[cur];
    if (item.toggle) {
      if (input.pressed('ArrowLeft')) { item.toggle(-1); this.sfx.beep(520, 0.03); }
      if (input.pressed('ArrowRight')) { item.toggle(1); this.sfx.beep(760, 0.03); }
    }

    const sel = this.setupMenu.handle(input, this.sfx);
    // カーソルが任務の行に乗ったら、その時点で任務が決まる。
    // FREE RANGE は「攻撃されない練習場」であって照準補助の段階ではないので、
    // 見越し点は EASY 相当（＝Q で入切できる状態）から始める
    const now = this.setupMenu.i;
    if (now < 3) {
      this.opts.freeRange = now === 2;
      this.opts.aid = now === 1 ? 'HARD' : 'EASY';
    }
    if (sel) return 'launch';
    return null;
  }

  /* 横並びの選択列。1 行の見出しと、その下に候補を等間隔で並べる。
     選ばれている候補を反転、行そのものにカーソルがあれば見出しを黄色にする。 */
  pickerRow(r, x, y, w, label, items, idx, rowSel) {
    if (rowSel) {
      r.fillRect(x - 10, y - 3, w + 22, 11, C.BLUE);
      r.text(x - 8, y, '►', C.YELLOW);
    }
    r.text(x + 6, y, label, rowSel ? C.WHITE : C.LCYAN);
    y += 12;
    const cell = w / items.length;
    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      const cx = Math.round(x + 6 + cell * (i + 0.5));
      const tw = r.textW(s);
      const tx = Math.round(cx - tw / 2);
      if (i === idx) {
        r.fillRect(tx - 3, y - 2, tw + 6, 11, rowSel ? C.CYAN : C.DGRAY);
        r.text(tx, y, s, rowSel ? C.BLACK : C.WHITE);
      } else {
        r.text(tx, y, s, C.DGRAY);
      }
    }
    return y + 13;
  }

  /* --- OPTIONS ------------------------------------------------ */

  options(r, dt, input, backdrop) {
    this.t += dt;
    if (backdrop) backdrop(); else this.drawTitleBackdrop(r);
    const box = centerBox(r, 380, 190, 'OPTIONS', C.CYAN);
    this.optMenu.draw(r, box.x + 24, box.y + 22, 16, 336);

    const m = this.optMenu.items[this.optMenu.i];
    const hintEn = {
      drive: 'GEARED = REAL TRAVERSE RATE LIMIT.  DIRECT = INSTANT',
      maim: 'OFF: THE MOUSE IS RELEASED AND ARROW KEYS LAY THE GUN',
      lead: 'HOW FAR OUT THE LEAD POINT IS STILL DRAWN (EASY ONLY)',
      sens: 'DEGREES OF TRAVERSE PER MOUSE PIXEL',
      crt: 'SCANLINES AND VIGNETTE',
      fullscr: 'FILLS THE SCREEN AT THE BEST INTEGER SCALE. ESC EXITS',
      snd: 'SYNTHESIZED SOUND EFFECTS',
      back: 'RETURN',
    }[m.id];
    r.textCenter(W / 2, box.y + box.h - 22, hintEn || '', C.DGRAY);

    if (input.pressed('ArrowLeft')) { m.toggle && m.toggle(-1); this.sfx.beep(520, 0.03); }
    if (input.pressed('ArrowRight')) { m.toggle && m.toggle(1); this.sfx.beep(760, 0.03); }
    if (input.pressed('Escape')) return 'back';

    const sel = this.optMenu.handle(input, this.sfx);
    if (sel) {
      if (sel.id === 'back') return 'back';
      if (sel.toggle) sel.toggle(1);
    }
    return null;
  }

  /* --- CONTROLS ----------------------------------------------- */

  help(r, dt, input) {
    this.t += dt;
    this.drawTitleBackdrop(r);
    if (this.helpPage === 0) this.helpControls(r);
    else this.helpThreat(r);

    r.textCenter(W / 2, H - 24, this.helpPage === 0 ? 'PAGE 1/2 -- CONTROLS' : 'PAGE 2/2 -- THE THREAT', C.DGRAY);
    r.textCenter(W / 2, H - 14, 'LEFT/RIGHT: PAGE   ENTER OR ESC: RETURN', C.YELLOW);

    if (input.pressed('ArrowLeft') || input.pressed('ArrowRight')) {
      this.helpPage = 1 - this.helpPage;
      this.sfx.beep(660, 0.03);
    }
    if (input.pressed('Enter') || input.pressed('Escape') || input.pressed('Space')) {
      this.sfx.beep(1040, 0.05);
      return 'back';
    }
    return null;
  }

  /* --- CONTROLS ページ ----------------------------------------- */

  helpControls(r) {
    const box = centerBox(r, 500, 356, 'CONTROLS & DOCTRINE', C.CYAN);
    const x = box.x + 18;
    let y = box.y + 16;
    const line = (a, b, ca = C.YELLOW, cb = C.LGRAY) => {
      r.text(x, y, a, ca); r.text(x + 132, y, b, cb); y += 10;
    };
    line('MOUSE', 'TRAVERSE AND ELEVATE THE MOUNT');
    line('ARROW KEYS', 'LAY THE MOUNT TOO -- SOLE CONTROL IF MOUSE AIM IS OFF');
    line('LEFT BUTTON / SPACE', 'FIRE');
    line('RIGHT BUTTON / Z', 'TELESCOPIC SIGHT -- HOLD TO LOOK THROUGH IT');
    line('WHEEL / W / S', 'ZOOM MAGNIFICATION X2-X8 WHILE ZOOMED (REMEMBERED)');
    line('1 / 2 / 3 / 4 / WHEEL', 'SELECT ARMAMENT (WHEEL ONLY WHEN NOT ZOOMED)');
    line('R', 'RELOAD');
    line('TAB', 'LOCK CONTACT IN RETICLE / RELEASE ON EMPTY SKY');
    line('Q', 'LEAD POINT ON / OFF (EASY & FREE RANGE) -- RANGE IN OPTIONS');
    line('P / ESC', 'PAUSE');
    line('M', 'MUTE');
    line('F', 'TOGGLE FULLSCREEN');
    y += 3;
    r.hline(x, box.x + box.w - 18, y, C.CYAN); y += 7;
    r.text(x, y, 'DEFLECTION SHOOTING', C.LCYAN); y += 11;
    const doc = [
      'ROUNDS ARE NOT INSTANT. A 12.7MM ROUND NEEDS ABOUT 1.5',
      'SECONDS TO REACH 1000 METRES, AND IT KEEPS SLOWING DOWN.',
      'A TARGET CROSSING AT 90 M/S TRAVELS OVER 130 METRES IN',
      'THAT TIME. AIM WHERE IT WILL BE, NOT WHERE IT IS.',
      '',
      'THE PANEL SHOWS TIME OF FLIGHT (TOF) AND THE REQUIRED',
      'LEAD IN MILS. THE SIGHT RINGS ARE GRADUATED IN MILS, SO',
      'YOU CAN MEASURE THE LEAD AGAINST THEM. IN EASY MODE THE',
      'LEAD POINT IS ALSO DRAWN:   ' + PLANE_GLYPH + ' - - - - []',
      '',
      'IF THE LEAD POINT FALLS INSIDE THE VIEW BUT THE CONTACT',
      'DOES NOT, THE BOX STAYS AND THE DASHES RUN TO THE EDGE.',
      'A LOCKED CONTACT OFF SCREEN GETS ITS OWN ARROW AT THE',
      'EDGE WITH ITS RANGE, SO YOU NEVER LOSE IT WHILE ZOOMED.',
      '',
      'WITH GEARED DRIVE THE MOUNT CANNOT SNAP ONTO A TARGET.',
      'THE GREY CROSS IS WHERE YOU ARE COMMANDING; THE SIGHT IS',
      'WHERE THE BARRELS ACTUALLY POINT. LEAD THE MOUNT TOO.',
    ];
    for (const d of doc) { r.text(x, y, d, C.LGRAY); y += 9; }
  }

  /* --- THE THREAT ページ ----------------------------------------- */

  helpThreat(r) {
    const box = centerBox(r, 500, 356, 'THE THREAT', C.CYAN);
    const x = box.x + 18;
    let y = box.y + 18;
    const head = (t) => { r.text(x, y, t, C.LCYAN); y += 11; };
    const doc = (lines) => { for (const d of lines) { r.text(x, y, d, C.LGRAY); y += 9; } y += 9; };

    head('LOW ALTITUDE  --  220-1000M  --  DART / LANCE / WEDGE');
    doc([
      'THESE JINK AND DIVE ON THE POST, DROP THEIR LOAD AT CLOSE',
      'RANGE, THEN BREAK AWAY. LANCE IS FAST BUT TURNS POORLY --',
      'ONCE IT OVERSHOOTS A RUN IT TAKES A WHILE TO LINE UP AGAIN.',
    ]);

    head('HIGH ALTITUDE  --  1200-1900M  --  CRANE / CONDOR');
    doc([
      'THE TWIN-ENGINE CRANE AND FOUR-ENGINE CONDOR FLY STRAIGHT',
      'OVER THE POST WITHOUT JINKING AND RELEASE AT THEIR CLOSEST',
      'POINT. ONLY A GUN WITH THE REACH TO MATCH WILL CATCH THEM',
      'IN TIME -- CHECK YOUR HEAVY GUN\'S FUZE RANGE AGAINST THE',
      'TARGET\'S ALTITUDE BEFORE THE WAVE ARRIVES.',
    ]);

    head('PRISM  --  BONUS CONTACT');
    doc([
      'A RAINBOW-COLOURED CONTACT THAT NEVER ATTACKS. DOWN IT FOR',
      '+25% POST INTEGRITY. IT LEAVES AFTER 25 SECONDS, SO DECIDE',
      'QUICKLY WHETHER IT IS WORTH THE DIVERSION.',
    ]);

    head('ORDNANCE');
    doc([
      'THE HEAVY GUNS FIRE TIME-FUZED SHELLS. THE FUZE IS SET',
      'FROM THE DESIGNATED TARGET, SO THE SHELL BURSTS AT THAT',
      'RANGE WHEREVER THE BARREL POINTS. NO TARGET DESIGNATED',
      'MEANS NO FUZE, AND THE ROUND SIMPLY FLIES ON.',
    ]);

    r.text(x, y, 'THE WEAPON SET IS PICKED IN MISSION SETUP. EACH NATION', C.LGRAY); y += 9;
    r.text(x, y, 'FIGHTS DIFFERENTLY: MAGAZINE SIZE, RATE OF FIRE AND HOW', C.LGRAY); y += 9;
    r.text(x, y, 'FAST THE MOUNT TRAVERSES ALL CHANGE WITH IT.', C.LGRAY);
  }

  /* --- PAUSE -------------------------------------------------- */

  pause(r, dt, input) {
    const box = centerBox(r, 240, 92, 'PAUSED', C.YELLOW);
    this.pauseMenu.draw(r, box.x + 26, box.y + 22, 16, 190);
    if (input.pressed('Escape') || input.pressed('KeyP')) return 'resume';
    const sel = this.pauseMenu.handle(input, this.sfx);
    return sel ? sel.id : null;
  }

  /* --- 戦績 --------------------------------------------------- */

  gameover(r, dt, input, g) {
    const box = centerBox(r, 400, 210, 'AFTER ACTION REPORT', C.LRED);
    const x = box.x + 30;
    let y = box.y + 24;
    r.textCenter(W / 2, y, '*** BATTERY DESTROYED ***', C.LRED); y += 20;

    const row = (a, b, cb = C.WHITE) => {
      r.text(x, y, a, C.CYAN);
      r.textRight(box.x + box.w - 30, y, b, cb);
      y += 11;
    };
    const acc = g.shots > 0 ? (g.hits / g.shots) * 100 : 0;
    row('WAVES SURVIVED', String(Math.max(0, g.wave - 1)));
    row('AIRCRAFT DESTROYED', String(g.kills), C.LGREEN);
    row('ROUNDS FIRED', String(g.shots));
    row('ROUNDS ON TARGET', String(g.hits));
    row('ACCURACY', acc.toFixed(1) + ' %', acc > 8 ? C.LGREEN : C.YELLOW);
    row('ROUNDS PER KILL', g.kills ? (g.shots / g.kills).toFixed(1) : '---');
    row('TIME IN ACTION', Math.floor(g.elapsed / 60) + 'M ' +
      String(Math.floor(g.elapsed % 60)).padStart(2, '0') + 'S');
    y += 6;
    r.hline(x, box.x + box.w - 30, y, C.LRED); y += 8;
    r.text(x, y, 'FINAL SCORE', C.YELLOW);
    r.textRight(box.x + box.w - 30, y, String(g.score), C.WHITE);
    y += 18;
    r.textCenter(W / 2, y, this.rank(g), C.LCYAN);

    r.textCenter(W / 2, box.y + box.h - 16,
      Math.floor(this.t * 2) % 2 ? 'ENTER: FIGHT AGAIN    ESC: TITLE' : '', C.YELLOW);
    this.t += dt;

    if (input.pressed('Enter') || input.pressed('Space')) return 'restart';
    if (input.pressed('Escape')) return 'title';
    return null;
  }

  rank(g) {
    const acc = g.shots > 0 ? (g.hits / g.shots) * 100 : 0;
    if (g.kills >= 40 && acc > 10) return 'RATING: ACE OF THE BATTERY';
    if (g.kills >= 24) return 'RATING: MASTER GUNNER';
    if (g.kills >= 12) return 'RATING: GUNNER, FIRST CLASS';
    if (g.kills >= 5) return 'RATING: GUNNER';
    return 'RATING: LOADER';
  }

  /* --- ウェーブ間の帯 ----------------------------------------- */

  banner(r, g) {
    if (g.state === 'BRIEF') {
      if (g.freeRange) {
        const box = centerBox(r, 340, 60, null, C.LCYAN);
        r.textCenter(W / 2, box.y + 14, 'FREE RANGE', C.LCYAN, 2);
        r.textCenter(W / 2, box.y + 36, 'RELEASING TARGETS -- TAKE YOUR TIME', C.LGRAY);
      } else {
        const box = centerBox(r, 300, 60, null, C.CYAN);
        r.textCenter(W / 2, box.y + 14, 'STAND BY', C.YELLOW, 2);
        r.textCenter(W / 2, box.y + 36, 'RADAR CONTACT EXPECTED', C.LGRAY);
      }
    } else if (g.state === 'REARM') {
      const box = centerBox(r, 320, 74, null, C.LGREEN);
      r.textCenter(W / 2, box.y + 10, 'WAVE ' + g.wave + ' CLEAR', C.LGREEN, 2);
      r.textCenter(W / 2, box.y + 34, 'REARMING -- ALL MAGAZINES REPLENISHED', C.LGRAY);
      const left = Math.max(0, 8 - g.stateT);
      r.textCenter(W / 2, box.y + 48, 'NEXT WAVE IN ' + left.toFixed(1) + ' S', C.YELLOW);
      const bw = 260;
      r.rect(W / 2 - bw / 2, box.y + 60, bw, 6, C.DGRAY);
      r.fillRect(W / 2 - bw / 2 + 1, box.y + 61, Math.round((bw - 2) * (1 - left / 8)), 4, C.LGREEN);
    }
  }
}
