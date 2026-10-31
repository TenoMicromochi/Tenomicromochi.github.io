// Heavy work off the page thread (SPEC 2.3): decode, preview, encode, self-check, reveal.
// The images themselves (raw RGBA and the opened file's bytes) live here, one per slot
// ('encode' and 'decode'; 'tmp' only while a freshly opened file waits to be routed).
// The page gets copies of the pixels for drawing, moved over as transferables.
//
// Requests  { id, type, ... }  ->  replies  { id, type: 'ok', ... } or { id, type: 'error', message, reason }

import { loadImage, inspectImage, preview, encode, decode, encodeRestored, FORMATS } from './core/index.js';

// slot -> { fileBytes, image (loadImage), restored (decode result, after UNLOCK) }
const slots = {};

const reply = (id, body, transfer = []) => postMessage({ id, type: 'ok', ...body }, transfer);

function slotOf(name) {
  const s = slots[name];
  if (!s) throw Object.assign(new Error('No image is open.'), { reason: 'no_image' });
  return s;
}

// What the page needs to show a freshly opened image.
function describe(s) {
  const { image } = s;
  const info = inspectImage(image);
  const rgba = image.rgba.slice();
  return [{ width: image.width, height: image.height, hasAlpha: image.hasAlpha, warnings: image.warnings, info, rgba }, [rgba.buffer]];
}

// Only the newest preview request is worth drawing: older ones that are still waiting are dropped.
let waiting = null;
let timer = 0;

function queuePreview(msg) {
  if (waiting) reply(waiting.id, { skipped: true });
  waiting = msg;
  if (!timer) timer = setTimeout(runPreview, 0);
}

async function runPreview() {
  timer = 0;
  const msg = waiting;
  waiting = null;
  if (!msg) return;
  try {
    const res = await preview(slotOf('encode').image, msg.mask, msg.render);
    reply(msg.id, { rgba: res.rgba, warnings: res.warnings }, [res.rgba.buffer]);
  } catch (e) {
    fail(msg.id, e);
  }
}

function fail(id, e) {
  postMessage({ id, type: 'error', message: e.message ?? String(e), reason: e.reason ?? 'unknown' });
}

const handlers = {
  // Opens into `slot` (the page uses 'tmp', then routes it with move). A failure leaves the slot as it was.
  async open({ id, slot = 'tmp', bytes }) {
    const fileBytes = new Uint8Array(bytes);
    const image = await loadImage(fileBytes);
    slots[slot] = { fileBytes, image, restored: null };
    const [body, transfer] = describe(slots[slot]);
    reply(id, body, transfer);
  },

  // Moves the image in `from` to `to` (no reply data).
  async move({ id, from, to }) {
    slots[to] = slotOf(from);
    slots[to].restored = null;
    if (from !== to) delete slots[from];
    reply(id, {});
  },

  // SEND TO ENCODE: the decode slot's file is opened again in `to`.
  async copy({ id, from, to }) {
    const src = slotOf(from);
    slots[to] = { fileBytes: src.fileBytes, image: src.image, restored: null };
    const [body, transfer] = describe(slots[to]);
    reply(id, body, transfer);
  },

  async encode({ id, mask, render, hint, passphrase, format, quality, keepMetadata }) {
    const res = await encode(slotOf('encode').image, mask, { render, hint, passphrase: passphrase || undefined, format, quality, keepMetadata });
    reply(id, { bytes: res.bytes, warnings: res.warnings, info: res.info, ext: FORMATS[res.info.format].ext, mime: FORMATS[res.info.format].mime }, [res.bytes.buffer]);
  },

  async reveal({ id, passphrase }) {
    const s = slotOf('decode');
    s.restored = null;
    s.restored = await decode(s.fileBytes, { passphrase: passphrase || undefined });
    const restored = s.restored;
    const rgba = restored.rgba.slice();
    reply(id, { width: restored.width, height: restored.height, hint: restored.hint, lossless: restored.lossless, rgba }, [rgba.buffer]);
  },

  async saveOriginal({ id, format = 'png', quality = 80 }) {
    const bytes = await encodeRestored(slotOf('decode').restored, { format, quality });
    reply(id, { bytes, ext: FORMATS[format].ext, mime: FORMATS[format].mime }, [bytes.buffer]);
  },
};

onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'preview') { queuePreview(msg); return; }
  try {
    await handlers[msg.type](msg);
  } catch (err) {
    fail(msg.id, err);
  }
};
