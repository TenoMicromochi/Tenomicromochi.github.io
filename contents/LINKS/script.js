const LINK_DATA = [
    {
        title: "Twitter/X",
        url: "https://x.com/_Tenokun_",
        image: "/images/icons/X.png",
        buttonText: "←VISIT！",
        description: "僕のTwitterメインアカウントです\n色々呟いてるよ"
    },
    {
        title: "DISCORD - あーく・そどむ",
        url: "https://t.co/amifWLaZYL",
        image: "/images/icons/DISCORD.png",
        buttonText: "←VISIT！",
        description: "僕が管理者のDiscordサーバーです\nもしよければ覗いていってね"
    },
    {
        title: "PIXIV",
        url: "https://www.pixiv.net/users/7435083",
        image: "/images/icons/PIXIV.png",
        buttonText: "←VISIT！",
        description: "僕のドット絵がいっぱい置いてある場所です\n好きにみていってね"
    },
    {
        title: "VRChat",
        url: "https://vrchat.com/home/user/usr_2c3892bd-bc45-4bdf-b6ff-2a763227d13b",
        image: "/images/icons/VRCHAT.png",
        buttonText: "←VISIT！",
        description: "僕のVRChatアカウントです\nフレンド登録歓迎だよ"
    },
    {
        title: "YOUTUBE",
        url: "https://www.youtube.com/@Teno_Micromochi",
        image: "/images/icons/YOUTUBE.png",
        buttonText: "←VISIT！",
        description: "僕の音楽がそこそこ置いてある場所です\n好きにみていってね"
    },
];

document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('link-list-container');

    LINK_DATA.forEach(data => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'link-item';

        const headerDiv = document.createElement('div');
        headerDiv.className = 'link-header';

        const iconImg = document.createElement('img');
        iconImg.src = data.image;
        iconImg.alt = "icon";
        iconImg.className = 'link-icon';

        iconImg.onerror = function() {
            this.style.display = 'none';
        };

        const titleSpan = document.createElement('span');
        titleSpan.className = 'link-title';
        titleSpan.textContent = data.title;

        const linkBtn = document.createElement('a');
        linkBtn.href = data.url;
        linkBtn.className = 'link-button';
        linkBtn.textContent = data.buttonText;
        linkBtn.target = "_blank";
        linkBtn.rel = "noopener noreferrer";

        headerDiv.appendChild(iconImg);
        headerDiv.appendChild(titleSpan);
        headerDiv.appendChild(linkBtn);

        const descP = document.createElement('p');
        descP.className = 'link-desc';
        descP.textContent = data.description;

        itemDiv.appendChild(headerDiv);
        itemDiv.appendChild(descP);
        container.appendChild(itemDiv);
    });
});