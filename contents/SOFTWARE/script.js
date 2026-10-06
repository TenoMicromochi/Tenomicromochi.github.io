// 1本 = 1オブジェクト。増えたらここに足すだけ。icon は 16x16 の実寸
// features_* の文面は仮（Kaname が後で書き直す）
const SOFTWARE = [
  {
    "id": "tliv",
    "name": "TLIV",
    "version": "1.0.0",
    "icon": "images/tliv.png",
    "platform": "Windows 10 / 11 (x64)",
    "license": "MIT",
    "repo": "https://github.com/TenoMicromochi/TLIV",
    "tagline_jp": "軽量画像ビュワー。画像の細かなメタデータも覗けます。",
    "tagline_en": "A light image viewer that also lets you peek at detailed image metadata.",
    "about_jp": "ダブルクリックですぐ開く、画像を見るためだけの小さなソフトです。ドット絵をぼかさずに拡大でき、カーソルの下の座標と色もその場で分かります。I キーで情報パネルを開くと、画像の大きさ・色数・EXIF・PNG に埋め込まれた文字なども読めます。",
    "about_en": "A small program that only shows images, and opens instantly. Pixel art zooms in without blurring, and you can see the position and colour under the cursor. Press I to open the info panel: size, colour count, EXIF and text embedded in PNGs.",
    "features_jp": [
      "ドット絵モード：補間なし・整数倍ズーム・座標と HEX 色の表示",
      "情報パネルで EXIF・PNG の埋め込みテキストなどを表示",
      "GIF / APNG / WebP のアニメ再生とコマ送り",
      "範囲選択して透過を保ったままコピー",
      "背景切替（市松・黒・白・任意色）",
      "英語 / 日本語 / 简体中文 / 繁體中文"
    ],
    "features_en": [
      "Pixel mode: no smoothing, whole-number zoom, x / y and HEX colour",
      "Info panel: EXIF, text embedded in PNGs and more",
      "Plays GIF / APNG / WebP animation, frame by frame too",
      "Select an area and copy it with transparency",
      "Background: checker / black / white / custom",
      "English / 日本語 / 简体中文 / 繁體中文"
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
    "tagline_jp": "音声を TUI ＋ブラウン管風の動画にするソフトウェア。",
    "tagline_en": "Turns your audio into a TUI-style video on an old CRT screen.",
    "about_jp": "曲のファイルを入れると、昔のパソコンの文字だけの画面（TUI）がブラウン管に映っているような映像で、音に合わせてメーターやスペクトラムが動きます。歌詞や曲の情報も画面に流せて、そのまま YouTube や X に上げられる 1920x1080 の MP4 として書き出せます。",
    "about_en": "Drop in a song and it plays as a text-only computer screen (a TUI) on an old CRT, with meters and a spectrum moving to the sound. You can show lyrics and song info on screen too, and save it as a 1920x1080 MP4 ready for YouTube or X.",
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
    "tagline_jp": "Windows エクスプローラーで EDGE2 の *.edg をサムネイル表示させるパッチ。",
    "tagline_en": "A patch that makes Windows Explorer show thumbnails of EDGE2 *.edg files.",
    "about_jp": "ドット絵ソフト EDGE2 で保存した .edg ファイルは、ふつうエクスプローラーでは中身が見えず、同じアイコンが並ぶだけです。これを入れると、PNG などと同じようにフォルダの中で絵が小さく表示され、ファイルを開かなくてもどれが何の絵か分かります。（非公式ツールです）",
    "about_en": "Files saved by the pixel art editor EDGE2 (.edg) normally all look the same in Explorer. Install this and they show a small picture of what is inside, like PNGs do, so you can find a drawing without opening it. (Unofficial tool.)",
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
                    <span class="spec-line">${esc(sw.platform)} / ${esc(sw.license)}</span>
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
