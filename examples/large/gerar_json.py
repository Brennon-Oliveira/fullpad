#!/usr/bin/env python3
"""Gera um .json grande (e válido) para ver o modo de arquivo grande do Fullpad (issue #19).

    python3 examples/large/gerar_json.py                   # ~100 MB em examples/large/grande.json
    python3 examples/large/gerar_json.py 200               # ~200 MB
    python3 examples/large/gerar_json.py 50 --minificado   # o arquivo inteiro numa linha só
    python3 examples/large/gerar_json.py 0.5 -o /tmp/pequeno.json

Em modo de arquivo grande o JSON abre **como texto** (sem a árvore): ela precisaria do documento inteiro na
memória. O destaque de sintaxe vale pelo trecho carregado. O que há nele:
- uma lista de objetos, um por linha, com acento, números, booleanos, listas e `null`;
- um campo com a palavra RARA a cada 250 mil objetos (a busca acha longe);
- no meio, um objeto com uma **string gigante** (até 3 MB numa linha só): vira segmentos marcados com ↳;
- com `--minificado`, o arquivo todo é UMA linha (o caso de um JSON de 200 MB sem quebras): são centenas de segmentos.
O arquivo é JSON válido do começo ao fim (`python3 -m json.tool` o lê sem erro).
"""
import json

from _comum import Saida, argumentos

NOMES = [json.dumps(n, ensure_ascii=False) for n in ["Ana Beatriz", "João Pedro", "Conceição", "André", "Luíza", "Mário", "Zoé"]]
CIDADES = [json.dumps(c, ensure_ascii=False) for c in ["São Paulo", "Belém", "Florianópolis", "Maceió", "Curitiba"]]


def objeto(i: int) -> str:
    obs = '"RARA: ocorrência única"' if i % 250_000 == 0 else ("null" if i % 3 else '"observação com ação e emoji 😀"')
    return (
        f'{{"id": {i}, "nome": {NOMES[i % 7]}, "cidade": {CIDADES[i % 5]}, "valor": {(i * 37 % 100_000) / 100}, '
        f'"ativo": {"true" if i % 2 else "false"}, "tags": ["a{i % 10}", "b{i % 7}"], "obs": {obs}}}'
    )


def extra(p) -> None:
    p.add_argument("--minificado", action="store_true", help="o arquivo inteiro numa linha só, sem quebras")


def main() -> None:
    a = argumentos(__doc__, "grande.json", extra=extra)
    sep = "," if a.minificado else ",\n"
    ini, fim = ("[", "]\n") if a.minificado else ("[\n", "\n]\n")
    with Saida(a.saida, a.mb) as s:
        s.escrever(ini)
        i, gigante_feita, primeiro = 0, False, True
        while not s.completo:
            blocos = []
            if s.metade and not gigante_feita:
                gigante_feita = True
                texto = ("gigante😀é " * (s.tamanho_gigante // 14 + 1))[: s.tamanho_gigante]
                blocos.append(f'{{"id": "gigante", "texto": "{texto}"}}')
            blocos.extend(objeto(j) for j in range(i, i + 2_000))
            i += 2_000
            s.escrever(("" if primeiro else sep) + sep.join(blocos))
            primeiro = False
        s.escrever(fim)


if __name__ == "__main__":
    main()
