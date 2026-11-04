"""Gera example.pdf (precisa de reportlab e pillow).

    python3 -m venv /tmp/v && /tmp/v/bin/pip install reportlab pillow && /tmp/v/bin/python pdf.py
"""
import io, math, random
from pathlib import Path
from PIL import Image, ImageDraw
from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
                                NextPageTemplate, FrameBreak, Image as RLImage, KeepTogether, Preformatted, ListFlowable, ListItem, Flowable)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.graphics.shapes import Drawing, String, Line, Rect, Circle
from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.linecharts import HorizontalLineChart
from reportlab.graphics.charts.piecharts import Pie
from reportlab.graphics.charts.legends import Legend

OUT = Path(__file__).resolve().parent.parent / "example.pdf"
L, D = "/usr/share/fonts/truetype/lato/", "/usr/share/fonts/truetype/dejavu/"
for n, f in [("Lato", "Lato-Regular"), ("Lato-B", "Lato-Bold"), ("Lato-I", "Lato-Italic"), ("Lato-BI", "Lato-BoldItalic"), ("Lato-L", "Lato-Light")]:
    pdfmetrics.registerFont(TTFont(n, L + f + ".ttf"))
pdfmetrics.registerFont(TTFont("Mono", D + "DejaVuSansMono.ttf"))
pdfmetrics.registerFontFamily("Lato", normal="Lato", bold="Lato-B", italic="Lato-I", boldItalic="Lato-BI")

VERDE, VERDE2, AREIA, GRAFITE = colors.HexColor("#1f6f50"), colors.HexColor("#8fd3b0"), colors.HexColor("#f3efe6"), colors.HexColor("#25302b")
LARANJA, AZUL = colors.HexColor("#e08a2e"), colors.HexColor("#2f6db5")

body = ParagraphStyle("body", fontName="Lato", fontSize=10.5, leading=15, textColor=GRAFITE, alignment=TA_JUSTIFY, spaceAfter=7)
h1 = ParagraphStyle("h1", parent=body, fontName="Lato-B", fontSize=22, leading=26, textColor=VERDE, spaceBefore=4, spaceAfter=10, alignment=0)
h2 = ParagraphStyle("h2", parent=h1, fontSize=14.5, leading=18, spaceBefore=10, spaceAfter=5, textColor=GRAFITE)
h3 = ParagraphStyle("h3", parent=h2, fontSize=11.5, leading=14, textColor=VERDE, spaceBefore=6)
small = ParagraphStyle("small", parent=body, fontSize=8.5, leading=11, textColor=colors.HexColor("#5b6862"), alignment=0)
quote = ParagraphStyle("quote", parent=body, fontName="Lato-I", fontSize=12, leading=17, leftIndent=18, rightIndent=18, textColor=VERDE, spaceBefore=6, spaceAfter=10, alignment=0)
cell = ParagraphStyle("cell", parent=body, fontSize=9, leading=11.5, alignment=0, spaceAfter=0)
cellb = ParagraphStyle("cellb", parent=cell, fontName="Lato-B", textColor=colors.white)
codestyle = ParagraphStyle("code", fontName="Mono", fontSize=8, leading=10.5, backColor=colors.HexColor("#eef2ef"), borderPadding=6, leftIndent=6, textColor=GRAFITE, spaceAfter=10)


class Cabecalho(Flowable):
    """Título que também vira entrada do sumário e marcador (bookmark)."""
    pass


class Doc(BaseDocTemplate):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._n = 0

    def afterFlowable(self, f):
        if isinstance(f, Paragraph) and f.style.name in ("h1", "h2"):
            nivel = 0 if f.style.name == "h1" else 1
            texto = f.getPlainText()
            key = "sec-" + "".join(ch for ch in texto if ch.isalnum())
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(texto, key, level=nivel, closed=False)
            self.notify("TOCEntry", (nivel, texto, self.page, key))


