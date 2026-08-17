/* ============================================================
   FLAKALT — screens.js
   起動画面・タイトル・オプション・ポーズ・戦績。

   起動画面に出る弾道定数は飾りではなく、実際に ballistics.js が使う
   k の値をその場で計算して出している。data/guns.json をいじると
   ここの表示も変わる。
   ============================================================ */

import { C } from './palette.js';
import { Camera, orientation, clamp } from './camera.js';
import { DART, GLIDER, drawMesh } from './models.js';
import { dragFactor } from './ballistics.js';
import { DIFFICULTY } from './game.js';
import { LEAD_AID_RANGE } from './hud.js';

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
  constructor(sfx, opts, gunSpecs, fsCtl) {
    this.sfx = sfx;
    this.opts = opts;
    this.gunSpecs = gunSpecs;
    this.fsCtl = fsCtl; // { isActive(), toggle() } — main.js 側の Fullscreen API 窓口
    this.t = 0;

    this.bootLines = this.makeBootLines();
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

    this.modeMenu = new Menu([
      { id: 'EASY', label: 'EASY' },
      { id: 'HARD', label: 'HARD' },
    ]);
    this.modeMenu.i = opts.aid === 'HARD' ? 1 : 0;

    this.optMenu = new Menu([
      {
        id: 'drive', label: 'MOUNT DRIVE',
        value: () => (opts.realistic ? 'GEARED' : 'DIRECT'),
        toggle: () => { opts.realistic = !opts.realistic; },
      },
      {
        id: 'diff', label: 'DIFFICULTY',
        value: () => opts.difficulty,
        toggle: (d) => {
          const keys = Object.keys(DIFFICULTY);
          const i = keys.indexOf(opts.difficulty);
          opts.difficulty = keys[(i + (d || 1) + keys.length) % keys.length];
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

  makeBootLines() {
    const L = [];
    L.push(['TENO MICROMOCHI SOFTWORKS  BIOS  V2.14', C.LGRAY]);
    L.push(['(C) 1998  ALL RIGHTS RESERVED', C.DGRAY]);
    L.push(['', C.BLACK]);
    L.push(['CPU  : 486DX2/66   FPU PRESENT', C.LGRAY]);
    L.push(['MEM  : 8192K EXTENDED ............ OK', C.LGRAY]);
    L.push(['VIDEO: VGA 640X400 16 COLOR ...... OK', C.LGRAY]);
    L.push(['INPUT: MOUSE (2 BUTTON) .......... OK', C.LGRAY]);
    L.push(['AUDIO: PC SPEAKER / SYNTH ........ OK', C.LGRAY]);
    L.push(['', C.BLACK]);
    L.push(['LOADING FLAKALT.EXE', C.WHITE]);
    L.push(['MOUNTING EXTERIOR BALLISTIC TABLES', C.CYAN]);
    for (const g of this.gunSpecs) {
      const k = dragFactor(g.caliber, g.projectileMass, g.dragCd);
      const name = (g.caliber.toFixed(1) + 'MM').padEnd(7);
      L.push(['  ' + name + 'V0 ' + String(g.muzzleVelocity).padStart(3) +
        ' M/S   K ' + k.toExponential(2).toUpperCase() + '   OK', C.LGREEN]);
    }
    L.push(['', C.BLACK]);
    L.push(['ALL SYSTEMS NOMINAL', C.LGREEN]);
    L.push(['', C.BLACK]);
    return L;
  }

  /* --- BOOT --------------------------------------------------- */

  boot(r, dt, input) {
    this.bootT += dt;
    r.clear(C.BLACK);
    const shown = Math.min(this.bootLines.length, Math.floor(this.bootT / 0.11));
    for (let i = 0; i < shown; i++) {
      const [text, c] = this.bootLines[i];
      r.text(16, 16 + i * 9, text, c);
    }
    const done = shown >= this.bootLines.length;
    if (done) {
      const y = 16 + this.bootLines.length * 9;
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
    drawMesh(r, this.titleCam, GLIDER, -14, -5.5, 24, this.m, 3.2, C.CYAN);
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
      'MOUNT: ' + (this.opts.realistic ? 'GEARED' : 'DIRECT') +
      '   AID: ' + this.opts.aid +
      '   ENEMY: ' + this.opts.difficulty, C.DGRAY);

    const sel = this.mainMenu.handle(input, this.sfx);
    return sel ? sel.id : null;
  }

  /* --- 出撃前のモード選択 -------------------------------------- */

  modeSelect(r, dt, input) {
    this.t += dt;
    this.drawTitleBackdrop(r);
    const box = centerBox(r, 430, 196, 'MISSION SETUP', C.CYAN);
    const x = box.x + 22;
    r.text(x, box.y + 20, 'GUNNERY AID', C.LCYAN);
    r.hline(x, box.x + box.w - 22, box.y + 30, C.CYAN);

    const rows = [
      {
        head: 'EASY', c: C.LGREEN,
        lines: [
          'THE LEAD POINT IS DRAWN ON THE DESIGNATED TARGET',
          'WHILE IT IS ON SCREEN AND WITHIN ' + LEAD_AID_RANGE + ' METRES.',
          'AIM AT THE BOX:   ' + PLANE_GLYPH + ' - - - - []',
        ],
      },
      {
        head: 'HARD', c: C.LRED,
        lines: [
          'NO LEAD POINT AT ANY RANGE. THE PANEL STILL GIVES',
          'TIME OF FLIGHT AND THE LEAD IN MILS -- MEASURE IT',
          'AGAINST THE SIGHT RINGS AND JUDGE IT YOURSELF.',
        ],
      },
    ];
    let y = box.y + 38;
    for (let i = 0; i < rows.length; i++) {
      const sel = this.modeMenu.i === i;
      const row = rows[i];
      if (sel) {
        r.fillRect(x - 10, y - 3, box.w - 24, 13, C.BLUE);
        r.text(x - 8, y, '►', C.YELLOW);
      }
      r.text(x + 6, y, row.head, sel ? C.WHITE : row.c);
      y += 14;
      for (const line of row.lines) {
        r.text(x + 18, y, line, sel ? C.LGRAY : C.DGRAY);
        y += 9;
      }
      y += 8;
    }

    r.text(x, box.y + box.h - 30, 'MOUNT DRIVE', C.CYAN);
    r.text(x + 78, box.y + box.h - 30, this.opts.realistic ? 'GEARED' : 'DIRECT', C.LGRAY);
    r.textRight(box.x + box.w - 22, box.y + box.h - 30, 'ENEMY  ' + this.opts.difficulty, C.LGRAY);
    r.textCenter(W / 2, box.y + box.h - 16, 'ENTER: LAUNCH    ESC: BACK', C.YELLOW);

    if (input.pressed('Escape')) return 'back';
    const sel = this.modeMenu.handle(input, this.sfx);
    if (sel) {
      this.opts.aid = sel.id;
      return 'launch';
    }
    return null;
  }

  /* --- OPTIONS ------------------------------------------------ */

  options(r, dt, input, backdrop) {
    this.t += dt;
    if (backdrop) backdrop(); else this.drawTitleBackdrop(r);
    const box = centerBox(r, 380, 172, 'OPTIONS', C.CYAN);
    this.optMenu.draw(r, box.x + 24, box.y + 22, 16, 336);

    const m = this.optMenu.items[this.optMenu.i];
    const hintEn = {
      drive: 'GEARED = REAL TRAVERSE RATE LIMIT.  DIRECT = INSTANT',
      diff: 'ENEMY SPEED, JINK, ATTACK RUNS AND AMMO SUPPLY',
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
    const box = centerBox(r, 500, 348, 'CONTROLS & DOCTRINE', C.CYAN);
    const x = box.x + 18;
    let y = box.y + 18;
    const line = (a, b, ca = C.YELLOW, cb = C.LGRAY) => {
      r.text(x, y, a, ca); r.text(x + 132, y, b, cb); y += 10;
    };
    line('MOUSE', 'TRAVERSE AND ELEVATE THE MOUNT');
    line('LEFT BUTTON / SPACE', 'FIRE');
    line('RIGHT BUTTON / Z', 'TELESCOPIC SIGHT (ZOOM)');
    line('1 / 2 / 3 / 4 / WHEEL', 'SELECT ARMAMENT');
    line('R', 'RELOAD');
    line('TAB', 'CYCLE DESIGNATED TARGET');
    line('P / ESC', 'PAUSE');
    line('M', 'MUTE');
    line('F', 'TOGGLE FULLSCREEN');
    y += 4;
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
      'WITH GEARED DRIVE THE MOUNT CANNOT SNAP ONTO A TARGET.',
      'THE GREY CROSS IS WHERE YOU ARE COMMANDING; THE SIGHT IS',
      'WHERE THE BARRELS ACTUALLY POINT. LEAD THE MOUNT TOO.',
      '',
      'THE 40MM BOFORS FIRES A TIME-FUZED SHELL AT 120 ROUNDS',
      'PER MINUTE (2 PER SECOND). THE FUZE IS SET FROM THE',
      'DESIGNATED TARGET, SO IT BURSTS AT THAT RANGE WHEREVER',
      'THE BARREL POINTS. NO TARGET DESIGNATED MEANS NO FUZE.',
    ];
    for (const d of doc) { r.text(x, y, d, C.LGRAY); y += 9; }

    r.textCenter(W / 2, box.y + box.h - 14, 'PRESS ENTER OR ESC TO RETURN', C.YELLOW);
    if (input.pressed('Enter') || input.pressed('Escape') || input.pressed('Space')) {
      this.sfx.beep(1040, 0.05);
      return 'back';
    }
    return null;
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
      const box = centerBox(r, 300, 60, null, C.CYAN);
      r.textCenter(W / 2, box.y + 14, 'STAND BY', C.YELLOW, 2);
      r.textCenter(W / 2, box.y + 36, 'RADAR CONTACT EXPECTED', C.LGRAY);
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
