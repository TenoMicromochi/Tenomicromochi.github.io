/* ============================================================
   SANDBOX 標準UI — 共通スクリプト（sandbox.css とセット）

   やること
     1. footer.sb-dock の section.sb-tab[data-tab] からタブ見出しを作る
        （タブが1枚なら見出しは出さない）
     2. .sb-screen（data-w / data-h = 論理サイズ）を、.sb-stage に収まる
        最大の整数倍に拡大する（最低 x1）。倍率は右下に出す
     3. .sb-ctrl（スライダー＋数値入力）の同期と、スライダーの塗り（--pct）

   試作側へ渡すもの
     window.SandboxUI.scale          今の倍率（整数）
     window 'sb-fit' イベント         倍率が決まるたびに発火（detail = 倍率）
   ============================================================ */
(function () {
    'use strict';

    const SandboxUI = { scale: 1 };
    window.SandboxUI = SandboxUI;

    /* ── 1. タブ ── */
    function buildTabs() {
        const dock = document.querySelector('footer.sb-dock');
        if (!dock) return;
        const tabs = Array.from(dock.querySelectorAll(':scope > .sb-tab'));
        if (!tabs.length) return;

        const select = (name) => {
            tabs.forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
            dock.querySelectorAll('.sb-tabs button').forEach((b) =>
                b.classList.toggle('is-active', b.dataset.tab === name));
        };

        if (tabs.length === 1) {
            dock.classList.add('no-tabs');
        } else {
            const nav = document.createElement('nav');
            nav.className = 'sb-tabs';
            tabs.forEach((t) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.dataset.tab = t.dataset.tab;
                b.textContent = t.dataset.tab;
                b.addEventListener('click', () => select(t.dataset.tab));
                nav.appendChild(b);
            });
            dock.insertBefore(nav, dock.firstChild);
        }
        select(tabs[0].dataset.tab);   // 最初の section が選択中
    }

    /* ── 2. 整数倍フィット ── */
    function setupFit() {
        const stage = document.querySelector('main.sb-stage');
        const screenEl = document.querySelector('.sb-screen');
        if (!stage || !screenEl) return;

        const lw = parseInt(screenEl.dataset.w, 10);
        const lh = parseInt(screenEl.dataset.h, 10);
        if (!(lw > 0 && lh > 0)) return;

        let label = stage.querySelector('.sb-scale');
        if (!label) {
            label = document.createElement('div');
            label.className = 'sb-scale';
            stage.appendChild(label);
        }

        const fit = () => {
            const cs = getComputedStyle(stage);
            const aw = stage.clientWidth  - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            const ah = stage.clientHeight - parseFloat(cs.paddingTop)  - parseFloat(cs.paddingBottom);
            const s = Math.max(1, Math.min(Math.floor(aw / lw), Math.floor(ah / lh)));
            screenEl.style.width  = lw * s + 'px';
            screenEl.style.height = lh * s + 'px';
            // 中央寄せの端数（0.5px）で画素が滲まないよう、余白は整数に丸めて置く
            screenEl.style.marginLeft = Math.floor((aw - lw * s) / 2) + 'px';
            screenEl.style.marginTop  = Math.floor((ah - lh * s) / 2) + 'px';
            label.textContent = 'x' + s;
            if (s !== SandboxUI.scale) {
                SandboxUI.scale = s;
                window.dispatchEvent(new CustomEvent('sb-fit', { detail: s }));
            }
        };

        // stage の大きさは下の欄の高さが決めた残り。変わるたびに計算し直す
        new ResizeObserver(fit).observe(stage);
        // 下の欄の中身が変わっても追従（フォント読み込み後の高さ変化など）
        const dock = document.querySelector('footer.sb-dock');
        if (dock) new ResizeObserver(fit).observe(dock);
        fit();
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
    }

    /* ── 3. スライダー＋数値入力 ── */
    function setupCtrls() {
        document.querySelectorAll('.sb-ctrl').forEach((box) => {
            const range = box.querySelector('input[type=range]');
            const num = box.querySelector('input[type=number]');
            if (!range) return;
            const paint = () => {
                const min = parseFloat(range.min) || 0;
                const max = parseFloat(range.max) || 100;
                const pct = ((parseFloat(range.value) - min) / (max - min)) * 100;
                range.style.setProperty('--pct', pct + '%');
            };
            range.addEventListener('input', () => { if (num) num.value = range.value; paint(); });
            if (num) {
                num.addEventListener('input', () => {
                    if (num.value === '') return;
                    const lo = parseFloat(range.min), hi = parseFloat(range.max);
                    const v = Math.min(hi, Math.max(lo, parseFloat(num.value)));
                    range.value = v;
                    paint();
                    // 試作側はスライダーの 'input' だけ聞けばよい
                    range.dispatchEvent(new Event('input', { bubbles: true }));
                });
                num.addEventListener('change', () => { num.value = range.value; });
                num.value = range.value;
            }
            paint();
        });
    }

    function init() {
        buildTabs();
        setupCtrls();
        setupFit();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
