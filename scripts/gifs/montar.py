#!/usr/bin/env python3
"""montar.py <pasta-dos-quadros> <saida.gif> [largura=1000] [cores=96] [velocidade=1]: monta o GIF (quadros fNNNN.jpg e
tempos.txt do gravar.ps1), juntando os quadros iguais para o arquivo ficar pequeno."""
import sys, glob, os
import numpy as np
from PIL import Image, ImageChops
pasta, saida = sys.argv[1], sys.argv[2]
larg = int(sys.argv[3]) if len(sys.argv) > 3 else 1000
cores = int(sys.argv[4]) if len(sys.argv) > 4 else 96
vel = float(sys.argv[5]) if len(sys.argv) > 5 else 1.0
fs = sorted(glob.glob(f"{pasta}/f*.jpg"))
tempos = [int(x) for x in open(f"{pasta}/tempos.txt").read().split()]
quadros, durs = [], []
def popup_de_voz(im):
    """O ditado por voz do Windows (um quadrado escuro com um microfone branco, no topo e no meio da
    tela) aparece por cima da janela quando a pessoa dita algo durante a gravação: o quadro é
    descartado. A assinatura é exata (mesmo tamanho e lugar a cada vez), para não pegar a página
    branca de um PDF nem a caixa da paleta, que também são claras no topo."""
    reg = im.convert("L").crop((1100, 40, 1500, 260))
    if reg.size != (400, 220):
        return False
    mascara = reg.point(lambda p: 255 if p > 235 else 0)
    brancos = mascara.histogram()[255]
    if not 2800 <= brancos <= 3800:
        return False
    caixa = mascara.getbbox()  # o microfone ocupa ~ (59, 4)-(281, 150) neste recorte
    return bool(caixa) and all(abs(a - b) <= 8 for a, b in zip(caixa, (59, 4, 281, 150)))


def tooltip_de_caminho(im):
    """O tooltip de uma aba mostra o CAMINHO COMPLETO do arquivo (com o nome de usuário da máquina de
    quem grava): uma caixa de borda clara logo abaixo da barra de abas. O quadro é descartado."""
    faixa = np.asarray(im.convert("L"))[112:160, :] > 175
    for linha in faixa:
        d = np.diff(np.concatenate(([0], linha.astype(np.int8), [0])))
        ini, fim = np.where(d == 1)[0], np.where(d == -1)[0]
        if len(ini) and (fim - ini).max() >= 420:
            return True
    return False


descartados = 0
for i, f in enumerate(fs):
    im = Image.open(f).convert("RGB")
    if popup_de_voz(im) or tooltip_de_caminho(im):
        descartados += 1
        continue
    h = round(im.height * larg / im.width)
    im = im.resize((larg, h), Image.LANCZOS)
    dur = (tempos[i + 1] - tempos[i]) if i + 1 < len(tempos) else 900
    dur = max(60, min(dur, 1500)) / vel
    if quadros and ImageChops.difference(quadros[-1], im).getbbox() is None:
        durs[-1] += dur
        continue
    quadros.append(im); durs.append(dur)
durs[-1] += 700  # respiro no fim, antes de repetir
pal = [q.quantize(colors=cores, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for q in quadros]
pal[0].save(saida, save_all=True, append_images=pal[1:], duration=durs, loop=0, optimize=True, disposal=1)
print(saida, len(fs), f"({descartados} descartados)" if descartados else "", "->", len(quadros), "quadros,", os.path.getsize(saida) // 1024, "KB,", sum(durs) / 1000, "s")
