// 8の倍数に丸める
export function snapTo8(v) { return Math.round(v / 8) * 8; }
// 出力サイズを64〜1024pxの範囲・8刻みにクランプ
export function clampSize(v) { return Math.max(64, Math.min(1024, snapTo8(v || 512))); }

// rangeスライダーと数値入力(スピナー付き<input type="number">)を双方向に同期する
export function setupSlider(id, valId) {
  const el = document.getElementById(id), vEl = document.getElementById(valId);
  const mn = +el.min, mx = +el.max;

  function updatePct() {
    el.style.setProperty('--pct', ((+el.value - mn) / (mx - mn) * 100).toFixed(1) + '%');
  }
  // スライダー操作 → 数値入力とつまみ位置に反映
  function syncFromSlider() {
    vEl.value = el.value;
    updatePct();
  }
  // 数値入力への打鍵 → スライダー側だけリアルタイムに反映(数値入力自体は打鍵中に書き換えない。
  // 書き換えるとカーソル位置がズレて打ちにくくなるため)
  function syncFromInput() {
    if (vEl.value === '' || vEl.value === '-') return;
    el.value = Math.min(mx, Math.max(mn, +vEl.value));
    updatePct();
  }
  // 数値入力からフォーカスが外れたら、クランプ済みの値へ表示も揃える
  function commitInput() {
    syncFromInput();
    vEl.value = el.value;
  }

  el.addEventListener('input', syncFromSlider);
  vEl.addEventListener('input', syncFromInput);
  vEl.addEventListener('change', commitInput);
  syncFromSlider();
}

// ステータス行(パレット/グリフ読み込み状況など)のテキストと状態クラスを更新
export function setStatus(id, msg, type) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = 'status-line' + (type ? ' ' + type : '');
}

let toastTimer = null;
// 画面下部にエラーメッセージを一時表示するトースト
export function showError(msg) {
  const t = document.getElementById('errorToast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = 'none'; }, 4000);
}
