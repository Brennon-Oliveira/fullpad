#!/usr/bin/env python3
"""Gera um .csv grande para ver o modo de arquivo grande do Fullpad (issue #19).

    python3 examples/large/gerar_csv.py          # ~100 MB em examples/large/grande.csv
    python3 examples/large/gerar_csv.py 200      # ~200 MB
    python3 examples/large/gerar_csv.py 0.5 -o /tmp/pequeno.csv

Em modo de arquivo grande o CSV abre **como texto** (sem a tabela, a ordenação nem o filtro): é um arquivo
com milhões de linhas, e a tabela precisaria indexá-lo inteiro na memória. O que há nele, para testar:
- cabeçalho `id,nome,cidade,valor,data,observacao` e uma linha por registro, com acento;
- células entre aspas com vírgula e aspas escapadas (`""`), a cada 53 linhas;
- células entre aspas com **quebra de linha dentro**, a cada 997 linhas (a linha "do arquivo" continua sendo uma por `\\n`);
- uma célula com a palavra RARA a cada 250 mil linhas (a busca acha longe);
- no meio, uma **célula gigante** (até 3 MB numa linha só): vira segmentos marcados com ↳.
O arquivo é CSV válido do começo ao fim (`python3 -m csv` o lê sem erro).
"""
from _comum import Saida, argumentos

NOMES = ["Ana Beatriz", "João Pedro", "Conceição", "André", "Luíza", "Mário", "Zoé", "Sebastião", "Letícia", "Têmis"]
CIDADES = ["São Paulo", "Belém", "Florianópolis", "Maceió", "Curitiba", "Goiânia", "Fortaleza", "Cuiabá"]


def linha(i: int) -> str:
    if i % 250_000 == 0:
        obs = '"RARA: ocorrência única, com vírgula"'
    elif i % 997 == 0:
        obs = '"primeira linha da célula\nsegunda linha, com vírgula e ""aspas"""'
    elif i % 53 == 0:
        obs = '"com vírgula, ""aspas"" e acento: ação"'
    else:
        obs = ""
    valor = (i * 37 % 100_000) / 100
    return f"{i},{NOMES[i % 10]},{CIDADES[i % 8]},{valor:.2f},2026-{1 + i % 12:02d}-{1 + i % 28:02d},{obs}\n"


def main() -> None:
    a = argumentos(__doc__, "grande.csv")
    with Saida(a.saida, a.mb) as s:
        s.escrever("id,nome,cidade,valor,data,observacao\n")
        i, gigante_feita = 0, False
        while not s.completo:
            if s.metade and not gigante_feita:
                gigante_feita = True
                celula = ("célula enorme 😀 " * (s.tamanho_gigante // 18 + 1))[: s.tamanho_gigante]
                s.escrever(f'{i},Gigante,Cidade,0.00,2026-01-01,"{celula}"\n')
                i += 1
            s.escrever("".join(linha(j) for j in range(i, i + 2_000)))
            i += 2_000


if __name__ == "__main__":
    main()
