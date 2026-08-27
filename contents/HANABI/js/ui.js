/* ============================================================
   ui.js — ハンバーガー、レシピ編集、設定パネル、計測表示

   パネルは 2 層に分かれている。

     RECIPE  玉の入れ子構造そのもの。ブロックを足す／消す／選ぶ
     EDIT    「いま選んでいるブロック」の中身を触るスライダー群

   スライダーをブロックごとに全部並べるとパネルが縦に伸びきってしまうので、
   選択中の 1 ブロックにだけ束ねてある。ブロックを選び直すとスライダーが
   まるごと差し替わる。

   ---- 値を詰めたものはスライダーから外した ----
   重力・風・星の密度・地面の明るさなどは、詰め終わったあとは動かす理由が
   ないので定数に落とした（それぞれの定義元にコメントがある）。
   触りたくなったら window.HANABI から書き換えられる。
   段が決まっているものはスライダーではなくボタン列にしてある。
   ============================================================ */

import { COLORS, COLOR_KEYS, TYPES, TYPE_KEYS, SIZES, SIZE_KEYS } from './presets.js';
import { MAX_PAL } from './shaders.js';
import { SKY_MODES, HAZE_STEPS, TREE_ON } from './sky.js';
import { newShell, newSplit, applyType, applySize, normalizeRecipe } from './recipes.js';

export const params = {
  count: 800,

  /* カメラは 2 変数だけで決まる（camera.js 冒頭）。
     dist = 発射地点からの水平距離 D、altitude = 開花高度 H。
     仰角 θ = atan((H - 1.6) / D) は自動的に決まる */
  dist: 2000, altitude: 500,
  scatter: 1500,
  fov: 45,
  autoLaunch: true, interval: 1.0,

  // 背景。段の値は sky.js に定義がある
  skyMode: 1,
  haze: 0.15,
  treeH: TREE_ON,      // 0 で消える

  // 描画
  pixelSize: 1,
  starSize: 3.0,
  // 蓄積バッファへ入れる利得。ここを上げすぎると球の内部まで飽和して
  // 縁が明るく見える手がかり（リム輝度）が白に潰れる。見た目の明るさは
  // BRIGHTNESS（トーンマップ手前）で調整する
  exposureStar: 0.085, exposure: 2.0,
  glow: 2.0, glowSize: 2.0,
  trailTime: 0.1, toneMap: true,
};

export const state = {
  recipes: [],     // recipes.json から読んだ原本
  edited: [],      // プレイヤーが触った作業コピー（原本は残す）
  index: 0,
  mix: false,
  sel: { s: 0, split: false },
};

const pct = v => Math.round(v * 100) + '%';
const f1 = v => v.toFixed(1);
const f2 = v => v.toFixed(2);
const int = v => String(Math.round(v));

/* グローバルスライダーの再同期。ドラッグで距離が動いたときに
   スライダーのつまみを追従させるために使う */
const sliderSyncs = {};
export function syncSlider(k) { sliderSyncs[k]?.(); }

/* ------------------------------------------------------------ 選択 */
export function currentRecipe() { return state.edited[state.index]; }

function selShell() { return currentRecipe()?.shells[state.sel.s] || null; }

/* いま編集中のブロック。split を選んでいるのに親から split が消えた場合は
   親へフォールバックする（消したあとに宙に浮いた参照が残らないように） */
function selBlock() {
  const sh = selShell();
  if (!sh) return null;
  if (state.sel.split && !sh.split) state.sel.split = false;
  return state.sel.split ? sh.split : sh;
}

/* MIX と AUTO LAUNCH の抽選は「ON のレシピ」だけを回す。
   OFF は一覧にも残り、選んで編集も手動発射もできる（下の LAUNCH ボタンと
   Space は currentRecipe を直接撃つので ON/OFF に関係なく出る）。
   全部 OFF なら null を返し、shells 側でそのフレームは何も撃たない */
export function pickRecipe() {
  if (state.mix) {
    const pool = state.edited.filter(r => r.on);
    return pool.length ? pool[(Math.random() * pool.length) | 0] : null;
  }
  const r = currentRecipe();
  return r && r.on ? r : null;
}

const clone = (r) => normalizeRecipe(JSON.parse(JSON.stringify(r)), 0);

/* -------------------------------------------------- 変更マーカー
   作業コピー（state.edited）を原本（state.recipes）と突き合わせて、
   どこをいじったかを見せる。原本は recipes.json 読み込み時と
   設定ファイル読み込み時に更新され、RESET はそこへ戻す */
