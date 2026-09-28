/* ============================================================
   panels.js — 左右パネルの開閉（ての標準ツールUI と同じ振る舞い）

   左右どちらも独立に開閉できる。両方開くと中央が潰れる幅では、
   開いたほうを残して反対側を閉じる。
   パネルが開閉しても成果物の位置は動かない（パネルは上に被さる）。
   ============================================================ */
(() => {
  const $ = (id) => document.getElementById(id);

  const PANELS = {
    left:  { panel: $('panelLeft'),  tab: $('tabLeft'),  label: $('tabLeftLabel'),  name: 'IMAGE' },
    right: { panel: $('panelRight'), tab: $('tabRight'), label: $('tabRightLabel'), name: 'PALETTE' },
  };

  function togglePanel(side) {
    const me = PANELS[side], other = PANELS[side === 'left' ? 'right' : 'left'];
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
