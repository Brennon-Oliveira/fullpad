#!/usr/bin/env python3
"""Gera um .txt (log) grande para ver o modo de arquivo grande do Fullpad (issue #19).

    python3 examples/large/gerar_txt.py          # ~100 MB em examples/large/grande.txt
    python3 examples/large/gerar_txt.py 300      # ~300 MB
    python3 examples/large/gerar_txt.py 0.5 -o /tmp/pequeno.txt

O que há nele, para o app mostrar:
- linhas de log comuns, com acento ("requisição", "concluída") e níveis variados;
- uma linha com a palavra RARA a cada 250 mil linhas (a busca acha longe);
- no meio, uma **linha gigante** (até 3 MB, sem quebra, com acento e emoji): vira segmentos marcados com ↳;
- logo depois, 30 linhas em CRLF dentro de um arquivo em LF (as quebras de cada lote são preservadas ao salvar);
- uma linha com bytes que parecem texto mas têm caracteres fora do ASCII em posições variadas (ção, 😀).
"""
from _comum import Saida, argumentos

NIVEIS = ["INFO", "INFO", "INFO", "DEBUG", "WARN", "INFO", "ERRO"]
ACOES = ["requisição", "sincronização", "autenticação", "conversão", "transmissão"]


def linha(i: int) -> str:
    marca = " RARA" if i % 250_000 == 0 else ""
    return f"2026-11-16 12:{(i // 60) % 60:02d}:{i % 60:02d} [{NIVEIS[i % 7]}] {ACOES[i % 5]} {i} concluída com sucesso{marca}\n"


def main() -> None:
    a = argumentos(__doc__, "grande.txt")
    with Saida(a.saida, a.mb) as s:
        i, gigante_feita = 0, False
        while not s.completo:
            if s.metade and not gigante_feita:
                gigante_feita = True
                s.escrever(("gigante😀é " * (s.tamanho_gigante // 14 + 1))[: s.tamanho_gigante] + "\n")
                for k in range(30):  # um trecho em CRLF no meio de um arquivo em LF
                    s.escrever(f"trecho em CRLF {k} com acentuação\r\n")
            s.escrever("".join(linha(j) for j in range(i, i + 2_000)))
            i += 2_000


if __name__ == "__main__":
    main()