const sig = (o) => JSON.stringify(o);
const shellSig = (sh) => { const { split, ...rest } = sh; return sig(rest); };

function recipeDirty(i) {
  const o = state.recipes[i];
  return !!o && sig(state.edited[i]) !== sig(o);
}
function shellDirty(i, j) {
  const o = state.recipes[i]?.shells[j];
  const e = state.edited[i]?.shells[j];
  if (!e) return false;
  if (!o) return true;                 // 足した玉
  return shellSig(o) !== shellSig(e);
}
function splitDirty(i, j) {
  const e = state.edited[i]?.shells[j];
  if (!e?.split) return false;
  return sig(state.recipes[i]?.shells[j]?.split ?? null) !== sig(e.split);
}

/* ------------------------------------------------------------ 部品 */
function el(tag, cls, parent, text) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text != null) d.textContent = text;
  if (parent) parent.appendChild(d);
  return d;
}

function hint(parent, text) { return el('p', 'hint', parent, text); }

/* obj[key] を直接編集するスライダー。
   log: true なら対数で動かす。距離のように「効くのは絶対値ではなく比」の
   量は、加算で動かすと近距離が窮屈になって遠距離が大雑把になる */
function slider(parent, obj, key, o) {
  const row = el('div', 'ctl', parent);
  el('label', null, row, o.label);
  const inp = el('input', null, row);
  inp.type = 'range';
  if (o.log) {
    inp.min = Math.log10(o.min);
    inp.max = Math.log10(o.max);
    inp.step = 0.002;
  } else {
    inp.min = o.min; inp.max = o.max; inp.step = o.step;
  }
  const val = el('span', 'val', row);

  const sync = () => {
    inp.value = o.log ? Math.log10(obj[key]) : obj[key];
    val.textContent = o.fmt(Number(obj[key]));
  };
  inp.addEventListener('input', () => {
    obj[key] = o.log ? Math.pow(10, Number(inp.value)) : Number(inp.value);
    val.textContent = o.fmt(obj[key]);
    o.onChange?.();
  });
  sync();
  const extra = o.hint ? hint(parent, o.hint) : null;
  return { sync, row, extra };
}

/* 段が決まっている設定はボタン列にする。スライダーだと
   「HIGH と MID の間」のような無意味な値に止められてしまう */
function buttonGroup(parent, label, choices, get, set) {
  const row = el('div', 'ctl btns', parent);
  el('label', null, row, label);
  const wrap = el('div', 'seg', row);
  const btns = choices.map(c => {
    const b = el('button', 'pbtn', wrap, c.label);
    b.onclick = () => set(c.key);
    return b;
  });
  el('span', 'val', row, '');
  const sync = () => btns.forEach((b, i) => b.classList.toggle('on', choices[i].key === get()));
  sync();
  return { sync, btns, row };
}

/* 色チップ。複数選択＝「1 つの玉から複数の色が出る」の入力そのもの。
   MAX_PAL を超えたぶんはシェーダが引けないので、ここで頭打ちにする */
function colorChips(parent, spec, onChange) {
  const row = el('div', 'chips', parent);
  const sync = () => {
    row.querySelectorAll('.chip').forEach((c) => {
      c.classList.toggle('on', spec.colors.includes(c.dataset.k));
    });
  };
  for (const k of COLOR_KEYS) {
    const c = el('button', 'chip', row);
    c.dataset.k = k;
    c.title = k;
    const rgb = COLORS[k];
    c.style.background = `rgb(${rgb.map(v => Math.round(v * 255)).join(',')})`;
    c.onclick = () => {
      const i = spec.colors.indexOf(k);
      if (i >= 0) {
        if (spec.colors.length > 1) spec.colors.splice(i, 1);   // 最低 1 色は残す
      } else if (spec.colors.length < MAX_PAL) {
        spec.colors.push(k);
      }
      sync();
      onChange();
    };
  }
  sync();
  return row;
}

function dropdown(parent, label, keys, labels, get, set) {
  const row = el('div', 'ctl', parent);
  el('label', null, row, label);
  const sel = el('select', 'sel2', row);
  keys.forEach((k, i) => {
    const op = el('option', null, sel, labels[i]);
    op.value = k;
  });
  sel.value = get();
  sel.onchange = () => set(sel.value);
  el('span', 'val', row, '');
  return sel;
}

