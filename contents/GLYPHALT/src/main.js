// エントリーポイント: 各モジュールを束ね、DOM上の全操作(UI操作・画像読み込み・変換実行・出力)を配線する
import { setupSlider, clampSize, showError } from './ui.js';
import { loadAllPalettes, setActivePalette } from './palette.js';
import { loadAllGlyphs, glyphSlots } from './glyph.js';
import { buildCatalog } from './catalog.js';
import { setQuadMode } from './matching.js';
import { startConvert, stopConvert, getIsConverting, setInputImageData, setInputFile, setSrcAspect, getSrcAspect, isOutputReady, getInputFile, getInputImageData } from './convert.js';

document.addEventListener('DOMContentLoaded', async () => {

  // IMAGE ADJUSTの各スライダーとスピナー付き数値入力の同期を設定
  ['sobel','blur','sharp','gamma','brightness','contrast','saturation','hue','posterize','dither'].forEach(id =>
    setupSlider(id, id+'Val')
  );

  // パレット・グリフを並行読み込みし、両方の<select>とグリッドを初期化
  await Promise.all([loadAllPalettes(), loadAllGlyphs()]);
  // 現在の選択状態とは独立に、同梱の全パレット・全グリフセットを右パネルの一覧として構築
  buildCatalog();

  document.getElementById('paletteSelect').addEventListener('change', function() {
    setActivePalette(this.value);
  });

  document.getElementById('glyphSelectA').addEventListener('change', function() {
    glyphSlots.A.setActiveGlyph(this.value);
  });
  document.getElementById('glyphSelectB').addEventListener('change', function() {
    glyphSlots.B.setActiveGlyph(this.value);
  });

  // FEATURE SPLIT(分割数)ラジオボタンの切り替え
  document.querySelectorAll('input[name="quadMode"]').forEach(radio => {
    radio.addEventListener('change', function() {
      if (this.checked) setQuadMode(this.value);
    });
  });

  // グリフの一括ON/OFFボタン(Set A/Bそれぞれ独立)
  document.getElementById('glyphAllOnA').addEventListener('click', () => glyphSlots.A.setAllEnabled(true));
  document.getElementById('glyphAllOffA').addEventListener('click', () => glyphSlots.A.setAllEnabled(false));
  document.getElementById('glyphAllOnB').addEventListener('click', () => glyphSlots.B.setAllEnabled(true));
  document.getElementById('glyphAllOffB').addEventListener('click', () => glyphSlots.B.setAllEnabled(false));

  // メニュー(サイドバー)の表示/非表示トグル。画像を等倍で見たい時に隠せるように
  const sidebar = document.getElementById('sidebar');
  const menuToggle = document.getElementById('menuToggle');
  const menuToggleLabel = document.getElementById('menuToggleLabel');
  function syncMenuToggleLabel() {
    menuToggleLabel.textContent = sidebar.classList.contains('hidden') ? 'SETTINGS' : '✕ CLOSE';
  }
  menuToggle.addEventListener('click', () => {
    sidebar.classList.toggle('hidden');
    syncMenuToggleLabel();
  });
  syncMenuToggleLabel();

  // パレット&グリフ一覧パネルの表示/非表示トグル
  const catalogPanel = document.getElementById('catalogPanel');
  const catalogToggle = document.getElementById('catalogToggle');
  const catalogToggleLabel = document.getElementById('catalogToggleLabel');
  function syncCatalogToggleLabel() {
    catalogToggleLabel.textContent = catalogPanel.classList.contains('hidden') ? 'PALETTE & GLYPHS' : '✕ CLOSE';
  }
  catalogToggle.addEventListener('click', () => {
    catalogPanel.classList.toggle('hidden');
    syncCatalogToggleLabel();
  });
  syncCatalogToggleLabel();

  // 選択された画像ファイルを読み込み、最大1024px以内にリサイズして入力データとして保持する
  function loadImage(file) {
    if (getIsConverting()) stopConvert();
    const reader=new FileReader();
    reader.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        const maxSide=Math.max(img.naturalWidth, img.naturalHeight);
        const scale=Math.min(1, 1024/maxSide);
        const imageW=Math.max(1, Math.round(img.naturalWidth*scale));
        const imageH=Math.max(1, Math.round(img.naturalHeight*scale));
        const tmpC=document.createElement('canvas');
        tmpC.width=imageW; tmpC.height=imageH;
        const tmpCtx=tmpC.getContext('2d');
        tmpCtx.imageSmoothingEnabled=true;
        tmpCtx.imageSmoothingQuality='high';
        tmpCtx.drawImage(img, 0, 0, imageW, imageH);

        setInputImageData(tmpCtx.getImageData(0,0,imageW,imageH));
        setInputFile(file);
        setSrcAspect(imageW / imageH);

        document.getElementById('outWidth').value  = clampSize(imageW);
        document.getElementById('outHeight').value = clampSize(imageH);
        document.getElementById('imgName').textContent=file.name;
        document.getElementById('convertBtn').disabled=false;
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ファイル選択・ドラッグ&ドロップによる画像読み込み
  const dz=document.getElementById('dropZone');
  document.getElementById('imageInput').addEventListener('change', e=>{
    if (e.target.files[0]) loadImage(e.target.files[0]);
  });
  dz.addEventListener('dragover', e=>{ e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', ()=>dz.classList.remove('drag'));
  dz.addEventListener('drop', e=>{
    e.preventDefault(); dz.classList.remove('drag');
    const f=e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) loadImage(f);
  });

  // OUTPUT SIZEの幅/高さ入力(アスペクト比維持オプション付き)
  const wIn=document.getElementById('outWidth'), hIn=document.getElementById('outHeight');
  wIn.addEventListener('change', ()=>{
    const w=clampSize(+wIn.value); wIn.value=w;
    if (document.getElementById('keepAspect').checked && getSrcAspect())
      hIn.value=clampSize(w / getSrcAspect());
  });
  hIn.addEventListener('change', ()=>{
    const h=clampSize(+hIn.value); hIn.value=h;
    if (document.getElementById('keepAspect').checked && getSrcAspect())
      wIn.value=clampSize(h * getSrcAspect());
  });

  // CONVERTボタン: 変換中なら停止、そうでなければ入力画像がある場合に開始
  document.getElementById('convertBtn').addEventListener('click', ()=>{
    if (getIsConverting()) stopConvert();
    else if (getInputImageData()) startConvert();
  });

  // DOWNLOAD PNGボタン: 出力キャンバスを選択倍率(1x〜4x)に拡大してPNG保存
  document.getElementById('downloadBtn').addEventListener('click', ()=>{
    if (!isOutputReady()) return;
    const scale=Number(document.querySelector('input[name="downloadScale"]:checked').value);
    const source=document.getElementById('outputCanvas');
    const exportCanvas=document.createElement('canvas');
    exportCanvas.width=source.width*scale;
    exportCanvas.height=source.height*scale;
    const exportCtx=exportCanvas.getContext('2d');
    exportCtx.imageSmoothingEnabled=false;
    exportCtx.drawImage(source, 0, 0, exportCanvas.width, exportCanvas.height);
    const link=document.createElement('a');
    link.download=`glyphalt-16-${scale}x.png`;
    link.href=exportCanvas.toDataURL('image/png');
    link.click();
  });

  // POST TO Xボタン: 出力画像(4x)と元画像をWeb Share APIで共有、非対応環境はX投稿画面を開くだけに留める
  document.getElementById('tweetBtn').addEventListener('click', async ()=>{
    if (!isOutputReady() || !getInputFile()) return;

    const text='⚡️ぐりふぁると-16で加工したよ.ᐟ ⚡️\n#GLYPHALT16\nhttps://tenokun.neocities.org';
    const btn=document.getElementById('tweetBtn');
    btn.disabled=true;
    try {
      const source=document.getElementById('outputCanvas');
      const exportCanvas=document.createElement('canvas');
      exportCanvas.width=source.width*4;
      exportCanvas.height=source.height*4;
      const exportCtx=exportCanvas.getContext('2d');
      exportCtx.imageSmoothingEnabled=false;
      exportCtx.drawImage(source, 0, 0, exportCanvas.width, exportCanvas.height);
      const processedBlob=await new Promise(resolve => exportCanvas.toBlob(resolve, 'image/png'));
      if (!processedBlob) throw new Error('Could not create output image.');

      const files=[
        new File([processedBlob], 'glyphalt-16-4x.png', { type: 'image/png' }),
        getInputFile(),
      ];
      if (navigator.share && navigator.canShare && navigator.canShare({ files })) {
        await navigator.share({ title: 'GLYPHALT-16', text, files });
      } else {
        window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
        showError('This browser cannot attach files automatically. Add the two images to the X post manually.');
      }
    } catch (err) {
      if (err.name !== 'AbortError') showError('Could not open the share dialog.');
    } finally {
      btn.disabled=!isOutputReady();
    }
  });
});
