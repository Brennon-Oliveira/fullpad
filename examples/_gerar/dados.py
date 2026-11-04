"""Gera example.json, example.csv e example.tsv. Uso: python3 dados.py (a partir de qualquer pasta)."""
import json, random, csv, io
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent
rnd = random.Random(2026)

# ---------- JSON ----------
SVG = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCI+PGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMzAiIGZpbGw9IiNlNjc2MjIiLz48L3N2Zz4="
clientes = [
    ("Ana Beatriz Souza", "ana.souza@example.com", "São Paulo", "SP"),
    ("João Pedro Álvares", "joao.alvares@example.com", "Belo Horizonte", "MG"),
    ("Mariana Çavuşoğlu", "mariana.c@example.com", "Curitiba", "PR"),
    ("Luiz Fernando Ñandú", "luiz.nandu@example.com", "Porto Alegre", "RS"),
    ("Júlia 🌻 Campos", "julia.campos@example.com", "Recife", "PE"),
    ("Carlos Eduardo Lima", "carlos.lima@example.com", "Salvador", "BA"),
]
produtos = [
    ("FP-001", "Caderno pautado 96 folhas", 24.9, "papelaria", "#e67e22"),
    ("FP-002", "Caneta gel 0,5 mm (caixa com 12)", 39.0, "papelaria", "rgb(41, 128, 185)"),
    ("FP-003", "Mochila urbana impermeável", 219.9, "acessorios", "hsl(145, 63%, 42%)"),
    ("FP-004", "Luminária de mesa LED", 129.5, "casa", "#8e44ad"),
    ("FP-005", "Garrafa térmica 750 ml", 89.9, "casa", "#c0392b"),
    ("FP-006", "Fone de ouvido sem fio", 349.0, "eletronicos", "rgb(44, 62, 80)"),
    ("FP-007", "Teclado mecânico compacto", 459.9, "eletronicos", "hsl(48, 96%, 53%)"),
    ("FP-008", "Suporte ajustável para notebook", 159.0, "acessorios", "#16a085"),
]
pedidos = []
for i in range(1, 15):
    c = rnd.randrange(len(clientes))
    itens = []
    for _ in range(rnd.randint(1, 3)):
        p = rnd.choice(produtos)
        q = rnd.randint(1, 4)
        itens.append({"sku": p[0], "quantidade": q, "precoUnitario": p[2], "desconto": rnd.choice([0, 0, 0.05, 0.1, None])})
    total = round(sum(x["quantidade"] * x["precoUnitario"] * (1 - (x["desconto"] or 0)) for x in itens), 2)
    pedidos.append({
        "numero": 10000 + i,
        "cliente": c,
        "realizadoEm": f"2026-{rnd.randint(1,10):02d}-{rnd.randint(1,28):02d}T{rnd.randint(8,22):02d}:{rnd.randint(0,59):02d}:00-03:00",
        "status": rnd.choice(["pago", "enviado", "entregue", "aguardando_pagamento", "cancelado"]),
        "itens": itens,
        "total": total,
        "rastreio": None if rnd.random() < .3 else f"BR{rnd.randint(10**8, 10**9-1)}XY",
    })

doc = {
    "$schema": "https://example.com/schemas/loja-v3.json",
    "loja": {
        "nome": "Papelaria & Cia — Edição Especial",
        "fundadaEm": 1987,
        "ativa": True,
        "site": "https://www.example.com/loja",
        "contato": {"email": "contato@example.com", "telefone": "+55 (11) 4002-8922", "redes": {"instagram": "https://instagram.com/example", "x": "https://x.com/example"}},
        "logo": SVG,
        "corPrincipal": "#e67e22",
        "coresDoTema": {"fundo": "hsl(30, 100%, 97%)", "texto": "rgb(34, 40, 49)", "destaque": "#e67e22", "alerta": "rgb(192 57 43)"},
        "endereco": {"rua": "Rua das Acácias", "numero": 1200, "complemento": None, "cidade": "São Paulo", "uf": "SP", "cep": "01310-100",
                      "geo": {"type": "Point", "coordinates": [-46.6333, -23.5505]}},
    },
    "configuracoes": {
        "moeda": "BRL", "casasDecimais": 2, "impostos": {"icms": 0.18, "ipi": 0.0, "pis": 0.0165, "cofins": 0.076},
        "frete": {"gratisAcimaDe": 250.0, "regioes": {"sudeste": {"prazoDias": [2, 4], "valor": 14.9}, "sul": {"prazoDias": [3, 6], "valor": 19.9}, "nordeste": {"prazoDias": [5, 9], "valor": 29.9}}},
        "funcionalidades": {"avaliacoes": True, "listaDeDesejos": True, "cupons": {"ativo": True, "maximoPorPedido": 2, "regras": [{"codigo": "BEMVINDO10", "percentual": 10, "primeiraCompra": True}, {"codigo": "FRETEGRATIS", "percentual": 0, "freteGratis": True, "expiraEm": "2026-12-31"}]}},
        "textos": {"boasVindas": "Olá! 👋 Bem-vindo à nossa loja.", "rodape": "© 2026 Papelaria & Cia.\nTodos os direitos reservados.", "caminhoWindows": "C:\\Users\\loja\\Documentos", "aspas": "Ele disse: \"nada se perde\"", "unicode": "@@UNI@@"},
    },
    "clientes": [{"id": i, "nome": n, "email": e, "endereco": {"cidade": cid, "uf": uf}, "vip": i % 2 == 0, "pontos": rnd.randint(0, 5000), "preferencias": {"newsletter": rnd.random() > .4, "categorias": rnd.sample(["papelaria", "casa", "eletronicos", "acessorios"], 2)}} for i, (n, e, cid, uf) in enumerate(clientes)],
    "produtos": [{"sku": s, "nome": n, "preco": p, "categoria": cat, "cor": cor, "estoque": rnd.randint(0, 300), "foto": f"https://picsum.photos/seed/{s}/400/300.jpg", "dimensoesCm": {"largura": round(rnd.uniform(5, 40), 1), "altura": round(rnd.uniform(5, 40), 1), "profundidade": round(rnd.uniform(1, 25), 1)}, "avaliacoes": [{"nota": rnd.randint(3, 5), "comentario": rnd.choice(["Ótimo!", "Chegou rápido, recomendo.", "Qualidade excelente 😍", "Poderia ser mais barato.", None])} for _ in range(rnd.randint(0, 3))]} for s, n, p, cat, cor in produtos],
    "pedidos": pedidos,
    "matrizes": {"identidade3x3": [[1, 0, 0], [0, 1, 0], [0, 0, 1]], "misturado": [1, "dois", 3.0, True, None, [5, [6, [7, [8, [9]]]]], {"dez": 10}], "vazios": {"objeto": {}, "lista": [], "texto": ""}},
    "numeros": {"inteiroGigante": "@@BIG@@", "decimalPreciso": "@@DEC@@", "estourado": "@@E400@@", "negativo": -273.15, "cientifica": 6.022e23, "zeroNegativo": -0.0, "float": 3.141592653589793},
    "@@DUP1@@": 1, "@@DUP2@@": 2,
    "metadados": {"geradoPor": "examples/_gerar/dados.py", "linhasDeExemplo": True, "observacao": "Passe o mouse sobre URLs, imagens e cores na árvore."},
}
txt = json.dumps(doc, indent=2, ensure_ascii=False)
txt = (txt.replace('"@@BIG@@"', "12345678901234567890123456789")
          .replace('"@@DEC@@"', "1.10000000000000000000001")
          .replace('"@@E400@@"', "1e400")
          .replace('"@@UNI@@"', '"\\u00e7\\u00e3o \\u2014 \\u20ac \\ud83d\\ude80"')
          .replace('"@@DUP1@@": 1,', '"chaveRepetida": 1,').replace('"@@DUP2@@": 2,', '"chaveRepetida": 2,'))
