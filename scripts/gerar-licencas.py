#!/usr/bin/env python3
"""Gera o THIRD_PARTY_LICENSES.md: avisos e textos de licença de tudo que viaja no Fullpad.

    python3 scripts/gerar-licencas.py            reescreve THIRD_PARTY_LICENSES.md
    python3 scripts/gerar-licencas.py --check    não grava; sai com 1 se o arquivo está desatualizado
                                                 ou se aparece licença fora da lista permitida

Fontes (nada é inventado: tudo vem do que está instalado):
  * Rust: `cargo tree -e normal` (sem dependências de desenvolvimento nem de build) para Windows,
    Linux e macOS + `cargo metadata`; o texto vem do arquivo de licença dentro do pacote.
  * UI: `pnpm licenses list --prod`; o texto vem do arquivo de licença do pacote.
  * Dados que o app embarca (pdf.js: fontes, cmaps, wasm; KaTeX: fontes): os arquivos de licença
    que acompanham cada um.

A lista de licenças permitidas (PERMITIDAS) e a de copyleft fraco com observação (FRACO) ficam aqui
embaixo: uma licença nova que não esteja em nenhuma das duas faz o script falhar, para alguém olhar
(GPL/AGPL/LGPL/EUPL/SSPL e afins nunca entram sem decisão explícita).
"""
import collections
import hashlib
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(ROOT, "THIRD_PARTY_LICENSES.md")
# o Fullpad é distribuído para Windows e Linux (macOS não)
TARGETS = ["x86_64-pc-windows-msvc", "x86_64-unknown-linux-gnu"]

# Pacotes que não levam arquivo de licença no pacote publicado: o texto original, copiado do
# repositório do projeto para `scripts/licencas/pacotes/`. (nome do pacote → arquivos de texto)
TEXTOS_DO_REPOSITORIO = {
    "alloc-stdlib": ["alloc-stdlib.txt"],            # github.com/dropbox/rust-alloc-no-stdlib
    "dlopen2": ["dlopen2.txt"],                      # github.com/OpenByteDev/dlopen2
    "dlopen2_derive": ["dlopen2.txt"],
    "webview2-com": ["webview2-rs.txt"],             # github.com/wravery/webview2-rs
    "webview2-com-macros": ["webview2-rs.txt"],
    "webview2-com-sys": ["webview2-rs.txt"],
    "@tauri-apps/plugin-dialog": ["tauri-plugin-dialog-MIT.txt"],  # github.com/tauri-apps/plugins-workspace
    "selectors": ["MPL-2.0.txt"],                    # texto-padrão da MPL-2.0 (github.com/servo/stylo)
}

# identificadores SPDX permissivos (não exigem nada além de manter o aviso)
PERMITIDAS = {
    "MIT", "MIT-0", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "Unicode-3.0",
    "0BSD", "CC0-1.0", "Unlicense", "BlueOak-1.0.0", "LLVM-exception", "CDLA-Permissive-2.0",
}
# copyleft fraco, em nível de arquivo: só obriga a manter os arquivos do próprio componente sob a
# licença dele e a indicar onde está o código-fonte; não contamina o código do Fullpad
FRACO = {"MPL-2.0", "EPL-2.0"}

# Pacotes cujo `package.json`/`Cargo.toml` não declara a licença, mas o arquivo no pacote declara.
# Conferido à mão em cada caso; se o pacote mudar de versão, o script avisa para conferir de novo.
DECLARADAS_A_MAO = {("khroma", "2.1.0"): "MIT"}

# Dependências da UI que o pnpm lista como de produção mas que não vão no app (só rodam em Node,
# nos testes): o pdf.js as pede como opcionais para renderizar fora do navegador.
FORA_DO_APP = ("@napi-rs/canvas",)

ARQ_LICENCA = re.compile(r"(?i)^(licen[sc]e|copying|unlicense|notice)(?!.*\.spdx$)")

