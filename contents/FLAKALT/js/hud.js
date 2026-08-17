/* ============================================================
   FLAKALT — hud.js
   照準器と計器盤。

   照準環はピクセルではなくミル（mrad）で定義してある。焦点距離から
   逆算して描いているので、望遠に切り替えると環も一緒に拡大される。
   つまり画面上の目盛りが常に実際の角度と一致する。

   砲架が指令方向に追いつくまでの遅れは、砲身の向き（＝視点）と
   指令方向を別々に出して見せている。この 2 つのズレが見えないと
   旋回速度の制限がただの理不尽になってしまう。
   ============================================================ */

import { C } from './palette.js';
import { clamp, wrapDeg, DEG, RAD } from './camera.js';

export const VIEW = { x: 0, y: 0, w: 640, h: 320 };
export const PANEL_Y = 320;

/* EASY で見越し点を出す上限距離。これより遠い目標は自分で見積もる */
export const LEAD_AID_RANGE = 2000;

const _p = { x: 0, y: 0, z: 0 };
const _p2 = { x: 0, y: 0, z: 0 };

/* --- 小物 ------------------------------------------------------ */

function bar(r, x, y, w, h, frac, cf, ce = C.BLACK) {
  r.rect(x, y, w, h, C.DGRAY);
  const iw = Math.round((w - 2) * clamp(frac, 0, 1));
  if (iw > 0) r.fillRect(x + 1, y + 1, iw, h - 2, cf);
  if (iw < w - 2) r.fillRect(x + 1 + iw, y + 1, w - 2 - iw, h - 2, ce);
}

function pad(n, w, ch = '0') {
  const s = String(Math.max(0, Math.round(n)));
  return s.length >= w ? s : ch.repeat(w - s.length) + s;
}

function fixed(n, d) {
  return (isFinite(n) ? n : 0).toFixed(d);
}

function mmss(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return pad(m, 2) + ':' + pad(s, 2);
}

/* --- 照準環 ---------------------------------------------------- */

function mil(cam, m) { return (m / 1000) * cam.focal; }

function tickCross(r, x, y, len, c) {
  r.hline(x - len, x - 2, y, c);
  r.hline(x + 2, x + len, y, c);
  r.vline(x, y - len, y - 2, c);
  r.vline(x, y + 2, y + len, c);
}

