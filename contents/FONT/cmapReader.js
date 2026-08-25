/* ============================================================
   cmapReader.js
   TTF / OTF のバイナリから cmap テーブルを読み、
   「そのフォントが実際にグリフを持つコードポイント」を列挙する。

   外部ライブラリは使わない。必要なのは以下の3テーブルだけ:
     head … unitsPerEm
     hhea … ascender / descender（ベースライン位置の整数判定に使う）
     cmap … 収録コードポイント

   対応サブテーブル形式: 0 / 4 / 6 / 12
   （自作フォント8書体はすべて format 4 だが、
     将来 BMP 外を含むフォントを足したときのために 12 も見る）
   ============================================================ */

/** 指定URLのフォントを取得して解析する */
export async function loadCoverage(url) {
    const res = await fetch(encodeURI(url));
    if (!res.ok) throw new Error(`font fetch failed (${res.status}): ${url}`);
    return parseCoverage(await res.arrayBuffer());
}

/**
 * @returns {{unitsPerEm:number, ascender:number, descender:number,
 *            codepoints:Set<number>, cmapFormat:number}}
 */
export function parseCoverage(buffer) {
    const dv = new DataView(buffer);
    const tables = readTableDirectory(dv);

    if (!tables.cmap) throw new Error('cmap table not found');

    const head = tables.head;
    const hhea = tables.hhea;

    return {
        unitsPerEm: head ? dv.getUint16(head.offset + 18) : 1000,
        ascender:   hhea ? dv.getInt16(hhea.offset + 4) : 0,
        descender:  hhea ? dv.getInt16(hhea.offset + 6) : 0,
        ...readCmap(dv, tables.cmap.offset)
    };
}

/* ── テーブルディレクトリ ── */
function readTableDirectory(dv) {
    const numTables = dv.getUint16(4);
    const tables = {};
    for (let i = 0; i < numTables; i++) {
        const rec = 12 + i * 16;
        const tag = String.fromCharCode(
            dv.getUint8(rec), dv.getUint8(rec + 1),
            dv.getUint8(rec + 2), dv.getUint8(rec + 3)
        );
        tables[tag] = { offset: dv.getUint32(rec + 8), length: dv.getUint32(rec + 12) };
    }
    return tables;
}

/* ── cmap 本体 ── */
function readCmap(dv, cmapOffset) {
    const numSubtables = dv.getUint16(cmapOffset + 2);
    const subtables = [];
    for (let i = 0; i < numSubtables; i++) {
        const rec = cmapOffset + 4 + i * 8;
        subtables.push({
            platformID: dv.getUint16(rec),
            encodingID: dv.getUint16(rec + 2),
            offset: cmapOffset + dv.getUint32(rec + 4)
        });
    }

    // Windows UCS-4 → Windows BMP → Unicode → 先頭、の順で優先
    const pick =
        subtables.find(s => s.platformID === 3 && s.encodingID === 10) ||
        subtables.find(s => s.platformID === 3 && s.encodingID === 1) ||
        subtables.find(s => s.platformID === 0) ||
        subtables[0];

    if (!pick) throw new Error('no usable cmap subtable');

    const format = dv.getUint16(pick.offset);
    const codepoints = new Set();

    switch (format) {
        case 0:  readFormat0(dv, pick.offset, codepoints); break;
        case 4:  readFormat4(dv, pick.offset, codepoints); break;
        case 6:  readFormat6(dv, pick.offset, codepoints); break;
        case 12: readFormat12(dv, pick.offset, codepoints); break;
        default: throw new Error(`unsupported cmap format: ${format}`);
    }

    return { codepoints, cmapFormat: format };
}

/* format 0: 1バイト索引 */
function readFormat0(dv, off, out) {
    for (let c = 0; c < 256; c++) {
        if (dv.getUint8(off + 6 + c) !== 0) out.add(c);
    }
}

/* format 4: セグメント方式（BMP、もっとも一般的） */
function readFormat4(dv, off, out) {
    const segCountX2 = dv.getUint16(off + 6);
    const segCount = segCountX2 / 2;

    const endCodes      = off + 14;
    const startCodes    = endCodes + segCountX2 + 2;   // +2 は reservedPad
    const idDeltas      = startCodes + segCountX2;
    const idRangeOffsets = idDeltas + segCountX2;

    for (let i = 0; i < segCount; i++) {
        const start = dv.getUint16(startCodes + i * 2);
        const end   = dv.getUint16(endCodes + i * 2);
        const delta = dv.getInt16(idDeltas + i * 2);
        const rangeOffsetPos = idRangeOffsets + i * 2;
        const rangeOffset = dv.getUint16(rangeOffsetPos);

        if (start === 0xFFFF) continue; // 終端セグメント

        for (let c = start; c <= end; c++) {
            let glyphId;
            if (rangeOffset === 0) {
                glyphId = (c + delta) & 0xFFFF;
            } else {
                const idx = rangeOffsetPos + rangeOffset + (c - start) * 2;
                if (idx + 1 >= dv.byteLength) continue; // 壊れたテーブル対策
                glyphId = dv.getUint16(idx);
                if (glyphId !== 0) glyphId = (glyphId + delta) & 0xFFFF;
            }
            // glyphId 0 は .notdef ＝ 未収録
            if (glyphId !== 0) out.add(c);
        }
    }
}

/* format 6: 連続範囲 */
function readFormat6(dv, off, out) {
    const first = dv.getUint16(off + 6);
    const count = dv.getUint16(off + 8);
    for (let i = 0; i < count; i++) {
        if (dv.getUint16(off + 10 + i * 2) !== 0) out.add(first + i);
    }
}

/* format 12: グループ方式（BMP外を含む） */
function readFormat12(dv, off, out) {
    const numGroups = dv.getUint32(off + 12);
    for (let i = 0; i < numGroups; i++) {
        const g = off + 16 + i * 12;
        const start = dv.getUint32(g);
        const end   = dv.getUint32(g + 4);
        for (let c = start; c <= end; c++) out.add(c);
    }
}
