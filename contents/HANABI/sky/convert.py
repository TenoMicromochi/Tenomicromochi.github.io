"""EXR / HDR の等角図法画像を、ブラウザが読める 8bit 画像に変換する。

    py sky/convert.py NightSkyHDRI009_2K.exr sky/nightsky.jpg

EXR は線形 HDR なので、素朴に 255 倍すると夜空はほぼ真っ黒に潰れる。
Reinhard で圧縮してから sRGB ガンマをかける。

出力は既定で長辺 2048px に落とす。このツールは内部解像度 1/3
（427x240 程度）で描いているので、それ以上細かくしても画面に出ない。
"""

import sys
import os

import numpy as np

os.environ.setdefault("OPENCV_IO_ENABLE_OPENEXR", "1")
import cv2  # noqa: E402


def convert(src, dst, max_w=2048, exposure=1.0):
    img = cv2.imread(src, cv2.IMREAD_UNCHANGED | cv2.IMREAD_ANYDEPTH | cv2.IMREAD_ANYCOLOR)
    if img is None:
        raise SystemExit(f"読めなかった: {src}")
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    img = img[:, :, :3].astype(np.float32)

    h, w = img.shape[:2]
    if w > max_w:
        img = cv2.resize(img, (max_w, max(1, round(h * max_w / w))), interpolation=cv2.INTER_AREA)

    x = np.clip(img * exposure, 0.0, None)
    x = x / (1.0 + x)                       # Reinhard
    x = np.power(x, 1.0 / 2.2)              # sRGB ガンマ
    out = np.clip(x * 255.0, 0, 255).astype(np.uint8)

    params = []
    if dst.lower().endswith((".jpg", ".jpeg")):
        params = [cv2.IMWRITE_JPEG_QUALITY, 88]
    elif dst.lower().endswith(".webp"):
        params = [cv2.IMWRITE_WEBP_QUALITY, 88]

    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    if not cv2.imwrite(dst, out, params):
        raise SystemExit(f"書けなかった: {dst}")
    print(f"{src} -> {dst}  {out.shape[1]}x{out.shape[0]}  "
          f"{os.path.getsize(dst) / 1024:.0f} KB")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    convert(sys.argv[1], sys.argv[2],
            max_w=int(sys.argv[3]) if len(sys.argv) > 3 else 2048)
