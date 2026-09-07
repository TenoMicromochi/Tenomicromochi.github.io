/* ============================================================
   POEM
   一覧は poems.json が唯一の情報源。追加するときは data/ に .txt を
   置いて poems.json に1件足すだけでよく、このファイルは触らない。
   ============================================================ */

const DATA_URL = 'poems.json';

/* S/M/L の実寸。行長は #poem-display の max-width が em 指定なので、
   サイズを変えても1行の文字数は変わらない。 */
const TEXT_SIZES = { s: 15, m: 18, l: 22 };
const SIZE_KEY = 'sodenmir.poem.textSize';
const DEFAULT_SIZE = 'm';

const els = {};
let poems = [];
let currentId = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
    els.index    = document.getElementById('poem-index');
    els.side     = document.getElementById('poem-content-side');
    els.display  = document.getElementById('poem-display');
    els.scroll   = document.getElementById('poem-scroll');
    els.titleJa  = document.querySelector('#poem-heading .t-ja');
    els.titleEn  = document.querySelector('#poem-heading .t-en');
    els.swatchLg = document.querySelector('#poem-heading .swatch-lg');

    setupSizeButtons();

    let data;
    try {
        const res = await fetch(DATA_URL);
        if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
        data = await res.json();
    } catch (err) {
        els.display.innerHTML = '';
        els.display.appendChild(makeError('Failed to load poems.json — ' + err.message));
        return;
    }

    poems = data.poems || [];
    buildIndex(data.categories || [], poems);

    // #id 付きで開かれたらその1編を出す。共有リンク用。
    const fromHash = poems.find(p => p.id === location.hash.replace(/^#/, ''));
    if (fromHash) selectPoem(fromHash.id);

    window.addEventListener('hashchange', () => {
        const id = location.hash.replace(/^#/, '');
        if (id && id !== currentId && poems.some(p => p.id === id)) selectPoem(id);
    });
}

/* ── 索引の組み立て ── */
function buildIndex(categories, list) {
    els.index.innerHTML = '';

    // poems.json の categories の並び順をそのまま画面の順にする。
    // どのカテゴリにも属さないものは末尾の「その他」に落とす。
    const groups = categories.map(cat => ({
        cat,
        items: list.filter(p => p.category === cat.key)
    }));
    const orphans = list.filter(p => !categories.some(c => c.key === p.category));
    if (orphans.length) {
        groups.push({ cat: { key: '_other', ja: 'その他', en: 'OTHER' }, items: orphans });
    }

    groups.forEach(group => {
        if (!group.items.length) return;

        const details = document.createElement('details');
        details.className = 'cat';
        details.open = true;

        const summary = document.createElement('summary');
        summary.className = 'cat-summary';
        // \u958B\u9589\u306E\u76EE\u5370\u306F\u30C9\u30C3\u30C8\u7D75\u306E\u30D5\u30A9\u30EB\u30C0\u30A2\u30A4\u30B3\u30F3\u3002\u56DE\u3059\u3068\u30C9\u30C3\u30C8\u304C\u5D29\u308C\u308B\u306E\u3067
        // \u56DE\u8EE2\u306F\u3055\u305B\u305A\u3001\u9589\u3058\u3066\u3044\u308B\u5074\u3092 CSS \u3067\u6C88\u3081\u3066\u72B6\u614B\u3092\u793A\u3059\u3002
        summary.innerHTML =
            '<img class="cat-folder" src="/images/icons/FOLDER.png" alt="">' +
            '<span class="cat-ja"></span>' +
            '<span class="cat-en"></span>' +
            '<span class="cat-count"></span>';
        summary.querySelector('.cat-ja').textContent = group.cat.ja;
        summary.querySelector('.cat-en').textContent = group.cat.en;
        summary.querySelector('.cat-count').textContent = group.items.length;
        details.appendChild(summary);

        const body = document.createElement('div');
        body.className = 'cat-body';
        group.items.forEach(poem => body.appendChild(makeLink(poem)));
        details.appendChild(body);

        els.index.appendChild(details);
    });
}

function makeLink(poem) {
    const a = document.createElement('a');
    a.className = 'poem-link';
    a.href = '#' + poem.id;
    a.dataset.id = poem.id;
    // 本来のテーマカラーは --theme に持たせておく。実際に描画に使う --c は
    // CSS 側が切り替える：未選択はグレー、ホバーと選択中だけ --theme に戻る。
    // カラーボックスも選択中の左バーも --c しか見ていないので、
    // poems.json の color を変えれば両方まとめて変わる。
    a.style.setProperty('--theme', poem.color || 'var(--border)');

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    a.appendChild(swatch);

    const label = document.createElement('span');
    label.className = 'poem-label';
    label.textContent = poem.titleJa;
    a.appendChild(label);

    a.addEventListener('click', e => {
        e.preventDefault();
        history.replaceState(null, '', '#' + poem.id);
        selectPoem(poem.id);
    });
    return a;
}

/* ── 本文の表示 ── */
async function selectPoem(id) {
    const poem = poems.find(p => p.id === id);
    if (!poem) return;
    currentId = id;

    els.index.querySelectorAll('.poem-link').forEach(a => {
        a.classList.toggle('active', a.dataset.id === id);
    });

    const color = poem.color || 'var(--border)';
    els.side.style.setProperty('--c', color);
    els.swatchLg.hidden = false;
    els.titleJa.textContent = poem.titleJa;
    els.titleEn.textContent = poem.titleEn || '';

    els.display.textContent = '';
    els.scroll.scrollTop = 0;

    try {
        const res = await fetch(poem.file);
        if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
        // 本文は textContent で入れる。white-space: pre-wrap が改行を保つので
        // HTML に変換する必要はなく、記号がタグとして解釈される事故も起きない。
        // CRLF は LF に揃えてから流す（pre-wrap で余分な空白扱いにならないように）
        els.display.textContent = (await res.text()).replace(/\r\n?/g, '\n').replace(/\s+$/, '');
    } catch (err) {
        els.display.appendChild(makeError('Failed to load — ' + err.message));
    }
}

function makeError(message) {
    const p = document.createElement('p');
    p.className = 'placeholder';
    p.textContent = message;
    return p;
}

/* ── S / M / L ── */
function setupSizeButtons() {
    const buttons = document.querySelectorAll('.size-btn');
    let saved = null;
    try { saved = localStorage.getItem(SIZE_KEY); } catch (e) { /* プライベートモード等 */ }
    const initial = TEXT_SIZES[saved] ? saved : DEFAULT_SIZE;

    const apply = key => {
        document.documentElement.style.setProperty('--poem-fs', TEXT_SIZES[key] + 'px');
        buttons.forEach(b => b.classList.toggle('active', b.dataset.size === key));
        try { localStorage.setItem(SIZE_KEY, key); } catch (e) { /* 保存できなくても表示は動く */ }
    };

    buttons.forEach(b => b.addEventListener('click', () => apply(b.dataset.size)));
    apply(initial);
}
