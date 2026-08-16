/* ============================================================
   FLAKALT — scene.js
   空・地面・遠景。動かない世界の側。

   空は地平線からの距離でバンドを作り、境目を 4x4 のディザで繋ぐ。
   16 色しかないので、グラデーションはディザでしか作れない。
   地面は格子。距離で色を落としていくのがそのまま奥行きの手がかりになる。
   ============================================================ */

import { C } from './palette.js';
import { drawMeshFlat, makeHangar, makeTower, makeBox } from './models.js';
import { DEG } from './camera.js';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 地平線から上へ向かうバンド。[上端までの距離px, 色A, 色B, ディザ量] */
const SKY_BANDS = [
  [6, C.BROWN, C.RED, 8],
  [15, C.RED, C.MAGENTA, 8],
  [28, C.MAGENTA, C.BLUE, 9],
  [58, C.BLUE, C.BLUE, 0],
  [104, C.BLUE, C.BLACK, 10],
  [168, C.BLUE, C.BLACK, 5],
  [240, C.BLUE, C.BLACK, 2],
];

const GRID_STEP = 250;
const GRID_EXT = 2500;
const GRID_R2 = GRID_EXT * GRID_EXT;
const NEAR_STEP = 50;
const NEAR_EXT = 350;

export class Scene {
  constructor(seed = 1337) {
    const rnd = mulberry32(seed);
    this.rnd = rnd;

    /* --- 星 --- */
    this.stars = [];
    for (let i = 0; i < 460; i++) {
      const az = rnd() * 360 * DEG;
      // 低空ほど疎に。地平線近くは大気で見えないという体
      const el = (4 + Math.pow(rnd(), 0.75) * 84) * DEG;
      const ce = Math.cos(el);
      this.stars.push({
        x: Math.sin(az) * ce, y: Math.sin(el), z: Math.cos(az) * ce,
        c: rnd() < 0.14 ? C.WHITE : (rnd() < 0.45 ? C.LGRAY : C.DGRAY),
        ph: rnd() * 6.28,
      });
    }

    /* --- 遠景の稜線。2 枚重ねて奥行きを出す --- */
    this.ridges = [
      this.makeRidge(rnd, 8200, 260, 900, 96, C.DGRAY),
      this.makeRidge(rnd, 5200, 130, 420, 80, C.BLUE),
    ];

    /* --- 地上物 --- */
    this.hangar = makeHangar(46, 11, 26);
    this.tower = makeTower(24, 9, 5);
    this.crate = makeBox(6, 3, 10);
    this.props = [
      { m: this.hangar, x: -520, z: 980, yaw: 18, s: 1, c: C.DGRAY },
      { m: this.hangar, x: -430, z: 1120, yaw: 18, s: 1, c: C.DGRAY },
      { m: this.tower, x: 260, z: 520, yaw: 0, s: 1, c: C.LGRAY },
      { m: this.tower, x: -900, z: -640, yaw: 0, s: 0.8, c: C.DGRAY },
      { m: this.crate, x: 34, z: 28, yaw: 12, s: 1, c: C.DGRAY },
      { m: this.crate, x: 44, z: 16, yaw: -40, s: 1, c: C.DGRAY },
      { m: this.crate, x: -38, z: 30, yaw: 70, s: 1, c: C.DGRAY },
    ];

    /* --- 滑走路 --- */
    this.runway = { x: 700, z: 1500, yaw: 28, len: 1200, wid: 58 };

    /* --- 友軍の陣地（土嚢のリング） --- */
    this.emplacements = [
      { x: 0, z: 0, r: 9, c: C.LGRAY },
      { x: 150, z: -90, r: 7, c: C.DGRAY },
      { x: -170, z: 60, r: 7, c: C.DGRAY },
      { x: 40, z: 210, r: 7, c: C.DGRAY },
    ];

    /* --- 太陽 --- */
    this.sun = { az: 246, el: 4.5 };
  }

