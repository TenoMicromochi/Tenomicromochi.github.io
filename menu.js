
// ===============================================
// 送電世界 共通サイドバーナビゲーション
// 各コンテンツページの<head>に以下2行を追加するだけで
// このサイドバーが自動的に挿入される：
//   <link rel="stylesheet" href="/main.css">
//   <script src="/menu.js" defer></script>
// iframeは使わず、各ページは独立したURLを持つ本物の
// ページなので、直リンク・戻る/進む・ブックマークが
// すべてそのまま機能する。
// ===============================================

const SODENMIR_MENU = [
    { label: "Home", dir: "/contents/HOME/", path: "/contents/HOME/index.html", icon: "/images/HOME.png" },
    { label: "Link", dir: "/contents/LINKS/", path: "/contents/LINKS/index.html", icon: "/images/LINK.png" },
    { label: "GLYPHALT", dir: "/contents/GLYPHALT/", path: "/contents/GLYPHALT/index.html", icon: "/images/TOOLS.png" },
    { label: "TEXTALT", dir: "/contents/TEXTALT/", path: "/contents/TEXTALT/index.html", icon: "/images/TOOLS.png" },
    { label: "Font", dir: "/contents/FONT/", path: "/contents/FONT/index.html", icon: "/images/FONTS.png" },
    { label: "Poem", dir: "/contents/POEM/", path: "/contents/POEM/index.html", icon: "/images/FOLDER.png" },
    { label: "Updates", dir: "/contents/UPDATE/", path: "/contents/UPDATE/index.html", icon: "/images/UPDATE.png" },
];

(function () {
    function init() {
        // ディレクトリ単位でアクティブ判定（大文字/小文字ゆれにも強い）
        const currentPath = location.pathname.toLowerCase();

        const sidebar = document.createElement('aside');
        sidebar.id = 'sodenmir-sidebar';

        const branding = document.createElement('div');
        branding.className = 'sodenmir-branding';
        branding.innerHTML =
            '<img src="/images/TENOKUN_ICON.gif" alt="Welcome" class="sodenmir-site-banner">' +
            '<h1 class="sodenmir-site-title">送電世界</h1>';
        sidebar.appendChild(branding);

        const nav = document.createElement('nav');
        nav.id = 'sodenmir-menu';

        SODENMIR_MENU.forEach((item) => {
            const link = document.createElement('a');
            link.className = 'sodenmir-menu-item';
            link.href = item.path;
            if (currentPath.startsWith(item.dir.toLowerCase())) {
                link.classList.add('active');
            }

            const img = document.createElement('img');
            img.src = item.icon;
            img.alt = '';
            img.className = 'sodenmir-menu-icon';

            const span = document.createElement('span');
            span.textContent = item.label;
            span.className = 'sodenmir-menu-text';

            link.appendChild(img);
            link.appendChild(span);
            nav.appendChild(link);
        });

        sidebar.appendChild(nav);
        document.body.insertBefore(sidebar, document.body.firstChild);
        document.body.classList.add('sodenmir-has-sidebar');

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
