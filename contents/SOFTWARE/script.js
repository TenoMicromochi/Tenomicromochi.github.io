// 1本 = 1オブジェクト。増えたらここに足すだけ。icon は 16x16 の実寸
// 文面のルールは Software/WRITING_RULES.md。languages は spec 行に出す（無ければ出さない）
const SOFTWARE = [
  {
    "id": "tliv",
    "name": "TLIV",
    "version": "1.0.0",
    "icon": "images/tliv.png",
    "platform": "Windows 10 / 11 (x64)",
    "license": "MIT",
    "languages": "EN, JA, ZH-CN, ZH-TW",
    "repo": "https://github.com/TenoMicromochi/TLIV",
    "tagline_jp": "軽量画像ビュワー",
    "tagline_en": "A light image viewer",
    "about_jp": "Windows 標準が最低なので作りました。これだけできれば十分、がコンセプトです。",
    "about_en": "The Windows default is the worst, so I made this. The concept: this much is enough.",
    "features_jp": [
      "ドット絵モード：補間なし・整数倍ズーム・座標と HEX 色の表示",
      "情報パネルで EXIF・PNG の埋め込みテキストなどを表示",
      "GIF / APNG / WebP のアニメ再生とコマ送り",
      "範囲選択して透過を保ったままコピー",
      "背景切替（市松・黒・白・任意色）"
    ],
    "features_en": [
      "Pixel mode: no smoothing, whole-number zoom, x / y and HEX colour",
      "Info panel: EXIF, text embedded in PNGs and more",
      "Plays GIF / APNG / WebP animation, frame by frame too",
      "Select an area and copy it with transparency",
      "Background: checker / black / white / custom"
    ]
  },
  {
    "id": "tlvv",
    "name": "TLVV",
    "version": "1.0.0",
    "icon": "images/tlvv.png",
    "platform": "Windows 10 / 11 (x64)",
    "license": "MIT",
    "languages": "EN, JA, ZH-CN, ZH-TW",
    "repo": "https://github.com/TenoMicromochi/TLVV",
    "tagline_jp": "軽量動画ビュワー",
    "tagline_en": "A light video viewer",
    "about_jp": "Windows 標準が最低なので作りました。これだけできれば十分、がコンセプトです。",
    "about_en": "The Windows default is the worst, so I made this. The concept: this much is enough.",
    "features_jp": [
      "← → で同じフォルダの前後の動画へ（端でループ）",
      "コマ送り・コマ戻し、再生速度 x0.25〜x4",
      "等倍 / 窓に合わせる の切り替え、全画面",
      "終わったら：停止 / ループ / 次の動画",
      "MP4 / MOV / MKV / WebM / AVI / WMV（再生できるかは Windows のコーデックに依存します）"
    ],
    "features_en": [
      "Left / Right for the previous / next video in the folder (loops at the ends)",
      "Frame back / forward, speed x0.25 to x4",
      "Fit to window or 1x, fullscreen",
      "At end: stop / loop / next video",
      "MP4 / MOV / MKV / WebM / AVI / WMV (depends on the codecs in your Windows)"
    ]
  },
  {
    "id": "tlap",
    "name": "TLAP",
    "version": "1.0.1",
    "icon": "images/tlap.png",
    "platform": "Windows 10 / 11 (x64)",
    "license": "MIT",
    "languages": "EN, JA, ZH-CN, ZH-TW",
    "repo": "https://github.com/TenoMicromochi/TLAP",
    "tagline_jp": "軽量音楽プレーヤー",
    "tagline_en": "A light music player",
    "about_jp": "Windows 標準が最低なので作りました。これだけできれば十分、がコンセプトです。",
    "about_en": "The Windows default is the worst, so I made this. The concept: this much is enough.",
    "features_jp": [
      "曲間なしの再生、リピート4種（1曲 / フォルダ / フォルダの最後で停止 / 1曲で停止）",
      "列を選べる曲の一覧、並べ替えた順に再生",
      "ジャケット、小さなエクスプローラ、情報パネル、ミニ窓",
      "10バンド EQ、HLSL シェーダーのビジュアライザ（自作を足せる）",
      "MP3 / M4A / FLAC / WAV / WMA / Ogg Vorbis / Opus"
    ],
    "features_en": [
      "Gapless playback, 4 repeat modes (one / folder / stop at folder end / stop after track)",
      "Song list with selectable columns; sorting sets the play order",
      "Cover, small folder explorer, info panel, mini window",
      "10-band EQ and HLSL shader visualizers (add your own)",
      "MP3 / M4A / FLAC / WAV / WMA / Ogg Vorbis / Opus"
    ]
  },
  {
    "id": "ttui",
    "name": "TTUI",
    "version": "0.2.1",
    "icon": "images/ttui.png",
    "platform": "Windows 10 / 11 (x64)",
    "license": "MIT",
    "repo": "https://github.com/TenoMicromochi/Tenokun-s_TUI_Visualizer",
    "tagline_jp": "音声をブラウン管風の TUI 動画にするソフト",
    "tagline_en": "Turns audio into a CRT-style TUI video",
    "about_jp": "曲のファイルを入れると、昔のパソコンの文字だけの画面がブラウン管に映ったような映像になり、音に合わせて動きます。書き出した MP4 はそのまま YouTube や X に上げられます。",
    "about_en": "Drop in a song and it becomes a text-only computer screen on an old CRT, moving to the sound. The MP4 it writes is ready for YouTube or X.",
    "features_jp": [
      "スペクトラム・メーター・ラウドネスを文字の格子で描き、ブラウン管効果をかける",
      "台本ファイルで曲情報・歌詞・AA・演出を LOG に流す（秒 / 小節指定）",
      "レイアウト5種（16:9 と 4:3）、16色パレットと § 色コード",
      "コマ単位で正確な 1920x1080 MP4 書き出し（H.264 / AAC・Opus）",
      "プロジェクトファイル .ttui に全部まとめて保存"
    ],
    "features_en": [
      "Spectrum, meters and loudness drawn as a text grid, with a CRT pass",
      "A script puts song info, lyrics, ASCII art and effects into a LOG (seconds or bars)",
      "Five layouts (16:9 and 4:3), 16-colour palettes with § colour codes",
      "Frame-exact 1920x1080 MP4 rendering (H.264 / AAC or Opus)",
      "Project files (.ttui) keep everything together"
    ]
  },
  {
    "id": "edgthumb",
    "name": "EdgThumb",
    "version": "1.0.0",
    "icon": "images/edgthumb.png",
    "platform": "Windows 10 / 11 (x64)",
    "license": "MIT",
    "repo": "https://github.com/TenoMicromochi/EdgThumb",
    "tagline_jp": "EDGE2 の .edg をエクスプローラーでサムネイル表示するパッチ",
    "tagline_en": "A patch that shows EDGE2 .edg thumbnails in Windows Explorer",
    "about_jp": "Windows のエクスプローラーで .edg ファイルの中身が見えないのが不便なので作りました。非公式ツールです。",
    "about_en": "Windows Explorer doesn't show what's inside .edg files. That was annoying, so I made this. Unofficial tool.",
    "features_jp": [
      "EDGE2 で開いているページを、EDGE2 上と同じ見え方で合成",
      "1 / 4 / 8 / 15 / 16 / 24bit に対応（EDGE1 形式は非対応）",
      "整数倍・整数分の1だけで拡大縮小、補間なし",
      "背景色は透明"
    ],
    "features_en": [
      "Composes the current page the way EDGE2 shows it",
      "Supports 1 / 4 / 8 / 15 / 16 / 24 bit (not EDGE1)",
      "Scales by whole-number steps only, never interpolated",
      "Transparent background"
    ]
  }
];

