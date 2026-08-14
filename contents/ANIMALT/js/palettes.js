/* ============================================================
   ANIMALT-Δ — palette files（FILE モード）

   PNG から色を読む。GLYPHALT にも同じ機能があるが、あちらは

       drawImage(img, 0,0, natW,natH, 0,0, 16,1)

   と「必ず 16x1 へ縮小」していた。同梱パレットはほとんどが 16x1 なので
   たいていは 1:1 で正確に読めていたが、8x1 の Tonal_Greenscale だけは
   補間で引き伸ばされ、8色が16色の中間色に化けていた。

   ここでは自然サイズのまま走査して色を拾う。
   ・8色並んだ画像なら 8色として読む（残りは埋めない）
   ・格子状に並べた画像でも、重複を落とすので色数どおりに読める
   ・上限 16色で打ち切る（GIF のカラーテーブルに載る数）
   ============================================================ */
const PaletteFiles = (() => {

  const MAX_COLORS = 16;

  const LIST = [
    { name: 'PICO-8',        path: 'Colors/16colors_PICO-8.png' },
    { name: 'Sweetie 16',    path: 'Colors/16colors_Sweetie16.png' },
    { name: 'CYAN//RUINS',   path: 'Colors/16colors_CYAN_RUINS.png' },
    { name: 'PRIDEs',        path: 'Colors/16colors_PRIDEs.png' },
    { name: 'Rainbow',       path: 'Colors/16colors_Rainbow.png' },
    { name: 'Galaxy Flame',  path: 'Colors/16colors_Galaxy_Flame.png' },
    { name: 'Lost Century',  path: 'Colors/16colors_Lost_Century.png' },
    { name: 'Pastel Pop',    path: 'Colors/16colors_Pastel_Pop.png' },
    { name: 'Dusk',          path: 'Colors/4x4colors_Dusk.png' },
    { name: 'Fun',           path: 'Colors/4x4colors_Fun.png' },
    { name: 'Glay',          path: 'Colors/4x4colors_Glay.png' },
    { name: 'Nostalgia',     path: 'Colors/4x4colors_Nostalgia.png' },
    { name: 'Rain',          path: 'Colors/4x4colors_Rain.png' },
    { name: 'APPLE',         path: 'Colors/Legacy_APPLE.png' },
    { name: 'CGA',           path: 'Colors/Legacy_CGA.png' },
    { name: 'Commodore 64',  path: 'Colors/Legacy_Commodore64.png' },
    { name: 'MSX',           path: 'Colors/Legacy_MSX.png' },
    { name: 'Web Color',     path: 'Colors/Legacy_WebColor.png' },
    { name: 'Grayscale',     path: 'Colors/Tonal_Glayscale.png' },
    { name: 'Greenscale',    path: 'Colors/Tonal_Greenscale.png' },
  ];

  const cvs = document.createElement('canvas');
  const ctx = cvs.getContext('2d', { willReadFrequently: true });

  /** 画像を自然サイズのまま走査し、出てきた順に色を拾う（重複は落とす） */
  function readColors(img) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    cvs.width = w; cvs.height = h;
    ctx.imageSmoothingEnabled = false;   // 拡縮しないので効かないが、意図として明示
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0);

    const d = ctx.getImageData(0, 0, w, h).data;
    const seen = new Set();
    const colors = [];
    for (let i = 0; i < d.length && colors.length < MAX_COLORS; i += 4) {
      if (d[i + 3] < 8) continue;        // 透明部分は色として数えない
      const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      if (seen.has(key)) continue;
      seen.add(key);
      colors.push({ r: d[i], g: d[i + 1], b: d[i + 2], n: 1, share: 0 });
    }
    for (const c of colors) c.share = 1 / colors.length;
    return colors;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`palette not found: ${src}`));
      img.src = src;
    });
  }

  /** 同梱パレットを1枚読む */
  async function load(entry) {
    const img = await loadImage(entry.path);
    return readColors(img);
  }

  /** ユーザーが投げ込んだ画像ファイルを読む */
  async function loadFile(file) {
    const url = URL.createObjectURL(file);
    try {
      return readColors(await loadImage(url));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** 一覧表示用に全部読む。失敗したものは落とす */
  async function loadAll() {
    const out = [];
    for (const entry of LIST) {
      try {
        out.push({ name: entry.name, path: entry.path, colors: await load(entry) });
      } catch (e) {
        console.warn('[ANIMALT]', e.message);
      }
    }
    return out;
  }

  return { LIST, MAX_COLORS, load, loadFile, loadAll };
})();
