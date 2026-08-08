(function () {
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const pad = (n) => String(n).padStart(2, '0');

    function renderClock() {
        const el = document.getElementById('tenokun-clock');
        if (!el) return;
        const now = new Date();
        el.textContent =
            `${now.getFullYear()} / ${pad(now.getMonth() + 1)} / ${pad(now.getDate())} ` +
            `(${DAYS[now.getDay()]}) - ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    }

    renderClock();
    setInterval(renderClock, 1000);
})();
