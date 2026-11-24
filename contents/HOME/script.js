// HOME：時計、カードのマス揃え（見えない 12x18 のマス）、アバターの pupi とハート
// マスは TenoText 3x6 の 18px の 1 文字（12x18）。時計の文字はこのマスに描く
(() => {
  const FONT = { family: 'TenoText 3x6', size: 18 };

  const layer = document.getElementById('home-clock-layer');   // 時計の文字を描く pre
  const bg = document.getElementById('home-bg');
  let cw = 12, ch = 18;
  let clockAt = null;   // { row, col } ページのマス。null なら出さない

  async function init() {
    await document.fonts.load(`${FONT.size}px "${FONT.family}"`);
    const c = document.createElement('canvas').getContext('2d');
    c.font = `${FONT.size}px "${FONT.family}"`;
    cw = Math.round(c.measureText('#'.repeat(100)).width / 100);
    ch = FONT.size;
    await document.fonts.ready;
    layout();
    addEventListener('resize', layout);
    tick();
  }

  // カードをグリッドのマスに合わせる。
  // 枠線がグリッドの線に重なるよう、カードは「マス数×幅 + 1px」、隙間は「1マス − 1px」
  const CARD_COLS = 18;     // カード1枚の横の送り（マス）。カードは 17 マス + 1px
  function snapCards() {
    const grid = document.querySelector('.home-card-grid');
    const cards = [...document.querySelectorAll('.home-card')];
    if (!grid || !cards.length) return;
    const main = grid.parentElement;
    grid.style.cssText = '';
    const ms = getComputedStyle(main);
    const avail = main.clientWidth - parseFloat(ms.paddingLeft) - parseFloat(ms.paddingRight);
    // 列の数と1枚の幅（マス）。1列しか入らないときは入るだけの幅にする
    let n = Math.max(1, Math.floor((avail + cw) / (CARD_COLS * cw)));
    let m = n > 1 ? CARD_COLS : Math.floor((avail + cw) / cw);
    grid.style.gridTemplateColumns = `repeat(${n}, ${(m - 1) * cw + 1}px)`;
    grid.style.columnGap = (cw - 1) + 'px';
    grid.style.rowGap = (ch - 1) + 'px';
    grid.style.gridAutoRows = 'auto';
    grid.style.width = 'max-content';
    // 高さ：一番背の高いカードが入るマス数にそろえる
    const h = Math.max(...cards.map(c => c.getBoundingClientRect().height));
    const k = Math.ceil((h - 1) / ch);
    grid.style.gridAutoRows = (k * ch + 1) + 'px';
    // 左上の角をマスの角に寄せる（本文の左端より右の、一番近いマス）
    const r = grid.getBoundingClientRect();
    const x = r.left + scrollX, y = r.top + scrollY;
    grid.style.marginLeft = (Math.ceil(x / cw) * cw - x) + 'px';
    // 上の余白はリード文の margin-bottom と相殺されるので、その分を足して書く
    const prev = grid.previousElementSibling;
    const above = prev ? parseFloat(getComputedStyle(prev).marginBottom) || 0 : 0;
    grid.style.marginTop = (above + Math.ceil(y / ch) * ch - y) + 'px';
  }

  // 背景（グラデーション）はページと一緒にスクロールし、高さはページ全体に合わせる
  function layout() {
    // 先に時計の入れ物の置き方を決める（狭い画面では行が増えてカードが下がる）。
    // カードを揃えると SANDBOX の位置が動き、置き方が変わることがある（幅を変えたとき）。
    // 置き方が変わったら、もう一度カードを揃える
    const lead = clockEl && clockEl.parentElement;
    const side = () => !!lead && lead.classList.contains('dg-clock-side');
    placeClock();
    snapCards();
    const before = side();
    placeClock();
    if (side() !== before) snapCards();
    bg.style.height = '0px';
    bg.style.height = Math.max(document.documentElement.scrollHeight, innerHeight) + 'px';
    placeClock();
    drawClock();
  }

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pad = n => String(n).padStart(2, '0');
  // 時計：リード文の行に1行で。左端を SANDBOX のカードの左端に揃える。
  // 文字は #home-clock-layer のマスに描くので、カードと同じマスにそろう。
  // #dg-clock は場所を決めるための見えない入れ物（狭い画面で行を確保する）
  const clockEl = document.getElementById('dg-clock');
  function clockText() {
    const d = new Date();
    return `${d.getFullYear()} / ${pad(d.getMonth() + 1)} / ${pad(d.getDate())} (${DAYS[d.getDay()]})` +
      ` ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  clockEl.textContent = clockText();
  // SANDBOX が1段目にあり、時計がリード文に重ならず画面に収まるときだけ横に置く。
  // （時計はカードより幅があるので、本文の枠から右にはみ出してよい）
  // そうでなければリード文の下の行に左揃えで出す
  function placeClock() {
    if (!clockEl) return;
    const lead = clockEl.parentElement;
    const text = lead.querySelector('.dg-lead-text');
    const card = document.querySelector('.home-card[href*="/SANDBOX/"]');
    const first = document.querySelector('.home-card');
    lead.classList.remove('dg-clock-side');
    clockEl.style.left = '';
    if (card && first) {
      const L = lead.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const left = Math.round(c.left - L.left);
      const fits = Math.abs(c.top - first.getBoundingClientRect().top) < 1 &&
        left >= text.getBoundingClientRect().right - L.left + 12 &&
        L.left + left + clockEl.getBoundingClientRect().width <= document.documentElement.clientWidth - 8;
      if (fits) {
        lead.classList.add('dg-clock-side');
        clockEl.style.left = left + 'px';
      }
    }
    // 入れ物の位置を一番近いマスに丸める（ページの一番上にいるときの位置）
    const r = clockEl.getBoundingClientRect();
    clockAt = {
      row: Math.round((r.top + scrollY) / ch),
      col: Math.round((r.left + scrollX) / cw),
    };
  }
  document.fonts.ready.then(placeClock);

  // アバターをクリックすると pupi が鳴る（連打しても頭から鳴らし直す）
  const pupi = new Audio('/sounds/pupi.mp3');
  const avatar = document.querySelector('.tenokun-mascot-img');
  if (avatar) avatar.addEventListener('click', () => {
    pupi.currentTime = 0;
    pupi.play().catch(() => {});
    burstHearts();
  });

  // ハート：アバターの GIF の (46, 16) から 大1・中2・小5 個。
  // 初速はランダム、向きは真上を 0° として左右 ±40°。重力も反射もなく、画面の外に出たら消える
  const HEARTS = [
    { src: '/images/particle/heart_l.png', w: 11, h: 10, n: 1 },
    { src: '/images/particle/heart_m.png', w: 7,  h: 6,  n: 2 },
    { src: '/images/particle/heart_s.png', w: 5,  h: 4,  n: 5 },
  ];
  const HEART_ORIGIN = { x: 46, y: 16 };
  const HEART_SPEED = [120, 360];   // px/s
  const HEART_SPREAD = 40;          // 度
  let heartLayer = null, hearts = [], heartsRunning = false;
  function burstHearts() {
    if (!heartLayer) {
      heartLayer = document.createElement('div');
      heartLayer.id = 'dg-hearts';
      document.body.appendChild(heartLayer);
    }
    const r = avatar.getBoundingClientRect();
    const ox = r.left + HEART_ORIGIN.x, oy = r.top + HEART_ORIGIN.y;
    for (const k of HEARTS) for (let i = 0; i < k.n; i++) {
      const el = new Image(k.w, k.h);
      el.src = k.src;
      el.alt = '';
      heartLayer.appendChild(el);
      const ang = (Math.random() * 2 - 1) * HEART_SPREAD * Math.PI / 180;
      const sp = HEART_SPEED[0] + Math.random() * (HEART_SPEED[1] - HEART_SPEED[0]);
      // 出現位置にハートの中心を合わせる
      hearts.push({ el, w: k.w, h: k.h, x: ox - k.w / 2, y: oy - k.h / 2,
        vx: Math.sin(ang) * sp, vy: -Math.cos(ang) * sp });
    }
    if (!heartsRunning) { heartsRunning = true; lastHeart = performance.now(); requestAnimationFrame(stepHearts); }
  }
  let lastHeart = 0;
  function stepHearts(now) {
    const dt = Math.min(0.05, (now - lastHeart) / 1000);
    lastHeart = now;
    const W = innerWidth, H = innerHeight;
    hearts = hearts.filter(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x + p.w < 0 || p.x > W || p.y + p.h < 0 || p.y > H) { p.el.remove(); return false; }
      p.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
      return true;
    });
    if (hearts.length) requestAnimationFrame(stepHearts);
    else heartsRunning = false;
  }
  // pre の左上はページの左上。行と桁はマスの数で、改行と空白で送る
  function drawClock() {
    layer.textContent = clockAt ? '\n'.repeat(clockAt.row) + ' '.repeat(clockAt.col) + clockText() : '';
  }
  // 1 秒ごと。秒の変わり目に合わせて描き直す
  function tick() {
    drawClock();
    setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
  }
  init();
})();