function drawSight(r, cam, gun, t) {
  const cx = Math.round(cam.ccx), cy = Math.round(cam.ccy);
  const col = C.LGREEN;

  if (gun.sight === 'ring') {
    // 環と照星。いちばん素朴な対空照準器
    r.circle(cx, cy, mil(cam, 70), col);
    r.circle(cx, cy, mil(cam, 28), col);
    for (let a = 0; a < 4; a++) {
      const ang = a * 90 * DEG;
      const s = Math.sin(ang), c = Math.cos(ang);
      const r0 = mil(cam, 70), r1 = mil(cam, 86);
      r.line(cx + s * r0, cy - c * r0, cx + s * r1, cy - c * r1, col);
    }
    tickCross(r, cx, cy, 5, C.WHITE);
    r.px(cx, cy, C.WHITE);
  } else if (gun.sight === 'mil') {
    // ミル環。20/40/60/80 mrad
    for (const m of [20, 40, 60, 80]) {
      r.circle(cx, cy, mil(cam, m), m === 40 ? col : C.GREEN);
    }
    // 水平の目盛り（10 mrad ごと）
    for (let m = -80; m <= 80; m += 10) {
      if (m === 0) continue;
      const x = cx + mil(cam, m);
      const h = (m % 40 === 0) ? 5 : 2;
      r.vline(x, cy - h, cy + h, col);
    }
    r.hline(cx - mil(cam, 86), cx + mil(cam, 86), cy, C.GREEN);
    tickCross(r, cx, cy, 4, C.WHITE);
  } else if (gun.sight === 'flak') {
    // 高射砲の方向照準。中央の枠に目標を入れて、距離は信管が受け持つ
    const s = Math.round(mil(cam, 12));
    r.rect(cx - s, cy - s, s * 2 + 1, s * 2 + 1, col);
    const arm = mil(cam, 108);
    r.hline(cx - arm, cx - s - 4, cy, col);
    r.hline(cx + s + 4, cx + arm, cy, col);
    r.vline(cx, cy - arm, cy - s - 4, col);
    r.vline(cx, cy + s + 4, cy + arm, col);
    for (let m = 20; m <= 100; m += 20) {
      const d = mil(cam, m), h = (m % 40 === 0) ? 6 : 3;
      r.vline(cx - d, cy - h, cy + h, C.GREEN);
      r.vline(cx + d, cy - h, cy + h, C.GREEN);
      r.hline(cx - h, cx + h, cy - d, C.GREEN);
      r.hline(cx - h, cx + h, cy + d, C.GREEN);
    }
    const b = mil(cam, 76);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      r.hline(cx + sx * b, cx + sx * (b - 11), cy + sy * b, C.GREEN);
      r.vline(cx + sx * b, cy + sy * b, cy + sy * (b - 11), C.GREEN);
    }
    r.px(cx, cy, C.WHITE);
  } else {
    // 望遠照準。視野環 + 落下量の目盛り
    const rr = mil(cam, 95);
    for (let i = 0; i < 72; i++) {
      if (i % 3 === 0) continue;
      const a0 = (i / 72) * 6.2832, a1 = ((i + 0.9) / 72) * 6.2832;
      r.line(cx + Math.sin(a0) * rr, cy - Math.cos(a0) * rr,
        cx + Math.sin(a1) * rr, cy - Math.cos(a1) * rr, C.GREEN);
    }
    r.circle(cx, cy, mil(cam, 18), col);
    r.hline(cx - mil(cam, 95), cx - mil(cam, 18), cy, col);
    r.hline(cx + mil(cam, 18), cx + mil(cam, 95), cy, col);
    r.vline(cx, cy - mil(cam, 95), cy - mil(cam, 18), col);
    for (let m = 10; m <= 60; m += 10) {
      const y = cy + mil(cam, m);
      const w = (m % 20 === 0) ? 7 : 3;
      r.hline(cx - w, cx + w, y, col);
      if (m % 20 === 0) r.text(cx + 11, y - 3, String(m / 10), C.GREEN);
    }
    for (let m = 20; m <= 80; m += 20) {
      r.vline(cx - mil(cam, m), cy - 4, cy + 4, C.GREEN);
      r.vline(cx + mil(cam, m), cy - 4, cy + 4, C.GREEN);
    }
    r.px(cx, cy, C.WHITE);
  }

  // 過熱すると照準環が赤く点滅する
  if (gun.overheated && Math.floor(t * 6) % 2 === 0) {
    r.circle(cx, cy, mil(cam, 100), C.LRED);
  }
}

/* --- 砲身 ------------------------------------------------------ */

const BARREL_SETS = {
  // [muzzleX, baseX, 太さ]
  ring: [[-64, -168, 3], [-24, -58, 3], [24, 58, 3], [64, 168, 3]],
  mil: [[-30, -84, 5], [30, 84, 5]],
  scope: [[-22, -58, 7], [22, 58, 7]],
  flak: [[0, 0, 10]],
};
const MUZZLE_Y = { ring: 92, mil: 92, scope: 96, flak: 100 };

