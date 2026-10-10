// uikit.js — UI の小道具：差分だけ書く関数、素材の説明、ヒント欄、スライダー、ボタン
import { M, MAT_ORDER, matKey, RGB_ON, LAMP_ON, LAMP_NAMES } from './materials.js';
import { setIcon } from './icons.js';

export const $ = (id) => document.getElementById(id);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const hex = (n) => '#' + n.toString(16).padStart(6, '0');
export { setIcon, LAMP_ON, LAMP_NAMES, MAT_ORDER, matKey };

export function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
export function setDis(el, v) { if (el && el.disabled !== !!v) el.disabled = !!v; }
export function setCls(el, name, v) { if (el && el.classList.contains(name) !== !!v) el.classList.toggle(name, !!v); }
export function setHidden(el, v) { if (el && el.hidden !== !!v) el.hidden = !!v; }

// 素材ごとの名前・色・一言の説明（何をする素材か）
export const MATS = [
  { m: M.WIRE,   name: 'WIRE',   kind: 'WIRE', say: 'Carries a signal instantly along touching cells.' },
  { m: M.INPUT,  name: 'INPUT',  kind: 'PORT', say: 'Port into a gate. Put it between a wire and a gate.' },
  { m: M.OUTPUT, name: 'OUTPUT', kind: 'PORT', say: 'Port out of a gate. Put it between a gate and a wire.' },
  { m: M.INVERT, name: 'INVERT', kind: 'GATE', say: 'NOT gate. ON when its input is OFF. 1 tick delay.' },
  { m: M.BUFFER, name: 'BUFFER', kind: 'GATE', say: 'Copies its input one way. 1 tick delay. No light.' },
  { m: M.CROSS,  name: 'CROSS',  kind: 'WIRE', say: 'Lets two lines cross without touching.' },
  { m: M.TFF,    name: 'T-FF',   kind: 'GATE', say: 'Memory. Flips ON/OFF on each rising input. Click to flip.' },
  { m: M.LAMP,   name: 'LAMP',   kind: 'GATE', say: 'Lights up when its input is ON. 16 colors.' },
  { m: M.HOLE,   name: 'HOLE',   kind: 'WIRE', say: 'Connects the FRONT and BACK layers at one spot.' },
  { m: M.EMPTY,  name: 'ERASER', kind: 'TOOL', say: 'Removes cells.' },
];
export const matInfo = (m) => MATS.find((x) => x.m === m);
export const matColor = (m, lamp = 0) => (m === M.LAMP ? hex(LAMP_ON[lamp]) : m === M.EMPTY ? '#000000' : hex(RGB_ON[m]));

export const SHAPES = [
  { s: 'PEN',    ic: 'pen',    say: 'Draw freehand. Shift: straight.' },
  { s: 'LINE',   ic: 'line',   say: 'Draw a line. Shift: even stairs.' },
  { s: 'RECT',   ic: 'rect',   say: 'Draw a box. Shift: square.' },
  { s: 'CIRCLE', ic: 'circle', say: 'Draw a circle. Shift: round.' },
  { s: 'FILL',   ic: 'fill',   say: 'Fill touching same cells on this layer.' },
  { s: 'SELECT', ic: 'select', say: 'Pick an area. Drag inside to move it.' },
];

// 色見本つきの素材ボタンを作る
export function matButton(info, cls = 'b') {
  const b = document.createElement('button');
  b.type = 'button'; b.className = cls; b.dataset.mat = info.m;
  b.dataset.hint = `${matKey(info.m)} ${info.name}  - ${info.say.toUpperCase()}`;
  const chip = document.createElement('i');
  chip.className = 'chip' + (info.m === M.EMPTY ? ' eraser' : '');
  chip.style.background = matColor(info.m);
  b.append(chip);
  return b;
}

// ヒント欄：data-hint を持つ要素の上にマウスがあればその文、なければ fallback() の文
export function initHints(el, fallback) {
  let hover = null;
  const show = () => setText(el, hover ? hover.dataset.hint + (hover.disabled ? '  (NOT NOW)' : '') : fallback());
  document.addEventListener('mouseover', (e) => { hover = e.target.closest ? e.target.closest('[data-hint]') : null; show(); });
  return show;
}

// 自前スライダー（つまみの位置は整数 px）。el の中に .trk と .thm を作る
export function makeSlider(el, max, onChange) {
  el.innerHTML = '<i class="trk"></i><i class="thm"></i>';
  const thm = el.querySelector('.thm');
  const span = () => el.offsetWidth - 5;
  const api = {
    v: 0,
    set(v) { api.v = Math.max(0, Math.min(max, Math.round(v))); thm.style.left = Math.round(api.v / max * span()) + 'px'; },
  };
  const fromX = (clientX) => { const box = el.getBoundingClientRect(); return (Math.floor(clientX - box.left) - 2) / span() * max; };
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    api.set(fromX(e.clientX)); onChange(api.v);
    const mv = (ev) => { api.set(fromX(ev.clientX)); onChange(api.v); };
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  });
  return api;
}
// TPS は対数：スライダーの値 0..1100 <-> 1..2048
export const tpsToSlider = (t) => Math.log2(t) * 100;
export const sliderToTps = (v) => Math.max(1, Math.min(2048, Math.round(2 ** (v / 100))));

// 文字ボタン・アイコンボタンを手早く作る
export function btn(label, hint, onClick, cls = 'b') {
  const b = document.createElement('button');
  b.type = 'button'; b.className = cls; b.dataset.hint = hint;
  if (label.startsWith('ic:')) { b.classList.add('ic-b'); setIcon(b, label.slice(3)); } else b.textContent = label;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