/* 開始と終了を 1 行に並べた 2 連スライダー。
   別々の行に置くと「窓」だということが読めないので、まとめてある。
   逆転すると smoothstep が破綻するので、必ず from < to を保つ */
function rangePair(parent, obj, kFrom, kTo, label, onChange) {
  const GAP = 0.04;
  const row = el('div', 'ctl dual', parent);
  el('label', null, row, label);
  const wrap = el('div', 'pair', row);
  const a = el('input', null, wrap);
  const b = el('input', null, wrap);
  for (const inp of [a, b]) { inp.type = 'range'; inp.min = 0; inp.max = 1; inp.step = 0.01; }
  const val = el('span', 'val', row);

  const sync = () => {
    a.value = obj[kFrom]; b.value = obj[kTo];
    val.textContent = `${pct(obj[kFrom])}→${pct(obj[kTo])}`;
  };
  a.addEventListener('input', () => {
    obj[kFrom] = Math.min(Number(a.value), obj[kTo] - GAP);
    sync(); onChange?.();
  });
  b.addEventListener('input', () => {
    obj[kTo] = Math.max(Number(b.value), obj[kFrom] + GAP);
    sync(); onChange?.();
  });
  sync();
  return sync;
}

/* ------------------------------------------------------- ブロック樹 */
function swatchStrip(parent, spec) {
  const w = el('span', 'sw', parent);
  for (const k of spec.colors) {
    const d = el('i', null, w);
    d.style.background = `rgb(${COLORS[k].map(v => Math.round(v * 255)).join(',')})`;
  }
  if (spec.colorLate) {
    el('span', 'arw', w, '→');
    const d = el('i', null, w);
    d.style.background = `rgb(${COLORS[spec.colorLate].map(v => Math.round(v * 255)).join(',')})`;
  }
  return w;
}

/* ブロックの見出し行。閉じているときはこれ 1 行だけになる。
   dirty=true でこのブロックが原本と違うことを示す点を出す */
function blockHead(parent, spec, name, open, dirty, onOpen, onRemove) {
  const h = el('div', 'blk-h', parent);
  h.onclick = (e) => { e.stopPropagation(); onOpen(); };
  el('span', 'caret', h, open ? '▾' : '▸');
  el('span', 'blk-n', h, name);
  if (dirty) el('span', 'dot', h, '•');
  swatchStrip(h, spec);
  if (onRemove) {
    const x = el('button', 'blk-x', h, '×');
    x.title = 'remove';
    x.onclick = (e) => { e.stopPropagation(); onRemove(); };
  }
  return h;
}

/* レシピの樹。開いているブロックにだけエディタをその場で差し込む。
   同時に開くのは 1 つだけなので、閉じた行は 1 行で済み、
   3 玉あっても全体が画面に収まる */
function buildTree(host, redraw, onEdit) {
  host.textContent = '';
  const r = currentRecipe();
  if (!r) return;

  r.shells.forEach((sh, i) => {
    const open = state.sel.s === i && !state.sel.split;
    const splitOpen = state.sel.s === i && state.sel.split;
    const blk = el('div', 'blk' + (open || splitOpen ? ' on' : ''), host);

    blockHead(blk, sh, `${TYPES[sh.type].label} ${SIZES[sh.size].label}`, open,
      shellDirty(state.index, i),
      // もう一度押したら畳む
      () => { state.sel = open ? { s: -1, split: false } : { s: i, split: false }; redraw(); },
      r.shells.length > 1 ? () => {
        r.shells.splice(i, 1);
        state.sel = { s: -1, split: false };
        redraw();
      } : null);

    const body = el('div', 'blk-b', blk);
    if (open) editorInto(body, sh, false, sh, redraw, onEdit);

    /* 分裂の行は親を畳んでいても出す。1 行で入れ子構造が読めるので、
       開かないと子の存在が分からない状態を避けられる */
    if (sh.split) {
      const sb = el('div', 'blk sub' + (splitOpen ? ' on' : ''), body);
      blockHead(sb, sh.split,
        `↳ ${TYPES[sh.split.type].label} ${SIZES[sh.split.size].label}`, splitOpen,
        splitDirty(state.index, i),
        () => { state.sel = splitOpen ? { s: -1, split: false } : { s: i, split: true }; redraw(); },
        () => { sh.split = null; state.sel = { s: i, split: false }; redraw(); });
      const sbody = el('div', 'blk-b', sb);
      if (splitOpen) editorInto(sbody, sh.split, true, sh, redraw, onEdit);
    } else if (open) {
      // 畳んでいるときに出しても押しようがないので、開いているときだけ
      const add = el('button', 'addbtn sm', body, '+ SPLIT');
      add.onclick = (e) => {
        e.stopPropagation();
        sh.split = newSplit(sh);
        state.sel = { s: i, split: true };
        redraw();
      };
    }
  });

  const add = el('button', 'addbtn', host, '+ SHELL');
  add.onclick = () => {
    const cur = currentRecipe();
    cur.shells.push(newShell(cur.shells[cur.shells.length - 1]));
    state.sel = { s: cur.shells.length - 1, split: false };
    redraw();
  };
}