function drawBarrels(r, cam, gun, t) {
  const set = BARREL_SETS[gun.sight] || BARREL_SETS.mil;
  const bottom = VIEW.y + VIEW.h;
  // 後座量は反動の大きさに比例させる。反動 recoil が大きい砲ほどごっそり下がる
  const recoil = gun.recoilT * (4 + gun.recoil * 1.8);
  const muzzleY = Math.round(cam.ccy + (MUZZLE_Y[gun.sight] || 92) + recoil);
  const baseY = bottom + 6 + recoil;
  const cx = Math.round(cam.ccx);
  if (muzzleY > bottom - 4) return;

  for (const [mx, bx, w] of set) {
    const x0 = cx + mx, x1 = cx + bx;
    r.line(x0 - w, muzzleY, x1 - w * 2.4, baseY, C.LGRAY);
    r.line(x0 + w, muzzleY, x1 + w * 2.4, baseY, C.LGRAY);
    r.hline(x0 - w, x0 + w, muzzleY, C.WHITE);
    // 大口径にはマズルブレーキを付ける
    if (w >= 10) {
      r.rect(x0 - w - 3, muzzleY, w * 2 + 7, 9, C.LGRAY);
      r.vline(x0 - w + 4, muzzleY + 2, muzzleY + 7, C.DGRAY);
      r.vline(x0 + w - 4, muzzleY + 2, muzzleY + 7, C.DGRAY);
    }
    // 冷却ジャケットの帯
    for (let i = 1; i <= 5; i++) {
      const f = i / 6;
      const y = Math.round(muzzleY + (baseY - muzzleY) * f);
      const ww = w + (w * 1.4) * f;
      r.hline(x0 - ww, x0 + ww, y, C.DGRAY);
    }
  }

  // 銃口炎
  if (gun.flashT > 0) {
    const i = gun.flashBarrel % set.length;
    const [mx, , w] = set[i];
    const x = cx + mx, y = muzzleY - 1;
    const s = 5 + w * 2.2;
    r.discDither(x, y, s * 0.55, C.YELLOW, C.WHITE, 9);
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * 6.2832 + t * 3;
      r.line(x, y, x + Math.sin(ang) * s * 1.9, y - Math.cos(ang) * s * 1.2,
        a % 2 ? C.YELLOW : C.WHITE);
    }
  }
}

/* --- 方位帯と仰角尺 -------------------------------------------- */

function drawCompass(r, cam) {
  const y = VIEW.y + 13;
  r.hline(VIEW.x, VIEW.x + VIEW.w - 1, y + 9, C.DGRAY);
  for (let b = 0; b < 360; b += 5) {
    const d = wrapDeg(b - cam.yaw);
    if (Math.abs(d) > 70) continue;
    const x = Math.round(cam.ccx + Math.tan(d * DEG) * cam.focal);
    if (x < VIEW.x + 2 || x > VIEW.x + VIEW.w - 2) continue;
    if (b % 45 === 0) {
      r.vline(x, y + 3, y + 9, C.LCYAN);
      const label = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[b] || pad(Math.floor(b / 10), 2);
      r.textCenter(x, y - 6, label, b % 90 === 0 ? C.WHITE : C.CYAN);
    } else {
      r.vline(x, y + 6, y + 9, C.CYAN);
    }
  }
  // 現在の方位
  const bx = Math.round(cam.ccx);
  r.line(bx, y + 11, bx - 3, y + 15, C.YELLOW);
  r.line(bx, y + 11, bx + 3, y + 15, C.YELLOW);
  r.line(bx - 3, y + 15, bx + 3, y + 15, C.YELLOW);
  const hdg = (Math.round(cam.yaw) + 360) % 360;
  r.textCenter(bx, y + 17, pad(hdg, 3), C.YELLOW);
}

function drawElevScale(r, cam) {
  const x = VIEW.x + 24;
  for (let e = 0; e <= 90; e += 5) {
    const d = e - cam.pitch;
    if (Math.abs(d) > 40) continue;
    const y = Math.round(cam.ccy - Math.tan(d * DEG) * cam.focal);
    if (y < VIEW.y + 26 || y > VIEW.y + VIEW.h - 30) continue;
    if (e % 15 === 0) {
      r.hline(x, x + 10, y, C.CYAN);
      r.text(x + 13, y - 3, pad(e, 2), C.CYAN);
    } else {
      r.hline(x + 4, x + 10, y, C.GREEN);
    }
  }
  const cy = Math.round(cam.ccy);
  r.line(x + 12, cy, x + 6, cy - 3, C.YELLOW);
  r.line(x + 12, cy, x + 6, cy + 3, C.YELLOW);
  r.line(x + 6, cy - 3, x + 6, cy + 3, C.YELLOW);
}

/* --- 目標表示 -------------------------------------------------- */

/* 矢じり付きの線。進行方向の表示に使う。 */
function arrow(r, x0, y0, ux, uy, len, c) {
  const x1 = Math.round(x0 + ux * len), y1 = Math.round(y0 + uy * len);
  r.line(x0, y0, x1, y1, c);
  const a = Math.atan2(uy, ux);
  for (const s of [-1, 1]) {
    const b = a + s * 2.55;
    r.line(x1, y1, x1 + Math.cos(b) * 6, y1 + Math.sin(b) * 6, c);
  }
}

