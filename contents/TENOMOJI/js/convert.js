// 濁点・半濁点付き文字を「清音＋結合文字」に分解してから変換テーブルを引く。
// 例：「が」→ NFD分解 → 「か」+「゙(結合濁点)」→ それぞれ変換して連結
function tenomojiConvert(input) {
    let output = "";
    for (const ch of input.normalize("NFD")) {
        output += TENOMOJI_MAP[ch] !== undefined ? TENOMOJI_MAP[ch] : ch;
    }
    return output;
}
