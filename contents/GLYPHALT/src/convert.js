// 入力画像→出力キャンバスへの変換処理全体(調整・パディング・グリフマッチング・進捗表示)
import { clampSize, showError } from './ui.js';
import { applyAdjustments } from './image-pipeline.js';
import { makeConversionSnapshot, extractCellFeature, createMatcher } from './matching.js';
import { GLYPH_W, GLYPH_H } from './glyph.js';

// 入力画像・変換中/完了状態などのモジュール内共有ステート
let inputImageData = null;
let inputFile = null;
let outputReady = false;
let convertRAF = null;
let isConverting = false;
let startTime = 0;
let srcAspect = null;

export function setInputImageData(data) { inputImageData = data; }
export function getInputImageData() { return inputImageData; }
export function setInputFile(file) { inputFile = file; }
export function getInputFile() { return inputFile; }
export function setSrcAspect(aspect) { srcAspect = aspect; }
export function getSrcAspect() { return srcAspect; }
export function isOutputReady() { return outputReady; }
export function getIsConverting() { return isConverting; }

// CONVERTボタンの表示(ラベル/色/活性状態)を変換中かどうかに合わせて更新
export function setConversionState(running) {
  isConverting = running;
  const btn = document.getElementById('convertBtn');
  btn.textContent = running ? 'STOP CONVERT' : 'CONVERT';
  btn.classList.toggle('stop', running);
  btn.disabled = !running && !inputImageData;
}

// 実行中の変換を中断し、進捗表示・ダウンロードボタンなどをリセット
export function stopConvert() {
  if (!isConverting) return;
  if (convertRAF) cancelAnimationFrame(convertRAF);
  convertRAF = null;
  outputReady = false;
  document.getElementById('progressText').textContent = 'Cancelled';
  document.getElementById('progressWrap').classList.remove('show');
  document.getElementById('downloadBtn').disabled = true;
  setConversionState(false);
}

