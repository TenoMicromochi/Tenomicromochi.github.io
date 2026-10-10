// dock.js — ドック（案A：段1・段2・SETTINGS の引き出し）とシステムバーの表示：ボタンの組み立て、自前スライダー、ヒント欄、状態の反映
// ボタンを押したときの処理は main.js が受け持つ（ここは見た目と状態の反映だけ）。
import { M, LAMP_NAMES, LAMP_ON, RGB_ON, MAT_ORDER, MAT_LABEL, matKey, cssHex } from './materials.js';
import { LAYER_NAMES } from './world.js';
import { setIcon } from './icons.js';

const $ = (id) => document.getElementById(id);
const Q = {}; // 一覧は組み立て後は変わらないので、最初に引いたものを使い回す
const $$ = (sel) => Q[sel] || (Q[sel] = Array.from(document.querySelectorAll(sel)));

// [素材, 名前]。並びとキー（1〜9・0）は materials.js の MAT_ORDER
const MATS = MAT_ORDER.map((m) => [m, MAT_LABEL[m]]);

export function buildDock() {
  for (const [m, name] of MATS) {
    const b = document.createElement('button');
    b.className = 'b mb'; b.type = 'button'; b.dataset.mat = m;
    b.dataset.hint = `${matKey(m)} ${name}` + (m === M.LAMP ? '  - PICK A COLOR BELOW' : m === M.HOLE ? '  - PLACED ON BOTH LAYERS' : m === M.BUFFER ? '  - ONE WAY, 1 TICK DELAY, NO LIGHT' : '');
    const chip = document.createElement('span');
    chip.className = 'chip' + (m ? '' : ' eraser');
    if (m && m !== M.LAMP) chip.style.background = cssHex(RGB_ON[m]);
    const top = document.createElement('span'); top.className = 'mt';
    const k = document.createElement('span'); k.className = 'mk'; k.textContent = String(matKey(m));
    top.append(k, chip);
    const nm = document.createElement('span'); nm.className = 'mn'; nm.textContent = name;
    b.append(top, nm);
    $('matRow').appendChild(b);
  }
  LAMP_ON.forEach((c, k) => {
    const b = document.createElement('button');
    b.className = 'sw'; b.type = 'button'; b.dataset.lamp = k;
    b.dataset.hint = `LAMP ${LAMP_NAMES[k]}` + (k === 0 ? '  [8]' : '');
    const s = document.createElement('span'); s.style.background = cssHex(c);
    b.appendChild(s);
    $('lampRow').appendChild(b);
  });
  $$('[data-ic]').forEach((b) => setIcon(b, b.dataset.ic));
}

// ---------- スライダー（自前。つまみの位置は整数 px） ----------
export function makeSlider(el, onChange) {
  const max = +el.dataset.max, w = el.offsetWidth || parseInt(getComputedStyle(el).width), span = w - 5;
  const thm = el.querySelector('.thm');
  if (el.dataset.ticks) {
    const step = +el.dataset.ticks;
    for (let value = 0; value <= max; value += step) {
      const tick = document.createElement('i'); tick.className = 'tk';
      tick.style.left = (2 + Math.round(value / max * span)) + 'px';
      el.appendChild(tick);
    }
  }
  const api = {
    v: 0,
    set(value) {
      api.v = Math.max(0, Math.min(max, Math.round(value)));
      thm.style.left = Math.round(api.v / max * span) + 'px';
    },
  };
  const fromX = (clientX) => {
    const box = el.getBoundingClientRect();
    return (Math.floor(clientX - box.left) - 2) / span * max;
  };
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    api.set(fromX(e.clientX)); onChange(api.v);
    const mv = (ev) => { api.set(fromX(ev.clientX)); onChange(api.v); };
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  });
  el.addEventListener('wheel', (e) => { e.preventDefault(); api.set(api.v + (e.deltaY < 0 ? 1 : -1) * (max / 100)); onChange(api.v); }, { passive: false });
  return api;
}

// ---------- ヒント欄（システムバーの中央。title の代わりにピクセルフォントで出す） ----------
let hoverEl = null, cur = { mode: 'STOP', pasting: false };
function defaultHint() {
  if (cur.pasting) return 'CLICK: PLACE   R / F: ROTATE / FLIP   ESC: CANCEL';
  if (cur.mode !== 'STOP') return 'LOCKED - STOP TO EDIT   CLICK T-FF: TOGGLE';
  return 'L-DRAG: DRAW   R-DRAG: PAN   WHEEL: ZOOM   MID-CLICK: PICK';
}
// 使えない理由：RUN / PAUSE 中は LOCKED、選択が無ければ NO SEL、履歴が無ければ EMPTY
const SEL_ONLY = ['copyBtn', 'saveSelBtn', 'zoomSelBtn'];
function whyOff(t) {
  const inp = t.matches('label') ? t.querySelector('input') : t;
  if (!inp || !inp.disabled) return '';
  if (cur.mode !== 'STOP' && !SEL_ONLY.includes(t.id)) return '  (LOCKED)';
  if (t.id === 'undoBtn' || t.id === 'redoBtn') return '  (EMPTY)';
  return '  (NO SEL)';
}
function showHint() { setText($('hint'), hoverEl ? hoverEl.dataset.hint + whyOff(hoverEl) : defaultHint()); }
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest && e.target.closest('[data-hint]');
  hoverEl = t || null;
  showHint();
});

