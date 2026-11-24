#!/usr/bin/env node
// SODENMIR/images/ 直下のフォルダを走査して ../assets.json を生成・更新する。
// 既存の assets.json の category ラベルや item の titleJa/titleEn/description は
// file パス一致で保持したままマージする。
// 実行: node contents/ASSETS/src/generate-assets-json.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const IMAGES_DIR = path.join(ROOT, '..', '..', 'images');
const OUTPUT_PATH = path.join(ROOT, 'assets.json');

// 未登録のフォルダはフォルダ名をそのまま key/ja/en に使う。
const KNOWN_CATEGORIES = {
    avatar:     { key: 'avatar',     ja: 'アバター',         en: 'Avatar' },
    background: { key: 'background', ja: 'バックグラウンド', en: 'Background' },
    buttons:    { key: 'buttons',    ja: 'ボタン',           en: 'Buttons' },
    cards:      { key: 'cards',      ja: 'カード',           en: 'Cards' },
    icons:      { key: 'icons',      ja: 'アイコン',         en: 'Icons' },
    particle:   { key: 'particle',   ja: 'パーティクル',     en: 'Particle' },
    tile:       { key: 'tile',       ja: 'タイル',           en: 'Tile' },
    title:      { key: 'title',      ja: 'タイトル',         en: 'Title' },
};

const IMAGE_EXTENSIONS = new Set(['.png', '.gif', '.webp']);
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

let existing = { categories: [], items: [] };
if (fs.existsSync(OUTPUT_PATH)) {
    existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
}
const existingItemByFile = new Map(existing.items.map(i => [i.file, i]));
const existingCategoryByKey = new Map(existing.categories.map(c => [c.key, c]));

const categories = [];
const items = [];

const folders = fs.readdirSync(IMAGES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort(byName);

for (const folder of folders) {
    const known = KNOWN_CATEGORIES[folder];
    const key = folder;
    categories.push(existingCategoryByKey.get(key) || known || { key, ja: folder, en: folder });

    const files = fs.readdirSync(path.join(IMAGES_DIR, folder), { withFileTypes: true })
        .filter(d => d.isFile() && IMAGE_EXTENSIONS.has(path.extname(d.name).toLowerCase()))
        .map(d => d.name)
        .sort(byName);

    for (const file of files) {
        const relPath = '/images/' + folder + '/' + file;
        const prev = existingItemByFile.get(relPath);
        items.push(prev ? { ...prev, category: key, file: relPath } : { category: key, file: relPath });
    }
}

fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ categories, items }, null, 2) + '\n', 'utf8');
console.log(`assets.json を更新しました（カテゴリ${categories.length}件 / 画像${items.length}件）`);
