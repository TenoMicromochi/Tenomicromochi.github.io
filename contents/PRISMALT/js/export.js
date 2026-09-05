// ============================================================ 書き出し
// 静止画（PNG）と動画（WebM）。どちらも「枠の中に見えている範囲」を、
// 編集用キャンバスを引き伸ばすのではなく、同じシーン状態で描き直して出す（SPEC §7）。
//
//  PNG   … 常に中央の正方形を 4096x4096。設定項目なし。
//          縦長が欲しい人は書き出したあとスマホ/SNS側で切り抜く、という割り切り
//  WebM  … 選択中の枠の比率で短辺 720。ガラスだけが1回転するので、
//          1回転 = 1ループが構造的に保証される（尺 = 秒/回転）
//
// 動画は MediaRecorder を実時間で回さない。1フレームのレイトレに何十msも掛かるので、
// 実時間記録だとコマ落ちしたスローモーションになる。captureStream(0) の 0 が肝で、
// track.requestFrame() でフレームを手動送りすると、1枚が何秒かかっても
// 尺の正しい動画が出る。

import { scene, PNG_SIDE, VIDEO_SHORT, FPS, ASPECTS } from './scene.js';
import { drawExport, renderStill, restoreCanvas, tanScaleFor, glCanvas,
         lockRender, unlockRender, yieldToBrowser } from './renderer.js';

function save(blob, name){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- PNG
// **1回のドローで 4096x4096 を描かない。** 非力な GPU だと1枚に数秒かかり、
// Windows の TDR（既定2秒）でドライバがリセットされて WebGL のコンテキストごと落ちる。
// renderStill がタイルに割って描き、2D キャンバスに組み立てて返す
let cancelStill = false;
export const cancelPNG = () => { cancelStill = true; };

export async function exportPNG(onProgress, done){
  const scale = tanScaleFor('1:1');            // PNG は枠の選択に関係なく常に正方形
  cancelStill = false;
  const out = await renderStill(scene, PNG_SIDE, scale, onProgress, () => cancelStill);
  if (!out){ done?.('still cancelled'); return; }
  out.toBlob(blob => {
    save(blob, `wallpaper_${PNG_SIDE}x${PNG_SIDE}.png`);
    done?.(`saved ${PNG_SIDE}x${PNG_SIDE} png`);
  }, 'image/png');
}

// ---------------------------------------------------------------- WebM
// 短辺を VIDEO_SHORT に合わせる。16:9 ならちょうど 1280x720
export function videoSize(aspect){
  const a = ASPECTS[aspect] ?? 1;
  let w, h;
  if (a >= 1){ h = VIDEO_SHORT; w = Math.round(h * a); }
  else       { w = VIDEO_SHORT; h = Math.round(w / a); }
  return { w: w - (w % 2), h: h - (h % 2) };   // エンコーダが奇数サイズを嫌う
}

function pickMime(){
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'])
    if (window.MediaRecorder?.isTypeSupported(m)) return m;
  return '';
}

let cancelFlag = false;
export const cancelVideo = () => { cancelFlag = true; };

// onProgress(done, total) / 戻り値は完了メッセージ
export async function exportVideo(onProgress, done){
  const mime = pickMime();
  if (!mime){ done?.('MediaRecorder unavailable'); return; }

  const aspect = scene.out.aspect;
  const { w, h } = videoSize(aspect);
  const frames = Math.max(2, Math.round(scene.out.turn * FPS));
  const scale = tanScaleFor(aspect);
  const cv = glCanvas();
  cancelFlag = false;
  lockRender();          // 収録中はライブ描画を止める（大きさを変えられると収録が壊れる）

  // captureStream はキャンバスの現在の解像度でトラックを作るので、先にサイズを決める
  drawExport(scene, w, h, scale);
  const stream = cv.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

  const stopped = new Promise(r => { rec.onstop = r; });
  rec.start();

  const spin0 = scene.spin;
  for (let f = 0; f < frames; f++){
    if (cancelFlag) break;
    scene.spin = spin0 + 2 * Math.PI * f / frames;   // 1回転ぴったりで割り切る = 完全ループ
    drawExport(scene, w, h, scale);
    track.requestFrame();
    onProgress?.(f + 1, frames);
    // requestAnimationFrame は使わない。ウィンドウが前面に無い / 描画が止まっている間は
    // rAF がスロットリングされて収録ループごと止まる（実際に踏んだ）。
    // setTimeout も裏タブでは 1秒まで延ばされるので、どちらの制限も受けない
    // MessageChannel で制御を返す（renderer.yieldToBrowser）
    await yieldToBrowser();
  }

  rec.stop();
  await stopped;
  scene.spin = spin0;
  unlockRender();
  restoreCanvas();

  if (cancelFlag){ done?.('video cancelled'); return; }
  save(new Blob(chunks, { type: 'video/webm' }), `wallpaper_${w}x${h}_${scene.out.turn}s.webm`);
  done?.(`saved ${w}x${h} webm · ${frames} frames`);
}
