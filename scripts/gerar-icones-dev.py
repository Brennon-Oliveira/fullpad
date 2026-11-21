#!/usr/bin/env python3
"""Gera os ícones VERMELHOS do build de desenvolvimento (`crates/app/icons-dev/`) a partir dos ícones do app.

O azul vira vermelho (giro de matiz); o branco e o cinza do documento ficam como estão. Rode de novo se o ícone
do app mudar. Precisa de Pillow e numpy. Ver docs/rules/build-dev.md.
"""
import colorsys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "crates/app/icons"
OUT = ROOT / "crates/app/icons-dev"


def redden(img: Image.Image) -> Image.Image:
    a = np.asarray(img.convert("RGBA")).astype(np.float32) / 255
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    out = a.copy()
    blue = sat > 0.25  # só o que é colorido (o fundo azul); o papel branco e o "I" escuro ficam
    h_new = 0.0  # vermelho
    for y, x in zip(*np.nonzero(blue & (al > 0))):
        _, s, v = colorsys.rgb_to_hsv(r[y, x], g[y, x], b[y, x])
        out[y, x, :3] = colorsys.hsv_to_rgb(h_new, min(1.0, s * 1.05), v)
    return Image.fromarray((out * 255).astype(np.uint8), "RGBA")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for name in ("32x32.png", "128x128.png", "icon.png"):
        redden(Image.open(SRC / name)).save(OUT / name)
    big = redden(Image.open(SRC / "icon.png"))
    big.save(OUT / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("ok:", sorted(p.name for p in OUT.iterdir()))


if __name__ == "__main__":
    main()