function drawTargetBox(r, cam, ac, sol, showLead) {
  const q = cam.project(ac.x, ac.y, ac.z, _p);
  if (!q) return;
  // 画面の中に捉えているときだけ表示する
  if (q.x < VIEW.x + 2 || q.x > VIEW.x + VIEW.w - 3) return;
  if (q.y < VIEW.y + 24 || q.y > VIEW.y + VIEW.h - 3) return;

  const px = Math.round(q.x), py = Math.round(q.y);
  // 画面上での見かけの大きさに枠を合わせる
  const h = Math.round(clamp((ac.hitR * 1.9 * cam.focal) / q.z, 7, 60));
  const c = C.YELLOW;
  const L = Math.max(3, Math.round(h * 0.35));
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = px + sx * h, y = py + sy * h;
    r.hline(x, x - sx * L, y, c);
    r.vline(x, y, y - sy * L, c);
  }
  r.text(px + h + 3, py - h - 1, ac.tag, c);
  r.text(px + h + 3, py - h + 7, pad(ac.slant, 4) + 'M', C.LGREEN);

  /* 進行方向。長さは固定なので「どっちへ飛んでいるか」しか教えない。
     遠距離だと機体が数ドットになって機首の向きが読めなくなるため。 */
  const ahead = cam.project(ac.x + ac.vx, ac.y + ac.vy, ac.z + ac.vz, _p2);
  let ux = 0, uy = 0, hasDir = false;
  if (ahead) {
    ux = ahead.x - q.x; uy = ahead.y - q.y;
    const m = Math.hypot(ux, uy);
    if (m > 0.4) {
      ux /= m; uy /= m; hasDir = true;
      arrow(r, px + ux * (h + 3), py + uy * (h + 3), ux, uy, 13, C.LCYAN);
    }
  }

  /* 見越し点。EASY のときだけ、規定距離以内で出す。
     目標 ✈ - - - - □ 照準点 という並びになる。 */
  if (showLead && sol && ac.slant <= LEAD_AID_RANGE) {
    const f = cam.project(sol.x, sol.y, sol.z, _p2);
    if (f) {
      const fx = Math.round(f.x), fy = Math.round(f.y);
      const dist = Math.hypot(fx - px, fy - py);
      if (dist > h + 6) {
        // 枠の縁から照準点の手前までを破線で繋ぐ
        const nx = (fx - px) / dist, ny = (fy - py) / dist;
        r.lineDash(px + nx * (h + 2), py + ny * (h + 2),
          fx - nx * 8, fy - ny * 8, C.MAGENTA, 2, 4);
      }
      r.rect(fx - 6, fy - 6, 13, 13, C.LMAGENTA);
      r.rect(fx - 1, fy - 1, 3, 3, C.WHITE);
      r.text(fx + 10, fy - 3, 'AIM', C.LMAGENTA);
    }
  } else if (showLead && hasDir) {
    // 射程外で見越し点を出せないことを明示する
    r.text(px + h + 3, py - h + 15, 'NO AID', C.DGRAY);
  }
}

/* 砲身が追いついていない方向を出す。ここが今マウスの向いている先。 */
function drawCommandMark(r, cam, mount) {
  const lag = mount.lagDeg();
  if (lag < 0.15) return;
  const cy = Math.cos(mount.cmdPitch * DEG);
  const d = 900;
  const wx = cam.x + Math.sin(mount.cmdYaw * DEG) * cy * d;
  const wy = cam.y + Math.sin(mount.cmdPitch * DEG) * d;
  const wz = cam.z + Math.cos(mount.cmdYaw * DEG) * cy * d;
  const q = cam.project(wx, wy, wz, _p);
  if (!q) return;
  const x = Math.round(clamp(q.x, VIEW.x + 4, VIEW.x + VIEW.w - 5));
  const y = Math.round(clamp(q.y, VIEW.y + 26, VIEW.y + VIEW.h - 5));
  const c = lag > 3 ? C.LRED : C.LGRAY;
  r.hline(x - 4, x + 4, y, c);
  r.vline(x, y - 4, y + 4, c);
  r.px(x, y, C.BLACK);
}

/* --- 計器盤 ---------------------------------------------------- */