/* --------------------------------------------------------- エディタ
   開いているブロックの中身をそこへ直接書き出す。ブロックを開き直すたびに
   作り直すので、スライダーの参照先が古いオブジェクトに残る事故が起きない。

   b       = 編集対象（玉そのもの、または分裂の設定）
   sh      = その玉（分裂を編集しているときは親）
   onEdit  = スライダーを動かすたびに呼ぶ軽い更新（変更マーカーの反映）。
             ここで redraw を呼ぶと樹ごと作り直してドラッグ中に掴みが外れる */
function editorInto(host, b, isSplit, sh, redraw, onEdit) {
  const sl = (key, o) => slider(host, b, key, { ...o, onChange: onEdit });

  dropdown(host, 'TYPE', TYPE_KEYS, TYPE_KEYS.map(k => TYPES[k].label),
    () => b.type, (v) => { applyType(b, v); redraw(); });
  dropdown(host, 'SIZE', SIZE_KEYS, SIZE_KEYS.map(k => SIZES[k].label),
    () => b.size, (v) => { applySize(b, v); redraw(); });

  el('div', 'sublab', host, 'COLORS');
  colorChips(host, b, redraw);
  hint(host, `Pick up to ${MAX_PAL}. Each star draws one of them at build time, ` +
             'so extra colors cost nothing per frame.');

  dropdown(host, 'THEN', ['', ...COLOR_KEYS], ['(none)', ...COLOR_KEYS],
    () => b.colorLate || '', (v) => { b.colorLate = v || null; redraw(); });
  /* 色が変わる玉のときだけ、その窓を色設定のすぐ下に出す。
     使わない玉に出しても意味のない行が増えるだけ */
  if (b.colorLate) {
    rangePair(host, b, 'lateFrom', 'lateTo', 'SHIFT', onEdit);
    hint(host, 'When the colour shifts, as a fraction of this stage\'s life.');
  } else {
    hint(host, 'Shift to a second colour over the star\'s life.');
  }

  el('div', 'sublab', host, 'BURST');
  sl('radius', { label: 'RADIUS', min: 8, max: 320, step: 1, fmt: v => int(v) + ' m' });
  sl('fallSpeed', { label: 'FALL SPEED', min: 2, max: 42, step: 0.5, fmt: v => f1(v) + ' m/s' });
  sl('life', { label: 'LIFE', min: 0.4, max: 7, step: 0.05, fmt: v => f2(v) + ' s' });
  el('p', 'note', host,
    'tau = FALL SPEED / g,  |v0| = RADIUS / tau. Drag and muzzle speed are never edited directly.');

  if (isSplit) {
    el('div', 'sublab', host, 'SPLIT');
    sl('at', { label: 'AT', min: 0.05, max: 0.95, step: 0.01, fmt: pct,
      hint: 'When the parent stars break, as a fraction of the parent life. ' +
            'The child starts from the exact position and velocity the parent had ' +
            'at that instant, so nothing is integrated.' });
    sl('inherit', { label: 'INHERIT', min: 0, max: 1, step: 0.01, fmt: pct,
      hint: 'How much of the parent velocity carries into the child. ' +
            '0 = the child ignores where the parent was going.' });
    sl('spread', { label: 'TIME SPREAD', min: 0, max: 0.6, step: 0.01, fmt: pct });
    sl('crackle', { label: 'CRACKLE', min: 0, max: 1, step: 0.01, fmt: f2 });
  } else {
    sl('delay', { label: 'DELAY', min: 0, max: 1, step: 0.01, fmt: v => f2(v) + ' s',
      hint: 'Offset from the rest of the recipe. The rise and the burst point are shared, ' +
            'so the shells still read as one firework.' });

    el('div', 'sublab', host, 'SPREAD');
    sl('tauSpread', { label: 'DRAG SPREAD', min: 0, max: 0.6, step: 0.01, fmt: pct,
      hint: 'Source of the droop. Linear drag alone keeps the shell a perfect sphere; ' +
            'the sag comes from this spread.' });
    sl('spdSpread', { label: 'SPEED SPREAD', min: 0, max: 0.3, step: 0.01, fmt: pct });
    sl('lifeSpread', { label: 'LIFE SPREAD', min: 0, max: 0.5, step: 0.01, fmt: pct });

    el('div', 'sublab', host, 'SHAPE');
    sl('flat', { label: 'FLATTEN', min: 0.03, max: 1, step: 0.01, fmt: f2,
      hint: '1.0 = sphere, lower = ring. Only the direction set is squashed; the shader is unchanged.' });
    // 分裂する玉ではクラックルは子側の値が使われる（終盤に出したいので）
    if (!sh.split) {
      sl('crackle', { label: 'CRACKLE', min: 0, max: 1, step: 0.01, fmt: f2 });
    } else {
      hint(host, 'CRACKLE is taken from the SPLIT block while this shell breaks.');
    }
  }
}

