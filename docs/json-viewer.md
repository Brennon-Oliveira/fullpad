# JSON viewer: pesquisa e desenho

Fase 9 do [PLANO.md](PLANO.md). Este documento registra **como o jsonformatter.org/json-viewer funciona** (pesquisado com o REA) e **como replicamos** no Fullpad, no padrão do app.

## 1. Como o jsonformatter.org faz

### Método e limites da pesquisa

- Baixei `index.html`, `/dist/4.3/js/jsontools-min.js` (963 KB) e `jsonmain.css` e li o código. Isso é **análise estática**: nada foi executado nem observado em um navegador.
- O `capture_browser_scenario` do REA não conseguiu abrir o Chrome do Windows a partir do WSL (falha de execução; limpeza do navegador ficou "incompleta", sem recursos listados). Não houve captura de rede nem de DOM.
- O `analyze_javascript_application` esgotou o heap de 1 GiB no bundle e não analisou nenhum arquivo. Os fatos abaixo vêm de leitura direta do texto do bundle, não do grafo do REA.
- Numa segunda rodada, com o Chrome 156 do Windows aberto em `http://127.0.0.1:9222`, o REA fez `list_browser_targets`, `inspect_web_page` (DOM e acessibilidade) e `capture_web_screenshot` **passivos** na aba. Eu só colei um JSON de teste e cliquei em "JSON Viewer" (o `capture_browser_scenario` falhou de novo no provedor Playwright do REA, então as ações foram manuais). Passar o mouse num valor também foi manual; só há o screenshot, sem captura de rede.
- O que foi **observado** (bundle ou página ao vivo) está dito como tal; o que é inferência vem marcado.

### Observado na página ao vivo (JSON de teste colado)

| Entrada | Resultado na árvore (modo `view`) |
|---|---|
| `"site":"https://example.com/pagina"` | Link sublinhado (célula `site : https://...`). |
| `"logo":"https://www.google.com/.../googlelogo...png"` | Link; ao passar o mouse, balão grande com a imagem (o logo do Google, bem maior que a linha, cobrindo parte da árvore). |
| `"#ff8800"`, `"rgb(10,120,200)"`, `"red"` | Quadradinho colorido antes do valor, nos três. |
| `"orange juice"` | **Sem** quadradinho: a string inteira precisa ser uma cor válida (corrige minha inferência anterior; o problema real é um valor `"red"`, `"tan"` ou `"orange"` sozinho). |
| `"C:/Users/x/foto.png"` | Texto comum: caminho local não vira link nem imagem. |
| `12345678901234567890` | Mostrado como **`12345678901234567000`** na árvore (o editor de código à esquerda mantém o original). Perda de dígitos observada. |
| `1730000000` | Número comum, sem data. |
| Estrutura | Tudo vem **expandido** de início. Cabeçalhos `object {12}`, `lista [2]`, índices `0 {2}`, e `(vazio array)` / `(vazio object)` para coleções vazias. |
| Barra do topo da árvore | Expandir tudo, recolher tudo, ordenar, filtrar/transformar, seletor de modo, **caixa de busca** com anterior/próximo, e uma **linha de caminho** ("Selecione um nódulo...") que mostra o caminho do nó selecionado. |

### Arquitetura

