/* ============================================================
   FLAKALT — input.js
   マウスとキーボード。

   照準は Pointer Lock でマウスの移動量をそのまま角度に変える。
   画面端で止まらないので、砲を延々と旋回させられる。
   ロックが外れたら自動的にポーズ扱いにする（メニューへ戻す判断は game 側）。
   ============================================================ */

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

    addEventListener('keydown', (e) => {
      if (e.repeat) { return; }
      // ブラウザ既定の動作を潰しておきたいキー
      if (['Space', 'Tab', 'F1', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      this.keys.add(e.code);
      this.queue.push(e.code);
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