function drawArmament(r, g) {
  const gun = g.mount.gun;
  const x = 6;
  r.text(x, 326, gun.name, C.YELLOW);
  r.text(x, 334, gun.designation, C.DGRAY);

  r.text(x, 346, 'AMMO', C.CYAN);
  bar(r, x + 32, 345, 92, 7, gun.magFrac,
    gun.magFrac < 0.2 ? C.LRED : C.LGREEN);
  r.text(x + 130, 346, pad(gun.ammo, 3), C.WHITE);

  r.text(x, 356, 'HEAT', C.CYAN);
  bar(r, x + 32, 355, 92, 7, gun.heatFrac,
    gun.heat > 80 ? C.LRED : gun.heat > 50 ? C.YELLOW : C.GREEN);
  r.text(x + 130, 356, pad(gun.heat, 3), gun.heat > 80 ? C.LRED : C.WHITE);

  r.text(x, 366, 'RSV', C.CYAN);
  r.text(x + 32, 366, pad(gun.stock, 4), C.LGRAY);
  r.text(x + 72, 366, 'V0', C.CYAN);
  r.text(x + 92, 366, pad(gun.v0, 3) + ' M/S', C.LGRAY);

  // 次弾までの待ち。発射間隔が長い砲（0.5 秒超）だけバーで見せる。
  // いまのところ該当する砲はないが、将来もっと遅い砲を足したときのため残してある。
  if (gun.shotInterval > 0.5) {
    const wait = clamp(-gun.shotT / gun.shotInterval, 0, 1);
    bar(r, x + 150, 365, 40, 7, 1 - wait, wait > 0 ? C.YELLOW : C.LGREEN);
  }

  let st = 'READY', sc = C.LGREEN;
  if (gun.reloading) { st = 'RELOADING ' + fixed(gun.reloadT, 1) + 'S'; sc = C.YELLOW; }
  else if (gun.overheated) { st = '*** OVERHEAT ***'; sc = C.LRED; }
  else if (gun.ammo <= 0) { st = 'MAGAZINE EMPTY'; sc = C.LRED; }
  else if (gun.timeFuze && g.mount.fuzeTime <= 0) { st = 'FUZE UNSET - NO TARGET'; sc = C.YELLOW; }
  else if (gun.shotInterval > 0.5 && gun.shotT < 0) { st = 'LOADING NEXT ROUND'; sc = C.CYAN; }
  else if (g.mount.firing) { st = 'FIRING'; sc = C.WHITE; }
  r.text(x, 378, st, sc);

  // 兵装の選択タブ
  for (let i = 0; i < g.mount.guns.length; i++) {
    const gi = g.mount.guns[i];
    const sel = i === g.mount.index;
    const bx = x + i * 47;
    const cal = gi.caliber >= 20 ? Math.round(gi.caliber) + 'MM' : String(gi.caliber);
    const label = String(i + 1) + ':' + cal;
    if (sel) {
      r.fillRect(bx - 2, 388, 44, 9, C.CYAN);
      r.text(bx, 389, label, C.BLACK);
    } else {
      r.text(bx, 389, label, gi.ammo > 0 || gi.stock > 0 ? C.DGRAY : C.RED);
    }
  }
}

