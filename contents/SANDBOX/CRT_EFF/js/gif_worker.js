// GIF の減色と圧縮を画面と別の流れで行う。
// 受け取る：{ type: 'start', w, h } → { type: 'frame', rgba(ArrayBuffer), delay } を何度も → { type: 'finish' }
// 返す：{ type: 'progress', n }（n コマ目が済んだ）、{ type: 'done', bytes }
import { createGifEncoder } from './gif.js';

let enc = null;
self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'start') {
      enc = createGifEncoder(m.w, m.h);
    } else if (m.type === 'frame') {
      enc.addFrame(new Uint8ClampedArray(m.rgba), m.delay);
      self.postMessage({ type: 'progress', n: enc.frames });
    } else if (m.type === 'finish') {
      const bytes = enc.finish();
      enc = null;
      self.postMessage({ type: 'done', bytes }, [bytes.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