# Texto-padrão para o pacote que não leva arquivo de licença (o SPDX declarado vale; o copyright é
# dos autores indicados no repositório do pacote).
MODELOS = {
    "MIT": (
        "MIT License\n\nCopyright (c) os autores do pacote (veja o repositório indicado)\n\n"
        "Permission is hereby granted, free of charge, to any person obtaining a copy\n"
        "of this software and associated documentation files (the \"Software\"), to deal\n"
        "in the Software without restriction, including without limitation the rights\n"
        "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell\n"
        "copies of the Software, and to permit persons to whom the Software is\n"
        "furnished to do so, subject to the following conditions:\n\n"
        "The above copyright notice and this permission notice shall be included in all\n"
        "copies or substantial portions of the Software.\n\n"
        "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\n"
        "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\n"
        "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\n"
        "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\n"
        "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\n"
        "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\n"
        "SOFTWARE.\n"
    ),
}


def sh(cmd, cwd=ROOT):
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True).stdout


def ids_spdx(expr):
    """Identificadores de uma expressão SPDX, sem operadores."""
    expr = expr.replace("WITH LLVM-exception", "").replace("Apache-2.0 WITH", "Apache-2.0")
    return {t for t in re.split(r"\s*(?:OR|AND|/|\(|\)|WITH)\s*|\s+", expr) if t}


def escolha(expr):
    """Qual licença vale para nós numa expressão `A OR B`: a mais simples que existe nas permitidas.
    Para `AND` valem todas. Devolve o texto da escolha (só para exibir)."""
    if " OR " in expr or "/" in expr:
        opcoes = [o.strip(" ()") for o in re.split(r"\s+OR\s+|\s*/\s*", expr)]
        for pref in ("MIT", "Apache-2.0", "Zlib", "BSD-3-Clause", "ISC", "Unlicense", "CC0-1.0", "0BSD"):
            if pref in opcoes:
                return pref
    return expr


def arquivo_licenca(pasta):
    textos = []
    for nome in sorted(os.listdir(pasta)):
        caminho = os.path.join(pasta, nome)
        if ARQ_LICENCA.match(nome) and os.path.isfile(caminho):
            try:
                texto = open(caminho, encoding="utf-8", errors="replace").read().strip()
            except OSError:
                continue
            if texto:
                textos.append((nome, texto))
    return textos


def texto_do_repositorio(nome):
    textos = []
    for arq in TEXTOS_DO_REPOSITORIO.get(nome, []):
        caminho = os.path.join(ROOT, "scripts", "licencas", "pacotes", arq)
        textos.append((arq, open(caminho, encoding="utf-8").read().strip()))
    return textos


def pacotes_rust():
    meta = json.loads(sh(["cargo", "metadata", "--format-version", "1", "--locked"]))
    por_id = {(p["name"], p["version"]): p for p in meta["packages"]}
    usados = set()
    for alvo in TARGETS:
        saida = sh(["cargo", "tree", "--locked", "-e", "normal", "--target", alvo, "--prefix", "none",
                    "--format", "{p}"])
        for linha in saida.splitlines():
            m = re.match(r"(\S+) v(\S+)", linha)
            if m:
                usados.add((m.group(1), m.group(2)))
    pacotes = []
    for chave in sorted(usados):
        p = por_id[chave]
        if p.get("source") is None:  # os da casa (fullpad, fullpad-core)
            continue
        pasta = os.path.dirname(p["manifest_path"])
        pacotes.append({
            "eco": "Rust", "nome": chave[0], "versao": chave[1], "licenca": p.get("license") or "",
            "repo": p.get("repository") or p.get("homepage") or "",
            "textos": arquivo_licenca(pasta) or texto_do_repositorio(chave[0]),
        })
    return pacotes