function drawTargetPanel(r, g) {
  const x = 204, x2 = 336;
  r.text(x, 326, 'TARGET', C.CYAN);
  const ac = g.target;
  if (!ac) {
    r.text(x, 344, 'NO TARGET DESIGNATED', C.DGRAY);
    r.text(x, 354, 'AIM AT A CONTACT TO TRACK', C.DGRAY);
    return;
  }
  const sol = g.solution;
  const brg = (Math.round(Math.atan2(ac.x, ac.z) * RAD) + 360) % 360;
  const elv = Math.atan2(ac.y - g.gunPos.y, Math.hypot(ac.x, ac.z)) * RAD;
  const closing = (ac.x * ac.vx + ac.y * ac.vy + ac.z * ac.vz) / Math.max(1, ac.slant);

  r.text(x + 44, 326, ac.tag + ' ' + ac.t.name, C.YELLOW);
  r.text(x + 44, 334, ac.state, C.DGRAY);

  const hpFrac = ac.hp / ac.hpMax;
  r.text(x, 334, 'DMG', C.CYAN);
  bar(r, x + 22, 333, 18, 7, 1 - hpFrac, C.LRED);

  r.text(x, 346, 'RNG', C.CYAN); r.text(x + 24, 346, pad(ac.slant, 4) + ' M', C.WHITE);
  r.text(x, 354, 'ALT', C.CYAN); r.text(x + 24, 354, pad(ac.y, 4) + ' M', C.LGRAY);
  r.text(x, 362, 'SPD', C.CYAN); r.text(x + 24, 362, pad(ac.speed, 3) + ' M/S', C.LGRAY);
  r.text(x, 370, 'CLS', C.CYAN);
  r.text(x + 24, 370, (closing < 0 ? '-' : '+') + pad(Math.abs(closing), 3) + ' M/S',
    closing < 0 ? C.LGREEN : C.LGRAY);

  r.text(x2, 346, 'BRG', C.CYAN); r.text(x2 + 24, 346, pad(brg, 3) + '°', C.LGRAY);
  r.text(x2, 354, 'ELV', C.CYAN); r.text(x2 + 24, 354, (elv < 0 ? '-' : '+') + pad(Math.abs(elv), 2) + '°', C.LGRAY);

  if (sol) {
    const leadM = Math.hypot(sol.x - ac.x, sol.y - ac.y, sol.z - ac.z);
    const leadMil = (leadM / Math.max(1, ac.slant)) * 1000;
    r.text(x2, 362, 'TOF', C.CYAN); r.text(x2 + 24, 362, fixed(sol.t, 2) + ' S', C.YELLOW);
    r.text(x2, 370, 'LED', C.CYAN);
    r.text(x2 + 24, 370, pad(leadM, 3) + ' M', C.YELLOW);
    r.text(x, 382, 'REQUIRED LEAD', C.CYAN);
    r.text(x + 84, 382, pad(leadMil, 3) + ' MIL', C.LMAGENTA);
    r.text(x, 390, 'DROP', C.CYAN);
    r.text(x + 34, 390, fixed(sol.drop, 1) + ' M', C.LMAGENTA);

    // 時限信管の砲は、この解の弾着時間がそのまま信管の秒数になる
    const gun = g.mount.gun;
    if (gun.timeFuze) {
      r.text(x2, 382, 'FUZE', C.CYAN);
      r.text(x2 + 30, 382, fixed(g.mount.fuzeTime, 2) + ' S', C.LGREEN);
      r.text(x2, 390, 'BURST', C.CYAN);
      r.text(x2 + 36, 390, pad(sol.range, 4) + ' M', C.LGREEN);
    } else {
      r.text(x2 + 60, 390, g.mount.realistic ? 'DRV:GEARED' : 'DRV:DIRECT', C.DGRAY);
    }
  }
}

function drawRadar(r, g, t) {
  const cx = 542, cy = 361, rad = 34;
  const scale = rad / 3000;
  r.text(448, 323, 'SECTOR', C.CYAN);
  r.circle(cx, cy, rad, C.GREEN);
  r.circle(cx, cy, Math.round(rad * 0.66), C.GREEN);
  r.circle(cx, cy, Math.round(rad * 0.33), C.GREEN);
  r.lineDash(cx - rad, cy, cx + rad, cy, C.GREEN, 1, 2);
  r.lineDash(cx, cy - rad, cx, cy + rad, C.GREEN, 1, 2);
  r.text(cx - 2, cy - rad - 8, 'N', C.CYAN);

  // 走査線
  const sweep = (t * 1.4) % (Math.PI * 2);
  r.line(cx, cy, cx + Math.sin(sweep) * rad, cy - Math.cos(sweep) * rad, C.LGREEN);

  // 砲の指向
  const a = g.mount.yaw * DEG;
  const fovH = (g.cam.fov / 2) * DEG;
  for (const s of [-1, 1]) {
    r.line(cx, cy,
      cx + Math.sin(a + s * fovH) * rad * 0.9,
      cy - Math.cos(a + s * fovH) * rad * 0.9, C.DGRAY);
  }

  for (const ac of g.aircraft) {
    if (!ac.alive) continue;
    const px = Math.round(cx + ac.x * scale);
    const py = Math.round(cy - ac.z * scale);
    if (Math.hypot(px - cx, py - cy) > rad) continue;
    const col = ac === g.target ? C.WHITE : ac.damaged ? C.LRED : C.YELLOW;
    r.px(px, py, col);
    if (ac === g.target) {
      r.px(px - 2, py, col); r.px(px + 2, py, col);
      r.px(px, py - 2, col); r.px(px, py + 2, col);
    }
  }
  r.px(cx, cy, C.LCYAN);
  r.text(cx + rad - 22, cy + rad - 6, '3KM', C.DGRAY);
}

