/* ============================================================
   ANIMALT — input decoding

   静止画 / アニメーション GIF・WebP / 動画 のどれを渡されても、
   { bitmap, delayMs } の配列に均してから先へ渡す。
   以降のパイプラインは入力が何だったかを知らない。

   切り出しの設定は4つ。
     FPS    … 出力の1秒あたりコマ数。動画のサンプリング間隔を決める
     SPEED  … 元素材を何倍速で流すか
     START  … 元素材のどこから切り出すか（秒）
     LENGTH … 元素材を何秒ぶん切り出すか

   コマ数は MAX_FRAMES で頭打ちにする。UI 側と同じ式で見積れるよう
   plan() を公開していて、「設定どおりだと何コマになるか」「上限に
   当たっているか」を読み込み前から出せるようにしてある。

   アニメーション GIF/WebP は元のコマ間隔を持っているので、そこへ FPS を
   かぶせて打ち直すと同じ絵が並ぶだけで太る。よって FPS は動画専用とし、
   アニメ画像は元のタイミングを保ったまま START/LENGTH で切り、
   SPEED は表示時間の割り算だけで効かせる。

   アニメーションのデコードには WebCodecs の ImageDecoder を使う。
   GIF デコーダを自前で書かずに済むが、非対応ブラウザでは
   1コマ目だけの静止画として扱う（その旨を status に出す）。
   ============================================================ */
