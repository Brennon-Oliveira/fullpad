#!/usr/bin/env python3
"""Gera um .md (relatório longo) grande para ver o modo de arquivo grande do Fullpad (issue #19).

    python3 examples/large/gerar_md.py           # ~100 MB em examples/large/grande.md
    python3 examples/large/gerar_md.py 50        # ~50 MB
    python3 examples/large/gerar_md.py 0.5 -o /tmp/pequeno.md

Em modo de arquivo grande o Markdown abre **só como texto** (sem a visão renderizada nem o sumário): o
destaque de sintaxe vale pelo trecho carregado. O que há nele:
- capítulos com títulos, listas, tabela, bloco de código, equação e emoji, todos com acento;
- uma frase com a palavra RARA a cada 500 capítulos (a busca acha longe);
- no meio, um **parágrafo de uma linha só** (até 3 MB): vira segmentos marcados com ↳.
"""
from _comum import Saida, argumentos

TEMAS = ["Operações", "Logística", "Qualidade", "Atendimento", "Finanças", "Manutenção"]


def capitulo(n: int) -> str:
    tema = TEMAS[n % 6]
    rara = "\nEsta é a ocorrência RARA, uma só a cada quinhentos capítulos.\n" if n % 500 == 0 else ""
    return f"""# Capítulo {n}: {tema} em revisão

A equipe de {tema.lower()} concluiu a análise do período e registrou **{n % 97 + 3} ocorrências** relevantes,
todas com _plano de ação_ definido. O texto segue com acentuação completa: ação, conceição, órgão, coração. 😀
{rara}
## Resultados {n}.1

- primeiro item do capítulo {n}, com `código em linha`
- segundo item, com [um link](https://example.com/{n})
- terceiro item com equação $a^2 + b^2 = c^2$

| Indicador | Valor | Meta |
|---|---:|---:|
| Prazo médio | {n % 40 + 1} dias | 30 |
| Satisfação | {(n * 7) % 100} % | 90 |

## Código {n}.2

```python
def processa(n: int) -> int:
    return n * 2  # capítulo {n}
```

$$\\sum_{{i=1}}^{{{n % 9 + 2}}} i = \\frac{{n(n+1)}}{{2}}$$

"""


def main() -> None:
    a = argumentos(__doc__, "grande.md")
    with Saida(a.saida, a.mb) as s:
        n, gigante_feita = 0, False
        while not s.completo:
            if s.metade and not gigante_feita:
                gigante_feita = True
                s.escrever("Este parágrafo é uma única linha enorme: " + ("texto corrido sem quebra, com acento e emoji 😀 " * (s.tamanho_gigante // 50 + 1))[: s.tamanho_gigante] + "\n\n")
            s.escrever("".join(capitulo(k) for k in range(n, n + 40)))
            n += 40


if __name__ == "__main__":
    main()