  makeRidge(rnd, radius, hMin, hMax, n, color) {
    const pts = [];
    const p1 = rnd() * 100, p2 = rnd() * 100, p3 = rnd() * 100;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const noise =
        Math.sin(a * 3 + p1) * 0.5 +
        Math.sin(a * 7 + p2) * 0.3 +
        Math.sin(a * 13 + p3) * 0.2;
      const h = hMin + (hMax - hMin) * (0.5 + 0.5 * noise);
      const rr = radius * (0.9 + 0.2 * Math.sin(a * 5 + p3));
      pts.push({ x: Math.sin(a) * rr, y: h, z: Math.cos(a) * rr });
    }
    return { pts, color };
  }

  /* --- 空 ---------------------------------------------------- */

  drawSky(r, cam) {
    const vy = cam.vy, vh = cam.vh, vx = cam.vx, vw = cam.vw;
    const hy = Math.round(cam.horizonY());

    r.fillRect(vx, vy, vw, vh, C.BLACK);

    // 地平線より上をバンドで塗る
    let prev = 0;
    for (const [top, ca, cb, lv] of SKY_BANDS) {
      const y1 = hy - prev;
      const y0 = hy - top;
      if (y1 <= vy) break;
      const cy0 = Math.max(vy, y0);
      const cy1 = Math.min(vy + vh, y1);
      if (cy1 > cy0) {
        if (lv === 0) r.fillRect(vx, cy0, vw, cy1 - cy0, ca);
        else r.ditherRect(vx, cy0, vw, cy1 - cy0, ca, cb, lv);
      }
      prev = top;
    }

    // 地平線のすぐ下は靄
    if (hy < vy + vh) {
      const h = Math.min(7, vy + vh - hy);
      if (h > 0) r.ditherRect(vx, hy, vw, h, C.BLACK, C.BLUE, 5);
    }
  }

  drawStars(r, cam, t) {
    const hy = cam.horizonY();
    const p = { x: 0, y: 0, z: 0 };
    for (const s of this.stars) {
      // 無限遠なのでカメラ位置は無視して方向だけで置く
      const q = cam.project(cam.x + s.x * 9000, cam.y + s.y * 9000, cam.z + s.z * 9000, p);
      if (!q) continue;
      // 地平線際は薄明かりで星が見えない。上へ行くほど本来の明るさに戻す
      const above = hy - q.y;
      if (above < 46) continue;
      const tw = Math.sin(t * 2.2 + s.ph);
      const c = above < 120 ? C.DGRAY : (tw > 0.75 ? C.WHITE : s.c);
      r.px(q.x, q.y, c);
    }
  }

  drawSun(r, cam) {
    const el = this.sun.el * DEG, az = this.sun.az * DEG;
    const d = 9000, ce = Math.cos(el);
    const p = { x: 0, y: 0, z: 0 };
    const q = cam.project(
      cam.x + Math.sin(az) * ce * d,
      cam.y + Math.sin(el) * d,
      cam.z + Math.cos(az) * ce * d, p);
    if (!q) return;
    const rad = 26;
    if (q.x < cam.vx - rad * 2 || q.x > cam.vx + cam.vw + rad * 2) return;

    r.discDither(q.x, q.y, rad, C.RED, C.BROWN, 8);
    r.discDither(q.x, q.y, rad - 7, C.BROWN, C.YELLOW, 9);
    r.discDither(q.x, q.y, rad - 15, C.YELLOW, C.WHITE, 8);
    // 横に切れ目を入れる。これだけで一気にそれっぽくなる
    for (let i = -3; i <= 3; i++) {
      const yy = Math.round(q.y + i * 6 + 2);
      const w = Math.floor(Math.sqrt(Math.max(0, rad * rad - (yy - q.y) ** 2)));
      r.hline(q.x - w, q.x + w, yy, C.BLACK);
    }
  }

  /* --- 地面 -------------------------------------------------- */

  gridColor(d) {
    if (d < 520) return C.LCYAN;
    if (d < 1050) return C.CYAN;
    if (d < 1750) return C.LBLUE;
    return C.BLUE;
  }

  drawGround(r, cam) {
    // 真上を向いていて地面が一切見えないときは丸ごと省く
    if (cam.horizonY() < cam.vy - 4) return;

    // 足元は細かい格子。ここは色を変えず、線一本ずつを長いまま引く
    // （距離による減衰が要らないぶん呼び出し回数が減る）
    for (let i = -NEAR_EXT; i <= NEAR_EXT; i += NEAR_STEP) {
      cam.line3(r, -NEAR_EXT, 0, i, NEAR_EXT, 0, i, C.LCYAN);
      cam.line3(r, i, 0, -NEAR_EXT, i, 0, NEAR_EXT, C.LCYAN);
    }

    // 中距離は分割して距離ごとに色を落とす
    for (let i = -GRID_EXT; i <= GRID_EXT; i += GRID_STEP) {
      for (let j = -GRID_EXT; j < GRID_EXT; j += GRID_STEP) {
        const mid = j + GRID_STEP / 2;
        const d2 = i * i + mid * mid;
        if (d2 >= GRID_R2 || d2 < NEAR_EXT * NEAR_EXT) continue;
        const c = this.gridColor(Math.sqrt(d2));
        cam.line3(r, j, 0, i, j + GRID_STEP, 0, i, c);
        cam.line3(r, i, 0, j, i, 0, j + GRID_STEP, c);
      }
    }

    // 外周のざっくりした格子
    const OUT = 8000, OSTEP = 1000;
    for (let i = -OUT; i <= OUT; i += OSTEP) {
      if (Math.abs(i) < GRID_EXT) continue;
      cam.line3(r, -OUT, 0, i, OUT, 0, i, C.BLUE);
      cam.line3(r, i, 0, -OUT, i, 0, OUT, C.BLUE);
    }
  }

  drawRidges(r, cam) {
    for (const ridge of this.ridges) {
      const p = ridge.pts;
      for (let i = 0; i < p.length - 1; i++) {
        cam.line3(r, p[i].x, p[i].y, p[i].z, p[i + 1].x, p[i + 1].y, p[i + 1].z, ridge.color);
        if (i % 3 === 0) {
          cam.line3(r, p[i].x, p[i].y, p[i].z, p[i].x, 0, p[i].z, ridge.color);
        }
      }
    }
  }

  drawRunway(r, cam) {
    const rw = this.runway;
    const c = Math.cos(rw.yaw * DEG), s = Math.sin(rw.yaw * DEG);
    const hl = rw.len / 2, hw = rw.wid / 2;
    const pt = (u, v) => [rw.x + c * u + s * v, 0, rw.z - s * u + c * v];
    const corners = [pt(-hw, -hl), pt(hw, -hl), pt(hw, hl), pt(-hw, hl)];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      cam.line3(r, a[0], 0, a[2], b[0], 0, b[2], C.LGRAY);
    }
    // 中心線
    for (let v = -hl + 20; v < hl - 20; v += 90) {
      const a = pt(0, v), b = pt(0, v + 45);
      cam.line3(r, a[0], 0, a[2], b[0], 0, b[2], C.DGRAY);
    }
  }

  drawProps(r, cam) {
    for (const p of this.props) {
      drawMeshFlat(r, cam, p.m, p.x, 0, p.z, p.yaw, p.s, p.c);
    }
    for (const e of this.emplacements) {
      const n = 14;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        const h = 1.1 + 0.25 * (i % 2);
        cam.line3(r,
          e.x + Math.sin(a0) * e.r, h, e.z + Math.cos(a0) * e.r,
          e.x + Math.sin(a1) * e.r, h, e.z + Math.cos(a1) * e.r, e.c);
        cam.line3(r,
          e.x + Math.sin(a0) * e.r, 0, e.z + Math.cos(a0) * e.r,
          e.x + Math.sin(a0) * e.r, h, e.z + Math.cos(a0) * e.r, e.c);
      }
    }
  }

  draw(r, cam, t) {
    this.drawSky(r, cam);
    this.drawStars(r, cam, t);
    this.drawSun(r, cam);
    this.drawRidges(r, cam);
    this.drawGround(r, cam);
    this.drawRunway(r, cam);
    this.drawProps(r, cam);
  }
}