def rodape(c, d):
    c.saveState()
    c.setFont("Lato", 8.5); c.setFillColor(colors.HexColor("#6b7872"))
    c.drawString(2 * cm, 1.2 * cm, "Cooperativa Horizonte Verde — Relatório Anual 2026")
    c.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Página {d.page}")
    c.setStrokeColor(VERDE2); c.setLineWidth(0.6); c.line(2 * cm, 1.7 * cm, A4[0] - 2 * cm, 1.7 * cm)
    c.restoreState()


def capa(c, d):
    w, h = A4
    c.saveState()
    c.setFillColor(VERDE); c.rect(0, 0, w, h, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#185a41"))
    for i in range(7):
        c.circle(w * .85, h * .78, 60 + i * 38, fill=0, stroke=1)
    c.setStrokeColor(colors.HexColor("#2b8a64")); c.setLineWidth(1.2)
    c.setFillColor(AREIA); c.rect(0, 0, w, 6.5 * cm, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Lato-L", 15); c.drawString(2.5 * cm, h - 5 * cm, "COOPERATIVA HORIZONTE VERDE")
    c.setFont("Lato-B", 46); c.drawString(2.5 * cm, h - 8 * cm, "Relatório")
    c.drawString(2.5 * cm, h - 10.2 * cm, "Anual 2026")
    c.setFont("Lato-I", 14); c.setFillColor(VERDE2)
    c.drawString(2.5 * cm, h - 12 * cm, "Cultivar com cuidado, colher junto.")
    c.setFillColor(GRAFITE); c.setFont("Lato", 11)
    c.drawString(2.5 * cm, 4.2 * cm, "Documento de exemplo do Fullpad — dados fictícios")
    c.setFont("Lato", 9.5); c.setFillColor(colors.HexColor("#5b6862"))
    c.drawString(2.5 * cm, 3.4 * cm, "Gerado por examples/_gerar/pdf.py · novembro de 2026")
    c.restoreState()


def foto(w, h, seed, tipo):
    rnd = random.Random(seed)
    im = Image.new("RGB", (w, h)); dr = ImageDraw.Draw(im)
    for y in range(h):
        t = y / h
        dr.line([(0, y), (w, y)], fill=(int(250 - 140 * t), int(214 - 40 * t), int(150 + 40 * t)) if tipo == "campo" else (int(20 + 30 * t), int(90 + 80 * t), int(70 + 60 * t)))
    if tipo == "campo":
        dr.ellipse([w * .62, h * .12, w * .62 + 70, h * .12 + 70], fill=(255, 238, 170))
        for i, base in enumerate([.55, .65, .75, .88]):
            pts = [(0, h)]
            for x in range(0, w + 20, 20):
                pts.append((x, h * base + math.sin(x / 55 + i * 1.7) * 14))
            pts.append((w, h))
            dr.polygon(pts, fill=(20 + i * 18, 110 + i * 22, 60 + i * 10))
    else:
        for _ in range(900):
            x, y = rnd.randrange(w), rnd.randrange(h); r = rnd.randint(3, 16)
            g = rnd.randint(100, 220)
            dr.ellipse([x, y, x + r, y + r], fill=(rnd.randint(20, 80), g, rnd.randint(50, 120)))
    b = io.BytesIO(); im.save(b, "PNG"); b.seek(0)
    return b


def titulo(t): return Paragraph(t, h1)
P = lambda t, s=body: Paragraph(t, s)
link = lambda url, txt=None: f'<link href="{url}" color="#2f6db5"><u>{txt or url}</u></link>'


def tabela(dados, larg, zebra=True, align_right_from=1):
    linhas = [[Paragraph(str(x), cellb) for x in dados[0]]] + [[Paragraph(str(x), cell) for x in r] for r in dados[1:]]
    t = Table(linhas, colWidths=larg, repeatRows=1)
    st = [("BACKGROUND", (0, 0), (-1, 0), VERDE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LINEBELOW", (0, 0), (-1, -1), .3, colors.HexColor("#c9d3cd")),
          ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]
    if zebra:
        st += [("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f4f8f5")])]
    t.setStyle(TableStyle(st)); return t


def grafico_barras():
    d = Drawing(440, 210)
    bc = VerticalBarChart(); bc.x, bc.y, bc.width, bc.height = 45, 30, 370, 150
    bc.data = [[310, 342, 365, 398], [270, 288, 310, 331]]
    bc.categoryAxis.categoryNames = ["2023", "2024", "2025", "2026"]
    bc.bars[0].fillColor, bc.bars[1].fillColor = VERDE, LARANJA
    bc.valueAxis.valueMin, bc.valueAxis.valueMax, bc.valueAxis.valueStep = 0, 450, 50
    bc.categoryAxis.labels.fontName = bc.valueAxis.labels.fontName = "Lato"
    bc.barSpacing, bc.groupSpacing = 3, 18
    d.add(bc)
    lg = Legend(); lg.x, lg.y, lg.fontName, lg.fontSize = 150, 205, "Lato", 9; lg.alignment = "right"; lg.columnMaximum = 1; lg.deltax = 90
    lg.colorNamePairs = [(VERDE, "Receita (milhares R$)"), (LARANJA, "Custos (milhares R$)")]
    d.add(lg); return d


def grafico_linha():
    d = Drawing(440, 190)
    lc = HorizontalLineChart(); lc.x, lc.y, lc.width, lc.height = 45, 28, 370, 135
    lc.data = [[820, 910, 1040, 1180, 1320, 1290, 1210, 1150, 1260, 1380, 1490, 1560]]
    lc.categoryAxis.categoryNames = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
    lc.lines[0].strokeColor, lc.lines[0].strokeWidth = AZUL, 2.2
    lc.lines[0].symbol = None
    lc.valueAxis.valueMin, lc.valueAxis.valueMax, lc.valueAxis.valueStep = 600, 1600, 200
    lc.categoryAxis.labels.fontName = lc.valueAxis.labels.fontName = "Lato"
    d.add(lc); d.add(String(45, 172, "Toneladas colhidas por mês", fontName="Lato-B", fontSize=10, fillColor=GRAFITE)); return d


def grafico_pizza():
    d = Drawing(440, 190)
    p = Pie(); p.x, p.y, p.width, p.height = 40, 15, 160, 160
    p.data = [38, 24, 17, 12, 9]; p.labels = None
    cores = [VERDE, LARANJA, AZUL, colors.HexColor("#b5517a"), colors.HexColor("#8c9b94")]
    for i, c in enumerate(cores):
        p.slices[i].fillColor = c; p.slices[i].strokeColor = colors.white; p.slices[i].strokeWidth = 1.5
    p.slices[0].popout = 6
    d.add(p)
    lg = Legend(); lg.x, lg.y, lg.fontName, lg.fontSize, lg.dy, lg.deltay, lg.columnMaximum = 240, 140, "Lato", 10, 9, 22, 8
    lg.colorNamePairs = [(c, n) for c, n in zip(cores, ["Hortaliças — 38%", "Frutas — 24%", "Grãos — 17%", "Laticínios — 12%", "Outros — 9%"])]
    d.add(lg); return d


def selo():
    d = Drawing(60, 60)
    d.add(Circle(30, 30, 28, fillColor=VERDE, strokeColor=VERDE2, strokeWidth=3))
    d.add(String(30, 26, "2026", fontName="Lato-B", fontSize=12, fillColor=colors.white, textAnchor="middle"))
    return d


def build():
    doc = Doc(str(OUT), pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=2 * cm, bottomMargin=2.3 * cm,
              title="Relatório Anual 2026 — Cooperativa Horizonte Verde", author="Fullpad (exemplo)", subject="Documento de exemplo com texto, tabelas, gráficos e links",
              keywords="exemplo, pdf, fullpad")
    W, H = A4
    f1 = Frame(2 * cm, 2.3 * cm, W - 4 * cm, H - 4.3 * cm, id="f1")
    colw = (W - 4 * cm - 0.8 * cm) / 2
    c1 = Frame(2 * cm, 2.3 * cm, colw, H - 4.3 * cm, id="c1"); c2 = Frame(2 * cm + colw + 0.8 * cm, 2.3 * cm, colw, H - 4.3 * cm, id="c2")
    doc.addPageTemplates([
        PageTemplate("capa", frames=[Frame(0, 0, W, H, id="x")], onPage=capa),
        PageTemplate("pagina", frames=[f1], onPage=rodape),
        PageTemplate("colunas", frames=[c1, c2], onPage=rodape),
    ])
    s = []
    s += [NextPageTemplate("pagina"), PageBreak()]
    s.append(P("Sumário", ParagraphStyle("sum", parent=h1)))
    toc = TableOfContents(); toc.dotsMinLevel = 0
    toc.levelStyles = [ParagraphStyle("t0", fontName="Lato-B", fontSize=11.5, leading=20, leftIndent=0, textColor=GRAFITE), ParagraphStyle("t1", fontName="Lato", fontSize=10, leading=15, leftIndent=18, textColor=colors.HexColor("#4a5851"))]
    s += [toc, Spacer(1, 12), P("Clique em uma linha do sumário para ir direto à seção. Os marcadores também aparecem no painel lateral dos leitores de PDF.", small), PageBreak()]

    # 1
    s.append(titulo("1. Carta aos cooperados"))
    s.append(P("Prezados cooperados, 2026 foi o ano em que <b>colhemos o que plantamos juntos</b>. Fechamos o exercício com <b>R$ 398 mil</b> de receita (alta de 9% sobre 2025), ampliamos de 112 para <b>137 famílias associadas</b> e inauguramos a nossa câmara fria, que reduziu o desperdício pós-colheita de 14% para 6%."))
    s.append(P("Os números contam apenas parte da história. A outra parte está nas feiras de sábado, na merenda das escolas da região — agora 31% abastecida por nós — e nas mutirões de preparo da terra que reuniram, em média, 48 pessoas por edição."))
    s.append(P("“Quem planta sozinho colhe pouco; quem planta junto colhe também amizade.”", quote))
    s.append(P("— Dona Aurora, cooperada fundadora", ParagraphStyle("a", parent=small, alignment=2)))
    s.append(Spacer(1, 6))
    s.append(P("Ao longo das próximas páginas você encontra o resumo do ano, os indicadores, os gráficos de produção, as metas para 2027 e um apêndice com o detalhamento por família. Para perguntas, escreva para " + link("mailto:contato@example.com", "contato@example.com") + " ou visite " + link("https://www.example.com/horizonte-verde") + "."))
    s.append(Spacer(1, 8))
    s.append(KeepTogether([P("Marcos de 2026", h2), ListFlowable([
        ListItem(P("<b>Fevereiro</b> — certificação orgânica renovada por mais três anos."), leftIndent=14),
        ListItem(P("<b>Maio</b> — início da operação da câmara fria (capacidade: 40 toneladas)."), leftIndent=14),
        ListItem(P("<b>Agosto</b> — contrato com o programa municipal de merenda escolar."), leftIndent=14),
        ListItem(P("<b>Outubro</b> — primeira exportação de mel orgânico, 2,3 toneladas."), leftIndent=14),
    ], bulletType="bullet", bulletColor=VERDE, leftIndent=14)]))
    s.append(PageBreak())

    # 2 colunas (simuladas com tabela)
    s.append(titulo("2. Resumo executivo"))
    texto = [
        "A produção total chegou a <b>14.280 toneladas</b>, distribuídas em 61 variedades. O destaque foi a linha de hortaliças folhosas, que cresceu 18% graças à irrigação por gotejamento instalada nos talhões 4 a 9.",
        "O custo médio por tonelada caiu 4,2% em termos reais. Contribuíram a compra coletiva de insumos, o uso compartilhado de maquinário e a redução de perdas na câmara fria.",
        "No financeiro, o fundo de reserva atingiu 3,1 meses de despesas fixas, acima da meta estatutária de 3 meses. Não houve inadimplência nas operações de microcrédito entre cooperados.",
        "Do lado social, destinamos 5% das sobras ao fundo de educação: 214 horas de formação em manejo agroecológico e gestão foram oferecidas, com 91% de frequência.",
        "Os principais riscos monitorados são a variação climática (dois períodos de estiagem em março e setembro), a dependência de dois compradores institucionais e a sucessão familiar — apenas 23% dos associados têm menos de 40 anos.",
        "Para 2027 propomos ampliar a câmara fria, abrir um segundo canal de venda direta ao consumidor e iniciar o programa jovem agricultor, descritos na seção de metas.",
    ]
    cols = [P(t) for t in texto]
    # simulação de duas colunas com tabela simples (mantém a seleção de texto fluindo por coluna)
    meio = len(cols) // 2
    esq = [P("Produção e custos", h3)] + cols[:meio]; dire = [P("Finanças e pessoas", h3)] + cols[meio:]
    t = Table([[esq, dire]], colWidths=[(W - 4 * cm) / 2] * 2); t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, 0), 14)]))
    s.append(t)
    s.append(Spacer(1, 6))
    s.append(RLImage(foto(900, 280, 3, "campo"), width=W - 4 * cm, height=(W - 4 * cm) * 280 / 900))
    s.append(P("Figura 1 — Talhões 4 a 9 ao amanhecer (imagem ilustrativa gerada por script).", small))
    s.append(PageBreak())

    # 3 indicadores
    s.append(titulo("3. Indicadores do ano"))
    s.append(P("A tabela abaixo reúne os principais indicadores. As variações são calculadas sobre o exercício anterior e valores em verde indicam melhora."))
    ind = [["Indicador", "2024", "2025", "2026", "Variação"],
           ["Famílias associadas", "98", "112", "137", "+22,3%"], ["Receita (R$ mil)", "342", "365", "398", "+9,0%"], ["Custos (R$ mil)", "288", "310", "331", "+6,8%"],
           ["Sobras líquidas (R$ mil)", "54", "55", "67", "+21,8%"], ["Produção (toneladas)", "11.020", "12.470", "14.280", "+14,5%"], ["Desperdício pós-colheita", "17%", "14%", "6%", "−8 p.p."],
           ["Merenda escolar abastecida", "12%", "21%", "31%", "+10 p.p."], ["Horas de formação", "120", "168", "214", "+27,4%"], ["Emissões (t CO₂e / t produzida)", "0,19", "0,17", "0,14", "−17,6%"]]
    s.append(tabela(ind, [6.2 * cm, 2.3 * cm, 2.3 * cm, 2.3 * cm, 3.9 * cm]))
    s.append(Spacer(1, 12))
    s.append(P("Receita e custos", h2)); s.append(grafico_barras())
    s.append(P("Gráfico 1 — Receita e custos anuais, em milhares de reais.", small)); s.append(PageBreak())

    # 4 produção
    s.append(titulo("4. Produção"))
    s.append(P("A colheita seguiu o padrão sazonal esperado, com queda em junho e julho por causa do frio e da estiagem, e recuperação a partir de agosto com a entrada das folhosas de verão. O pico de dezembro refletiu a antecipação de pedidos para as festas de fim de ano."))
    s.append(grafico_linha()); s.append(P("Gráfico 2 — Toneladas colhidas por mês em 2026.", small))
    s.append(P("Composição por categoria", h2)); s.append(grafico_pizza()); s.append(P("Gráfico 3 — Participação de cada categoria na produção total.", small))
    s.append(PageBreak())

    s.append(P("Principais culturas", h2))
    cult = [["Cultura", "Área (ha)", "Produção (t)", "Produtividade (t/ha)", "Destino principal"],
            ["Alface crespa", "6,5", "1.980", "304,6", "Feiras e mercados"], ["Tomate", "9,2", "2.640", "287,0", "Merenda escolar"], ["Cenoura", "7,8", "2.210", "283,3", "Merenda escolar"],
            ["Mandioca", "12,0", "1.870", "155,8", "Feiras"], ["Banana", "15,3", "2.150", "140,5", "Atacado"], ["Milho verde", "11,4", "1.320", "115,8", "Feiras"],
            ["Feijão", "20,1", "980", "48,8", "Cooperados"], ["Mel (litros → t)", "—", "2,3", "—", "Exportação"]]
    s.append(tabela(cult, [3.6 * cm, 2.2 * cm, 2.8 * cm, 3.6 * cm, 4.8 * cm]))
    s.append(Spacer(1, 10))
    s.append(P("Mapa esquemático da propriedade", h2))
    mapa = Drawing(480, 150)
    mapa.add(Rect(0, 0, 480, 150, fillColor=colors.HexColor("#eef5ee"), strokeColor=VERDE2))
    for i, (x, y, w, h_, c) in enumerate([(15, 80, 120, 55, VERDE2), (145, 80, 90, 55, colors.HexColor("#c8e0a8")), (245, 80, 100, 55, colors.HexColor("#f0d9a0")), (355, 80, 110, 55, VERDE2),
                                           (15, 15, 150, 55, colors.HexColor("#f0d9a0")), (175, 15, 110, 55, colors.HexColor("#c8e0a8")), (295, 15, 80, 55, colors.HexColor("#b9d9ee")), (385, 15, 80, 55, VERDE2)]):
        mapa.add(Rect(x, y, w, h_, fillColor=c, strokeColor=VERDE, strokeWidth=.8, rx=4, ry=4))
        mapa.add(String(x + w / 2, y + h_ / 2 - 4, f"Talhão {i + 1}", fontName="Lato", fontSize=9, fillColor=GRAFITE, textAnchor="middle"))
    s.append(mapa); s.append(P("Figura 2 — Distribuição dos talhões (esquemático).", small)); s.append(PageBreak())

    # 5 metas
    s.append(titulo("5. Metas para 2027"))
    s.append(P("As metas foram aprovadas em assembleia no dia 18 de outubro, com 119 votos a favor, 4 contra e 6 abstenções. Cada meta tem uma pessoa responsável e uma data de revisão trimestral."))
    metas = [["#", "Meta", "Responsável", "Prazo", "Investimento"],
             ["1", "Ampliar a câmara fria para 70 toneladas", "Comissão de infraestrutura", "Set/2027", "R$ 180 mil"],
             ["2", "Abrir loja virtual e entrega de cestas", "Comissão de comercialização", "Mar/2027", "R$ 45 mil"],
             ["3", "Programa jovem agricultor (20 vagas)", "Comissão de educação", "Jun/2027", "R$ 60 mil"],
             ["4", "Certificar mel e derivados para exportação", "Apicultores", "Dez/2027", "R$ 32 mil"],
             ["5", "Reduzir emissões para 0,11 t CO₂e / t", "Comissão técnica", "Dez/2027", "R$ 25 mil"]]
    s.append(tabela(metas, [0.8 * cm, 6.6 * cm, 4.2 * cm, 2.2 * cm, 3.2 * cm]))
    s.append(P("Processo de decisão", h2))
    s.append(P("Cada proposta segue o mesmo caminho, do campo até a assembleia:"))
    passos = Drawing(480, 60)
    nomes = ["Ideia", "Comissão", "Parecer técnico", "Assembleia", "Execução"]
    for i, n in enumerate(nomes):
        x = 4 + i * 96
        passos.add(Rect(x, 15, 84, 32, fillColor=VERDE if i < 4 else LARANJA, strokeColor=None, rx=6, ry=6))
        passos.add(String(x + 42, 27, n, fontName="Lato-B", fontSize=9.5, fillColor=colors.white, textAnchor="middle"))
        if i < 4: passos.add(Line(x + 85, 31, x + 95, 31, strokeColor=GRAFITE, strokeWidth=1.4))
    s.append(passos)
    s.append(P("Cálculo da meta de emissões", h2))
    s.append(Preformatted("emissao_por_tonelada = emissoes_totais_tco2e / producao_total_t\n# 2026: 2.000 / 14.280  ≈ 0,14\n# 2027 (meta): 1.760 / 16.000 = 0,11", codestyle))
    s.append(P("A metodologia segue o protocolo disponível em " + link("https://ghgprotocol.org", "ghgprotocol.org") + ". Veja também o <a href=\"#glossario\" color=\"#2f6db5\"><u>glossário</u></a> ao final deste documento.", body))
    s.append(PageBreak())

    # 6 apêndice
    s.append(titulo("6. Apêndice: famílias associadas"))
    rnd = random.Random(7)
    sob = ["Silva", "Oliveira", "Santos", "Pereira", "Lima", "Ferreira", "Costa", "Rodrigues", "Almeida", "Nascimento", "Araújo", "Ribeiro", "Carvalho", "Gomes", "Martins", "Rocha"]
    nom = ["Ana", "Bruno", "Carla", "Davi", "Elisa", "Fábio", "Gabriela", "Hugo", "Isabela", "João", "Karina", "Luís", "Marta", "Nelson", "Olívia", "Paulo"]
    ap = [["Nº", "Família", "Entrada", "Área (ha)", "Culturas principais", "Prod. (t)"]]
    cul = ["Alface, rúcula", "Tomate, pepino", "Mandioca", "Banana", "Cenoura, beterraba", "Feijão, milho", "Mel, própolis", "Leite, queijo"]
    for i in range(1, 49):
        ap.append([str(i), f"{rnd.choice(nom)} {rnd.choice(sob)}", str(rnd.randint(2009, 2026)), f"{rnd.uniform(1.2, 18):.1f}".replace(".", ","), rnd.choice(cul), f"{rnd.uniform(20, 420):.0f}"])
    s.append(tabela(ap, [1.1 * cm, 4.3 * cm, 2 * cm, 2.2 * cm, 4.7 * cm, 2.7 * cm]))
    s.append(PageBreak())

    s.append(titulo("7. Glossário"))
    s.append(Paragraph('<a name="glossario"/>', body))
    for t, d in [("Agroecologia", "Abordagem que aplica princípios ecológicos à produção agrícola, dispensando agrotóxicos sintéticos."), ("Câmara fria", "Ambiente refrigerado usado para conservar a produção após a colheita e reduzir perdas."),
                 ("CO₂e", "Dióxido de carbono equivalente: unidade que converte diferentes gases de efeito estufa em um mesmo padrão."), ("Gotejamento", "Sistema de irrigação que entrega água diretamente na raiz, gota a gota."),
                 ("Sobras", "Resultado positivo do exercício de uma cooperativa, distribuído conforme o estatuto e as decisões da assembleia."), ("Talhão", "Divisão da propriedade em áreas de cultivo com manejo próprio.")]:
        s.append(P(f"<b>{t}</b> — {d}"))
    s.append(Spacer(1, 14))
    s.append(P("Caracteres especiais para testar a busca e a cópia: ação, coração, pão, açaí, você, ônibus, três, à, ü, ñ · R$ 1.234,56 · 10 m² · CO₂ · ½ ¼ · “aspas” · — travessão.", body))
    s.append(Spacer(1, 10)); s.append(selo())
    doc.multiBuild(s)
    print("ok", OUT, OUT.stat().st_size)


build()
