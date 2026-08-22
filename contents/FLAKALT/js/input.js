/* ============================================================
   FLAKALT — input.js
   マウスとキーボード。

   照準は Pointer Lock でマウスの移動量をそのまま角度に変える。
   画面端で止まらないので、砲を延々と旋回させられる。
   ロックが外れたら自動的にポーズ扱いにする（メニューへ戻す判断は game 側）。
   ============================================================ */

/* 隠しコマンド。ゲーム側の状態を見ないので、タイトルでもプレイ中でも入る。

   出だしの ↑↑↓↓ が共通なので、片方だけを見ていると取り違える。
   直近の入力を丸ごと持って、両方に突き合わせる。 */
const CHEATS = {
  // コナミコマンド → INVINCIBLE MODE
  invincible: [
    'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
    'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA',
  ],
  // ゼビウスコマンド → TRIGGER HAPPY MODE。L R はそのまま L キーと R キー
  triggerHappy: [
    'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
    'KeyL', 'KeyR', 'KeyL', 'KeyR', 'KeyB', 'KeyA',
  ],
};
const CHEAT_LEN = Math.max(...Object.values(CHEATS).map((s) => s.length));

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.queue = [];        // 押した瞬間だけ拾いたいもの
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.fire = false;
    this.zoom = false;
    this.locked = false;
    this.clicked = false;
    this.cheatBuf = [];     // 隠しコマンド照合用の直近入力
    this.cheat = null;      // 成立したコマンド名。takeCheat() で 1 回だけ受け取る

    addEventListener('keydown', (e) => {
      if (e.repeat) { return; }
      // ブラウザ既定の動作を潰しておきたいキー
      if (['Space', 'Tab', 'F1', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      this.keys.add(e.code);
      this.queue.push(e.code);
      this.trackCheat(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.fire = false; });

    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.button === 0) { this.fire = true; this.clicked = true; }
      if (e.button === 2) this.zoom = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.zoom = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });

    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX || 0;
      this.dy += e.movementY || 0;
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      canvas.classList.toggle('locked', this.locked);
      if (!this.locked) this.fire = false;
    });
  }

  lock() {
    if (!this.locked && this.canvas.requestPointerLock) {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  /* 直近 10 打を保持して丸ごと突き合わせる。

     「一致した数を数えて、外れたら 0 に戻す」で書くと ↑↑↑↓↓… のように
     先頭を余分に押した入力を取りこぼす。3 打目の ↑ で不一致になった時点で、
     直前の 2 打が正しい出だしになっていることを見落とすため。 */
  trackCheat(code) {
    this.cheatBuf.push(code);
    if (this.cheatBuf.length > CHEAT_LEN) this.cheatBuf.shift();
    for (const [name, seq] of Object.entries(CHEATS)) {
      if (this.cheatBuf.length < seq.length) continue;
      const tail = this.cheatBuf.slice(this.cheatBuf.length - seq.length);
      if (seq.every((k, i) => k === tail[i])) {
        this.cheatBuf.length = 0;
        this.cheat = name;
        return;
      }
    }
  }

  takeCheat() {
    const c = this.cheat;
    this.cheat = null;
    return c;
  }

  down(code) { return this.keys.has(code); }

  /* 押した瞬間だけ true。1 フレームに 1 回だけ消費する。 */
  pressed(code) {
    const i = this.queue.indexOf(code);
    if (i < 0) return false;
    this.queue.splice(i, 1);
    return true;
  }

  anyPressed() { return this.queue.length > 0; }

  takeMouse() {
    const d = { x: this.dx, y: this.dy };
    this.dx = 0; this.dy = 0;
    return d;
  }

  takeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  takeClick() {
    const c = this.clicked;
    this.clicked = false;
    return c;
  }

  endFrame() {
    this.queue.length = 0;
  }
}
