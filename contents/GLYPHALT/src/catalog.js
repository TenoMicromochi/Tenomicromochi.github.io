// 右端の「PALETTE & GLYPHS」パネル: 現在の選択状態とは無関係に、同梱されている
// 全パレット・全グリフセットを一覧表示する参照用ライブラリ
import { getAllPalettes } from './palette.js';
import { getAllGlyphSets, GLYPH_W, GLYPH_H } from './glyph.js';

// 1セットあたりのグリフプレビュー表示上限(全件表示すると重いセットがあるため)
const GLYPH_PREVIEW_LIMIT = 32;

export function buildCatalog() {
  const body = document.getElementById('catalogBody');
  body.innerHTML = '';

  const paletteSection = document.createElement('div');
  paletteSection.className = 'section';
  const paletteTitle = document.createElement('div');
  paletteTitle.className = 'section-title';
  paletteTitle.textContent = 'PALETTES';
  paletteSection.appendChild(paletteTitle);

  getAllPalettes()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(({ name, colors }) => {
      const card = document.createElement('div');
      card.className = 'catalog-card';

      const label = document.createElement('div');
      label.className = 'catalog-card-label';
      label.textContent = name;

      const strip = document.createElement('div');
      strip.className = 'catalog-swatch-strip';
      colors.forEach(rgb => {
        const sw = document.createElement('div');
        sw.className = 'catalog-swatch';
        sw.style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        sw.title = `rgb(${rgb.join(',')})`;
        strip.appendChild(sw);
      });

      card.appendChild(label);
      card.appendChild(strip);
      paletteSection.appendChild(card);
    });

  const glyphSection = document.createElement('div');
  glyphSection.className = 'section';
  const glyphTitle = document.createElement('div');
  glyphTitle.className = 'section-title';
  glyphTitle.textContent = 'GLYPH SETS';
  glyphSection.appendChild(glyphTitle);

  getAllGlyphSets()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(({ name, thumbCanvases }) => {
      const card = document.createElement('div');
      card.className = 'catalog-card';

      const label = document.createElement('div');
      label.className = 'catalog-card-label';
      label.textContent = `${name} (${thumbCanvases.length})`;

      const grid = document.createElement('div');
      grid.className = 'catalog-glyph-grid';
      thumbCanvases.slice(0, GLYPH_PREVIEW_LIMIT).forEach(src => {
        const dst = document.createElement('canvas');
        dst.width = GLYPH_W; dst.height = GLYPH_H;
        dst.getContext('2d').drawImage(src, 0, 0);
        grid.appendChild(dst);
      });

      card.appendChild(label);
      card.appendChild(grid);
      if (thumbCanvases.length > GLYPH_PREVIEW_LIMIT) {
        const more = document.createElement('div');
        more.className = 'catalog-more';
        more.textContent = `+${thumbCanvases.length - GLYPH_PREVIEW_LIMIT} more`;
        card.appendChild(more);
      }
      glyphSection.appendChild(card);
    });

  body.appendChild(paletteSection);
  body.appendChild(glyphSection);
}