const Source = (() => {

  const hasImageDecoder = typeof ImageDecoder !== 'undefined';

  /* 出力コマ数の上限。ここを超えると等間隔で間引く（動画は打ち切る）。
     16s × 60fps = 960 コマのような指定を、そのまま回すと待たされるので */
  const MAX_FRAMES = 256;

  function guessType(file) {
    if (file.type) return file.type;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    return { gif: 'image/gif', webp: 'image/webp', png: 'image/png',
             jpg: 'image/jpeg', jpeg: 'image/jpeg', mp4: 'video/mp4',
             webm: 'video/webm' }[ext] || '';
  }

  /**
   * 設定から「何コマ / 何秒の出力になるか」を見積る。
   * デコード本体と UI の表示が食い違わないよう、式はここ1箇所だけに置く。
   * @param durationSec 元素材の長さ。未読み込みなら 0 か null を渡す
   */
  function plan(durationSec, opt) {
    const fps = Math.max(1, opt.fps || 12);
    const speed = Math.max(0.1, opt.speed || 1);
    const known = durationSec > 0 && isFinite(durationSec);

    // 開始位置は素材の末尾を越えないところまで
    const start = known ? Math.min(opt.start || 0, Math.max(0, durationSec - 1 / fps))
                        : (opt.start || 0);
    const avail = known ? Math.max(1 / fps, durationSec - start) : Infinity;
    const len = Math.min(opt.length || 1, avail);

    const want = Math.max(1, Math.round((len / speed) * fps));
    const count = Math.min(MAX_FRAMES, want);
    return { fps, speed, start, len, want, count,
             capped: want > MAX_FRAMES, outMs: (count * 1000) / fps };
  }

  /** 静止画1枚 */
  async function decodeStill(file) {
    const bitmap = await createImageBitmap(file);
    return { kind: 'still', frames: [{ bitmap, delayMs: 100 }], duration: 0 };
  }

  /** アニメーション GIF / WebP。元のコマ間隔は保ったまま切り出す */
  async function decodeAnimated(file, type, opt, onProgress) {
    const buf = await file.arrayBuffer();
    const dec = new ImageDecoder({ data: buf, type });
    // completed だけでは tracks がまだ空。frameCount を読む前に
    // tracks.ready も待つ必要がある（待たないと常に静止画扱いになる）
    await dec.tracks.ready;
    await dec.completed;

    const track = dec.tracks.selectedTrack;
    const total = track ? track.frameCount : 1;
    if (total <= 1) {
      const { image } = await dec.decode({ frameIndex: 0 });
      const bitmap = await createImageBitmap(image);
      image.close();
      return { kind: 'still', frames: [{ bitmap, delayMs: 100 }], duration: 0 };
    }

    // 1周目 — 表示時間だけ読む。ビットマップは作らないので窓の外を持ち続けずに済む
    const times = new Float64Array(total);
    let totalMs = 0;
    for (let i = 0; i < total; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      // duration はマイクロ秒。未指定の GIF があるので既定値を用意する
      const d = image.duration ? image.duration / 1000 : 100;
      image.close();
      times[i] = d; totalMs += d;
    }

    // START / LENGTH の窓に掛かるコマを拾う
    const startMs = Math.min((opt.start || 0) * 1000, Math.max(0, totalMs - 1));
    const endMs = startMs + Math.min((opt.length || 1) * 1000, totalMs - startMs);
    const pick = [];
    let cum = 0;
    for (let i = 0; i < total; i++) {
      const a = cum; cum += times[i];
      if (cum <= startMs) continue;
      if (a >= endMs) break;
      pick.push(i);
    }
    if (!pick.length) pick.push(0);

    // 多すぎるぶんは等間隔で間引き、飛ばしたコマの時間は残したコマへ足し込む
    const stride = Math.max(1, Math.ceil(pick.length / MAX_FRAMES));
    const speed = Math.max(0.1, opt.speed || 1);
    const outCount = Math.ceil(pick.length / stride);

    // 2周目 — 実際に使うコマだけビットマップにする
    const frames = [];
    for (let k = 0; k < pick.length; k += stride) {
      let ms = 0;
      for (let j = k; j < Math.min(k + stride, pick.length); j++) ms += times[pick[j]];
      const { image } = await dec.decode({ frameIndex: pick[k] });
      const bitmap = await createImageBitmap(image);
      image.close();
      // 10ms 未満はブラウザ側で丸められるので、そこで下げ止める
      frames.push({ bitmap, delayMs: Math.max(10, ms / speed) });
      if (onProgress) onProgress(frames.length, outCount);
    }
    dec.close();
    return { kind: 'anim', frames, sourceFrameCount: total,
             duration: totalMs / 1000, capped: pick.length > MAX_FRAMES };
  }

  /** 動画ファイル。シークしながら一定間隔で拾う */
  async function decodeVideo(file, opt, onProgress) {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;

    try {
      await new Promise((res, rej) => {
        v.onloadedmetadata = res;
        v.onerror = () => rej(new Error('この動画は読み込めなかった'));
      });

      if (!isFinite(v.duration) || v.duration <= 0)
        throw new Error('この動画は尺が読めなかった（シークできない形式かも）');
      if (!v.videoWidth || !v.videoHeight)
        throw new Error('この動画は映像トラックが読めなかった');

      const p = plan(v.duration, opt);
      // 出力1コマぶん進むあいだに、元動画が何秒進むか
      const step = p.speed / p.fps;
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      const cx = c.getContext('2d');

      // シークが返ってこない動画があるので待ちっぱなしにはしない。
      // ここで固まると status が「Decoding…」のまま操作不能に見える
      const seek = (t) => new Promise((res, rej) => {
        const timer = setTimeout(
          () => rej(new Error(`シークが返ってこない（${t.toFixed(2)}s）`)), 8000);
        v.onseeked = () => { clearTimeout(timer); res(); };
        v.currentTime = t;
      });

      const frames = [];
      for (let i = 0; i < p.count; i++) {
        const t = p.start + i * step;
        if (t > v.duration) break;
        await seek(t);
        cx.drawImage(v, 0, 0);
        frames.push({ bitmap: await createImageBitmap(c), delayMs: 1000 / p.fps });
        if (onProgress) onProgress(frames.length, p.count);
      }
      if (!frames.length) throw new Error('切り出す範囲に映像がなかった（START を戻して）');
      return { kind: 'video', frames, sourceFrameCount: frames.length,
               duration: v.duration, capped: p.capped };
    } finally {
      v.onseeked = null;
      v.src = '';
      URL.revokeObjectURL(url);
    }
  }

  /**
   * @returns {{kind:string, frames:Array<{bitmap:ImageBitmap, delayMs:number}>,
   *            duration:number, capped?:boolean, note?:string}}
   */
  async function load(file, opt, onProgress) {
    const type = guessType(file);

    if (type.startsWith('video/')) {
      return decodeVideo(file, opt, onProgress);
    }
    if (type === 'image/gif' || type === 'image/webp' || type === 'image/avif') {
      if (!hasImageDecoder) {
        const r = await decodeStill(file);
        r.note = 'このブラウザは ImageDecoder 非対応。1コマ目だけを静止画として扱う';
        return r;
      }
      return decodeAnimated(file, type, opt, onProgress);
    }
    return decodeStill(file);
  }

  return { load, plan, hasImageDecoder, MAX_FRAMES };
})();