// ---- 言語（作品の文だけ切り替える。画面の見出し・ボタンは英語固定） ----
const LANG_KEY = 'sodenmir.software.lang';
function loadLang() {
    try { return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'jp'; } catch (e) { return 'jp'; }
}
function saveLang(v) {
    try { localStorage.setItem(LANG_KEY, v); } catch (e) { /* 保存できなくても表示は続ける */ }
}
let lang = loadLang();

function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function render() {
    const root = document.getElementById('software-list');
    root.innerHTML = SOFTWARE.map((sw) => `
        <article class="card">
            <div class="card-top">
                <div class="icon-box"><img class="px" src="${esc(sw.icon)}" alt="" width="16" height="16"></div>
                <div class="card-main">
                    <div class="card-title"><span class="sw-name">${esc(sw.name)}</span><span class="sw-ver">v${esc(sw.version)}</span></div>
                    <div class="sw-tagline">${esc(sw['tagline_' + lang])}</div>
                </div>
            </div>
            <div class="card-body">
                <p class="about">${esc(sw['about_' + lang])}</p>
                <ul class="features">${sw['features_' + lang].map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
                <div class="card-foot">
                    <span class="spec-line">${esc(sw.platform)} / ${esc(sw.license)}${sw.languages ? ' / ' + esc(sw.languages) : ''}</span>
                    <div class="dl-buttons">
                        <a class="btn" href="${esc(sw.repo)}/releases/latest" target="_blank" rel="noopener">RELEASES &gt;</a>
                        <a class="btn secondary" href="${esc(sw.repo)}" target="_blank" rel="noopener">GITHUB</a>
                    </div>
                </div>
            </div>
        </article>`).join('');
    document.querySelectorAll('.lang-switch .tag').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
}

document.querySelectorAll('.lang-switch .tag').forEach((b) => {
    b.addEventListener('click', () => { lang = b.dataset.lang; saveLang(lang); render(); });
});
render();
