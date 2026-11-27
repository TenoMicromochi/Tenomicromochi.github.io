// MP4 の箱詰め（純粋な関数）。映像（H.264）だけ。moov を先頭に置く。
// 戻り：Uint8Array の配列（Blob にそのまま渡せる）

function u16(n) { return [(n >>> 8) & 255, n & 255]; }
function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
function str(s) { return [...s].map((c) => c.charCodeAt(0)); }
function bytes(...xs) {
  const flat = xs.flatMap((x) => (typeof x === 'number' ? [x] : Array.from(x)));
  return Uint8Array.from(flat);
}
function cat(list) {
  let n = 0;
  for (const a of list) n += a.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of list) { out.set(a, o); o += a.length; }
  return out;
}
function box(type, ...payload) {
  const body = cat(payload.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p))));
  return cat([Uint8Array.from([...u32(body.length + 8), ...str(type)]), body]);
}
const full = (version, flags) => [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255];
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].flatMap(u32);

// opts = { w, h, timescale, avcC(Uint8Array), samples: [{ data(Uint8Array), duration, key }] }
// duration は timescale 単位。avcC はエンコーダーの decoderConfig.description そのまま
export function buildMp4({ w, h, timescale = 1000, avcC, samples }) {
  const N = samples.length;
  if (N < 1) throw new Error('no samples');
  let total = 0, dataBytes = 0;
  for (const s of samples) { total += s.duration; dataBytes += s.data.length; }
  if (dataBytes + 8 > 0xFFFFFFFF) throw new Error('too large for MP4');

  const ftyp = box('ftyp', str('isom'), u32(512), str('isom'), str('iso2'), str('avc1'), str('mp41'));

  // stts：同じ長さが続くところをまとめる
  const runs = [];
  for (const s of samples) {
    const last = runs[runs.length - 1];
    if (last && last[1] === s.duration) last[0]++;
    else runs.push([1, s.duration]);
  }
  const keys = [];
  samples.forEach((s, i) => { if (s.key) keys.push(i + 1); });

  const build = (chunkOffset) => {
    const mvhd = box('mvhd', full(0, 0), u32(0), u32(0), u32(timescale), u32(total),
      u32(0x00010000), u16(0x0100), new Array(10).fill(0), MATRIX, new Array(24).fill(0), u32(2));
    const tkhd = box('tkhd', full(0, 3), u32(0), u32(0), u32(1), u32(0), u32(total),
      new Array(8).fill(0), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(w << 16), u32(h << 16));
    const mdhd = box('mdhd', full(0, 0), u32(0), u32(0), u32(timescale), u32(total), u16(0x55C4), u16(0));
    const hdlr = box('hdlr', full(0, 0), u32(0), str('vide'), new Array(12).fill(0), str('VideoHandler'), [0]);
    const vmhd = box('vmhd', full(0, 1), u16(0), new Array(6).fill(0));
    const dinf = box('dinf', box('dref', full(0, 0), u32(1), box('url ', full(0, 1))));
    const avc1 = box('avc1', new Array(6).fill(0), u16(1), u16(0), u16(0), new Array(12).fill(0),
      u16(w), u16(h), u32(0x00480000), u32(0x00480000), u32(0), u16(1), new Array(32).fill(0),
      u16(0x0018), u16(0xFFFF), box('avcC', avcC));
    const stsd = box('stsd', full(0, 0), u32(1), avc1);
    const stts = box('stts', full(0, 0), u32(runs.length), runs.flatMap(([c, d]) => [...u32(c), ...u32(d)]));
    const stss = box('stss', full(0, 0), u32(keys.length), keys.flatMap(u32));
    const stsc = box('stsc', full(0, 0), u32(1), u32(1), u32(N), u32(1));
    const stsz = box('stsz', full(0, 0), u32(0), u32(N), samples.flatMap((s) => u32(s.data.length)));
    const stco = box('stco', full(0, 0), u32(1), u32(chunkOffset));
    const stbl = box('stbl', stsd, stts, stss, stsc, stsz, stco);
    const minf = box('minf', vmhd, dinf, stbl);
    const mdia = box('mdia', mdhd, hdlr, minf);
    const trak = box('trak', tkhd, mdia);
    return box('moov', mvhd, trak);
  };
  const moov0 = build(0);
  const moov = build(ftyp.length + moov0.length + 8);   // 8 は mdat の見出し
  const mdatHead = Uint8Array.from([...u32(dataBytes + 8), ...str('mdat')]);
  return [ftyp, moov, mdatHead, ...samples.map((s) => s.data)];
}
