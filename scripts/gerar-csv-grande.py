#!/usr/bin/env python3
"""Gera um CSV grande para testar a tabela do Fullpad.

Uso: scripts/gerar-csv-grande.py SAIDA [MB] [--sep ,|;|tab] [--crlf]

Tem número, data, texto com acento, campos entre aspas (com vírgula, aspas e quebra de linha dentro),
células vazias e uma linha de vez em quando mais curta. Os valores são determinísticos (mesma saída
sempre). O teto da tabela é 50 milhões de caracteres: 40 MB liga a tabela, 60 MB passa do limite.
"""
import random
import sys

args = [a for a in sys.argv[1:] if not a.startswith("--")]
if not args:
    sys.exit(__doc__)
out = args[0]
mb = float(args[1]) if len(args) > 1 else 40
sep = "\t" if "--sep" in sys.argv and sys.argv[sys.argv.index("--sep") + 1] == "tab" else (
    sys.argv[sys.argv.index("--sep") + 1] if "--sep" in sys.argv else ",")
eol = "\r\n" if "--crlf" in sys.argv else "\n"
rnd = random.Random(42)
nomes = ["Ana", "Bruno", "Cláudia", "Dênis", "Érica", "Fábio", "Glória", "Hélio", "Íris", "João", "Luíza", "Márcio"]
cats = ["alimentação", "transporte", "saúde", "lazer", "educação", "moradia", "serviços", "outros"]
obs = ["", "", "", "pago à vista", "parcelado, 3x", 'disse: "ok"', "linha 1\nlinha 2", "ação ✓", "😀 feliz", "texto bem longo " * 8]


def campo(v):
    v = str(v)
    if any(c in v for c in (sep, '"', "\n", "\r")):
        return '"' + v.replace('"', '""') + '"'
    return v


alvo = int(mb * 1024 * 1024)
escrito = 0
with open(out, "w", encoding="utf-8", newline="") as f:
    cab = eol.join([sep.join(["id", "nome", "data", "valor", "categoria", "qtd", "observação"])]) + eol
    f.write(cab)
    escrito += len(cab.encode())
    i = 0
    while escrito < alvo:
        i += 1
        linha = [
            i,
            rnd.choice(nomes),
            f"20{rnd.randint(18, 26):02d}-{rnd.randint(1, 12):02d}-{rnd.randint(1, 28):02d}",
            f"{rnd.uniform(-500, 20000):.2f}",
            rnd.choice(cats),
            rnd.randint(0, 99) if rnd.random() > 0.05 else "",
            rnd.choice(obs),
        ]
        if i % 997 == 0:
            linha = linha[:3]  # linha mais curta
        texto = sep.join(campo(c) for c in linha) + eol
        f.write(texto)
        escrito += len(texto.encode())
print(f"{out}: {i} linhas, {escrito / 1024 / 1024:.1f} MB")
