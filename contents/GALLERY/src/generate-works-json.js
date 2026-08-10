#!/usr/bin/env node
// my_works/ 配下を走査して ../works.json を生成・更新する。
// 既存の works.json にある category のラベル(ja/en)や、
// item の titleJa/titleEn/description は file パス一致で保持したままマージする。
// 実行: node src/generate-works-json.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MY_WORKS_DIR = path.join(ROOT, 'my_works');
const OUTPUT_PATH = path.join(ROOT, 'works.json');

// フォルダ名 → カテゴリ定義の初期値。フォルダ名が日本語でも
// key は英語スラッグにしておきたいものだけここで対応付ける。
// 未登録のフォルダはフォルダ名をそのまま key/ja/en に使う。
const KNOWN_CATEGORIES = {
    avatar:   { key: 'avatar',    ja: 'アバター',            en: 'Avatars' },
    machine:  { key: 'machine',   ja: 'マシン系',            en: 'Machines' },
    talisman: { key: 'talisman',  ja: '護符',               en: 'Talismans' },
    '装備':    { key: 'equipment', ja: '装備',               en: 'Equipment' },
    'おくすりファンアート': { key: 'medicine', ja: 'おくすりファンアート', en: 'Medicine Fan Art' },
    other:    { key: 'other',     ja: 'その他',              en: 'Other' },
    icons:    { key: 'icons',     ja: 'アイコン・素材',        en: 'Icons & Materials' },
};

const IMAGE_EXTENSIONS = new Set(['.png', '.gif']);

let existing = { categories: [], items: [] };
if (fs.existsSync(OUTPUT_PATH)) {
    existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
}
const existingItemByFile = new Map(existing.items.map(i => [i.file, i]));
const existingCategoryByKey = new Map(existing.categories.map(c => [c.key, c]));

const categories = [];
const items = [];

const folders = fs.readdirSync(MY_WORKS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

for (const folder of folders) {
    const known = KNOWN_CATEGORIES[folder];
    const key = known ? known.key : folder;

    // ラベルは既存のworks.json > KNOWN_CATEGORIES > フォルダ名 の優先順で決める。
    // (手動でラベルを直しても再生成で上書きされない)
    categories.push(existingCategoryByKey.get(key) || known || { key, ja: folder, en: folder });

    const files = fs.readdirSync(path.join(MY_WORKS_DIR, folder), { withFileTypes: true })
        .filter(d => d.isFile() && IMAGE_EXTENSIONS.has(path.extname(d.name).toLowerCase()))
        .map(d => d.name)
        .sort((a, b) => a.localeCompare(b, 'ja'));

    for (const file of files) {
        const relPath = 'my_works/' + folder + '/' + file;
        const prev = existingItemByFile.get(relPath);
        // titleJa/titleEn/description等、手動で足した項目があれば維持。category/fileは常に最新化。
        items.push(prev ? { ...prev, category: key, file: relPath } : { category: key, file: relPath });
    }
}

fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ categories, items }, null, 2) + '\n', 'utf8');
console.log(`works.json を更新しました（カテゴリ${categories.length}件 / 作品${items.length}件）`);