def pacotes_ui():
    dados = json.loads(sh(["pnpm", "licenses", "list", "--prod", "--json"], cwd=os.path.join(ROOT, "ui")))
    pacotes = []
    for licenca, lista in dados.items():
        for p in lista:
            if p["name"].startswith(FORA_DO_APP):
                continue
            for versao, pasta in zip(p["versions"], p["paths"]):
                lic = licenca
                if lic == "Unknown":
                    lic = DECLARADAS_A_MAO.get((p["name"], versao), "Unknown")
                pacotes.append({
                    "eco": "npm", "nome": p["name"], "versao": versao, "licenca": lic,
                    "repo": p.get("homepage") or "",
                    "textos": arquivo_licenca(pasta) or texto_do_repositorio(p["name"]),
                })
    return sorted(pacotes, key=lambda x: (x["nome"], x["versao"]))


def verificar(pacotes):
    problemas = []
    for p in pacotes:
        ids = ids_spdx(p["licenca"])
        if not p["licenca"] or p["licenca"] == "Unknown":
            problemas.append(f"{p['eco']} {p['nome']} {p['versao']}: sem licença declarada")
            continue
        # numa expressão `A OR B` basta uma opção permitida; em `AND` todas precisam ser
        if " OR " in p["licenca"] or "/" in p["licenca"]:
            opcoes = [o.strip(" ()") for o in re.split(r"\s+OR\s+|\s*/\s*", p["licenca"])]
            if not any(ids_spdx(o) <= (PERMITIDAS | FRACO) for o in opcoes):
                problemas.append(f"{p['eco']} {p['nome']} {p['versao']}: {p['licenca']}")
        elif not ids <= (PERMITIDAS | FRACO):
            problemas.append(f"{p['eco']} {p['nome']} {p['versao']}: {p['licenca']} (fora da lista)")
    return problemas


# ---- dados embarcados (não são pacotes: arquivos copiados para dentro do app) ---------------------

def embarcados():
    pdfjs = os.path.join(ROOT, "ui", "node_modules", "pdfjs-dist")
    lic = lambda *partes: open(os.path.join(pdfjs, *partes), encoding="utf-8", errors="replace").read().strip()
    itens = [
        ("pdf.js: fontes padrão Foxit (`standard_fonts/*.pfb`)", "BSD-3-Clause",
         "Copyright 2014 PDFium Authors. Substituem Helvetica/Times/Courier quando o PDF não embute a fonte.",
         lic("standard_fonts", "LICENSE_FOXIT")),
        ("pdf.js: fonte Liberation Sans (`standard_fonts/LiberationSans-*.ttf`)",
         "GPL-2.0 com exceção de fonte (Red Hat)",
         "Atenção: é a única parte com GPL. São **arquivos de fonte separados**, carregados pelo pdf.js "
         "como dados; o Fullpad não é ligado a eles nem os modifica (mera agregação), e a exceção de fonte "
         "da própria licença diz que documentos que embutem a fonte não viram GPL. O código-fonte das "
         "fontes é o do projeto Liberation Fonts 1.x (https://github.com/liberationfonts/liberation-1.7-fonts). "
         "Texto completo da licença abaixo.",
         lic("standard_fonts", "LICENSE_LIBERATION")),
        ("pdf.js: mapas de caracteres (`cmaps/*.bcmap`)", "BSD-3-Clause",
         "Copyright 1990-2009 Adobe Systems Incorporated.", lic("cmaps", "LICENSE")),
        ("pdf.js: perfil de cor (`iccs/*.icc`)", "CC0-1.0", "Domínio público.", lic("iccs", "LICENSE")),
        ("pdf.js: decodificador JBIG2 (`wasm/jbig2.wasm`)", "BSD-3-Clause", "PDFium Authors.",
         lic("wasm", "LICENSE_JBIG2")),
        ("pdf.js: decodificador JPEG 2000 (`wasm/openjpeg.wasm`)", "BSD-2-Clause", "OpenJPEG.",
         lic("wasm", "LICENSE_OPENJPEG")),
        ("pdf.js: gerenciamento de cor (`wasm/qcms_bg.wasm`)", "MIT", "Mozilla Corporation e Marti Maria.",
         lic("wasm", "LICENSE_QCMS")),
        ("pdf.js: QuickJS (`wasm/quickjs-eval.*`)", "MIT", "Fabrice Bellard e Charlie Gordon.",
         lic("wasm", "LICENSE_QUICKJS")),
        ("pdf.js: ligações do wasm (JBIG2, OpenJPEG, QCMS, QuickJS)", "MIT/Apache-2.0", "Mozilla Foundation.",
         "\n\n".join(lic("wasm", n) for n in ("LICENSE_PDFJS_JBIG2", "LICENSE_PDFJS_OPENJPEG",
                                              "LICENSE_PDFJS_QCMS", "LICENSE_PDFJS_QUICKJS"))),
        ("KaTeX: fontes (`katex/fonts/*.woff2`)", "MIT, Apache-2.0 e OFL-1.1 (origem das fontes)",
         "As fontes `KaTeX_*` carregam \"Copyright (c) 2009-2010 Design Science, Inc.\" e \"Copyright (c) "
         "2014-2018 Khan Academy\". O KaTeX é MIT (texto na seção do pacote `katex`); as fontes são geradas "
         "com a cadeia de ferramentas das fontes do MathJax (Apache-2.0, texto na seção de pacotes) a partir "
         "das fontes da AMS (SIL OFL 1.1, texto abaixo). O projeto KaTeX não declara uma licença única só "
         "para as fontes; todas as possíveis são permissivas e permitem redistribuir sem alterar, o que é "
         "feito aqui.",
         open(os.path.join(ROOT, "scripts", "licencas", "OFL-1.1.txt"), encoding="utf-8").read().strip()),
    ]
    return itens


