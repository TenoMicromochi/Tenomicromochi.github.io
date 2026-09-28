/* ============================================================
   送電世界 — ALT ツール共通：左右パネルの開閉（ての標準ツールUI）

   index.html の <head> で読む（menu.js の隣）：
       <script src="/alt-panels.js" defer></script>

   必要な要素（ID 固定）：
       #tabLeft  #tabLeftLabel   #panelLeft     … 左のタブ / ラベル / パネル
       #tabRight #tabRightLabel  #panelRight    … 右
   タブの名前は、ラベル（#tab*Label）の HTML に書いてある文字がそのまま使われる。
   開閉の初期状態は、パネルに .hidden が付いているかどうか（付いていれば閉）。

   左右どちらも独立に開閉できる。両方開くと中央が潰れる幅（1100px 未満）では、
   開いたほうを残して反対側を閉じる。
   パネルが開閉しても成果物の位置は動かない（パネルは上に被さる。alt.css）。
   ============================================================ */
(() => {
  const $ = (id) => document.getElementById(id);

  const side = (S) => {
    const label = $('tab' + S + 'Label');
    return { panel: $('panel' + S), tab: $('tab' + S), label, name: label ? label.textContent.trim() : '' };
  };
  const PANELS = { left: side('Left'), right: side('Right') };
  if (!Object.values(PANELS).every((p) => p.panel && p.tab && p.label)) return;

  function togglePanel(sideName) {
    const me = PANELS[sideName], other = PANELS[sideName === 'left' ? 'right' : 'left'];
    const opening = me.panel.classList.contains('hidden');
    me.panel.classList.toggle('hidden', !opening);
    // 幅が取れない（非表示タブ等で 0）ときは閉じない。0 を「狭い」と読むと常に片方が消える
    const w = document.documentElement.clientWidth || 0;
    if (opening && w > 0 && w < 1100) other.panel.classList.add('hidden');
    syncTabs();
  }

  function syncTabs() {
    for (const p of Object.values(PANELS)) {
      const open = !p.panel.classList.contains('hidden');
      p.tab.classList.toggle('on', open);
      p.label.textContent = open ? '✕ CLOSE' : p.name;
    }
  }

  PANELS.left.tab.addEventListener('click', () => togglePanel('left'));
  PANELS.right.tab.addEventListener('click', () => togglePanel('right'));
  syncTabs();
})();
