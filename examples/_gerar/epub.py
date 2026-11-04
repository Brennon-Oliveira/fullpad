"""Gera example.epub (EPUB 3 com NCX de compatibilidade). Precisa de pillow para a capa e as ilustrações."""
import io, math, random, zipfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "example.epub"
TITULO, AUTORA, ID = "O Farol de Santa Luzia", "Helena Duarte (autora fictícia)", "urn:uuid:5a3c1f0e-8b7d-4c2a-9e61-0f4d2b7a1c33"

def png(im):
    b = io.BytesIO(); im.save(b, "PNG", optimize=True); return b.getvalue()

def fonte(tam):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", "/usr/share/fonts/truetype/lato/Lato-Bold.ttf"):
        try: return ImageFont.truetype(p, tam)
        except OSError: pass
    return ImageFont.load_default()

def capa():
    w, h = 800, 1200
    im = Image.new("RGB", (w, h)); d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=(int(12 + 40 * t), int(30 + 70 * t), int(62 + 90 * t)))
    rnd = random.Random(1)
    for _ in range(140):
        x, y, r = rnd.randrange(w), rnd.randrange(int(h * .55)), rnd.choice([1, 1, 2, 3])
        d.ellipse([x, y, x + r, y + r], fill=(255, 255, 230))
    d.ellipse([560, 110, 680, 230], fill=(250, 244, 210))
    for i in range(3):
        d.polygon([(w // 2, 470), (w + 80, 360 + i * 90), (w + 80, 420 + i * 90)], fill=(255, 235, 150) if i == 0 else (60 + i * 20, 80 + i * 20, 120 + i * 20))
    d.polygon([(0, 900), (200, 860), (420, 900), (640, 850), (800, 890), (800, 1200), (0, 1200)], fill=(8, 20, 38))
    d.polygon([(340, 900), (360, 480), (440, 480), (460, 900)], fill=(236, 232, 222))
    for y0 in (560, 700, 820):
        d.rectangle([340 + (900 - y0) // 40, y0, 460 - (900 - y0) // 40, y0 + 36], fill=(180, 60, 50))
    d.rectangle([350, 440, 450, 480], fill=(255, 220, 120)); d.polygon([(335, 440), (400, 395), (465, 440)], fill=(60, 40, 40))
    f1, f2 = fonte(62), fonte(28)
    for i, linha in enumerate(["O Farol de", "Santa Luzia"]):
        tw = d.textlength(linha, font=f1); d.text(((w - tw) / 2, 940 + i * 80), linha, font=f1, fill=(245, 240, 225))
    a = "HELENA DUARTE"; tw = d.textlength(a, font=f2); d.text(((w - tw) / 2, 1120), a, font=f2, fill=(190, 200, 220))
    return png(im)

def ilustracao(seed, w=900, h=420):
    rnd = random.Random(seed)
    im = Image.new("RGB", (w, h)); d = ImageDraw.Draw(im)
    top, bot = [(40, 90, 150), (240, 160, 90), (30, 40, 80), (120, 150, 170)][seed % 4], [(190, 220, 240), (250, 220, 150), (90, 100, 150), (200, 210, 215)][seed % 4]
    for y in range(h):
        t = y / h; d.line([(0, y), (w, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    for k in range(5):
        base = h * (.62 + k * .08); cor = (20 + k * 12, 70 + k * 14, 110 + k * 12)
        pts = [(0, h)] + [(x, base + math.sin(x / (40 + k * 12) + seed + k) * (9 - k)) for x in range(0, w + 10, 10)] + [(w, h)]
        d.polygon(pts, fill=cor)
    return png(im)

CSS = """
@charset "utf-8";
body { font-family: Georgia, "Times New Roman", serif; line-height: 1.55; margin: 0 5%; color: #222; }
h1 { font-size: 1.9em; text-align: center; margin: 2.2em 0 .2em; color: #12406b; font-weight: normal; letter-spacing: .02em; }
h1 + p.sub { text-align: center; font-style: italic; color: #667; margin-top: 0; margin-bottom: 2em; }
h2 { font-size: 1.25em; margin-top: 1.8em; color: #1d5a96; }
p { text-align: justify; margin: 0 0 .8em; text-indent: 1.4em; }
p.sem, h1 + p.sub + p, h2 + p, blockquote p, li p { text-indent: 0; }
blockquote { margin: 1.2em 1.5em; padding-left: 1em; border-left: 3px solid #9bb8d3; font-style: italic; color: #333; }
blockquote cite { display: block; text-align: right; font-size: .9em; font-style: normal; color: #667; }
figure { margin: 1.5em 0; text-align: center; } figure img { max-width: 100%; border-radius: 4px; }
figcaption { font-size: .85em; color: #667; font-style: italic; margin-top: .4em; }
table { border-collapse: collapse; margin: 1.2em auto; font-size: .95em; }
th, td { border: 1px solid #b9c7d6; padding: .35em .8em; } th { background: #e8eff6; }
.centro { text-align: center; text-indent: 0; } .cap { font-variant: small-caps; letter-spacing: .06em; }
.nota { font-size: .85em; color: #555; border-top: 1px solid #ccd; margin-top: 2em; padding-top: .5em; }
pre { background: #f2f4f7; padding: .8em; overflow-x: auto; font-size: .85em; }
code { font-family: "Courier New", monospace; font-size: .9em; }
.sep { text-align: center; letter-spacing: .6em; text-indent: 0; margin: 1.6em 0; color: #889; }
a { color: #1d5a96; }
"""

def cap(n, titulo, sub, corpo):
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="pt-BR" lang="pt-BR">
<head><meta charset="utf-8"/><title>{titulo}</title><link rel="stylesheet" type="text/css" href="../css/livro.css"/></head>
<body><section epub:type="chapter" id="c{n}"><h1>{titulo}</h1><p class="sub">{sub}</p>
{corpo}
</section></body></html>"""

caps = []

caps.append(("A carta sem remetente", "Capítulo 1", """
<p>A carta chegou numa terça-feira de chuva fina, embrulhada em papel pardo e amarrada com barbante, como se ainda vivêssemos no tempo em que o correio era uma aventura. <em>Para a nova guardiã do Farol de Santa Luzia</em>, dizia o envelope, numa letra inclinada que Marina não reconheceu.</p>
<p>Ela tinha chegado à vila havia nove dias. Trazia duas malas, uma caixa de livros e o contrato de um ano para catalogar o arquivo da antiga estação de sinalização — trabalho que ninguém mais queria, porque ficava depois da última curva da estrada, onde o asfalto desistia e a areia assumia o comando.</p>
<blockquote><p>“Se está lendo isto, o farol já escolheu você. Não tenha pressa. Ele nunca teve.”</p><cite>— trecho da carta</cite></blockquote>
<p>Marina leu duas vezes. Virou o envelope, procurou carimbo, data, qualquer pista. Nada. Apenas, no canto inferior, um desenho a nanquim: uma torre listrada e três linhas saindo do topo, como raios.</p>
<p>Lá fora, a chuva cobria o mar de um cinza uniforme. Foi então que ela percebeu que, pela primeira vez em nove dias, a lâmpada do alto — que todos juravam estar apagada desde 1987 — piscava.</p>
<figure><img src="../img/ilustracao1.png" alt="Costa ao amanhecer com colinas azuladas"/><figcaption>A costa vista da estrada, pouco antes da última curva.</figcaption></figure>
"""))

caps.append(("A vila e seus relógios", "Capítulo 2", """
<p>Em Santa Luzia, cada pessoa tinha o seu próprio horário. O padeiro vivia dez minutos adiantado, “para o pão não esperar o freguês”. A professora Odete, quinze atrasada, “para o recreio durar mais”. Só a igreja acertava a hora, e mesmo assim às terças, quando o sacristão lembrava de dar corda.</p>
<p>Marina aprendeu depressa a fazer as contas. Chegar às oito na casa de seu Anselmo, o chaveiro, queria dizer aparecer às oito e vinte; ir ao mercado “de manhã cedo” era algo entre seis e nove; e “já já” — palavra que ouviu umas quarenta vezes na primeira semana — podia significar cinco minutos ou o fim do século.</p>
<h2>Quem é quem</h2>
<table><thead><tr><th>Pessoa</th><th>Ofício</th><th>Horário “oficial”</th></tr></thead><tbody>
<tr><td>Seu Anselmo</td><td>chaveiro e relojoeiro</td><td>pontual (o único)</td></tr>
<tr><td>Dona Cecília</td><td>padeira</td><td>+10 min</td></tr>
<tr><td>Professora Odete</td><td>escola e biblioteca</td><td>−15 min</td></tr>
<tr><td>Capitão Bento</td><td>pescador aposentado</td><td>“pela maré”</td></tr>
<tr><td>Joaquim</td><td>entregador de tudo</td><td>nunca se sabe</td></tr>
</tbody></table>
<p>Foi o Capitão Bento quem lhe contou, numa tarde de remendo de rede, que os relógios da vila eram um acordo antigo. Quando o farol funcionava, todos acertavam o dia pelo giro da luz. Depois que ele se apagou, cada um passou a guardar a sua própria hora, <em>como quem guarda um pedaço do que se perdeu</em>.</p>
<p class="sem">Ver mais sobre o farol no <a href="cap03.xhtml">capítulo seguinte</a>.</p>
"""))

caps.append(("O arquivo da estação", "Capítulo 3", """
<p>O arquivo ocupava o térreo da torre: cinco estantes de ferro, duas mesas de carvalho e uma escrivaninha onde alguém havia deixado, cuidadosamente alinhados, uma lupa, um tinteiro seco e um par de óculos de aros finos. A poeira tinha a espessura de um dedo. Marina começou pelas caixas mais baixas.</p>
<p>Havia diários de bordo, tabelas de marés, cartas náuticas dobradas em oito, recibos de óleo para lâmpadas, convites de casamento de gente que ninguém mais lembrava. Para cada documento, ela anotava num caderno: <em>origem, data, estado de conservação, tema</em>. Ao fim do primeiro dia, tinha catalogado 43 itens e espirrado 43 vezes.</p>
<pre><code>registro   data         tipo              estado
-------------------------------------------------
FSL-0001   1911-03-02   diário de bordo   bom
FSL-0002   1911-03-09   tábua de marés    regular
FSL-0003   1914-08-21   carta náutica     frágil
FSL-0004   1923-12-30   recibo (óleo)     bom</code></pre>
<p>No fundo da terceira estante, atrás de uma fileira de almanaques, havia uma caixa de cedro trancada. Não tinha etiqueta, não constava de nenhum inventário e, quando Marina a sacudiu devagar, respondeu com um tilintar suave, como de pequenas peças de metal.</p>
<p>No tampo, gravado a fogo, o mesmo desenho do envelope: a torre listrada, os três raios.</p>
""" ))

caps.append(("As marés de dona Cecília", "Capítulo 4", """
<p>“Chave de caixa a gente não procura”, disse seu Anselmo, limpando as lentes com a barra do avental. “A chave procura a gente.” Marina esperou que ele sorrisse. Ele não sorriu.</p>
<p>Foi dona Cecília, entre uma fornada de pão doce e outra de broa, quem deu a primeira pista concreta. Ela guardava, numa lata de biscoitos, um bilhete que a mãe lhe entregara ainda menina, com a recomendação de entregá-lo “a quem viesse cuidar da luz”.</p>
<blockquote><p>Quando a maré baixar mais do que o costume<br/>e o sino da igreja errar a hora,<br/>procure a pedra que guarda o nome<br/>de quem nunca foi embora.</p><cite>— bilhete da lata de biscoitos</cite></blockquote>
<p>“A maré baixou muito em 1987, o ano em que a luz apagou”, lembrou o Capitão Bento. “E baixa de novo na semana que vem. Lua nova, maré de sizígia. Vai aparecer coisa que nem os mais velhos viram.”</p>
<h2>Tábua de marés da semana</h2>
<table><thead><tr><th>Dia</th><th>Baixa-mar</th><th>Altura</th></tr></thead><tbody>
<tr><td>Segunda</td><td>05h42</td><td>0,3 m</td></tr><tr><td>Terça</td><td>06h31</td><td>0,1 m</td></tr><tr><td>Quarta</td><td>07h20</td><td>−0,1 m</td></tr><tr><td>Quinta</td><td>08h09</td><td>0,0 m</td></tr></tbody></table>
<p>Marina marcou a quarta-feira com um círculo vermelho. Seria às 7h20, com a água mais baixa que qualquer um dali já tinha visto — se o Capitão estivesse certo, e ele quase sempre estava.</p>
"""))

caps.append(("A pedra do nome", "Capítulo 5", """
<p>Na quarta-feira, a vila inteira desceu à praia. Ninguém combinou; simplesmente, às seis e meia, havia gente de casaco e chinelo espalhada pela areia molhada, olhando o mar se afastar como uma cortina sendo recolhida devagar.</p>
<p>Apareceram conchas que ninguém conhecia, um pedaço de leme coberto de cracas, uma bota de borracha (a esquerda; a direita jamais foi encontrada) e, a uns duzentos metros da arrebentação, uma laje escura, lisa, quase redonda, que sempre estivera submersa.</p>
<figure><img src="../img/ilustracao2.png" alt="Praia ao entardecer com tons dourados"/><figcaption>A laje apareceu onde a praia se transformava em recife.</figcaption></figure>
<p>Marina chegou primeiro. Ajoelhou, passou a mão sobre a superfície gelada e encontrou, riscadas fundo na pedra, letras desgastadas pelo sal:</p>
<p class="centro cap">Aqui ficou Luzia, que acendeu a primeira luz</p>
<p>Embaixo, um pequeno orifício, do tamanho exato de uma chave. Do bolso do casaco, onde andara por toda a semana, Marina tirou a minúscula chave de latão que encontrara, afinal, <em>dentro do tinteiro seco</em> da escrivaninha. Ela entrou como se sempre tivesse pertencido ali.</p>
<p>A laje não se moveu, mas a água começou a voltar. Tinham quatro minutos. Talvez cinco.</p>
"""))

caps.append(("O que havia na caixa", "Capítulo 6", """
<p>A chave da laje também abria a caixa de cedro — descobriu Marina horas depois, na torre, com os dedos ainda adormecidos pelo frio e o coração batendo no ritmo das ondas. Dentro, sobre um forro de veludo desbotado, havia sete lentes de vidro, cada uma embrulhada em seda, e um caderno de capa azul.</p>
<p>O caderno era de Luzia. Fora escrito em 1911, ano em que o primeiro farol foi aceso naquela ponta de costa, e tinha algo de diário, algo de manual, algo de confissão. Marina leu à luz de um lampião, sentada no último degrau da escada em espiral:</p>
<blockquote><p>“Aprendi que a luz não serve para mostrar o caminho. Serve para mostrar que existe alguém do outro lado esperando que o caminho seja usado.”</p><cite>— Luzia, caderno azul, p. 3</cite></blockquote>
<h2>Inventário da caixa</h2>
<ol>
<li><p>Sete lentes de Fresnel em miniatura, numeradas de I a VII;</p></li>
<li><p>O caderno azul, com 62 páginas escritas e 40 em branco;</p></li>
<li><p>Uma fotografia de 1913 em que aparecem doze pessoas diante da torre;</p></li>
<li><p>Um cartão com a inscrição: <em>“Para a próxima guardiã: troque a lente VI antes do inverno.”</em></p></li>
</ol>
<p>Marina releu o último item. O inverno chegava em três semanas. E, pelo que dizia o caderno, sem a lente VI no lugar certo, a luz jamais voltaria a girar do jeito que girava no tempo de Luzia.</p>
"""))

caps.append(("A lente número seis", "Capítulo 7", """
<p>A substituição exigiu sete pessoas, duas escadas, três quilos de graxa e uma quantidade de palavrões que Marina decidiu não registrar no inventário. Seu Anselmo, no alto da galeria, calibrou a engrenagem com um relógio de bolso que, segundo ele, “nunca atrasou um segundo desde 1952”. Dona Cecília levou café. O Capitão Bento dava ordens que ninguém seguia.</p>
<p>A professora Odete trouxe as crianças da escola, em fila, de mãos dadas, e cada uma ganhou a tarefa de segurar uma das lentes por alguns minutos. “Um lugar só se salva se muita gente tiver segurado um pedaço dele”, disse, e olhou para o relógio, quinze minutos atrasada para a própria frase.</p>
<p>Ao anoitecer, tudo estava no lugar. Marina subiu sozinha ao topo e encontrou o interruptor de madeira, polido por décadas de mãos que não eram as dela.</p>
<pre><code>// o que o caderno diz, na última página escrita
lente_VI.posicao = "oeste, acima da cornija";
luz.giro = 12.0;      // segundos por volta
luz.alcance = 28;     // milhas náuticas
if (ninguem_esperando) { acender(); }  // acenda mesmo assim</code></pre>
<p>Ela abaixou a alavanca. Houve um estalo, um zumbido grave, o cheiro de metal aquecido — e então a luz percorreu a baía pela primeira vez em quase quarenta anos.</p>
""" ))

caps.append(("A luz que volta", "Capítulo 8", """
<p>Dizem na vila que a luz do Farol de Santa Luzia pode ser vista a vinte e oito milhas. Dizem também que, naquela primeira noite, ela foi vista de muito mais longe: por um barco de pesca que voltava sem rádio, por uma balsa que atravessava o canal, por uma mulher no convés de um cargueiro que olhava para o escuro e pensava em quem a esperava em terra.</p>
<p>Marina passou a noite acordada, na escada em espiral, ouvindo o mecanismo girar. Ao amanhecer, desceu, fez café, e encontrou na mesa do arquivo uma nova carta, que não estava ali antes. Dessa vez, havia remetente: o mesmo desenho a nanquim, e embaixo, em letra inclinada, a assinatura <em>L.</em></p>
<blockquote><p>“Obrigada por cuidar do que não é seu. É assim que as coisas passam a ser de todos.”</p><cite>— última carta</cite></blockquote>
<figure><img src="../img/ilustracao3.png" alt="Noite azul profunda com ondas escuras"/><figcaption>A baía na primeira noite com a luz de volta.</figcaption></figure>
<p>Marina guardou a carta no caderno azul, o caderno na caixa de cedro, e a caixa de volta na terceira estante, atrás dos almanaques. Depois abriu o catálogo e escreveu, na linha seguinte ao último registro:</p>
<p class="centro"><strong>FSL-0412</strong> — 2026-11-03 — <em>luz acesa; arquivo em ordem; guardiã em casa.</em></p>
<p class="sep">FIM</p>
<p class="nota">Esta é uma obra de ficção escrita para servir de exemplo ao leitor de EPUB do Fullpad. Personagens, lugares e eventos são inventados. Veja o <a href="posfacio.xhtml">posfácio</a> para um passeio pelos recursos usados neste livro.</p>
""" ))

posfacio = """
<p>Este livro de exemplo foi montado por um script (<code>examples/_gerar/epub.py</code>) para mostrar o que o leitor de EPUB do Fullpad faz. Abra o sumário ao lado e experimente:</p>
<h2>O que testar</h2>
<ul>
<li><p><strong>Sumário</strong> lateral (EPUB 3 e NCX) e navegação entre capítulos;</p></li>
<li><p><strong>Busca</strong> no livro inteiro: procure “farol”, “maré” ou “Luzia” (a busca ignora acentos e maiúsculas);</p></li>
<li><p><strong>Zoom do texto</strong> de 60% a 300% com Ctrl + roda;</p></li>
<li><p><strong>Tema escuro</strong>: as cores do livro são trocadas pelas do tema;</p></li>
<li><p><strong>Citação</strong>: selecione um trecho e use “Copiar como citação” (Ctrl+Shift+C); a origem sai com o título e o capítulo;</p></li>
<li><p>Tabelas, imagens, blocos de código, notas e links entre capítulos;</p></li>
<li><p>Fechar o app e voltar: a <strong>posição de leitura</strong> é lembrada.</p></li>
</ul>
<h2>Segurança</h2>
<p>O CSS do livro passa por um filtro de lista de permissão e os capítulos rodam num iframe sem scripts. Por isso, o <em>script</em> abaixo foi escrito de propósito para <strong>não</strong> executar:</p>
<script>document.body.innerHTML = "se você está vendo isso, algo está errado";</script>
<p style="position:fixed; top:0; background:red">Este parágrafo tenta se fixar no topo da tela, mas o filtro de CSS remove <code>position</code>.</p>
<p>Voltar ao <a href="cap01.xhtml">primeiro capítulo</a> ou ao <a href="https://www.example.com/fullpad">site de exemplo</a>.</p>
"""
caps.append(("Posfácio: um passeio pelos recursos", "Para quem lê o livro e para quem o testa", posfacio))

def nome(i): return "posfacio.xhtml" if i == len(caps) else f"cap{i:02d}.xhtml"

nav = """<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="pt-BR"><head><meta charset="utf-8"/><title>Sumário</title></head><body>
<nav epub:type="toc" id="toc"><h1>Sumário</h1><ol>
<li><a href="text/capa.xhtml">Capa</a></li>
""" + "\n".join(f'<li><a href="text/{nome(i)}">{t}</a></li>' for i, (t, *_ ) in enumerate(caps, 1)) + """
</ol></nav></body></html>"""

ncx = f"""<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="{ID}"/><meta name="dtb:depth" content="1"/></head>
<docTitle><text>{TITULO}</text></docTitle><navMap>
<navPoint id="n0" playOrder="1"><navLabel><text>Capa</text></navLabel><content src="text/capa.xhtml"/></navPoint>
""" + "\n".join(f'<navPoint id="n{i}" playOrder="{i+1}"><navLabel><text>{t}</text></navLabel><content src="text/{nome(i)}"/></navPoint>' for i, (t, *_ ) in enumerate(caps, 1)) + "\n</navMap></ncx>"

manifest = ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
            '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
            '<item id="css" href="css/livro.css" media-type="text/css"/>',
            '<item id="capaimg" href="img/capa.png" media-type="image/png" properties="cover-image"/>',
            '<item id="capa" href="text/capa.xhtml" media-type="application/xhtml+xml"/>']
manifest += [f'<item id="i{k}" href="img/ilustracao{k}.png" media-type="image/png"/>' for k in (1, 2, 3)]
manifest += [f'<item id="c{i}" href="text/{nome(i)}" media-type="application/xhtml+xml"/>' for i in range(1, len(caps) + 1)]
spine = '<itemref idref="capa" linear="yes"/>' + "".join(f'<itemref idref="c{i}"/>' for i in range(1, len(caps) + 1))
opf = f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="pt-BR">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">{ID}</dc:identifier><dc:title>{TITULO}</dc:title><dc:creator>{AUTORA}</dc:creator><dc:language>pt-BR</dc:language>
<dc:publisher>Fullpad (exemplos)</dc:publisher><dc:date>2026-11-03</dc:date><dc:subject>Ficção</dc:subject>
<dc:description>Novela curta fictícia usada como exemplo do leitor de EPUB do Fullpad.</dc:description>
<meta property="dcterms:modified">2026-11-03T12:00:00Z</meta><meta name="cover" content="capaimg"/></metadata>
<manifest>{"".join(manifest)}</manifest><spine toc="ncx">{spine}</spine></package>"""

capa_x = """<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="pt-BR"><head><meta charset="utf-8"/><title>Capa</title><link rel="stylesheet" type="text/css" href="../css/livro.css"/></head>
<body><figure><img src="../img/capa.png" alt="Capa: O Farol de Santa Luzia"/></figure></body></html>"""

with zipfile.ZipFile(OUT, "w") as z:
    z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    z.writestr("META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', compress_type=zipfile.ZIP_DEFLATED)
    for caminho, dado in {"content.opf": opf, "nav.xhtml": nav, "toc.ncx": ncx, "css/livro.css": CSS, "text/capa.xhtml": capa_x}.items():
        z.writestr("OEBPS/" + caminho, dado, compress_type=zipfile.ZIP_DEFLATED)
    z.writestr("OEBPS/img/capa.png", capa(), compress_type=zipfile.ZIP_STORED)
    for k in (1, 2, 3): z.writestr(f"OEBPS/img/ilustracao{k}.png", ilustracao(k), compress_type=zipfile.ZIP_STORED)
    for i, (t, sub, corpo) in enumerate(caps, 1):
        z.writestr(f"OEBPS/text/{nome(i)}", cap(i, t, sub, corpo), compress_type=zipfile.ZIP_DEFLATED)
print("ok", OUT, OUT.stat().st_size)
