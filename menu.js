
// トップレベル項目（フォルダ分けしない単独ページ）
const SODENMIR_TOP_ITEMS = [
    { label: "PROFILE", dir: "/contents/PROFILE/", path: "/contents/PROFILE/index.html", icon: "/images/TENOKUN_ICON.gif" },
];

// フォルダ分けされたグループ項目
const SODENMIR_GROUPS = [
    {
        label: "TOOLS", icon: "/images/TOOLS.png",
        items: [
            { label: "GLYPHALT", dir: "/contents/GLYPHALT/", path: "/contents/GLYPHALT/index.html", icon: "/images/TOOLS.png" },
            { label: "TEXTALT", dir: "/contents/TEXTALT/", path: "/contents/TEXTALT/index.html", icon: "/images/TOOLS.png" },
            { label: "TENOMOJI", dir: "/contents/TENOMOJI/", path: "/contents/TENOMOJI/index.html", icon: "/images/TOOLS.png" },
            { label: "PALETALT", dir: "/contents/PALETALT/", path: "/contents/PALETALT/index.html", icon: "/images/TOOLS.png" },
        ],
    },
    {
        label: "WORKS", icon: "/images/FOLDER.png",
        items: [
            { label: "GALLERY", dir: "/contents/GALLERY/", path: "/contents/GALLERY/index.html", icon: "/images/GALLARY.png" },
            { label: "POEM", dir: "/contents/POEM/", path: "/contents/POEM/index.html", icon: "/images/FOLDER.png" },
            { label: "FONT", dir: "/contents/FONT/", path: "/contents/FONT/index.html", icon: "/images/FONTS.png" },
        ],
    },
    {
        label: "OTHER", icon: "/images/FOLDER.png",
        items: [
            { label: "LINK", dir: "/contents/LINKS/", path: "/contents/LINKS/index.html", icon: "/images/LINK.png" },
            { label: "UPDATE", dir: "/contents/UPDATE/", path: "/contents/UPDATE/index.html", icon: "/images/UPDATE.png" },
        ],
    },
];

(function () {
    function init() {
        // ディレクトリ単位でアクティブ判定（大文字/小文字ゆれにも強い）
        const currentPath = location.pathname.toLowerCase();
        const isActive = (item) => currentPath.startsWith(item.dir.toLowerCase());
        const groupIsActive = (group) => group.items.some(isActive);

        function makeLink(item, { row } = {}) {
            const link = document.createElement('a');
            link.className = row ? 'sodenmir-row-item' : 'sodenmir-top-item';
            link.href = item.path;
            if (isActive(item)) link.classList.add('active');

            const img = document.createElement('img');
            img.src = item.icon;
            img.alt = '';
            img.className = row ? 'sodenmir-row-icon' : 'sodenmir-top-icon';

            const span = document.createElement('span');
            span.textContent = item.label;
            span.className = row ? 'sodenmir-row-text' : 'sodenmir-top-text';

            link.appendChild(img);
            link.appendChild(span);
            return link;
        }

        function makeGroup(group) {
            const details = document.createElement('details');
            details.className = 'sodenmir-group';
            if (groupIsActive(group)) details.open = true;

            const summary = document.createElement('summary');
            summary.className = 'sodenmir-group-summary';

            const img = document.createElement('img');
            img.src = group.icon;
            img.alt = '';
            img.className = 'sodenmir-top-icon';

            const span = document.createElement('span');
            span.textContent = group.label;
            span.className = 'sodenmir-top-text';

            const caret = document.createElement('span');
            caret.className = 'sodenmir-caret';
            caret.textContent = '▾';

            summary.appendChild(img);
            summary.appendChild(span);
            summary.appendChild(caret);
            details.appendChild(summary);

            const panel = document.createElement('div');
            panel.className = 'sodenmir-group-panel';
            group.items.forEach((item) => panel.appendChild(makeLink(item, { row: true })));
            details.appendChild(panel);

            return details;
        }

        const topbar = document.createElement('header');
        topbar.id = 'sodenmir-topbar';

        const branding = document.createElement('a');
        branding.className = 'sodenmir-branding';
        branding.href = '/';
        branding.innerHTML =
            '<img src="/images/TENOKUN_ICON.gif" alt="送電世界" class="sodenmir-brand-icon">' +
            '<img src="/images/banner.png" alt="送電世界 そーでんみーる//Soden-mir" class="sodenmir-brand-banner">';
        topbar.appendChild(branding);

        const nav = document.createElement('nav');
        nav.id = 'sodenmir-nav';
        SODENMIR_TOP_ITEMS.forEach((item) => nav.appendChild(makeLink(item)));
        SODENMIR_GROUPS.forEach((group) => nav.appendChild(makeGroup(group)));
        topbar.appendChild(nav);

        const mobileToggle = document.createElement('button');
        mobileToggle.id = 'sodenmir-mobile-toggle';
        mobileToggle.type = 'button';
        mobileToggle.textContent = 'MENU';
        topbar.appendChild(mobileToggle);

        document.body.insertBefore(topbar, document.body.firstChild);
        document.body.classList.add('sodenmir-has-topbar');

        const mobileNav = document.createElement('nav');
        mobileNav.id = 'sodenmir-mobile-nav';
        SODENMIR_TOP_ITEMS.forEach((item) => mobileNav.appendChild(makeLink(item, { row: true })));
        SODENMIR_GROUPS.forEach((group) => mobileNav.appendChild(makeGroup(group)));
        document.body.insertBefore(mobileNav, topbar.nextSibling);

        mobileToggle.addEventListener('click', () => {
            const open = mobileNav.classList.toggle('open');
            mobileToggle.classList.toggle('open', open);
        });

        if (!document.querySelector('link[rel="icon"]')) {
            const favicon = document.createElement('link');
            favicon.rel = 'icon';
            favicon.href = '/favicon.ico';
            document.head.appendChild(favicon);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