/* ------------------------------------------------- グローバル設定 */
const GLOBAL_SPEC = [
  { sec: 'SCENE' },
  { k: 'count', label: 'STARS', min: 200, max: 4000, step: 100, fmt: int, rebuild: true },
  { k: 'dist', label: 'DISTANCE', min: 20, max: 3000, log: true, fmt: v => int(v) + ' m',
    hint: 'Horizontal distance from the launch point. The camera always aims at the burst, ' +
          'so this alone sets the view angle: close = looking almost straight up, ' +
          'far = nearly level. Vertical drag and the wheel move it too.' },
  { k: 'altitude', label: 'ALTITUDE', min: 200, max: 700, step: 5, fmt: v => int(v) + ' m' },
  { k: 'scatter', label: 'SCATTER', min: 0, max: 2000, step: 10, fmt: v => int(v) + ' m',
    hint: 'How far each shell strays from the launch point. Set to 0 so every shell breaks ' +
          'at the same place and the D/R readout is exact.' },
  { k: 'fov', label: 'FOV', min: 20, max: 90, step: 1, fmt: v => int(v) + ' deg' },
  { k: 'autoLaunch', toggle: true, label: 'AUTO LAUNCH' },
  { k: 'interval', label: 'INTERVAL', min: 0.1, max: 6, step: 0.1, fmt: v => f1(v) + ' s' },

  { sec: 'SKY' },
  { skyModes: true },
  { k: 'haze', label: 'HAZE', group: HAZE_STEPS },
  { k: 'treeH', label: 'TREELINE',
    group: [{ key: TREE_ON, label: 'ON' }, { key: 0, label: 'OFF' }],
    hint: 'Only in frame once the horizon is, which needs DISTANCE past about 2.1x ALTITUDE.' },

  { sec: 'RENDER' },
  { k: 'pixelSize', label: 'PIXEL SIZE',
    group: [{ key: 1, label: 'x1' }, { key: 2, label: 'x2' }, { key: 3, label: 'x3' }],
    resize: true,
    hint: 'Render at 1/n and upscale by an integer factor with NEAREST. Fill cost drops as 1/n^2, ' +
          'and the dots land on the screen grid.' },
  { k: 'starSize', label: 'STAR SIZE', min: 1, max: 4, step: 0.1, fmt: f1,
    hint: 'The solid core is always one pixel, so this reads as brightness and halo size ' +
          'rather than size. Near stars gain more than far ones, which is what carries depth.' },
  { k: 'glow', label: 'GLOW', min: 0, max: 2, step: 0.02, fmt: f2 },
  { k: 'glowSize', label: 'GLOW SIZE', min: 0, max: 4, step: 0.1, fmt: f1 },
  { k: 'trailTime', label: 'TRAIL', min: 0, max: 2, step: 0.01, fmt: v => f2(v) + ' s',
    hint: 'Decay time constant, so tail length is the same at 30 and 60 fps. ' +
          'Screen-space feedback: the sky stays put but the streaks do not, ' +
          'and it is global, so one value has to serve both peony and willow.' },
  { k: 'exposure', label: 'BRIGHTNESS', min: 1, max: 4, step: 0.05, fmt: f2 },
  { k: 'toneMap', toggle: true, label: 'TONEMAP (ACES)',
    hint: 'Off = hard clip. Dense areas crush to flat white and the bright rim of the shell disappears.' },
];

