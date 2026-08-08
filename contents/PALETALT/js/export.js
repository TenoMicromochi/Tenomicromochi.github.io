/* ============================================================
   PALETALT-K — export (PNG / text formats / clipboard)
   ============================================================ */
const Exporter = (() => {

  function baseName() {
    const n = State.imgName ? State.imgName.replace(/\.[^.]+$/, '') : 'palette';
    return n.replace(/[\\/:*?"<>|]/g, '_');
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- パレット PNG ----------
     withText=true  … HEXラベル付きのグリッド。可読性優先のため倍率は 4x 固定。
     withText=false … 1色1pxを横に並べただけの帯。scale だけが実寸(px/色)を決める
                      ので、ピクセルアートのパレットファイルやカラーマップの元データ
                      として使う用途に向く。
  ---------------------------------------------------------------- */

  function palettePng(scale, withText) {
    const pal = State.palette;
    if (pal.length === 0) return showError('No palette to export');

    if (!withText) {
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, pal.length * scale);
      cv.height = scale;
      const ctx = cv.getContext('2d');
      pal.forEach((c, i) => {
        ctx.fillStyle = Color.toHex(c);
        ctx.fillRect(i * scale, 0, scale, scale);
      });
      cv.toBlob((blob) => download(blob, baseName() + '_palette_strip.png'));
      return;
    }

    const forcedScale = 4;
    const cell = 64, labelH = 20;
    const perRow = Math.min(pal.length, 8);
    const rows = Math.ceil(pal.length / perRow);

    const cv = document.createElement('canvas');
    cv.width = perRow * cell * forcedScale;
    cv.height = rows * (cell + labelH) * forcedScale;
    const ctx = cv.getContext('2d');
    ctx.scale(forcedScale, forcedScale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);

    pal.forEach((c, i) => {
      const x = (i % perRow) * cell;
      const y = Math.floor(i / perRow) * (cell + labelH);
      ctx.fillStyle = Color.toHex(c);
      ctx.fillRect(x, y, cell, cell);
      ctx.fillStyle = '#333355';
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(Color.toHex(c).toUpperCase(), x + cell / 2, y + cell + 13);
    });

    cv.toBlob((blob) => download(blob, baseName() + '_palette.png'));
  }

  /* ---------- 量子化画像 PNG ---------- */

  function quantizedPng() {
    const q = Render.getQuantized();
    if (!q) return showError('No quantized image');
    const cv = document.createElement('canvas');
    cv.width = q.w; cv.height = q.h;
    cv.getContext('2d').putImageData(new ImageData(q.data, q.w, q.h), 0, 0);
    cv.toBlob((blob) => download(blob, baseName() + '_quantized.png'));
  }

  /* ---------- テキスト形式 ---------- */

  function buildText(format) {
    const pal = State.palette;
    const hexes = pal.map((c) => Color.toHex(c).toUpperCase());

    switch (format) {
      case 'css':
        return ':root {\n' + hexes.map((h, i) => `  --color-${i + 1}: ${h};`).join('\n') + '\n}';
      case 'json':
        return JSON.stringify(pal.map((c, i) => ({
          index: i + 1,
          hex: hexes[i],
          rgb: [c.r, c.g, c.b],
          share: +(c.share * 100).toFixed(3),
        })), null, 2);
      case 'gpl':
        return 'GIMP Palette\nName: ' + baseName() + '\nColumns: 8\n#\n' +
          pal.map((c, i) => `${String(c.r).padStart(3)} ${String(c.g).padStart(3)} ${String(c.b).padStart(3)}\t${hexes[i]}`).join('\n');
      default:
        return hexes.join('\n');
    }
  }

  const EXT = { hex: 'txt', css: 'css', json: 'json', gpl: 'gpl' };

  function saveText(format) {
    if (State.palette.length === 0) return showError('No palette to export');
    const text = buildText(format);
    download(new Blob([text], { type: 'text/plain;charset=utf-8' }),
      baseName() + '_palette.' + (EXT[format] || 'txt'));
  }

  function copyText(text, okMsg) {
    const done = () => showOk(okMsg || 'Copied');
    // file:// では clipboard API が使えないことがあるので execCommand へフォールバック
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallback(text, done));
    } else {
      fallback(text, done);
    }
  }

  function fallback(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { showError('Copy failed'); }
    ta.remove();
  }

  function copyPalette(format) {
    if (State.palette.length === 0) return showError('No palette to export');
    copyText(buildText(format), State.palette.length + ' colors copied');
  }

  return { palettePng, quantizedPng, saveText, copyPalette, copyText, buildText };
})();
