// knVt / KNVT chunk data (SPEC 33.1) and the compressed plaintext inside it (SPEC 33.2).

import { deflate, inflate, concat } from './bytes.js';
import { usage, verify } from './errors.js';

export const VERSION = 2;
export const HINT_MAX = 1024;
const HEADER = 34; // bytes before the hint
const TAG = 16;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

export function hintBytes(hint = '') {
  const b = enc.encode(hint);
  if (b.length > HINT_MAX) throw usage('hint_too_long', `Hint is ${b.length} bytes (max ${HINT_MAX}).`);
  return b;
}

// Header = everything up to the end of the hint; it is also the AAD.
export function buildHeader({ keyMode, kdfSalt, nonce, hint }) {
  const h = hintBytes(hint);
  const out = new Uint8Array(HEADER + h.length);
  const dv = new DataView(out.buffer);
  out[0] = VERSION;
  out[1] = keyMode;
  dv.setUint16(2, 0);
  out.set(kdfSalt, 4);
  out.set(nonce, 20);
  dv.setUint16(32, h.length);
  out.set(h, HEADER);
  return out;
}

export function parseChunkData(data) {
  if (data.length < HEADER + TAG) throw verify('chunk_short', 'The restore data is too short.');
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = data[0];
  if (version !== VERSION) throw verify('chunk_version', `The restore data is version ${version}; this tool reads version ${VERSION}. A newer tool may be needed.`);
  const keyMode = data[1];
  if (keyMode !== 0 && keyMode !== 1) throw verify('bad_key_mode', `Unknown key mode ${keyMode}.`);
  const flags = dv.getUint16(2);
  if (flags !== 0) throw verify('chunk_flags', `Unknown flags 0x${flags.toString(16)}.`);
  const hintLen = dv.getUint16(32);
  if (hintLen > HINT_MAX || HEADER + hintLen + TAG > data.length) throw verify('chunk_hint', 'The restore data has a bad hint length.');
  let hint;
  try {
    hint = dec.decode(data.subarray(HEADER, HEADER + hintLen));
  } catch {
    throw verify('chunk_hint', 'The hint is not valid UTF-8.');
  }
  return {
    version, keyMode, flags, hint,
    kdfSalt: data.slice(4, 20),
    nonce: data.slice(20, 32),
    aad: data.subarray(0, HEADER + hintLen),
    ciphertext: data.subarray(HEADER + hintLen),
  };
}

export async function buildPlaintext(meta, mask, patch) {
  const m = enc.encode(JSON.stringify(meta));
  const head = new Uint8Array(4);
  new DataView(head.buffer).setUint32(0, m.length);
  const parts = [head, m, mask, patch];
  return deflate(concat(...parts));
}

// `limit` caps the inflated size (the image size bounds it), so a crafted chunk cannot
// expand without end.
export async function parsePlaintext(bytes, limit) {
  let raw;
  try {
    raw = await inflate(bytes, limit);
  } catch {
    throw verify('payload_inflate', 'The restore data cannot be unpacked.');
  }
  if (raw.length < 4) throw verify('payload_short', 'The restore data is too short.');
  const metaLen = new DataView(raw.buffer, raw.byteOffset).getUint32(0);
  if (4 + metaLen > raw.length) throw verify('payload_meta', 'The restore data has a bad header.');
  let meta;
  try {
    meta = JSON.parse(dec.decode(raw.subarray(4, 4 + metaLen)));
  } catch {
    throw verify('payload_meta', 'The restore data has a bad header.');
  }
  return { meta, body: raw.subarray(4 + metaLen) };
}
