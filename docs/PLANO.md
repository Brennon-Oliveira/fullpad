# Plano de implementação

Cada fase termina em uma **PARADA**: um ponto em que o app está usável e eu espero sua análise e testes antes de seguir. Os critérios de aceite dizem o que checar.

Legenda: ✅ feito · ⬜ pendente

## Fase 0 — Esqueleto (entregue)

- ✅ Workspace cargo (`core` + `app`) e UI Vite/TS
- ✅ `core`: modelo, `Store`, escrita atômica, sessão tolerante a corrupção, lixeira. 6 testes
- ✅ `app`: comandos IPC, single-instance, janela que só aparece quando a UI está pronta
- ✅ UI: abas, CodeMirror (markdown em modo código), autosave 400 ms, flush ao perder foco/fechar, restauração de aba ativa, cursor e scroll
- ⬜ **Ainda não compilado/rodado** o crate `app` (ver "Pendências de ambiente")

**PARADA 0:** rodar `tauri dev` no Windows e validar o checklist da Fase 1.

## Fase 1 — MVP "nunca perde nada"

| Milestone | Entrega | Critério de aceite |
|---|---|---|
| 1.1 | App abre, digita, autosave | Digitar, matar o processo (Gerenciador de Tarefas) e reabrir: o texto está lá |
| 1.2 | Abas | Ctrl+T, Ctrl+W, Ctrl+Tab, clique do meio fecha; fechar a última cria uma nova |
| 1.3 | Sessão completa | Reabrir restaura aba ativa, cursor e scroll de cada aba |
| 1.4 | Robustez | `session.json` corrompido não impede abrir; nota fechada vai para `trash/` |
| 1.5 | Single instance e start rápido | Abrir 2x reaproveita a janela; medir tempo até a janela aparecer (meta: < 500 ms) |
| 1.6 | Atalhos e polimento | Reordenar abas por arrastar, menu de contexto da aba, restaurar aba fechada (Ctrl+Shift+T) a partir de `trash/` |

**PARADA 1:** você usa o app como bloco de notas por alguns dias. Quero saber: tempo de abertura, qualquer perda de texto, incômodos nas abas.

## Fase 2 — Markdown renderizado (live preview)

| Milestone | Entrega | Critério de aceite |
|---|---|---|
| 2.1 | Toggle renderizado/código por aba (botão + Ctrl+E), salvo na sessão | Alternar não altera o texto nem o undo |
| 2.2 | Decorations: títulos, negrito/itálico/código inline, esconder marcadores fora da linha do cursor | Cursor na linha mostra a sintaxe; fora dela, renderizado |
| 2.3 | Listas, checkboxes clicáveis, citações, links, linha horizontal | Clicar no checkbox alterna `[ ]`/`[x]` no texto |
| 2.4 | Blocos de código com highlight por linguagem | Linguagens comuns coloridas, sem travar |
| 2.5 | Tabelas e imagens (caminho relativo e URL) | Tabela renderizada, editável célula a célula pela linha-fonte |
| 2.6 | Tema claro/escuro seguindo o SO, fonte configurável | Segue o tema do Windows |

Regra: o documento é sempre texto puro; renderizar nunca reescreve o conteúdo. Desligar decorations em arquivos grandes (> ~2 MB).

**PARADA 2:** você escreve notas reais em markdown. Quero saber: o que parece estranho ao editar, o que falta renderizar.

## Fase 3 — Arquivos reais

| Milestone | Entrega | Critério de aceite |
|---|---|---|
| 3.1 | Abrir arquivo (Ctrl+O, arrastar, argumento de linha de comando) | Abre `.md`/`.txt`; segunda instância repassa o arquivo à janela existente |
| 3.2 | Salvar / Salvar como (Ctrl+S) e converter nota avulsa em arquivo | Ctrl+S grava no caminho; avulsa nunca pergunta nada |
| 3.3 | Buffer sombra | Editar arquivo real sem salvar, fechar e reabrir: edição volta, arquivo em disco intocado |
| 3.4 | Encoding e quebras de linha | UTF-8, UTF-8 BOM e CP1252 detectados; CRLF/LF preservados ao salvar |
| 3.5 | Mudança externa | Arquivo alterado fora do app: aviso para recarregar ou manter |
| 3.6 | Instalador, associação e atualização | NSIS com opções: abrir `.md`/`.dbml` por padrão e "Abrir com" nos arquivos de texto; atualização automática pelos Releases públicos |

**PARADA 3:** testar com seus arquivos reais, incluindo acentuação, CRLF e arquivos que outro programa edita.