(OUT / "example.json").write_text(txt + "\n", encoding="utf-8")

# ---------- CSV ----------
cats = ["Papelaria", "Casa", "Eletrônicos", "Acessórios", "Livros", "Brinquedos"]
nomes = ["Ana Souza", "João Álvares", "Mariana Costa", "Luiz Ñandú", "Júlia Campos", "Carlos Lima", "Fernanda Rocha", "Ricardo Gomes", "Beatriz Dias", "Tiago Müller"]
obs_pool = ["", "", "", "Cliente pediu embalagem de presente", "Entrega no período da manhã, ligar antes", 'Disse: "urgente, por favor"', "Endereço alternativo: Rua A, 10 — fundos", "Troca solicitada;\nproduto com defeito na caixa", "Cupom BEMVINDO10 aplicado", "Pagamento dividido em 3x sem juros, parcelas de R$ 49,97 cada, com vencimento todo dia 10 — verificar com o financeiro antes de liberar o envio"]
rows = []
for i in range(1, 181):
    d = f"{rnd.randint(1,28):02d}/{rnd.randint(1,10):02d}/2026"
    cat = rnd.choice(cats)
    q = rnd.randint(1, 12)
    pu = round(rnd.uniform(9, 480), 2)
    desc = rnd.choice([0, 0, 0, 5, 10, 15])
    total = round(q * pu * (1 - desc / 100), 2)
    pago = rnd.choice(["sim", "sim", "sim", "não"])
    nota = "" if rnd.random() < .25 else str(rnd.randint(1, 5))
    rows.append([i, d, rnd.choice(nomes), cat, f"{cat[:3].upper()}-{rnd.randint(100,999)}", q, pu, desc, total, pago, nota, rnd.choice(obs_pool)])
rows.append([181, "31/10/2026", "Teste, com vírgula", "Livros", "LIV-000", 1, 0.0, 0, 0.0, "não", "", 'Linha final com "aspas" e, vírgula'])
buf = io.StringIO()
w = csv.writer(buf, lineterminator="\n")
w.writerow(["id", "data", "cliente", "categoria", "sku", "quantidade", "preco_unitario", "desconto_pct", "total", "pago", "nota", "observacao"])
w.writerows(rows)
(OUT / "example.csv").write_text(buf.getvalue(), encoding="utf-8")

# ---------- TSV (decimal com vírgula) ----------
itens = ["Parafuso sextavado M8", "Porca autotravante M8", "Arruela lisa 8 mm", "Chave Allen 5 mm", "Fita veda-rosca 18 mm", "Broca para concreto 8 mm", "Bucha nylon S8", "Cola de contato 200 g", "Lixa d'água 220", "Luva de segurança"]
locais = ["A-01", "A-02", "B-07", "B-12", "C-03", "D-15"]
t = ["código\tdescrição\tunidade\testoque\tmínimo\tpreço\tlocal\tsituação"]
for i in range(1, 61):
    est = rnd.randint(0, 500); mn = rnd.choice([20, 50, 100])
    sit = "REPOR" if est < mn else "ok"
    pr = f"{rnd.uniform(0.3, 85):.2f}".replace(".", ",")
    t.append(f"INV-{i:04d}\t{rnd.choice(itens)} #{i}\t{rnd.choice(['un', 'cx', 'pç', 'kg'])}\t{est}\t{mn}\t{pr}\t{rnd.choice(locais)}\t{sit}")
(OUT / "example.tsv").write_text("\n".join(t) + "\n", encoding="utf-8")
print("ok")
