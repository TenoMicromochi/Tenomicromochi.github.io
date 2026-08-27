# 空のテクスチャ（任意）

このフォルダに等角図法（equirectangular）の画像を置くと、
パネルの SKY で `HDRI` モードが選べるようになる。
無ければ手続きの星空（`STARS`）で動くので、置かなくても支障はない。

読みに行く名前は、この順で最初に見つかったもの：

```
sky/nightsky.webp
sky/nightsky.jpg
sky/nightsky.png
```

---

## ambientCG から持ってくる

<https://ambientcg.com/> の Night Sky HDRI シリーズは **CC0**
（表示義務なし・商用可）なので、そのまま使える。

ただし配布形式は zip の中の **EXR / HDR で、ブラウザはどちらも読めない**。
JPG か WebP に変換する必要がある。

| ambientCG の配布 | |
|---|---|
| 1K | 4 MB |
| 2K | 11 MB |
| 4K | 36 MB |
| 8K 以上 | 132 MB〜 |

**2K で十分。** 内部解像度 1/3 で描いている（427x240 程度）ので、
それ以上に細かくしても画面に出ない。

### 変換

このマシンでは `python` が Microsoft Store のスタブに当たるので `py` を使う。

```bash
py -m pip install opencv-python numpy
```

```bash
py sky/convert.py path/to/NightSkyHDRI009_2K.exr sky/nightsky.jpg
```

EXR は線形 HDR なので、8bit に落とすときにトーンマップとガンマをかける。
`convert.py` がそれをやる。

### HDR を捨てていいのか

いい。HDR のレンジが要るのは花火側で、そちらは今も RGBA16F の加算バッファで
持っている。夜空はもともと暗くてレンジが狭いので、8bit sRGB で足りる。

---

## 明るさに注意

`SKY LEVEL` を上げると**黒レベルが上がる**。
ACES トーンマップの足元が持ち上がるので、柳の暗い尾やクラックルの残光が
空に沈む。既定値を控えめ（0.5）にしてあるのはそのため。

README 本体の「空を足すと何が犠牲になるか」に実測を載せてある。
