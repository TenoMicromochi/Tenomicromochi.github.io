// autosave.js — IndexedDB への自動保存と、起動時の復元
// 保存するのは常に初期状態（world のセル）。RUN を押したとき・STEP で PAUSE に入ったとき・5分ごと（編集があるときだけ）・ページを閉じるとき
import { encodePng, decodePng, decodeRaw, rawSnapshot, idbGet, idbPut, idbDelete, idbWarm, idbPutSync, idbDeleteSync } from './storage.js';

const hhmm = (d) => d ? String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') : '--:--';

// enabled = false（?demo= のとき）は、タイマーとページを離れるときの保存をしない。onSaved = 保存し終えたときの画面更新
export function createAutosave(world, { enabled, onSaved }) {
  let savedVersion = 0, savedAt = null;               // 最後の自動保存の版と時刻
  let intervalMs = 5 * 60 * 1000, nextAt = performance.now() + intervalMs;

  async function save() {
    const version = world.version;
    const enc = await encodePng(world);
    if (!enc) { await idbDelete('png'); await idbDelete('raw'); }
    else { await idbPut('png', { blob: enc.blob, t: Date.now(), x: enc.x, y: enc.y }); await idbDelete('raw'); }
    savedVersion = version; savedAt = new Date(); nextAt = performance.now() + intervalMs;
    onSaved();
  }
  const saveQuietly = () => save().catch((e) => console.warn('autosave failed', e));

  // 離れる瞬間の書き込みは、ブラウザによっては完了前に捨てられることがある。保険として、編集が止まって約 0.25 秒たったら
  // 生の配列（RAW）を同期的に書いておく（UNSAVED の表示と自動保存の間隔は変えない。起動時は新しいほうを復元する）
  let seenVersion = -1, lastEditAt = 0, rawVersion = -1;
  function flushOnLeave() {
    if (!enabled || world.version === savedVersion) return;
    const raw = rawSnapshot(world);
    if (raw) idbPutSync('raw', raw); else { idbDeleteSync('png'); idbDeleteSync('raw'); }
  }
  function rawBackupTick(now) {
    if (world.version !== seenVersion) { seenVersion = world.version; lastEditAt = now; return; }
    if (world.version === savedVersion || world.version === rawVersion || now - lastEditAt < 250) return;
    rawVersion = world.version;
    flushOnLeave();
  }
  // メインループから毎フレーム呼ぶ
  function tick(now) {
    rawBackupTick(now);
    if (now < nextAt) return;
    nextAt = now + intervalMs;
    if (world.version !== savedVersion) saveQuietly();
  }

  window.addEventListener('pagehide', flushOnLeave);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushOnLeave(); });
  // 未保存の編集があるときは、ブラウザ標準の確認を出す
  window.addEventListener('beforeunload', (e) => {
    if (enabled && world.version !== savedVersion) { e.preventDefault(); e.returnValue = ''; }
  });

  // 保存してあるものを editor に読み込む。読み込んだら、画面の中心にする座標 {x, y} を返す（なければ null）
  async function restore(editor) {
    try {
      const png = await idbGet('png'), raw = await idbGet('raw');
      let dec = null, src = null;
      if (raw && (!png || raw.t > png.t)) { dec = decodeRaw(raw); src = raw; }
      else if (png) { dec = await decodePng(png.blob); src = png; }
      if (!dec || dec.error) return null;
      // 保存したときの座標に戻す（古い記録に座標が無ければ中央）
      const pos = (src.x != null && src.y != null) ? { x: src.x, y: src.y } : null;
      const placed = editor.placeImage(dec, false, pos);
      savedVersion = world.version; savedAt = src.t ? new Date(src.t) : null;
      return { x: placed.x0 + (dec.w >> 1), y: placed.y0 + (dec.h >> 1) };
    } catch (e) { console.warn('restore failed', e); return null; }
  }

  return {
    enabled, save, saveQuietly, tick, flushOnLeave, restore,
    warm: idbWarm,
    get savedAt() { return savedAt; },
    get savedVersion() { return savedVersion; },
    markSaved() { savedVersion = world.version; },
    get intervalMs() { return intervalMs; },
    setIntervalMs(ms) { intervalMs = ms; nextAt = performance.now() + ms; },
    // システムバーの SAVE 欄の文字
    statusText() {
      if (!enabled) return 'AUTOSAVE OFF';
      return world.version !== savedVersion ? 'UNSAVED' : 'SAVED ' + hhmm(savedAt);
    },
  };
}