## Fase 4 — Conforto

| Milestone | Entrega | Critério de aceite |
|---|---|---|
| 4.1 | Busca no arquivo (Ctrl+F) e substituir | Já vem do CodeMirror; só ajustar visual |
| 4.2 | Busca em todas as notas (Ctrl+Shift+F) | Resultados clicáveis que abrem a aba na posição |
| 4.3 | Atalho global + bandeja | Atalho abre/foca a janela com nota nova; fechar a janela pode manter na bandeja (opção) |
| 4.4 | Lista/histórico de notas fechadas | Recuperar nota de `trash/` pela UI |
| 4.5 | Configurações | Arquivo `settings.json`: tema, fonte, atalho global, comportamento da bandeja |

**PARADA 4:** versão 1.0. Revisamos o que sobrou e decidimos o que entra depois (sync, exportar HTML/PDF, SQLite+FTS).

## Fase 5 — Diagrama DBML (somente visualização)

Arquivos `.dbml`/`.dbmlx` (ou nota avulsa com a linguagem "DBML" escolhida no menu) ganham um painel de diagrama ao lado do texto, no estilo da extensão [dbmlx](https://github.com/myzenon/dbmlx). Escopo fechado: só ver o esquema. Sem arrastar tabelas e sem arquivo de layout (`.layout.json`), sem `!include`, `DiagramView` ou anotações de migração.

| Milestone | Entrega | Critério de aceite |
|---|---|---|
| 5.A | Spike: parser no navegador e custo de bundle | ✅ `@dbml/parse` (442 kB, 110 kB gzip na v11) + `@dagrejs/dagre` (47 kB); o `@dbml/core` (15,7 MB) foi descartado. Começou na 3.9.0 e subiu para a v11 ao aparecer esquema com `?>` (a 3.9 dá "Unexpected token '?'") |
| 5.B | Linguagem DBML (`Language::Dbml`), parse, layout automático, SVG, pan/zoom, erro de sintaxe sem perder o último diagrama | Abrir `.dbml` mostra o painel; digitar atualiza em ~300 ms; Ctrl+E liga/desliga sem mexer no texto |
| 5.C | Carga sob demanda | O boot não baixa parser nem dagre; só ao pedir o diagrama (chunks separados) |

**PARADA 5:** você abre esquemas DBML reais. Quero saber: o que fica estranho no layout, o que falta mostrar (notas, enums, grupos, índices), esquemas grandes.

Fica para depois: arrastar tabelas e persistir posições (decidir onde guardar o layout de nota avulsa), TableGroups, hover de coluna/aresta, exportar SVG/PNG, roteamento ortogonal elaborado, autocomplete/diagnóstico no editor, `!include`/`DiagramView`/migrações.

## Fase 6 — Diagrama DBML: conforto (Fase D)

Continuação da Fase 5, ainda só visualização.

| Milestone | Entrega | Critério de aceite |
|---|---|---|
| 6.1 | ✅ Enums como caixas ligadas por linha tracejada à coluna que os usa, notas como tooltip, `headercolor` nas tabelas | Enum aparece ligado à coluna; cor clara ganha texto escuro |
| 6.2 | ✅ TableGroups como molduras coloridas (clusters do dagre) | Tabelas do grupo ficam dentro da moldura, com o nome do grupo |
| 6.3 | ✅ Hover em coluna/aresta destaca a relação | Passar o mouse numa coluna ilumina as arestas e as colunas do outro lado |
| 6.4 | ✅ Exportar SVG e PNG | Botões no painel; salva pelo diálogo do sistema, com escrita atômica |
| 6.6 | ✅ Diagnóstico no editor: sublinhado de erros de sintaxe e semânticos (coluna que não existe, tabela duplicada...) com correções sugeridas, usando o `DBMLDiagnosticsProvider` do parser sobre um compilador compartilhado (`ui/src/dbml/service.ts`) | Erro aparece sublinhado no texto com a mensagem no hover, mesmo com o diagrama fechado |
| 6.7 | ✅ Autocomplete no editor: tipos de coluna, configurações `[...]`, tabelas e colunas em `Ref` (inclusive após `tabela.`), blocos do topo e do corpo da tabela, com snippets. Usa o `DBMLCompletionItemProvider` do parser através de um adaptador mínimo | Digitar `id ` sugere tipos; `[` sugere `pk`, `not null`...; `Ref: a.` sugere as colunas de `a`; Ctrl+Espaço força |
| 6.8 | ✅ Destaque do markdown no modo código (títulos, listas, código inline, links, citações, marcadores) e dos blocos de código por linguagem (js/ts, json, sql, python, css, html, rust, yaml, shell, dbml), carregadas sob demanda (`ui/src/codelangs.ts`). Vale também no preview renderizado (cores dos tokens dentro dos blocos) | Abrir um `.md` com um bloco ```` ```json ```` mostra o JSON colorido; no modo código os marcadores `#`, `-`, `**` ganham cor |
| 6.5 | ✅ Destaque de sintaxe do DBML no editor (`ui/src/dbmllang.ts`) | Palavras-chave, nomes, tipos, configurações `[...]`, relações (`>`, `?>`...), strings e comentários coloridos; tema claro e escuro |

Fica para depois: roteamento ortogonal elaborado (sem cruzar tabelas), arrastar tabelas com layout salvo, `!include`/`DiagramView`/migrações.

## Fase 7 — Janelas, visões e ligação código ↔ diagrama

- ✅ 7.1 Abre maximizada.
- ✅ 7.2 DBML fecha `(`, `[`, `{` e aspas sozinho; Enter entre chaves recua.
- ✅ 7.3 Passar o mouse no diagrama pinta a linha no código; o cursor do editor destaca o elemento no diagrama (só quando o diagrama é da mesma versão do texto).
- ✅ 7.4 Markdown renderizado ao lado do código (Ctrl+Shift+E), como o DBML; botão "Visão" na barra de status.
- ✅ 7.5 Várias janelas: tirar aba arrastando, reordenar, mover entre janelas, voltar para a principal, várias abas por janela; janelas reabertas no mesmo lugar.
- ✅ 7.6 Preview/diagrama numa janela separada, ligado à mesma aba.

## Fase 8 — Grade de painéis, abas fechadas e exportação

- ✅ 8.1 Reabrir aba fechada (Ctrl+Shift+T e lista no menu Arquivo): a lixeira guarda também o estado da aba.
- ✅ 8.2 Exportar markdown como HTML, como PDF (impressão do sistema) e copiar como HTML formatado.
- ✅ 8.3 Grade de painéis dentro da janela, como no VS Code: dividir à direita/abaixo/esquerda/acima (Ctrl+\, Ctrl+Shift+\, menu da aba), redimensionar pelos divisores, arrastar a aba para uma borda (divide) ou para a barra de outro painel (move, na posição exata), Ctrl+1…9 foca o painel, painel sem abas some. A grade é gravada por janela e restaurada.

- ✅ 8.4 Aba de outra janela solta direto na grade (barra ou borda de painel; o meio vira janela própria); o preview é parte do painel; histórico de abas fechadas numa janelinha com filtro.
- ✅ 8.5 Alvos visíveis ao arrastar uma aba (retângulos translúcidos em cada lugar possível: borda do painel, bloco inteiro da pilha, centro de outro painel), no lugar das faixas invisíveis de 28%.

Fica para depois: mover aba entre janelas com o histórico de desfazer; duas visões da mesma aba em painéis diferentes.

## Fase 9 — JSON viewer e formatação

Arquivos `.json` (ou nota avulsa com a linguagem "JSON") ganham uma árvore ao lado do texto, no estilo do jsonformatter.org/json-viewer, e formatação feita no Rust. Pesquisa e desenho em [json-viewer.md](json-viewer.md). Só visualização: o texto continua sendo a única fonte.

| Milestone | Entrega | Critério de aceite |
|---|---|---|
| ✅ 9.A | Núcleo Rust (`crates/core/src/json.rs`): parser com posições em UTF-16, erros com linha/coluna, `format`/`minify`/ordenar chaves, dica de valor (url, imagem, cor) | `cargo test -p fullpad-core`: inteiro gigante, `1.0` e `1e400` preservados; chaves duplicadas mantidas; acento/emoji com posição certa; BOM; 8 MB (cerca de 800 mil nós) em poucos segundos mesmo em build de depuração; aninhamento muito fundo não estoura a pilha |
| ✅ 9.B | Linguagem JSON (`Language::Json`, `Lang "json"`), extensões, menu Linguagem, destaque, dobrar blocos, erro sublinhado, filtros de abrir/salvar | Abrir `.json` mostra cores e dobra; erro de sintaxe aparece sublinhado com a mensagem; salvar preserva encoding e CRLF |
| ✅ 9.C | Árvore ao lado do código (lista virtualizada, carga sob demanda, Ctrl+E, janela separada), expandir/recolher, contagens, Ctrl+clique expande filhos | Árvore de até 300 mil nós, virtualizada (acima disso aviso e só o texto); o boot não baixa nada de `json/`; recolher/expandir tudo; a árvore continua no último estado válido durante um erro de sintaxe |
| ✅ 9.D | Formatar pelo menu superior "JSON" e pelo botão direito (código e árvore): formatar, minificar, ordenar chaves, indentação, formatar seleção, copiar caminho/valor | Formatar é um passo no Ctrl+Z; nenhum botão novo na tela; o texto formatado é igual ao original em tudo que não é espaço |
| ✅ 9.E | Valores ricos: URL clicável (navegador do sistema), quadradinho de cor, miniatura de imagem ao passar o mouse (URL ou arquivo local) | Ctrl+clique em URL abre o navegador; `"#ff8800"` mostra a cor; imagem local relativa ao arquivo aparece; imagem quebrada mostra aviso discreto; só `http`, `https` e `mailto` abrem |
| ✅ 9.F | Ligação código ↔ árvore (passar o mouse mostra a linha; cursor destaca o nó) | Igual ao diagrama do DBML, inclusive a regra da mesma versão do texto (`docRev`) |
| ✅ 9.G | Docs (`AGENTS.md`), nota de versão, build de Windows | `docs/` atualizados no mesmo commit; build de Windows reportado |

**PARADA 9:** você abre JSONs reais (grandes, com URLs, imagens e cores). Quero saber: o que fica estranho na árvore, o que falta no menu de formatar, desempenho.

Fica para depois: editar valor na árvore, busca/filtro na árvore (o jsonformatter tem uma caixa de busca com anterior/próximo; aqui o Ctrl+F do editor já cobre o texto), conversão para CSV/YAML/XML, JSON Schema, consulta JMESPath/JSONPath, detecção automática de JSON em nota avulsa, formatar JSONC preservando comentários.

## Fase 10 — Leitor de PDF e EPUB (só leitura)

O desenho e as defesas ficam em `docs/AGENTS.md` (abas de leitura). O app abre e abre arquivos tão rápido quanto antes: nada de PDF/EPUB pesa no boot, e a aba só lê o arquivo depois do clique em "Carregar".

| Milestone | Entrega | Critério de aceite |
|---|---|---|
| ✅ 10.1 | Aba de leitura (`TabKind`, `reader.rs`, comandos `open_reader`/`reader_info`/`reader_read`/`reader_relocate`, nunca grava, `unknown` seguro) | `cargo test -p fullpad-core`: abrir não lê o arquivo, `save_file` recusa, sessão com `kind` desconhecido não corrompe, fechar e reabrir mantém tipo e posição |
| ✅ 10.2 | Botão "Carregar", arquivo ausente ("Localizar arquivo…") e alterado (faixa "Recarregar"), posição na sessão | Abrir um PDF não faz nenhuma leitura; reiniciar o app volta ao botão; apagar o arquivo troca o botão por "Localizar arquivo…" |
| ✅ 10.3 | PDF com pdf.js por faixas (páginas virtualizadas, texto selecionável, links seguros, zoom próprio, página X de Y), endurecido contra bombas | Amostras maliciosas em `scratchpad` abrem sem travar o app; `source.test.ts` roda o pdf.js de verdade |
| ✅ 10.4a | Posição de leitura por arquivo (identidade do conteúdo, sobrevive a mover o arquivo e a fechar a aba) | `cargo test -p fullpad-core`: mesma identidade para cópia/renomeação, outra ao editar, registro corrompido tolerado, só as 2000 mais recentes |
| ✅ 10.4b | Copiar a seleção como citação em markdown (menu de contexto, menu PDF e Ctrl+Shift+C) | Selecionar um trecho e colar numa nota dá `> trecho` e `> — *Livro*, p. 42`; quebras de linha do PDF não viram parágrafos |
| ✅ 10.5 | EPUB: leitor em Rust (`epub.rs`), capítulo limpo pelo `ammonia`, CSS por lista de permissão (`css.rs`), sumário lateral, iframe sem scripts, posição de leitura | PARADA 3: abrir EPUBs reais e as amostras maliciosas; nenhum script roda, o app não trava e nada vai à rede |
| ✅ 10.6a | Citação no EPUB (menu, botão direito e Ctrl+Shift+C de dentro do livro) | Selecionar um trecho do livro e colar numa nota dá `> trecho` e `> — *Título*, cap. 3 (Nome)` |
| ✅ 10.6b | Busca no documento (PDF e EPUB): Ctrl+F, sem maiúscula nem acento, resultado anterior/próximo, realce | PARADA 4 |


As quatro PARADAs da fase (base e PDF, integração com as notas, EPUB, busca e citação no EPUB) foram validadas.

Fica para depois: links internos do PDF (sumário clicável, "ver página 12"), tema escuro do documento do PDF, lista de resultados da busca; EPUB com paginação e rolagem contínua entre capítulos, opção "usar o estilo do livro" (hoje o CSS é filtrado: sem fontes nem imagens de fundo) e capas em SVG; testar no Linux (WebKitGTK); associar `.pdf`/`.epub` no instalador; assinatura de código do instalador e do executável (o Smart App Control e o SmartScreen barram o que não é assinado). As ideias [referência com volta](banco-de-ideias/referencia-com-volta.md) e [nota ao lado do leitor](banco-de-ideias/nota-ao-lado-do-leitor.md) estão no banco de ideias.

## Fase 11 — Visão de CSV (tabela editável)

Arquivos `.csv`/`.tsv` (ou a linguagem "CSV" no menu) ganham uma tabela, no molde do markdown: três visões, a padrão é **só a tabela editável**. O texto continua sendo a única fonte: editar uma célula reescreve só o trecho dela. Desenho, decisões e escopo em [csv.md](banco-de-ideias/csv.md). Fórmulas ficam de fora.

| Milestone | Entrega | Critério de aceite |
|---|---|---|
| ✅ 11.A | Núcleo Rust (`crates/core/src/csv.rs`): parser RFC 4180 com posições em UTF-16, índice de linhas para ler por faixas, detecção do separador, tipo por coluna e estatísticas (soma, média, mín., máx., contagem) com separador decimal escolhido (ponto por padrão, vírgula opcional), escritor de célula que preserva o resto | `cargo test -p fullpad-core`: aspas, separador e quebra de linha dentro da célula, `""`, CRLF e LF misturados, BOM, acento e emoji com posição certa, linha com colunas a mais/a menos, arquivo sem quebra no fim; editar uma célula não muda nenhum outro byte; detecção em amostras `,` `;` tab `\|` e ambíguas; decimal com ponto (padrão) e com vírgula (escolhido); valor não numérico fora da conta e contado; arquivo grande em poucos segundos |
| ✅ 11.B | `Language::Csv`, extensões, menu Linguagem, colorir colunas no código, campo por aba (separador manual, cabeçalho e separador decimal) na sessão, menu "CSV" | Abrir `.csv` mostra colunas coloridas; escolher o separador na mão sobrevive a reiniciar e nunca é redetectado; sessão antiga sem o campo abre normal |
| ✅ 11.C | Tabela somente leitura (virtualizada por faixas), três visões (padrão: tabela), cabeçalho congelado, colunas redimensionáveis, ordenar/filtrar na visão, ligação código ↔ tabela, rodapé de estatísticas | **PARADA 11.1**: abrir CSVs reais (grandes, `;`, vírgula decimal, aspas com quebra de linha); a tabela nunca altera o texto |
| ✅ 11.D | Editar célula na tabela (uma transação, um passo no Ctrl+Z) | **PARADA 11.2**: editar e salvar; `git diff`-style: só a célula muda; Ctrl+Z desfaz |
| ✅ 11.E | Adicionar/remover linha e coluna, reordenar colunas, "ordenar o arquivo" (ação explícita) | **PARADA 11.3** |
| ✅ 11.F | Docs (`AGENTS.md`), nota de versão, build de Windows | `docs/` atualizados no mesmo commit; ideia marcada como feita; build de Windows reportado |

Fica para depois: fórmulas, tipos de coluna editáveis (datas com seletor), exportar a tabela (markdown, JSON), altura de linha guardada pela linha do arquivo (hoje pela posição na tela), atalhos de teclado para inserir/apagar linha e coluna, teste de arquivos de dezenas de MB (um CSV grande de teste é gerado para isso).

## Pendências de ambiente

- O WSL desta máquina não tem `pkg-config` nem `libwebkit2gtk-4.1-dev`, então o crate `app` não compila nativamente aqui. O `.exe` de Windows sai por cross-compile com `cargo-xwin` (veja `docs/rules/build-windows.md`); o app em si só foi executado no Windows do usuário.
- Ícone do app: o SVG é `crates/app/icons/fullpad.svg` (folha com canto dobrado e cursor de texto em "I"); para regerar os PNG/ICO/ICNS, `cd crates/app && cargo tauri icon icons/fullpad.svg -o /tmp/novos` e copie por cima só os arquivos que já existem em `icons/` (sem as pastas `android`/`ios`). Os ícones provisórios antigos (quadrado azul) ficam em `crates/app/icons/original/`.