// 変換本体: 現在の設定をスナップショットして固定し、画像調整→8px単位へのパディング→
// セルごとにグリフマッチングを行い、outputCanvasへ順次描画していく(requestAnimationFrameでバッチ処理)
export function startConvert() {
  if (!inputImageData) return;
  if (convertRAF) cancelAnimationFrame(convertRAF);

  // パレット/グリフ/分割モードを変換開始時点の状態に固定(以降のUI操作の影響を受けない)
  const snapshot = makeConversionSnapshot();
  if (!snapshot) {
    showError('No glyphs or palette colors enabled.'); return;
  }

  const matcher = createMatcher(snapshot);

  // IMAGE ADJUSTセクションの現在値を取得
  const params = {
    sobel:      parseInt(document.getElementById('sobel').value),
    blur:       parseInt(document.getElementById('blur').value),
    sharp:      parseInt(document.getElementById('sharp').value),
    gamma:      parseInt(document.getElementById('gamma').value),
    brightness: parseInt(document.getElementById('brightness').value),
    contrast:   parseInt(document.getElementById('contrast').value),
    saturation: parseInt(document.getElementById('saturation').value),
    hue:        parseInt(document.getElementById('hue').value),
    posterize:  parseInt(document.getElementById('posterize').value),
    dither:     parseInt(document.getElementById('dither').value),
    negative:   document.getElementById('negative').checked,
  };
  const outW = clampSize(parseInt(document.getElementById('outWidth').value));
  const outH = clampSize(parseInt(document.getElementById('outHeight').value));
  const tmpC = document.createElement('canvas');
  tmpC.width = inputImageData.width; tmpC.height = inputImageData.height;
  tmpC.getContext('2d').putImageData(inputImageData, 0, 0);

  // 出力サイズにリサイズしてから画像調整を適用
  const wc = document.getElementById('workCanvas');
  wc.width = outW; wc.height = outH;
  const wcCtx = wc.getContext('2d');
  wcCtx.imageSmoothingEnabled = true; wcCtx.imageSmoothingQuality = 'high';
  wcCtx.drawImage(tmpC, 0, 0, outW, outH);

  const adjData = wcCtx.getImageData(0, 0, outW, outH);
  applyAdjustments(adjData, params);
  wcCtx.putImageData(adjData, 0, 0);

  // グリフセルの整数倍サイズになるよう、右端/下端を黒で埋めてパディング
  const cellsX=Math.ceil(outW/GLYPH_W), cellsY=Math.ceil(outH/GLYPH_H);
  const padW=cellsX*GLYPH_W, padH=cellsY*GLYPH_H;

  const padC = document.createElement('canvas');
  padC.width=padW; padC.height=padH;
  const padCtx=padC.getContext('2d');
  padCtx.fillStyle='#000'; padCtx.fillRect(0,0,padW,padH);
  padCtx.putImageData(adjData, 0, 0);
  const padData=padCtx.getImageData(0,0,padW,padH).data;

  const oc=document.getElementById('outputCanvas');
  oc.width=padW; oc.height=padH;
  const outCtx=oc.getContext('2d');
  outCtx.fillStyle='#000'; outCtx.fillRect(0,0,padW,padH);

  const total=cellsX*cellsY; let idx=0;
  startTime=performance.now();

  // 同一内容のセルを再計算しないためのキャッシュ(cellKey=8x8ピクセルの生データ)
  const cellCache = new Map();
  let cacheHits = 0;
  const cellImg = outCtx.createImageData(GLYPH_W, GLYPH_H);
  const cellImgData = cellImg.data;
  const cellPx = new Uint8ClampedArray(GLYPH_W*GLYPH_H*4);
  const cellWords = new Uint32Array(cellPx.buffer);

  // 変換開始時のUI状態を更新(進捗バー表示、ボタン活性、情報バーの初期値など)
  document.getElementById('progressWrap').classList.add('show');
  setConversionState(true);
  document.getElementById('downloadBtn').disabled=true;
  document.getElementById('tweetBtn').disabled=true;
  document.getElementById('placeholder').style.display='none';
  oc.style.display='block';
  document.getElementById('infoSize').textContent =`${padW}×${padH}`;
  document.getElementById('infoCells').textContent=`${cellsX}×${cellsY}`;
  document.getElementById('infoGlyphs').textContent=snapshot.masks.length;
  document.getElementById('infoBar').style.display='flex';
  outputReady=false;

  // 1フレームあたりBATCH件ずつセルを処理し、都度requestAnimationFrameで続きを予約する
  const BATCH=64;
  function processChunk() {
    if (!isConverting) return;
    const end=Math.min(idx+BATCH, total);
    for (; idx<end; idx++) {
      const cx=idx%cellsX, cy=Math.floor(idx/cellsX);
      const px0=cx*GLYPH_W, py0=cy*GLYPH_H;

      // パディング済み画像から対象セルの8x8ピクセルを切り出す
      for (let py=0; py<GLYPH_H; py++)
        for (let px=0; px<GLYPH_W; px++) {
          const si=((py0+py)*padW+(px0+px))*4, di=(py*GLYPH_W+px)*4;
          cellPx[di]=padData[si]; cellPx[di+1]=padData[si+1];
          cellPx[di+2]=padData[si+2]; cellPx[di+3]=255;
        }

      // 同一ピクセル内容ならキャッシュを再利用し、無ければ特徴量抽出→マッチングして結果を保存
      const cellKey = cellWords.join(',');
      let best = cellCache.get(cellKey);

      if (best === undefined) {
        const cellFeat=extractCellFeature(cellPx, GLYPH_W, GLYPH_H, snapshot.mode);
        best = matcher(cellFeat);
        cellCache.set(cellKey, best);
      } else {
        cacheHits++;
      }

      // マッチした(背景色, 前景色, グリフ)でセルを塗り、出力キャンバスへ描画
      if (best) {
        const bgRGB=snapshot.palette[best.bg], fgRGB=snapshot.palette[best.fg];
        const mask=snapshot.masks[best.gi];
        for (let py=0; py<GLYPH_H; py++)
          for (let qx=0; qx<GLYPH_W; qx++) {
            const rgb=mask[py*GLYPH_W+qx] ? fgRGB : bgRGB;
            const di=(py*GLYPH_W+qx)*4;
            cellImgData[di]=rgb[0]; cellImgData[di+1]=rgb[1];
            cellImgData[di+2]=rgb[2]; cellImgData[di+3]=255;
          }
        outCtx.putImageData(cellImg, px0, py0);
      }
    }

    const pct=(idx/total)*100;
    document.getElementById('progressBar').style.width=pct+'%';
    document.getElementById('progressText').textContent=
      `Processing… ${Math.round(pct)}% (${idx}/${total} cells)`;

    if (idx<total) {
      convertRAF=requestAnimationFrame(processChunk);
    } else {
      // 全セル処理完了: 所要時間・キャッシュヒット率を表示し、ダウンロード/投稿を解禁
      const elapsed=((performance.now()-startTime)/1000).toFixed(2);
      const hitPct=total ? Math.round((cacheHits/total)*100) : 0;
      document.getElementById('progressText').textContent=
        `Done — ${elapsed}s (cache hits: ${cacheHits}/${total}, ${hitPct}%)`;
      document.getElementById('progressWrap').classList.remove('show');
      convertRAF=null;
      setConversionState(false);
      document.getElementById('downloadBtn').disabled=false;
      document.getElementById('tweetBtn').disabled=false;
      document.getElementById('infoTime').textContent=elapsed+'s';
      outputReady=true;
    }
  }
  convertRAF=requestAnimationFrame(processChunk);
}
