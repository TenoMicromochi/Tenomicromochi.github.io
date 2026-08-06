const poemList = [
{ title: "俳句・短歌・自由律", file: "data/俳句・短歌・自由律.txt" },
{ title: "抗アレルギー薬と人類愛と頭痛と風邪と体が熱くて眠いから", file: "data/抗アレルギー薬と人類愛と頭痛と風邪と体が熱くて眠いから.txt" },
{ title: "2つのプロペラ、3つの皿、5泊の連続に。", file: "data/2つのプロペラ、3つの皿、5泊の連続に。.txt" },
{ title: "爆死未遂ログ！", file: "data/爆死未遂ログ！.txt" },
{ title: "簡単に言えば72回目くらいのルール", file: "data/簡単に言えば72回目くらいのルール.txt" },
{ title: "止まらない動悸！(混乱！)", file: "data/止まらない動悸！(混乱！).txt" },
{ title: "アスファルト・デイ", file: "data/アスファルト・デイ.txt" },
{ title: "ロフトベッドのビニール祝福", file: "data/ロフトベッドのビニール祝福.txt" },
{ title: "こたつ・みかん", file: "data/こたつ・みかん.txt" },
{ title: "人間の夢", file: "data/人間の夢.txt" },
{ title: "もし、平和の仮眠が正確なら。", file: "data/もし、平和の仮眠が正確なら。.txt" },
{ title: "溶け落ちる散歩", file: "data/溶け落ちる散歩.txt" },
{ title: "透明", file: "data/透明.txt" },
{ title: "しんだあと", file: "data/しんだあと.txt" },
{ title: "チョコレート自殺", file: "data/チョコレート自殺.txt" },
{ title: "お昼寝前：白", file: "data/お昼寝前：白.txt" },
{ title: "お昼寝前：茶", file: "data/お昼寝前：茶.txt" },
{ title: "お昼寝前：緑", file: "data/お昼寝前：緑.txt" },
{ title: "お昼寝前：赤", file: "data/お昼寝前：赤.txt" },
];

document.addEventListener('DOMContentLoaded', () => {
    const listElement = document.getElementById('poem-titles');
    const displayElement = document.getElementById('poem-display');

    poemList.forEach(poem => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.textContent = poem.title;
        
        a.addEventListener('click', () => {
            loadPoem(poem.file);
        });

        li.appendChild(a);
        listElement.appendChild(li);
    });

    async function loadPoem(filePath) {
        displayElement.textContent = "読み込み中なのです...";
        try {
            const response = await fetch(filePath);
            if (!response.ok) throw new Error("ファイルが見つからないのです");
            const text = await response.text();
            displayElement.textContent = text;
        } catch (error) {
            displayElement.textContent = "エラーが発生したのです: " + error.message;
        }
    }
});