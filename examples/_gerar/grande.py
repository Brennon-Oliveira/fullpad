#!/usr/bin/env python3
"""Gera `examples/grande.log` (~300 MB), um arquivo grande para ver o modo de lotes do Fullpad (issue #19).

O arquivo NÃO vai para o git (`.gitignore`): rode este script quando quiser testar.

    python3 examples/_gerar/grande.py            # 4 milhões de linhas
    python3 examples/_gerar/grande.py 1000000    # menos linhas

O que há nele, para o app mostrar:
- linhas de log comuns (a maioria), com acento ("requisição", "concluída");
- uma **linha gigante** no meio (3,6 MB sem quebra, com acento e emoji): vira segmentos virtuais marcados com ↳;
- um trecho em CRLF no meio de um arquivo em LF (as quebras de cada lote são preservadas ao salvar);
- uma linha com a palavra RARA a cada 500 mil, para a busca achar longe.
"""
import pathlib
import sys

linhas = int(sys.argv[1]) if len(sys.argv) > 1 else 4_000_000
destino = pathlib.Path(__file__).resolve().parent.parent / "grande.log"
meio = linhas // 2

with destino.open("w", encoding="utf-8", newline="") as f:
    for i in range(linhas):
        if i == meio:
            f.write("gigante😀é" * 300_000 + "\n")
        eol = "\r\n" if meio + 10 <= i < meio + 40 else "\n"
        marca = " RARA" if i % 500_000 == 0 else ""
        f.write(f"2026-11-16 12:00:{i % 60:02d} [INFO] requisição {i} concluída com sucesso{marca}{eol}")

print(f"{destino} ({destino.stat().st_size / 1_000_000:.0f} MB, {linhas} linhas)")