function buildGlobals(host, hooks) {
  const syncs = [];
  const syncAll = () => syncs.forEach(fn => fn());

  for (const item of GLOBAL_SPEC) {
    if (item.sec) { el('div', 'sec', host, item.sec); continue; }

    /* 背景モードの切り替え。
       HDRI のテクスチャは「押されたときに初めて」読みに行く。起動時に
       候補を総当たりすると、素材を置いていない普段の状態で毎回 404 が
       コンソールに並び、本物のエラーが埋もれる */
    if (item.skyModes) {
      const note = hint(host, '');
      let failed = false;
      const g = buttonGroup(host, 'BACKDROP', SKY_MODES,
        () => params.skyMode,
        async (key) => {
          if (key === 2 && !hooks.skyStatus().texReady) {
            note.textContent = 'loading sky texture…';
            const url = await hooks.loadSky();
            if (!url) {
              // 読めなかったらモードは変えない。今の見た目を壊さないため
              failed = true;
              syncAll();
              return;
            }
            failed = false;
          }
          params.skyMode = key;
          syncAll();
        });
      host.insertBefore(g.row, note);
      syncs.push(() => {
        g.sync();
        const st = hooks.skyStatus();
        note.textContent = st.texReady ? `HDRI: ${st.texName}`
          : failed ? 'No equirectangular image found. Put one at sky/nightsky.jpg — see sky/README.md.'
          : 'HDRI reads sky/nightsky.(webp|jpg|png) when you pick it.';
      });
      continue;
    }

    if (item.group) {
      const g = buttonGroup(host, item.label, item.group,
        () => params[item.k],
        (key) => {
          params[item.k] = key;
          g.sync();
          if (item.resize) hooks.onResize();
        });
      syncs.push(g.sync);
      if (item.hint) hint(host, item.hint);
      continue;
    }

    if (item.toggle) {
      const b = el('button', 'tbtn', host);
      const sync = () => {
        b.classList.toggle('on', !!params[item.k]);
        b.textContent = (params[item.k] ? '■ ' : '□ ') + item.label;
      };
      b.onclick = () => { params[item.k] = !params[item.k]; sync(); };
      syncs.push(sync);
      sync();
      if (item.hint) hint(host, item.hint);
      continue;
    }

    const s = slider(host, params, item.k, {
      ...item,
      onChange: () => {
        if (item.rebuild) hooks.onCount();
        if (item.resize) hooks.onResize();
      },
    });
    sliderSyncs[item.k] = s.sync;
    syncs.push(s.sync);
  }

  syncAll();
  return syncAll;
}

