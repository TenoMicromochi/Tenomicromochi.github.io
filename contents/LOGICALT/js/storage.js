// storage.js — PNG の書き出し/読み込み（SPEC 8節）と、IndexedDB の読み書きの道具（自動保存の本体は autosave.js）
// 裏面にセルがあるときは、左に表・右に裏を並べた 2 面の PNG にし、tEXt チャンク（PixelCircuit / layers=2）で印を付ける。
import { M, COLOR_MAP, saveRgb } from './materials.js';
import { W, H, cellIndex } from './world.js';

const MARK_KEY = 'PixelCircuit', MARK_VAL = 'layers=2';

// 矩形 rect の中で、使っているセルを囲む最小矩形（mask の面だけ。bit0 = FRONT, bit1 = BACK）
function boundsIn(world, rect, mask = 3) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let l = 0; l < 2; l++) {
    if (!(mask & (1 << l))) continue;
    for (let y = rect.y0; y <= rect.y1; y++) {
      const row = cellIndex(l, 0, y);
      for (let x = rect.x0; x <= rect.x1; x++) {
        if (!world.mat[row + x]) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// 書き出す範囲と面を決める。only >= 0 ならその面だけの 1 面。-1 なら両面（裏が空なら 1 面）
// 返り値 { b: 矩形, layers: [面...] }。空なら null
function plan(world, rect, only) {
  const bnd = (mask) => (rect ? boundsIn(world, rect, mask) : world.bounds(mask));
  if (only >= 0) {
    const b = bnd(1 << only);
    return b ? { b, layers: [only] } : null;
  }
  const b = bnd(3);
  if (!b) return null;
  return { b, layers: bnd(2) ? [0, 1] : [0] };
}

// CRC32（PNG のチャンク用）
let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// PNG のバイト列の IHDR の直後に tEXt チャンクを差し込む（ブラウザの canvas は書かないので自分で作る）
function insertTextChunk(png, key, val) {
  const enc = new TextEncoder();
  const k = enc.encode(key), v = enc.encode(val);
  const data = new Uint8Array(k.length + 1 + v.length);
  data.set(k, 0); data[k.length] = 0; data.set(v, k.length + 1);
  const body = new Uint8Array(4 + data.length); // 種別 + データ（CRC の対象）
  body.set(enc.encode('tEXt'), 0); body.set(data, 4);
  const chunk = new Uint8Array(12 + data.length), dv = new DataView(chunk.buffer);
  dv.setUint32(0, data.length);
  chunk.set(body, 4);
  dv.setUint32(8 + data.length, crc32(body));
  const at = 8 + 25; // シグネチャ 8 + IHDR（長さ 4 + 種別 4 + データ 13 + CRC 4）
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, at), 0); out.set(chunk, at); out.set(png.subarray(at), at + chunk.length);
  return out;
}

// PNG のバイト列から tEXt チャンクを探す。返り値 { key: value }
function readTextChunks(png) {
  const out = {};
  if (png.length < 33) return out;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength), dec = new TextDecoder('latin1');
  let p = 8;
  while (p + 12 <= png.length) {
    const len = dv.getUint32(p), type = dec.decode(png.subarray(p + 4, p + 8));
    if (type === 'IDAT' || type === 'IEND') break;
    if (type === 'tEXt' && p + 12 + len <= png.length) {
      const data = png.subarray(p + 8, p + 8 + len), z = data.indexOf(0);
      if (z >= 0) out[dec.decode(data.subarray(0, z))] = dec.decode(data.subarray(z + 1));
    }
    p += 12 + len;
  }
  return out;
}

// world -> PNG。rect = 範囲（null = 全体）、only = 1 面だけ書くときの面（-1 = 両面）
export function encodePng(world, rect = null, only = -1) {
  const pl = plan(world, rect, only);
  if (!pl) return Promise.resolve(null);
  const { b, layers } = pl, n = layers.length;
  const c = document.createElement('canvas');
  c.width = b.w * n; c.height = b.h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(b.w * n, b.h);
  const d = img.data, mat = world.mat, aux = world.aux, rowW = b.w * n;
  layers.forEach((ly, k) => {
    for (let y = 0; y < b.h; y++) {
      let i = cellIndex(ly, b.x0, b.y0 + y), o = (y * rowW + k * b.w) * 4;
      for (let x = 0; x < b.w; x++, i++, o += 4) {
        const rgb = saveRgb(mat[i], aux[i]);
        d[o] = (rgb >> 16) & 255; d[o + 1] = (rgb >> 8) & 255; d[o + 2] = rgb & 255; d[o + 3] = 255;
      }
    }
  });
  ctx.putImageData(img, 0, 0);
  return new Promise((res) => c.toBlob(async (blob) => {
    if (n === 2) blob = new Blob([insertTextChunk(new Uint8Array(await blob.arrayBuffer()), MARK_KEY, MARK_VAL)], { type: 'image/png' });
    res({ blob, w: b.w, h: b.h, x: b.x0, y: b.y0, layers: n });
  }, 'image/png'));
}

