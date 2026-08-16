const UPDATE_LOGS = [
    {
        date: "2026/08/17",
        text: "追加//Added: FLAKALT"
    },
    {
        date: "2026/08/08",
        text: "追加//Added: PALETALT-K"
    },
    {
        date: "2026/08/07",
        text: "追加//Added: TENOMOJI\n変更//Updated: GLYPHALT-16"
    },
    {
        date: "2026/08/06",
        text: "変更//Updated: SITE-DESIGN\n追加//Added: PROFILE\n変更//Updated: HOME"
    },
    {
        date: "2026/08/04",
        text: "🐾Move the site's host to GitHub🐾\n削除//Deleted: CHROMALT-Q\n削除//Deleted: MAP-GEN"
    },
    {
        date: "2026/08/04",
        text: "変更//Updated: TEXTALT-V"
    },
    {
        date: "2026/08/03",
        text: "変更//Updated: GLYPHALT-16"
    },
    {
        date: "2026/07/30",
        text: "変更//Updated: GLYPHALT-16"
    },
    {
        date: "2026/07/29",
        text: "変更//Updated: TENOMOJI\n変更//Updated: LINK"
    },
    {
        date: "2026/07/28",
        text: "変更//Updated: GLYPHALT-16"
    },
    {
        date: "2026/05/28",
        text: "追加//Added: TEXTALT-V\n削除//Deleted: aa-Gen"
    },
    {
        date: "2026/04/17",
        text: "変更//Updated: HOME\n変更//Updated: SIDE BAR MENU"
    },
    {
        date: "2026/04/15",
        text: "追加//Added: CHROMALT-Q"
    },
    {
        date: "2026/04/09",
        text: "追加//Added: GLYPHALT-16"
    },
    {
        date: "2026/02/15",
        text: "追加//Added: Map-gen"
    },
    {
        date: "2026/02/03",
        text: "追加//Added: Updates"
    },
    {
        date: "2026/02/02",
        text: "誕生//Debut: 送電世界/SodenMir/そーでんみーる\n追加//Added: Home / Link / AA-gen / Font / Poem"
    },

];

document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('log-container');

    UPDATE_LOGS.forEach(log => {
        const item = document.createElement('div');
        item.className = 'log-item';

        // 日付部分
        const dateSpan = document.createElement('span');
        dateSpan.className = 'log-date';
        dateSpan.textContent = `[ ${log.date} ]`;

        // 本文部分
        const textP = document.createElement('div');
        textP.className = 'log-text';
        textP.textContent = log.text;

        item.appendChild(dateSpan);
        item.appendChild(textP);
        container.appendChild(item);
    });
});
