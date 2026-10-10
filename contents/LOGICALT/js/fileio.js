// fileio.js — PNG の保存（SAVE / SAVE SEL）と読み込み（LOAD / LOAD MODULE）。ボタンとドロップから呼ばれる
import { W, H } from './world.js';
import { encodePng, decodePng, timestamp, downloadBlob } from './storage.js';
import { bufFromDecoded } from './clip.js';

const isPng = (f) => f && (f.type === 'image/png' || /\.png$/i.test(f.name || ''));

const SAMPLE_URL = 'sample.png';
const RESET_MESSAGE = 'Reset the canvas? Your current circuit will be replaced with the sample. (UNDO can restore it)';

// app = { world, editor, renderer, toast, canEdit, rebuildNow, visibleCenter, setUnknown(n), redraw() }
export function createFileIo(app) {
  const { world, editor, renderer, toast } = app;

  async function savePng() {
    const enc = await encodePng(world);
    if (!enc) { toast('Nothing to save', 'error'); return; }
    downloadBlob(enc.blob, `circuit_${timestamp()}.png`);
    toast(`Saved ${enc.w}x${enc.h}${enc.layers === 2 ? ' x2 layers' : ''}`);
  }

  // SAVE SEL：選択の対象が BOTH なら両面ぶん（裏が空なら 1 面）、ACTIVE なら作業面だけの 1 面
  async function saveSel() {
    if (!editor.sel) { toast('Select an area first', 'error'); return; }
    const enc = await encodePng(world, editor.sel, editor.scope === 'ACTIVE' ? editor.layer : -1);
    if (!enc) { toast('Nothing in the selection', 'error'); return; }
    downloadBlob(enc.blob, `module_${timestamp()}.png`);
    toast(`Saved module ${enc.w}x${enc.h}${enc.layers === 2 ? ' x2 layers' : ''}`);
  }

  // PNG ファイルを読んで decodePng の結果を返す。PNG でない・大きすぎる・読めないときは、通知を出して null
  async function decodeOrToast(file) {
    if (!isPng(file)) { toast('Not a PNG file', 'error'); return null; }
    const dec = await decodePng(file);
    if (dec.error === 'toolarge') { toast(`Image too large: ${dec.w}x${dec.h} per layer (max ${W}x${H})`, 'error'); return null; }
    if (dec.error) { toast('Could not read the image', 'error'); return null; }
    return dec;
  }

  // LOAD：キャンバスを消して読み込む
  async function loadFile(file) {
    if (!app.canEdit()) return;
    const dec = await decodeOrToast(file);
    if (!dec) return;
    if (world.nonEmpty && !confirm('Clear the canvas and load this image?')) return;
    const placed = editor.placeImage(dec, true);
    app.rebuildNow();
    renderer.centerOn(placed.x0 + (dec.w >> 1), placed.y0 + (dec.h >> 1), ...app.visibleCenter());
    app.setUnknown(dec.unknown);
    toast(dec.unknown ? `Loaded ${dec.w}x${dec.h} (${dec.unknown} unknown colors -> EMPTY)` : `Loaded ${dec.w}x${dec.h}`, dec.unknown ? 'error' : 'ok');
    app.redraw();
  }

  // LOAD MODULE：キャンバスは消さず、貼り付けプレビューにする
  async function loadModule(file) {
    if (!app.canEdit()) { toast('Stop the simulation to edit', 'error'); return; }
    const dec = await decodeOrToast(file);
    if (!dec) return;
    editor.startPasteBuf(bufFromDecoded(dec));
    app.setUnknown(dec.unknown);
    toast(dec.unknown ? `Module ${dec.w}x${dec.h} (${dec.unknown} unknown colors -> EMPTY)` : `Module ${dec.w}x${dec.h}: click to paste`, dec.unknown ? 'error' : 'ok');
    app.redraw();
  }

  // サンプル回路（sample.png）を読む。失敗したら console に warn を 1 行出して null（file:// で開いた・ファイルが無いなど）
  async function fetchSample() {
    try {
      const res = await fetch(SAMPLE_URL);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const dec = await decodePng(await res.blob());
      if (dec.error) throw new Error(dec.error);
      return dec;
    } catch (e) {
      console.warn('sample load failed:', e.message || e);
      return null;
    }
  }

  // 初めて開いたとき：サンプルを置く（UNDO の対象にしない）。画面合わせは fit() に任せる。置けたら true
  async function placeSample(fit) {
    const dec = await fetchSample();
    if (!dec) return false;
    editor.placeImage(dec, false);
    app.setUnknown(dec.unknown);
    fit();
    return true;
  }

  // RESET：確認のあと、LOAD と同じ処理でサンプルに置き換える（1手として UNDO できる）
  async function resetToSample() {
    if (!app.canEdit()) return;
    if (!confirm(RESET_MESSAGE)) return;
    const dec = await fetchSample();
    if (!dec) { toast('Could not read the sample', 'error'); return; }
    editor.placeImage(dec, true);
    app.rebuildNow();
    app.setUnknown(dec.unknown);
    app.fitAll();
    toast('Reset to the sample');
    app.redraw();
  }

  return { savePng, saveSel, loadFile, loadModule, placeSample, resetToSample };
}
