// HOME：背景の電柱 AA（TenoText 3x6 18px / 水色 / グリッド / そよ風）、時計、カードのマス揃え、アバターの pupi とハート
// 電線は碍子（X の右端）から画面の左端までを1径間とみなし、真ん中が一番低い放物線
(() => {
  const FONT = { family: 'TenoText 3x6', size: 18 };
  const WIND = { center: 2.0, amp: 0.9, speed: 0.9 };   // CALM
  const LEVEL_TOP = ['~', '-', '_', ' '];
  const LEVEL_BELOW = '`';

  const aa = document.getElementById('denchu-aa');
  const bg = document.getElementById('denchu-bg');
  let base = [], wires = [], rowEls = [];
  let cols = 0, cw = 12, ch = 18, gx = 0, ox = 0, topRows = 0, lastKey = '';
  let clockAt = null;   // { row, col } 画面のマス。null なら出さない

  async function init() {
    const txt = await (await fetch('aa_source.txt')).text();
    base = txt.replace(/\r/g, '').split('\n');
    while (base.length && base[base.length - 1].trim() === '') base.pop();
    cols = Math.max(...base.map(l => l.length));
    base = base.map(l => l.padEnd(cols, ' '));
    base.forEach((l, r) => {
      const m = l.match(/^X+/);
      if (m) wires.push({ row: r, len: m[0].length });
    });
    wires.forEach((w, i) => {
      w.phase = (w.row < 10 ? 0 : 1.1) + i * 0.25;
      w.rate = 1 + ((i * 37) % 7 - 3) * 0.02;
    });
    await document.fonts.load(`${FONT.size}px "${FONT.family}"`);
    const c = document.createElement('canvas').getContext('2d');
    c.font = `${FONT.size}px "${FONT.family}"`;
    cw = Math.round(c.measureText('#'.repeat(100)).width / 100);
    ch = FONT.size;
    bg.style.setProperty('--dg-cw', cw + 'px');
    bg.style.setProperty('--dg-ch', ch + 'px');
    await document.fonts.ready;
    layout();
    addEventListener('resize', layout);
    requestAnimationFrame(tick);
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

  // 背景はページと一緒にスクロールする（グリッドとカードがずれないように）。
  // 電柱は右寄せ、上は上部バーの下から1マス空ける。柱はページの下まで継ぎ足す
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
    const docW = document.documentElement.clientWidth;
    const docH = Math.max(document.documentElement.scrollHeight, innerHeight);
    bg.style.height = docH + 'px';
    gx = Math.floor(docW / cw);
    const gy = Math.ceil(docH / ch);
    const bar = document.getElementById('sodenmir-topbar');
    const barRows = bar ? Math.ceil(bar.getBoundingClientRect().bottom / ch) : 0;
    // pre は画面の一番上から置き、AA は topRows 行下げる（時計を上の行にも描けるように）
    topRows = barRows + 1;
    ox = gx - cols;
    const total = Math.max(gy, topRows + base.length);
    aa.style.top = '0px';
    aa.textContent = '';
    rowEls = [];
    for (let r = 0; r < total; r++) {
      const s = document.createElement('span');
      s.textContent = screenRow(r).join('') + '\n';
      aa.appendChild(s);
      rowEls.push(s);
    }
    lastKey = '';
    placeClock();
  }
  function baseRow(r) {
    if (r < 0) return '';
    if (r < base.length) return base[r];
    const p = 7, start = base.length - p;
    return base[start + ((r - base.length) % p)];
  }
  function screenRow(r) {
    const src = baseRow(r - topRows), out = new Array(gx);
    for (let c = 0; c < gx; c++) out[c] = src[c - ox] ?? ' ';
    return out;
  }
  function depth(w, t) {
    const a = Math.sin(t * WIND.speed * w.rate + w.phase);
    const b = Math.sin(t * WIND.speed * 0.37 + w.phase * 0.5) * 0.35;
    const v = WIND.center + WIND.amp * (a * 0.8 + b);
    return Math.min(3, Math.max(0, v - 1));
  }
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pad = n => String(n).padStart(2, '0');
  // 時計：リード文の行に1行で。左端を SANDBOX のカードの左端に揃える。
  // 文字は背景の AA のマスに描くので、グリッドとずれない。
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
    lastKey = '';
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
  function tick(ms) {
    const t = ms / 1000;
    const levels = wires.map(w => {
      const A = ox + w.len, d = depth(w, t), lv = [];
      for (let c = 0; c < A; c++) {
        const u = (c + 0.5) / A * 2 - 1;
        lv.push(Math.round(d * (1 - u * u)));
      }
      return lv;
    });
    const clock = clockText();
    const key = levels.map(l => l.join('')).join('|') + clock;
    if (key !== lastKey) {
      lastKey = key;
      const rows = new Map();
      const get = r => rows.get(r) ?? screenRow(r);
      wires.forEach((w, i) => {
        const R = w.row + topRows;
        const lv = levels[i], line = get(R), below = get(R + 1);
        for (let c = 0; c < lv.length; c++) {
          line[c] = LEVEL_TOP[lv[c]];
          if (lv[c] === 3 && below[c] === ' ') below[c] = LEVEL_BELOW;
        }
        rows.set(R, line);
        rows.set(R + 1, below);
      });
      if (clockAt && clockAt.row < rowEls.length) {
        const line = get(clockAt.row);
        for (let i = 0; i < clock.length && clockAt.col + i < gx; i++) line[clockAt.col + i] = clock[i];
        rows.set(clockAt.row, line);
      }
      rowEls.forEach((el, r) => {
        const s = (rows.has(r) ? rows.get(r) : screenRow(r)).join('') + '\n';
        if (el.textContent !== s) el.textContent = s;
      });
    }
    requestAnimationFrame(tick);
  }
  init();
})();
