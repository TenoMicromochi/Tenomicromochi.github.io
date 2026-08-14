/* ============================================================
   ANIMALT — quantization pipeline
   PALETALT-K の quantize.js を、この用途に要る分だけ削って移植したもの。

   1. MEDIAN CUT  分散最大の箱を優先分割して初期プールを作る
   2. CAP         最近傍ペアを潰して TARGET まで確実に落とす
   3. K-MEANS     全色を再割り当てして重心を精錬する
   4. REPRESENT   クラスタごとに代表色を決め直す

   PALETALT との差分は 2 点だけ:
   - ΔE しきい値によるマージ（元の手順4）を落とした。
     ANIMALT では「パレット数＝GIF のカラーテーブル数」なので、
     ユーザーが指定した色数がそのまま出るほうが扱いやすい。
   - 代表色の戦略を centroid / median / mode の 3 つに絞った。
   ============================================================ */
const Quantize = (() => {

  /* ---------- 1. MEDIAN CUT ---------- */

  function makeBox(list) {
    let n = 0;
    const s = [0, 0, 0], ss = [0, 0, 0];
    for (let i = 0; i < list.length; i++) {
      const e = list[i], w = e.n;
      n += w;
      for (let c = 0; c < 3; c++) {
        const x = e.v[c];
        s[c] += x * w;
        ss[c] += x * x * w;
      }
    }
    const mean = [0, 0, 0], varc = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      mean[c] = s[c] / n;
      varc[c] = Math.max(0, ss[c] / n - mean[c] * mean[c]);
    }
    let axis = 0;
    if (varc[1] > varc[axis]) axis = 1;
    if (varc[2] > varc[axis]) axis = 2;
    // 「潰したときの誤差が大きい箱」ほど先に割る
    const priority = (varc[0] + varc[1] + varc[2]) * n;
    return { list, n, mean, axis, priority };
  }

  function splitBox(box) {
    const axis = box.axis;
    const list = box.list.slice().sort((a, b) => a.v[axis] - b.v[axis]);
    const half = box.n / 2;
    let acc = 0, cut = 0;
    for (let i = 0; i < list.length; i++) {
      acc += list[i].n;
      if (acc >= half) { cut = i + 1; break; }
    }
    if (cut <= 0) cut = 1;
    if (cut >= list.length) cut = list.length - 1;
    return [makeBox(list.slice(0, cut)), makeBox(list.slice(cut))];
  }

  function medianCut(entries, poolSize) {
    if (entries.length === 0) return [];
    let boxes = [makeBox(entries)];
    while (boxes.length < poolSize) {
      let bi = -1, best = 0;
      for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].list.length > 1 && boxes[i].priority > best) {
          best = boxes[i].priority; bi = i;
        }
      }
      if (bi < 0) break; // これ以上割れる箱がない
      const [a, b] = splitBox(boxes[bi]);
      boxes.splice(bi, 1, a, b);
    }
    return boxes.map((b) => ({ v: b.mean.slice(), n: b.n }));
  }

  /* ---------- 2. PAIRWISE MERGE ---------- */

  /** 最近傍ペアを繰り返し統合して minCount 個まで落とす */
  function mergePairs(colors, minCount) {
    const cur = colors.map((c) => ({ v: c.v.slice(), n: c.n }));
    while (cur.length > minCount && cur.length > 1) {
      let bd = Infinity, bi = -1, bj = -1;
      for (let i = 0; i < cur.length; i++) {
        for (let j = i + 1; j < cur.length; j++) {
          const d = Color.dist2(cur[i].v, cur[j].v);
          if (d < bd) { bd = d; bi = i; bj = j; }
        }
      }
      if (bi < 0) break;
      const a = cur[bi], b = cur[bj];
      // 空クラスタ由来の n=0 で 0 除算しないよう下限 1 を置く
      const wa = Math.max(1, a.n), wb = Math.max(1, b.n);
      const m = {
        v: [
          (a.v[0] * wa + b.v[0] * wb) / (wa + wb),
          (a.v[1] * wa + b.v[1] * wb) / (wa + wb),
          (a.v[2] * wa + b.v[2] * wb) / (wa + wb),
        ],
        n: a.n + b.n,
      };
      cur.splice(bj, 1);
      cur.splice(bi, 1);
      cur.push(m);
    }
    return cur;
  }

  /* ---------- 3. K-MEANS (Lloyd) ---------- */

  function kmeans(entries, centers, iters) {
    if (iters <= 0 || centers.length === 0) return centers;
    let cur = centers.map((c) => c.v.slice());
    const k = cur.length;

    for (let it = 0; it < iters; it++) {
      const acc = new Float64Array(k * 4); // x, y, z, weight
      for (let i = 0; i < entries.length; i++) {
        const v = entries[i].v;
        let bi = 0, bd = Infinity;
        for (let c = 0; c < k; c++) {
          const cc = cur[c];
          const x = v[0] - cc[0], y = v[1] - cc[1], z = v[2] - cc[2];
          const d = x * x + y * y + z * z;
          if (d < bd) { bd = d; bi = c; }
        }
        const w = entries[i].n, o = bi * 4;
        acc[o] += v[0] * w; acc[o + 1] += v[1] * w; acc[o + 2] += v[2] * w; acc[o + 3] += w;
      }

      let moved = 0;
      const next = new Array(k);
      for (let c = 0; c < k; c++) {
        const o = c * 4, w = acc[o + 3];
        if (w === 0) { next[c] = cur[c]; continue; } // 空クラスタは据え置き
        next[c] = [acc[o] / w, acc[o + 1] / w, acc[o + 2] / w];
        moved += Math.abs(next[c][0] - cur[c][0])
               + Math.abs(next[c][1] - cur[c][1])
               + Math.abs(next[c][2] - cur[c][2]);
      }
      cur = next;
      if (moved < 0.01) break; // 収束したら早期終了
    }
    return cur.map((v) => ({ v, n: 0 }));
  }

  /* ---------- 割り当て ---------- */

  function assignAll(entries, centers) {
    const clusters = centers.map(() => []);
    for (let i = 0; i < entries.length; i++) {
      const v = entries[i].v;
      let bi = 0, bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = Color.dist2(v, centers[c].v);
        if (d < bd) { bd = d; bi = c; }
      }
      clusters[bi].push(entries[i]);
    }
    return clusters;
  }

  /* ---------- 4. 代表色 ---------- */

  function weightedMean(list) {
    let r = 0, g = 0, b = 0, n = 0;
    for (const e of list) { r += e.r * e.n; g += e.g * e.n; b += e.b * e.n; n += e.n; }
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
  }

  function weightedMedian(list) {
    const pick = (ch) => {
      const sorted = list.slice().sort((a, b) => a[ch] - b[ch]);
      const half = sorted.reduce((s, e) => s + e.n, 0) / 2;
      let acc = 0;
      for (const e of sorted) { acc += e.n; if (acc >= half) return e[ch]; }
      return sorted[sorted.length - 1][ch];
    };
    return { r: pick('r'), g: pick('g'), b: pick('b') };
  }

  function modeBinned(list) {
    const bins = new Map();
    for (const e of list) {
      const key = ((e.r >> 3) << 10) | ((e.g >> 3) << 5) | (e.b >> 3);
      let bin = bins.get(key);
      if (!bin) { bin = { list: [], n: 0 }; bins.set(key, bin); }
      bin.list.push(e); bin.n += e.n;
    }
    let best = null;
    for (const bin of bins.values()) if (!best || bin.n > best.n) best = bin;
    return weightedMean(best.list);
  }

  function representative(list, center, p) {
    if (list.length === 0) {
      const [r, g, b] = Color.fromWork(center.v, p.space);
      return { r, g, b };
    }
    let col;
    switch (p.strategy) {
      case 'median': col = weightedMedian(list); break;
      case 'mode':   col = modeBinned(list); break;
      default: {
        // centroid は k-means が出した重心をそのまま使う
        const [r, g, b] = Color.fromWork(center.v, p.space);
        col = { r, g, b };
      }
    }
    if (p.chromaBias > 0) {
      let vivid = list[0], bc = -1;
      for (const e of list) {
        const c = Color.chroma(e.r, e.g, e.b);
        if (c > bc) { bc = c; vivid = e; }
      }
      const t = p.chromaBias / 100;
      col = {
        r: Math.round(col.r * (1 - t) + vivid.r * t),
        g: Math.round(col.g * (1 - t) + vivid.g * t),
        b: Math.round(col.b * (1 - t) + vivid.b * t),
      };
    }
    return col;
  }

  /* ---------- パイプライン ---------- */

  function extract(hist, p) {
    const entries = hist.entries;
    if (entries.length === 0) return [];

    const target = Math.min(p.target, entries.length);
    const poolSize = Math.max(target, Math.min(p.pool, entries.length));

    const pool = medianCut(entries, poolSize);
    let centers = mergePairs(pool, target);
    centers = kmeans(entries, centers, p.kmeans);

    const clusters = assignAll(entries, centers);
    const palette = [];
    for (let i = 0; i < clusters.length; i++) {
      const list = clusters[i];
      if (list.length === 0) continue; // 空クラスタは捨てる
      const n = list.reduce((s, e) => s + e.n, 0);
      const col = representative(list, centers[i], p);
      palette.push({ r: col.r, g: col.g, b: col.b, n, share: n / hist.total });
    }
    sortPalette(palette, p.sortBy);
    return palette;
  }

  function sortPalette(palette, mode) {
    const key = {
      population: (c) => -c.n,
      lightness:  (c) => Color.lightness(c.r, c.g, c.b),
      hue:        (c) => Color.hue(c.r, c.g, c.b),
      chroma:     (c) => -Color.chroma(c.r, c.g, c.b),
    }[mode] || ((c) => Color.lightness(c.r, c.g, c.b));
    palette.sort((a, b) => key(a) - key(b));
  }

  return { extract, sortPalette };
})();