/* ------------------------------------------------------------ 組み立て */
export function buildUI(recipes, hooks) {
  state.recipes = recipes;
  state.edited = recipes.map(clone);
  state.index = 0;
  state.sel = { s: 0, split: false };

  /* ---- 右：花火そのもの ---- */
  const right = document.getElementById('rightPanel');
  const rightFoot = document.getElementById('rightFoot');
  right.textContent = '';
  rightFoot.textContent = '';

  // レシピの切り替えはドロップダウン。option の文字に「変更あり(•)」と
  // 「無効((off))」を出すので、一覧を見れば触った跡が分かる
  const pick = document.getElementById('recipePick');
  const rebuildPick = () => {
    pick.textContent = '';
    state.edited.forEach((_, i) => {
      const op = el('option', null, pick);
      op.value = String(i);
    });
  };
  rebuildPick();
  pick.onchange = () => {
    state.index = Number(pick.value);
    state.sel = { s: 0, split: false };
    redraw();
    hooks.onLaunch();
  };

  /* ドロップダウンの下に「名前」と「ON/OFF」。名前はその場で書き換えられる。
     ここは MIX/AUTO の対象かどうかだけを切り替え、選んで編集・手動発射は OFF でもできる */
  const recCtl = el('div', 'rec-ctl', right);
  const nameInput = el('input', 'rec-name', recCtl);
  nameInput.type = 'text';
  nameInput.maxLength = 24;
  nameInput.spellcheck = false;
  nameInput.addEventListener('input', () => {
    currentRecipe().name = nameInput.value;
    refreshRecipeList();
  });
  const onBtn = el('button', 'rec-on', recCtl);
  onBtn.onclick = () => {
    const r = currentRecipe();
    r.on = !r.on;
    refreshRecipeList();
  };

  /* option の文字・名前欄・ON ボタン・開いているブロックの点を、
     樹を作り直さずに現在の state から更新する。
     option を作り直すと選択やフォーカスが飛ぶので textContent だけ差し替える */
  const refreshRecipeList = () => {
    state.edited.forEach((r, i) => {
      const op = pick.options[i];
      if (op) op.textContent = (recipeDirty(i) ? '• ' : '') + (r.on ? '' : '(off) ') + r.name;
    });
    pick.value = String(state.index);
    const cur = currentRecipe();
    if (cur) {
      if (nameInput.value !== cur.name) nameInput.value = cur.name;
      nameInput.classList.toggle('dirty', recipeDirty(state.index));
      onBtn.textContent = cur.on ? '◉ ON' : '○ OFF';
      onBtn.classList.toggle('off', !cur.on);
    }
    // スライダーで開いたまま編集しているブロックの点も追従させる
    const head = treeHost.querySelector('.blk.on > .blk-h');
    if (head && state.sel.s >= 0) {
      const dirty = state.sel.split
        ? splitDirty(state.index, state.sel.s)
        : shellDirty(state.index, state.sel.s);
      const dot = head.querySelector('.dot');
      if (dirty && !dot) head.querySelector('.blk-n').after(el('span', 'dot', null, '•'));
      else if (!dirty && dot) dot.remove();
    }
  };

  const treeHost = el('div', 'blocks', right);
  const redraw = () => {
    buildTree(treeHost, redraw, refreshRecipeList);
    refreshRecipeList();
  };

  /* 発射まわりは常設フッタへ。エディタ末尾に置くと、
     ブロックを開いているときスクロールしないと押せない */
  const mixBtn = el('button', 'tbtn', rightFoot);
  const syncMix = () => {
    mixBtn.classList.toggle('on', state.mix);
    mixBtn.textContent = (state.mix ? '■ ' : '□ ') + 'MIX RECIPES';
  };
  mixBtn.onclick = () => { state.mix = !state.mix; syncMix(); };
  syncMix();

  const foot = el('div', 'foot-row', rightFoot);
  const fire = el('button', 'tbtn go', foot, '▶ LAUNCH');
  fire.onclick = () => hooks.onLaunch();

  /* 作業コピーを捨てて原本に戻す／JSON に書き出す。
     組み替えて気に入ったものを recipes.json へ貼り戻せるようにしておく */
  const reset = el('button', 'tbtn', foot, '↺ RESET');
  reset.onclick = () => {
    state.edited[state.index] = clone(state.recipes[state.index]);
    state.sel = { s: 0, split: false };
    redraw();
  };
  const copy = el('button', 'tbtn', foot, '⧉ JSON');
  copy.onclick = async () => {
    const text = JSON.stringify(strip(currentRecipe()), null, 2);
    const flash = (msg) => {
      copy.textContent = msg;
      setTimeout(() => { copy.textContent = '⧉ JSON'; }, 1200);
    };
    try {
      await navigator.clipboard.writeText(text);
      flash('COPIED');
    } catch {
      console.log(text);
      flash('CONSOLE');
    }
  };

  redraw();

  /* ---- 左：世界の設定 ---- */
  const left = document.getElementById('leftPanel');
  left.textContent = '';
  const syncGlobals = buildGlobals(left, hooks);

  /* 左右タブの設定をまるごとファイルへ。左側に置くのは、
     これがシーン全体の保存で「世界の設定」の側だから */
  el('div', 'sec', left, 'CONFIG');
  const cfgRow = el('div', 'foot-row', left);
  el('button', 'tbtn', cfgRow, '⭳ SAVE').onclick = () => {
    downloadJSON(exportConfig(), 'hanabi-config.json');
  };
  const loadBtn = el('button', 'tbtn', cfgRow, '⭱ LOAD');
  loadBtn.onclick = async () => {
    const flash = (m) => {
      loadBtn.textContent = m;
      setTimeout(() => { loadBtn.textContent = '⭱ LOAD'; }, 1400);
    };
    const data = await pickJSONFile();
    if (data === null) return;                 // キャンセル
    if (data === false || !applyConfig(data)) { flash('BAD FILE'); return; }
    rebuildPick();
    hooks.onCount();
    hooks.onResize();
    syncGlobals();
    syncMix();
    redraw();
    hooks.onLaunch();
    flash('LOADED');
  };
  hint(left, 'Saves every SCENE / SKY / RENDER value and the whole recipe list ' +
             '(names and ON/OFF included). Loading replaces all of it.');

  wireTabs();

  /* コンソールからも設定を出し入れできるようにしておく。
     applyConfig のあとは再適用（解像度・星数・背景・樹）が要る */
  const reapply = () => {
    rebuildPick(); hooks.onCount(); hooks.onResize();
    syncGlobals(); syncMix(); redraw();
  };
  return { syncGlobals, syncSlider, redraw, exportConfig, applyConfig, reapply };
}

