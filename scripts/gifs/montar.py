#!/usr/bin/env python3
"""montar.py <pasta-dos-quadros> <saida.gif> [largura=1000] [cores=96]: monta o GIF (quadros fNNNN.jpg e
tempos.txt do gravar.ps1), juntando os quadros iguais para o arquivo ficar pequeno."""
import sys, glob, os
from PIL import Image, ImageChops
pasta, saida = sys.argv[1], sys.argv[2]
larg = int(sys.argv[3]) if len(sys.argv) > 3 else 1000
cores = int(sys.argv[4]) if len(sys.argv) > 4 else 96
fs = sorted(glob.glob(f"{pasta}/f*.jpg"))
tempos = [int(x) for x in open(f"{pasta}/tempos.txt").read().split()]
quadros, durs = [], []
for i, f in enumerate(fs):
    im = Image.open(f).convert("RGB")
    h = round(im.height * larg / im.width)
    im = im.resize((larg, h), Image.LANCZOS)
    dur = (tempos[i + 1] - tempos[i]) if i + 1 < len(tempos) else 900
    dur = max(60, min(dur, 1500))
    if quadros and ImageChops.difference(quadros[-1], im).getbbox() is None:
        durs[-1] += dur
        continue
    quadros.append(im); durs.append(dur)
durs[-1] += 700  # respiro no fim, antes de repetir
pal = [q.quantize(colors=cores, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for q in quadros]
pal[0].save(saida, save_all=True, append_images=pal[1:], duration=durs, loop=0, optimize=True, disposal=1)
print(saida, len(fs), "->", len(quadros), "quadros,", os.path.getsize(saida) // 1024, "KB,", sum(durs) / 1000, "s")