function drawTopBar(r, g) {
  r.fillRect(0, 0, 640, 9, C.BLUE);
  r.text(4, 1, 'FLAKALT', C.LCYAN);
  r.text(56, 1, 'WAVE ' + pad(g.wave, 2), C.YELLOW);
  r.text(116, 1, 'SCORE ' + pad(g.score, 7), C.WHITE);
  const ic = g.integrity < 34 ? C.LRED : g.integrity < 67 ? C.YELLOW : C.LGREEN;
  r.text(212, 1, 'POST ' + pad(g.integrity, 3) + '%', ic);
  const acc = g.shots > 0 ? (g.hits / g.shots) * 100 : 0;
  r.text(290, 1, 'HIT ' + pad(g.hits, 4) + '/' + pad(g.shots, 5), C.LGRAY);
  r.text(400, 1, 'ACC ' + pad(acc, 2) + '%', C.LGRAY);
  r.text(464, 1, 'KILL ' + pad(g.kills, 3), C.LGREEN);
  r.text(536, 1, 'AIR ' + pad(g.aircraft.length, 2), C.LGRAY);
  r.text(588, 1, 'T+' + mmss(g.elapsed), C.LCYAN);
}

function drawMessages(r, g) {
  const y0 = VIEW.y + VIEW.h - 8;
  for (let i = 0; i < g.log.length && i < 4; i++) {
    const m = g.log[g.log.length - 1 - i];
    if (!m) break;
    const age = g.elapsed - m.t;
    if (age > 6) continue;
    const c = (age > 5 && Math.floor(age * 4) % 2) ? C.BLACK : m.c;
    r.text(6, y0 - i * 8, m.text, c);
  }
}

/* --- まとめ ---------------------------------------------------- */

export function drawHud(r, g) {
  const cam = g.cam;
  const t = g.elapsed;

  // 3D ビューポート内
  r.clip(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
  drawBarrels(r, cam, g.mount.gun, t);
  drawCompass(r, cam);
  drawElevScale(r, cam);
  if (g.target) drawTargetBox(r, cam, g.target, g.solution, g.opts.aid === 'EASY');
  if (g.mount.realistic) drawCommandMark(r, cam, g.mount);
  drawSight(r, cam, g.mount.gun, t);
  drawMessages(r, g);

  // 命中したときの手応え
  if (g.hitMarker > 0) {
    const cx = Math.round(cam.ccx), cy = Math.round(cam.ccy);
    const s = 8 + (1 - g.hitMarker) * 6;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      r.line(cx + dx * s, cy + dy * s, cx + dx * (s + 4), cy + dy * (s + 4), C.WHITE);
    }
  }
  // 被弾したら画面全体が赤く走る
  if (g.damageFlash > 0) {
    const n = Math.floor(g.damageFlash * 18);
    for (let i = 0; i < n; i++) {
      const y = VIEW.y + Math.floor(Math.random() * VIEW.h);
      r.hline(VIEW.x, VIEW.x + VIEW.w - 1, y, C.RED);
    }
  }

  r.clipAll();
  drawTopBar(r, g);

  // 計器盤
  r.fillRect(0, PANEL_Y, 640, 400 - PANEL_Y, C.BLACK);
  r.hline(0, 639, PANEL_Y, C.CYAN);
  r.hline(0, 639, PANEL_Y + 2, C.CYAN);
  for (const dx of [200, 444]) {
    r.vline(dx, PANEL_Y + 3, 399, C.CYAN);
    r.vline(dx + 2, PANEL_Y + 3, 399, C.CYAN);
  }
  drawArmament(r, g);
  drawTargetPanel(r, g);
  drawRadar(r, g, t);
}