NOTAS = """\
## Resumo para quem audita

- **Nenhuma dependência é GPL, LGPL ou AGPL** (nem EUPL, SSPL ou similares), nem em código nem em
  bibliotecas ligadas ao programa. O script `scripts/gerar-licencas.py --check` falha se uma aparecer.
- **Copyleft fraco (em nível de arquivo), sem efeito sobre o código do Fullpad:**
  - **MPL-2.0**: `cssparser`, `cssparser-macros`, `dtoa-short`, `option-ext` e `selectors` (Rust).
    Usados sem modificação; o código-fonte está nos repositórios indicados. A MPL só exige manter os
    arquivos desses pacotes sob a MPL e dizer onde está o código deles.
  - **EPL-2.0**: `elkjs` (UI), puxado pelo `mermaid` e embutido sem modificação (carregado só quando um
    diagrama pede esse motor de layout). O código-fonte está em https://github.com/kieler/elkjs.
  - **MPL-2.0 OR Apache-2.0**: `dompurify`; vale a Apache-2.0.
- **Única parte com GPL:** os arquivos de fonte **Liberation Sans** que o pdf.js embarca (veja
  "Dados embarcados" abaixo): GPL-2.0 com exceção de fonte, como dados separados do programa.
- **Bibliotecas do sistema, não redistribuídas:** no Windows o app usa o WebView2 da Microsoft
  (baixado pelo instalador, não vem junto). No Linux liga-se dinamicamente ao GTK e ao WebKitGTK
  (LGPL) do sistema, que a pessoa instala; o Fullpad não as distribui.
- Todo o resto é MIT, Apache-2.0, BSD, ISC, Zlib, Unicode-3.0, 0BSD, CC0, Unlicense e semelhantes.
- Onde um pacote oferece `A OR B`, o Fullpad o usa pela licença mais permissiva (MIT ou Apache-2.0).
"""