// ---------- 差分だけ書く小道具 ----------
function setText(el, t) { if (el.textContent !== t) el.textContent = t; }
function setDis(el, v) { if (el.disabled !== v) el.disabled = v; }
function setCls(el, name, v) { if (el.classList.contains(name) !== !!v) el.classList.toggle(name, !!v); }

// s = { mode, tick, edit, mat, lampColor, shape, hollow, autoCross, scope, layer, pasteMode, pasting, sel,
//       canUndo, canRedo, glow, scale, otherPct, xy, matName, tps, saveText, unknown }
export function syncDock(s) {
  cur = s;
  const ed = s.edit, noSel = !s.sel;
  document.body.dataset.state = s.mode;
  document.body.dataset.curLayer = LAYER_NAMES[s.layer];

  // RUN
  $$('[data-run]').forEach((b) => setCls(b, 'active', b.dataset.run === s.mode));
  setText($('modeTag'), ed ? 'EDIT' : 'LOCKED');

  // CELLS
  $$('[data-mat]').forEach((b) => { setCls(b, 'active', +b.dataset.mat === s.mat); setDis(b, !ed); });
  $$('[data-lamp]').forEach((b) => {
    setCls(b, 'active', +b.dataset.lamp === s.lampColor);
    setCls(b, 'off', s.mat !== M.LAMP);
    setDis(b, !ed);
  });
  const lampChip = document.querySelector(`[data-mat="${M.LAMP}"] .chip`);
  const lc = cssHex(LAMP_ON[s.lampColor]);
  if (lampChip.dataset.c !== lc) { lampChip.dataset.c = lc; lampChip.style.background = lc; }
  setText($('matHead'), `${matKey(s.mat)} ${MAT_LABEL[s.mat]}` + (s.mat === M.LAMP ? ' ' + LAMP_NAMES[s.lampColor] : '') + '  ' + s.shape);

  // DRAW
  $$('[data-shape]').forEach((b) => { setCls(b, 'active', b.dataset.shape === s.shape); setDis(b, !ed); });
  const fh = s.shape === 'RECT' || s.shape === 'CIRCLE';
  $$('[data-hollow]').forEach((b) => { setCls(b, 'active', (b.dataset.hollow === '1') === s.hollow); setCls(b, 'na', !fh); setDis(b, !ed); });
  setDis($('autoCross'), !ed);
  if ($('autoCross').checked !== s.autoCross) $('autoCross').checked = s.autoCross;
  setCls($('autoCrossChk'), 'na', !(s.mat !== M.HOLE && s.mat !== M.CROSS && s.mat !== M.EMPTY && (s.shape === 'PEN' || s.shape === 'LINE')));

  // EDIT（COPY は RUN 中も使える。PASTE は貼り付け中だけ CANCEL に変わる）
  setDis($('undoBtn'), !ed || !s.canUndo);
  setDis($('redoBtn'), !ed || !s.canRedo);
  setDis($('copyBtn'), noSel);
  setDis($('cutBtn'), !ed || noSel);
  setDis($('delBtn'), !ed || noSel);
  setDis($('pasteBtn'), !ed);
  for (const id of ['rotCwBtn', 'rotCcwBtn', 'flipHBtn', 'flipVBtn']) setDis($(id), !ed || (noSel && !s.pasting));
  const pb = $('pasteBtn');
  if (pb.dataset.pasting !== String(s.pasting)) {
    pb.dataset.pasting = String(s.pasting);
    setIcon(pb, s.pasting ? 'cancel' : 'paste');
    pb.dataset.hint = s.pasting ? 'CANCEL PASTE  [ESC]' : 'PASTE  [CTRL+V]';
  }
  setCls(pb, 'active', s.pasting);
  $$('[data-mode]').forEach((b) => { setCls(b, 'active', b.dataset.mode === s.pasteMode); setDis(b, !ed); });
  $$('[data-scope]').forEach((b) => { setCls(b, 'active', b.dataset.scope === s.scope); setDis(b, !ed); });

  // LAYER（RUN 中も使える）
  $$('[data-layer]').forEach((b) => setCls(b, 'active', +b.dataset.layer === s.layer));
  setText($('otherV'), s.otherPct + '%');

  // VIEW
  $$('[data-glow]').forEach((b) => setCls(b, 'active', +b.dataset.glow === s.glow));
  setDis($('zoomSelBtn'), noSel);

  // FILE
  setDis($('loadBtn'), !ed);
  setDis($('loadModBtn'), !ed);
  setDis($('saveSelBtn'), noSel);

  // 貼り付けバー
  if ($('pasteCtx').hidden === s.pasting) $('pasteCtx').hidden = !s.pasting;

  // ステータス
  setText($('stXY'), s.xy);
  setText($('stMat'), s.matName);
  setText($('stZoom'), 'x' + s.scale);
  setText($('stTps'), 'TPS ' + s.tps);
  setText($('stState'), s.mode);
  setText($('stTick'), 'TICK ' + s.tick);
  setText($('stLayer'), LAYER_NAMES[s.layer]);
  const un = $('stUnknown');
  if (s.unknown) { setText(un, 'UNKNOWN ' + s.unknown); un.hidden = false; } else if (!un.hidden) un.hidden = true;
  setText($('stSave'), s.saveText);

  showHint();
}