// 色 1 つを素材にする。透明は EMPTY。未知色は unknown に数える
function classify(rgb, alpha, q, p) {
  if (alpha === 0) return 0;
  const v = alpha === 255 ? COLOR_MAP.get(rgb) : undefined;
  if (!v) return 1;
  q.mat[p] = v.mat;
  if (v.mat === M.LAMP) q.aux[p] = v.aux;
  else if (v.mat === M.TFF) q.aux[p] = v.on;
  return 0;
}

// HOLE が片面にしかない場合（壊れたファイルなど）は、両面に HOLE を補う
function fixHoles(layers) {
  const a = layers[0], b = layers[1];
  if (!b) return;
  for (let p = 0; p < a.mat.length; p++) {
    if (a.mat[p] === M.HOLE || b.mat[p] === M.HOLE) {
      a.mat[p] = M.HOLE; a.aux[p] = 0; b.mat[p] = M.HOLE; b.aux[p] = 0;
    }
  }
}

// PNG -> {w, h, layers: [{mat, aux}, {mat, aux} | null], unknown}。w, h は 1 面の大きさ
// 大きすぎる場合は {error:'toolarge', w, h}（w, h は 1 面の大きさ）
export async function decodePng(blob) {
  let bmp, marks = {};
  try {
    marks = readTextChunks(new Uint8Array(await blob.arrayBuffer()));
    bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
  } catch (e) { return { error: 'invalid' }; }
  const fw = bmp.width, h = bmp.height;
  const two = marks[MARK_KEY] === MARK_VAL && fw % 2 === 0;
  const w = two ? fw / 2 : fw;
  if (w > W || h > H) { bmp.close && bmp.close(); return { error: 'toolarge', w, h }; }
  const c = document.createElement('canvas');
  c.width = fw; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close && bmp.close();
  const d = ctx.getImageData(0, 0, fw, h).data;
  const layers = [], n = two ? 2 : 1;
  let unknown = 0;
  for (let k = 0; k < n; k++) {
    const q = { mat: new Uint8Array(w * h), aux: new Uint8Array(w * h) };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * fw + k * w + x) * 4;
      unknown += classify((d[o] << 16) | (d[o + 1] << 8) | d[o + 2], d[o + 3], q, y * w + x);
    }
    layers.push(q);
  }
  if (!two) layers.push(null);
  fixHoles(layers);
  return { w, h, layers, unknown };
}

export function timestamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---- IndexedDB（Cookie / localStorage は使わない） ----
let dbp = null, dbConn = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('pixel_circuit', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => { dbConn = r.result; res(r.result); };
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
// 開いておく（ページを離れるときに、await なしで同期的にトランザクションを始めるため）
export function idbWarm() { return db().catch(() => {}); }
// 同期版：接続が開いていればその場でトランザクションを始める（pagehide 用）。開いていなければ通常版へ
export function idbPutSync(key, val) {
  if (!dbConn) { idbPut(key, val).catch(() => {}); return; }
  try { dbConn.transaction('kv', 'readwrite').objectStore('kv').put(val, key); }
  catch (e) { idbPut(key, val).catch(() => {}); }
}
export function idbDeleteSync(key) {
  if (!dbConn) { idbDelete(key).catch(() => {}); return; }
  try { dbConn.transaction('kv', 'readwrite').objectStore('kv').delete(key); }
  catch (e) { idbDelete(key).catch(() => {}); }
}
export async function idbGet(key) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('kv').objectStore('kv').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
// 書き込み系（put / delete）はトランザクションの完了を待つ
function idbWrite(op) {
  return db().then((database) => new Promise((resolve, reject) => {
    const tx = database.transaction('kv', 'readwrite');
    op(tx.objectStore('kv'));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}
export const idbPut = (key, val) => idbWrite((store) => store.put(val, key));
export const idbDelete = (key) => idbWrite((store) => store.delete(key));

// ページを閉じる直前用：PNG の非同期エンコードを待てないので、同じ内容（色表の値）を RGB の生配列で同期的に書き始める
export function rawSnapshot(world) {
  const pl = plan(world, null, -1);
  if (!pl) return null;
  const { b, layers } = pl, n = layers.length, sz = b.w * b.h * 3;
  const rgb = new Uint8Array(sz * n);
  layers.forEach((ly, k) => {
    let o = k * sz;
    for (let y = b.y0; y < b.y0 + b.h; y++) {
      let i = cellIndex(ly, b.x0, y);
      for (let x = 0; x < b.w; x++, i++, o += 3) {
        const c = saveRgb(world.mat[i], world.aux[i]);
        rgb[o] = (c >> 16) & 255; rgb[o + 1] = (c >> 8) & 255; rgb[o + 2] = c & 255;
      }
    }
  });
  return { w: b.w, h: b.h, x: b.x0, y: b.y0, layers: n, rgb, t: Date.now() };
}

export function decodeRaw(r) {
  const { w, h, rgb } = r, n = r.layers || 1, sz = w * h * 3;
  const layers = [];
  let unknown = 0;
  for (let k = 0; k < n; k++) {
    const q = { mat: new Uint8Array(w * h), aux: new Uint8Array(w * h) };
    for (let p = 0, o = k * sz; p < w * h; p++, o += 3) unknown += classify((rgb[o] << 16) | (rgb[o + 1] << 8) | rgb[o + 2], 255, q, p);
    layers.push(q);
  }
  if (n === 1) layers.push(null);
  fixHoles(layers);
  return { w, h, layers, unknown };
}
