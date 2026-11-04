// menu.js の SANDBOX グループの items からカードを作る（SANDBOX_HOME 自身は除く）
(function () {
    function build() {
        const grid = document.getElementById('sandbox-cards');
        if (!grid) return;
        const group = SODENMIR_GROUPS.find((g) => g.label === 'SANDBOX');
        const items = group ? group.items.filter((i) => i.label !== 'SANDBOX_HOME') : [];
        if (!items.length) {
            const p = document.createElement('p');
            p.className = 'home-lead';
            p.textContent = 'No items yet.';
            grid.replaceWith(p);
            return;
        }
        items.forEach((item) => {
            const a = document.createElement('a');
            a.className = 'home-card';
            a.href = item.path;
            const img = document.createElement('img');
            img.className = 'home-card-icon';
            img.src = item.icon;
            img.alt = '';
            const label = document.createElement('span');
            label.className = 'home-card-label';
            label.textContent = item.label;
            a.append(img, label);
            if (item.desc) {
                const d = document.createElement('span');
                d.className = 'home-card-desc';
                d.textContent = item.desc;
                a.appendChild(d);
            }
            grid.appendChild(a);
        });
    }
    // menu.js（defer）が先に走って SODENMIR_GROUPS を定義済み
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
})();