O viewer **não é código próprio do site**: é o [JSONEditor](https://github.com/josdejong/jsoneditor) (modos `code`, `form`, `text`, `tree`, `view`) empacotado junto com Ace (editor de entrada), `jsonlint` (validação), tippy.js (tooltips) e jQuery. O site só cola botões em volta.

| Peça | Como é feita (observado) |
|---|---|
| Entrada | `JSONEditor` em `mode:"code"` (Ace). Saída: outro `JSONEditor` com `modes:["code","form","text","tree","view"]`. |
| Formatar | `JSON.stringify($.parseJSON(texto), null, indent)`; `indent` vem do `<select id=sel1>`. Erro de parse cai em `validateJSON()`. |
| Minificar | `JSON.stringify(valor, null, 0)`. |
| Validar | `jsonlint.parse(texto)`; mensagem "VALID JSON" ou erro com linha. |
| Carregar por URL | POST para um proxy do próprio site (`//codebeautify.com/URLService`), porque o navegador esbarra em CORS. |
| Expandir/recolher | Árvore do JSONEditor: clique no nó; Ctrl+clique expande/recolhe com todos os filhos; "expandir tudo"/"recolher tudo". |
| Listas grandes | `maxVisibleChilds` (padrão **100**, `F=100`): mostra 100 filhos e um "mostrar mais" (`displaying X of Y items`). |
| URL clicável | `isUrl(v)` = `/^https?:\/\/\S+$/` sobre strings. Em valor não editável (modo `view`) vira `<a href>`. |
| Preview de imagem | **Customização do site** sobre o JSONEditor: para todo valor que casa `isUrl`, um tooltip (tippy) com `<img src="valor" width=200>` à direita, ao passar o mouse. **Não olha a extensão**: URL que não é imagem mostra imagem quebrada. Só funciona com URL (uma página web não lê caminho local). |
| Cor visível | `isValidColor(v)`: atribui a string a `div.style.color` e vê se o navegador aceitou (aceita nome CSS, `#hex`, `rgb()`, `hsl()`). Se sim, desenha um quadradinho (`div.jsoneditor-color`) antes do valor; com `colorPicker` ligado, clicar abre o seletor. Observado: `"red"` ganha quadradinho, `"orange juice"` não; só vale quando a string **inteira** é uma cor, então um valor como `"red"` ou `"tan"` sozinho também acende. |
| Data/hora | `isTimestamp` existe no JSONEditor (tooltip com a data para números que parecem timestamp). |
| Outras ferramentas | JSON → CSV/TSV/XML/YAML/Java e "JSON graph" (abre outra página). Fora do escopo. |

### Problemas do que eles fazem (não copiar)

- `JSON.stringify(JSON.parse(x))` **altera o conteúdo**: inteiros acima de 2^53 perdem dígitos (observado na árvore: `12345678901234567890` virou `12345678901234567000`), e, pelo código, `1.0` vira `1`, `1e400` vira `null` e chaves duplicadas somem (esses três não foram testados ao vivo). Para o Fullpad ("nunca perde texto") isso é inaceitável.
- Toda URL dispara request de imagem ao passar o mouse, mesmo sem ser imagem, vazando que o documento foi aberto.
- Detecção de cor por nome acende palavras comuns.

## 2. Como fazemos no Fullpad

### Princípios

- O documento continua **texto puro**. A árvore é só visualização (como o DBML); editar é no código.
- Lógica no **Rust** (`crates/core`): parser, formatação, validação, classificação de valores. A UI só desenha.
- Uso no padrão do app: **menu superior e botão direito**, sem botões na tela; aba de linguagem "JSON", visão lado a lado igual ao DBML (Ctrl+E liga/desliga, "em janela separada" funciona).
- Carga sob demanda: nada de `json/` importado estaticamente por `main.ts` (mesma regra do `dbml/`).

### Núcleo Rust (`crates/core/src/json.rs`)

Parser **próprio** (pequeno, iterativo, sem recursão ilimitada), não `serde_json::Value`: precisamos de posição de cada nó, números como texto original e chaves duplicadas.

- `parse(text, Opções{lenient}) -> Result<Doc, JsonError>`; `Doc` é uma lista plana de nós: `{ pai, tipo, chave, de, ate, filhos, texto_curto, dica }`.
- **Posições em UTF-16** (unidades do CodeMirror), calculadas durante a varredura. Bytes do Rust não servem: acento e emoji desalinham o destaque.
- Erros com `linha`, `coluna`, `de`, `ate` e mensagem em português (para o sublinhado e a barra de status).
- `format(text, Indent{Espacos(n)|Tab}, ordenar_chaves) -> String`: reemite a partir da árvore copiando o texto original dos escalares. Preserva `12345678901234567890`, `1.0`, `1e400`, escapes `é` e chaves duplicadas.
- `minify(text) -> String`; `format_range` para formatar só a seleção quando ela é um JSON válido.
- **Dica de valor** (`dica`) para strings, decidida no Rust:
  - `url`: `http://` ou `https://` sem espaço (mesma regra do jsonformatter) e `mailto:`.
  - `imagem`: URL cuja extensão é de imagem (`png jpg jpeg gif webp svg avif bmp ico`), `data:image/...;base64,` ou caminho local (`file://`, absoluto, ou relativo à pasta do arquivo da aba) com essa extensão.
  - `cor`: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()`, `hsl()/hsla()`. Nome CSS **não** entra por padrão (decisão 3 abaixo).
  - `data`: número inteiro de 10 ou 13 dígitos em chave com cara de tempo (`*_at`, `time`, `date`, `timestamp`) ou string ISO 8601. Opcional.
- Comandos IPC novos (`crates/app`): `json_parse`, `json_format`, `json_minify`, `json_preview_image` (lê o arquivo local para um data URL, só extensões de imagem e até um tamanho máximo, **sem** abrir o protocolo de arquivos para o disco todo) e `open_url` (só `http`, `https` e `mailto`, pelo plugin `tauri-plugin-opener`).
- Limites: acima de 300 mil nós o documento ainda é validado e formatado, mas a árvore não é montada (aviso no painel); acima de 8 milhões de caracteres a visão desliga (como `MAX_DIAGRAM_CHARS`); o editor continua normal. Decisão: árvore **sem estado no Rust** (o IPC leva todos os nós de uma vez); carga preguiçosa por nó fica para depois, se o limite incomodar.

### UI (`ui/src/json/`, carregada sob demanda)

- `Lang` ganha `"json"` (`.json`, `.jsonc`, `.geojson`, `.webmanifest` e escolha manual em Linguagem). `Language::Json` no core, com o `#[serde(other)]` de sempre.
- **Editor:** `@codemirror/lang-json` (já no projeto, usado nos blocos do markdown) como linguagem principal, dobrar blocos, sublinhado de erro vindo do Rust, e o mesmo mecanismo `hintLines` do DBML.
- **Árvore (painel):** lista virtualizada (só desenha as linhas visíveis), então um arquivo de 10 MB abre sem montar milhões de nós. Estado de expansão guardado por id de nó. Abre expandido até o nível 2. Recolhido mostra `{…} 5 chaves` / `[…] 120 itens`. Chave e valor coloridos por tipo, tema claro/escuro. Ctrl+clique no triângulo expande o nó com todos os filhos.
- **Valores ricos:**
  - URL: texto sublinhado; Ctrl+clique (ou clique, já que a árvore é só leitura) abre no navegador do sistema via `open_url`.
  - Cor: quadradinho antes do valor; o texto não é alterado.
  - Miniatura com tamanho máximo (ex.: 240×180 px) e posicionada para não cobrir o nó sob o mouse; o balão do jsonformatter cobre a árvore.
  - Números inteiros grandes aparecem **exatamente como estão no texto**, sem passar por `f64`.
  - Barra de status: mostra o caminho do nó sob o cursor (`$.lista[0].tags[1]`), no lugar da linha de caminho do site; sem botão novo na tela.
  - Imagem: ao passar o mouse com pequeno atraso, balão com a miniatura (URL remota ou arquivo local via `json_preview_image`). Imagem quebrada mostra "não carregou", sem ícone feio.
  - Remota só carrega ao passar o mouse e só se a dica for `imagem` (decisão 2).
- **Menu superior "JSON"** (só habilitado com linguagem JSON): Formatar `Alt+Shift+F`, Minificar, Ordenar chaves (A→Z) e formatar, Indentação ▸ (2 / 4 / Tab; lembrada), Expandir tudo, Recolher tudo, Copiar caminho do cursor. Formatar é uma única transação do CodeMirror: **Ctrl+Z desfaz**.
- **Botão direito:**
  - No código: Formatar documento / Formatar seleção, Minificar, mais Recortar/Copiar/Colar próprios (como o markdown).
  - No nó da árvore: Copiar caminho (`$.itens[0].nome`), Copiar chave, Copiar valor (formatado se for objeto), Expandir/Recolher este nó, Expandir tudo abaixo, Ir para a linha no código, e conforme o valor: Abrir link, Copiar link, Abrir imagem, Copiar cor.
  - Na aba: nada novo.
- **Ligação código ↔ árvore** (igual ao diagrama do DBML): passar o mouse num nó pinta o trecho no código (`hintLines`, sem selecionar); o cursor do editor revela e destaca o nó na árvore (expande os pais e rola até ele, busca binária pelo intervalo). Só vale se a árvore é da mesma versão do texto (`docRev`), senão os trechos apontariam para o lugar errado.

## 3. Decisões (seguiu-se o padrão sugerido; dá para mudar na PARADA 9)

1. **Detecção automática de JSON em nota avulsa** (só por extensão e escolha manual; detecção por conteúdo fica para depois, como no DBML).
2. **Imagem remota ao passar o mouse** (sim, só com extensão de imagem; o jsonformatter faz para qualquer URL).
3. **Cores por nome CSS** como `red` (não; só hex, `rgb()` e `hsl()`).
4. **JSONC** (comentários e vírgula sobrando): a análise é **sempre tolerante** (vale também para `.json` como `tsconfig.json`, que costuma ter comentários); **formatar** recusa quando há comentários, para não apagá-los.
5. **Editar valores na árvore** (não: só visualização, igual ao DBML).