/* 左右のタブ。狭い画面では全幅になるので、開くともう片方を閉じる */
function wireTabs() {
  const panes = [
    { tab: document.getElementById('tabLeft'), wrap: document.getElementById('leftWrap'), cls: 'left-open' },
    { tab: document.getElementById('tabRight'), wrap: document.getElementById('rightWrap'), cls: 'right-open' },
  ];
  const set = (p, on) => {
    p.wrap.classList.toggle('open', on);
    p.tab.classList.toggle('on', on);
    document.body.classList.toggle(p.cls, on);
  };
  panes.forEach((p, i) => {
    p.tab.onclick = () => {
      const on = !p.wrap.classList.contains('open');
      set(p, on);
      if (on && window.innerWidth <= 560) set(panes[1 - i], false);
    };
  });
}

/* 書き出し用。null と既定値まみれの JSON は貼り戻しにくいので、
   使っていない項目を落として読みやすくする。
   on は既定（ON）のときは省き、無効化したものだけ "on": false を残す */
function strip(r) {
  const clean = (o) => {
    const x = { ...o };
    if (!x.colorLate) { delete x.colorLate; delete x.lateFrom; delete x.lateTo; }
    return x;
  };
  return {
    name: r.name,
    ...(r.on ? {} : { on: false }),
    shells: r.shells.map(sh => {
      const o = clean(sh);
      if (!o.split) delete o.split; else o.split = clean(o.split);
      return o;
    }),
  };
}

/* ---- 設定ファイルの入出力 ----
   左タブ（params 全部）と右タブ（レシピ配列・ON/名前込み）を 1 つの JSON に。
   読み込んだレシピは新しい原本になる（＝直後は変更マーカーが消える） */
function exportConfig() {
  return {
    hanabi: 1,
    params: { ...params },
    mix: state.mix,
    recipes: state.edited.map(strip),
  };
}

function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function pickJSONFile() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) return resolve(null);
      try { resolve(JSON.parse(await f.text())); }
      catch { resolve(false); }        // パース失敗
    };
    inp.click();
  });
}

/* 読み込んだ内容を state と params へ流し込む。
   未知の params キーは無視、既知キーだけ上書きする */
function applyConfig(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.params && typeof data.params === 'object') {
    for (const k of Object.keys(params)) {
      if (k in data.params) params[k] = data.params[k];
    }
  }
  if (typeof data.mix === 'boolean') state.mix = data.mix;
  if (Array.isArray(data.recipes) && data.recipes.length) {
    state.recipes = data.recipes.map((r, i) => normalizeRecipe(r, i));
    state.edited = data.recipes.map((r, i) => normalizeRecipe(r, i));
    state.index = 0;
    state.sel = { s: 0, split: false };
  }
  return true;
}

/* --------------------------------------------------------------- HUD
   D/R が読めることが目的。花火らしさを決めるのはこの比なので、
   カメラを動かしながら常に見えている必要がある。

   分子は水平距離ではなく斜距離。DISTANCE を 0 に近づけても斜距離は
   高度で下げ止まるので、D/R もそこで頭打ちになる。
   半径は玉ごとに違うので、選択中のブロックのものを出す */
export function updateHud(cam, stats) {
  const D = cam.slant(params.altitude);
  const b = selBlock();
  const R = b ? b.radius : 160;
  const near = (D + R) / Math.max(1, D - R);
  document.getElementById('hud').innerHTML =
    `<b>D/R</b> ${(D / R).toFixed(2)}` +
    `<b>NEAR/FAR</b> ${D > R ? near.toFixed(2) : '--'}` +
    `<b>SLANT</b> ${Math.round(D)} m` +
    `<b>θ</b> ${cam.lookUpDeg(params.altitude).toFixed(0)}°` +
    `<b>RES</b> ${stats.iw}×${stats.ih}` +
    `<b>STARS</b> ${stats.drawn}` +
    `<b>FPS</b> ${stats.fps.toFixed(0)}`;
}