def gerar():
    pacotes = pacotes_rust() + pacotes_ui()
    problemas = verificar(pacotes)

    contagem = collections.Counter()
    for p in pacotes:
        contagem[p["licenca"]] += 1

    out = []
    w = out.append
    w("# Licenças de terceiros\n")
    w("O Fullpad é distribuído com as bibliotecas abaixo. Cada uma continua sob a licença dos seus autores; "
      "os avisos de copyright e os textos completos estão aqui, como as licenças pedem.\n")
    w("> Arquivo **gerado** por `scripts/gerar-licencas.py`: não edite à mão. Rode o script ao mudar uma "
      "dependência (`Cargo.lock` ou `ui/pnpm-lock.yaml`).\n")
    w(NOTAS)
    w(f"## Pacotes ({len(pacotes)})\n")
    w("Rust: dependências normais (sem as de desenvolvimento e de compilação) para Windows e Linux, as "
      "plataformas em que o Fullpad é distribuído. UI: dependências de produção. Onde há `OR`, vale a "
      "opção mais permissiva.\n")
    w("| Licença | Pacotes |\n|---|---|")
    for lic, n in contagem.most_common():
        w(f"| {lic} | {n} |")
    w("")
    w("| Pacote | Versão | Origem | Licença | Repositório |\n|---|---|---|---|---|")
    for p in pacotes:
        w(f"| `{p['nome']}` | {p['versao']} | {p['eco']} | {p['licenca']} | {p['repo']} |")
    w("")

    # textos completos, agrupados pelo conteúdo (copyright incluso), cada um uma vez
    grupos = collections.OrderedDict()
    sem_texto = []
    for p in pacotes:
        if not p["textos"]:
            sem_texto.append(p)
            continue
        for _nome, texto in p["textos"]:
            chave = hashlib.sha256(re.sub(r"\s+", " ", texto).encode()).hexdigest()
            g = grupos.setdefault(chave, {"texto": texto, "pacotes": []})
            rotulo = f"{p['nome']} {p['versao']}"
            if rotulo not in g["pacotes"]:
                g["pacotes"].append(rotulo)

    w("## Textos das licenças dos pacotes\n")
    w("Cada texto aparece uma vez, com a lista dos pacotes que o usam (o aviso de copyright vem dentro "
      "do texto, como no pacote original).\n")
    for i, g in enumerate(sorted(grupos.values(), key=lambda g: (-len(g["pacotes"]), g["pacotes"][0])), 1):
        w(f"### Texto {i}: {', '.join(g['pacotes'][:12])}"
          + (f" e mais {len(g['pacotes']) - 12}" if len(g["pacotes"]) > 12 else "") + "\n")
        w("~~~~text\n" + g["texto"] + "\n~~~~\n")

    if sem_texto:
        w("## Pacotes sem arquivo de licença no pacote publicado\n")
        w("Estes pacotes declaram a licença nos metadados, mas não incluem o arquivo de texto. Vale a "
          "licença declarada, com o copyright dos autores no repositório indicado.\n")
        w("| Pacote | Licença declarada | Repositório |\n|---|---|---|")
        for p in sem_texto:
            w(f"| `{p['nome']}` {p['versao']} | {p['licenca']} | {p['repo']} |")
        w("")
        w("Texto-padrão da licença MIT (a mais frequente entre eles; as dos pacotes `OU` valem pela MIT):\n")
        w("~~~~text\n" + MODELOS["MIT"] + "~~~~\n")

    w("## Dados embarcados\n")
    w("Arquivos que o app carrega como dados (não são código): copiados de `pdfjs-dist` e `katex` na "
      "compilação (`ui/vite.config.ts`) e incluídos no instalador.\n")
    for titulo, spdx, nota, texto in embarcados():
        w(f"### {titulo}\n")
        w(f"**Licença:** {spdx}. {nota}\n")
        w("~~~~text\n" + texto + "\n~~~~\n")

    return "\n".join(out), problemas


def main():
    texto, problemas = gerar()
    if problemas:
        print("licenças fora da lista permitida:", *problemas, sep="\n  ", file=sys.stderr)
        sys.exit(2)
    if "--check" in sys.argv:
        atual = open(SAIDA, encoding="utf-8").read() if os.path.exists(SAIDA) else ""
        if atual != texto:
            print("THIRD_PARTY_LICENSES.md desatualizado: rode scripts/gerar-licencas.py", file=sys.stderr)
            sys.exit(1)
        print("ok")
        return
    with open(SAIDA, "w", encoding="utf-8") as f:
        f.write(texto)
    print(f"gravado: {SAIDA} ({len(texto) // 1024} KB)")


if __name__ == "__main__":
    main()
