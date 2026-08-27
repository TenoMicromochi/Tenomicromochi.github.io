/* ============================================================
   camera.js — 位置と向きが 2 変数だけで決まるカメラ

   発射地点は原点に固定。カメラはそこから水平に D 離れた目線の高さに立ち、
   常に「発射地点の真上 H」＝ 開花点を向く。周回はしない。

     カメラ位置  (0, 1.6, D)
     注視点      (0, H, 0)
     仰角        θ = atan((H - 1.6) / D)

   目線の高さを 1.6m に固定するのは、自由にすると簡単に「花火と同じ高さ」に
   なってしまい、そうなるとどれだけ物理が正しくても宇宙空間の粒子デモに
   見えるため。この 1 点だけは動かさない。

   ---- D は「立体感スライダー」でもある ----
   立体感を決めるのは水平距離ではなく斜距離 √(D² + H²) と炸裂半径 R の比。
   D を 0 に近づけても斜距離は H で下げ止まるので、真下から見上げても
   花火は一定以上は大きくならない（H=330, R=160 なら D/R = 2.05 が下限）。
   真下に立っても高度ぶんの距離は残るので、これは物理的に正しい。

   D を対数で動かすのはそのため。効くのは絶対距離ではなく比なので、
   加算より乗算のほうが手の感覚と合う。

   ---- 地平線が入る条件 ----
   θ < FOV/2 のときだけ地平線が画角に入る。FOV 50 度なら D > 2.14 × H で、
   H=330 なら 704m から。樹立が見えるのはそれより引いたときだけ。
   ============================================================ */

export const EYE_Y = 1.6;

/* 環をカメラ正面へ寄せるための基準方位。カメラは +Z 側に固定なので、
   環の法線を +Z に向ければ観客側へ開く。実物の型物もそう仕込まれていて、
   真横を向いた環はただの光の棒になってしまう */
export const CAM_AZ = 0;

export class OrbitCamera {
  constructor(params) {
    this.p = params;              // dist と altitude はここを唯一の出所にする
    this._dist = params.dist;     // 表示用に滑らかに追従させる値
    this.dragging = false;
    this.minDist = 20;
    this.maxDist = 3000;
    this.onChange = null;         // ドラッグでスライダーを追従させる
  }

  /* 横ドラッグは何もしない（周回を持たない設計）。
     縦ドラッグとホイールが D を動かす。どちらも乗算 */
  attach(el, onChange) {
    this.onChange = onChange;
    let py = 0;

    const setDist = (v) => {
      const d = Math.min(this.maxDist, Math.max(this.minDist, v));
      if (d === this.p.dist) return;
      this.p.dist = d;
      this.onChange?.();
    };

    const down = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      this.dragging = true;
      py = e.clientY;
      el.setPointerCapture?.(e.pointerId);
    };
    const move = (e) => {
      if (!this.dragging) return;
      const dy = e.clientY - py;
      py = e.clientY;
      setDist(this.p.dist * Math.exp(dy * 0.004));
    };
    const up = (e) => {
      this.dragging = false;
      el.releasePointerCapture?.(e.pointerId);
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      setDist(this.p.dist * Math.exp(e.deltaY * 0.0012));
    }, { passive: false });
  }

  /* 表示上の距離だけ滑らかに追従させる。ドラッグのガタつきが
     そのまま星の軌跡に出ると、尾が階段状になる */
  step() {
    this._dist += (this.p.dist - this._dist) * 0.18;
  }

  eye() { return [0, EYE_Y, this._dist]; }

  /* 常に開花点そのものを向く */
  target(altitude) { return [0, altitude, 0]; }

  /* 斜距離。D/R の分子になるのはこちらで、水平距離ではない */
  slant(altitude) {
    return Math.hypot(this._dist, altitude - EYE_Y);
  }

  /* 仰角 θ。上のコメントの式そのもの */
  lookUpDeg(altitude) {
    return Math.atan2(altitude - EYE_Y, this._dist) * 180 / Math.PI;
  }
}
