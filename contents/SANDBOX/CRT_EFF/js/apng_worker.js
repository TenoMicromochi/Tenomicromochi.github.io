// APNG のフィルタと圧縮を画面と別の流れで行う。
// 受け取る：{ type: 'start', w, h } → { type: 'frame', rgba(ArrayBuffer), delay } を何度も → { type: 'finish' }
// 返す：{ type: 'progress', n }（n コマ目が済んだ）、{ type: 'done', parts }
import { filterImage, deflateZlib, assembleApng } from './apng.js';

let w = 0, h = 0, zs = [], delays = [];
let queue = Promise.resolve();   // 圧縮は非同期。届いた順に1つずつ

async function handle(m) {
  if (m.type === 'start') {
    w = m.w; h = m.h; zs = []; delays = [];
  } else if (m.type === 'frame') {
    zs.push(await deflateZlib(filterImage(new Uint8ClampedArray(m.rgba), w, h)));
    delays.push(m.delay);
    self.postMessage({ type: 'progress', n: zs.length });
  } else if (m.type === 'finish') {
    const parts = assembleApng(w, h, zs, delays);
    zs = [];
    self.postMessage({ type: 'done', parts });
  }
}

self.onmessage = (e) => {
  queue = queue.then(() => handle(e.data)).catch((err) => {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  });
};
