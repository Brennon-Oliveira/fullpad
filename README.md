# Fullpad

Editor de notas e markdown **rápido**, no estilo do Notepad++: **nada se perde ao fechar**. O markdown é renderizado e continua editável (*live preview*), e cada tipo de arquivo ganha a visão que faz sentido para ele: tabela para CSV, árvore para JSON/YAML/TOML, diagrama para DBML e Mermaid, equações para LaTeX, leitor para PDF e EPUB. E **arquivos de texto gigantes** (um CSV de 15 GB, um log de centenas de MB) abrem na hora, se editam e se salvam sem travar. Feito com Rust, Tauri 2 e CodeMirror 6.

![Paleta de comandos do Fullpad: todos os itens dos menus, com atalho, achados por busca aproximada](docs/img/paleta.gif)

## Sumário

- [Por que o Fullpad](#por-que-o-fullpad)
- [Cada tipo de arquivo, a sua visão](#cada-tipo-de-arquivo-a-sua-visão)
- [Todos os recursos](#todos-os-recursos)
- [Instalar](#instalar)
- [Compilar e desenvolver](#compilar-e-desenvolver)
- [Estrutura](#estrutura)
- [Contribuir](#contribuir)
- [Licença](#licença)

## Por que o Fullpad

- **Abre arquivo gigante na hora.** Um CSV de 15 GB ou um log de centenas de MB abre sem ser lido por inteiro, rola, vai à linha, busca no disco, edita (com desfazer em tudo) e salva rápido, sem travar o app nem gastar a memória da máquina.
- **Nada se perde.** O texto de cada aba é guardado enquanto você digita; fechar o app, uma queda de energia ou fechar uma aba sem querer não leva nada. Abas, janelas, painéis, posição do cursor e do leitor voltam como estavam.
- **Abre rápido e fica leve.** Bibliotecas pesadas (Mermaid, KaTeX, pdf.js, o compilador de DBML) só são carregadas quando o primeiro arquivo que precisa delas aparece.
- **O texto é sempre texto puro.** Renderizar markdown, mostrar uma tabela ou um diagrama nunca reescreve o seu arquivo: a visão é uma máscara sobre o documento.
- **Seus arquivos estão seguros.** Toda gravação é atômica, preserva codificação e quebras de linha, e nunca sobrescreve uma mudança feita por outro programa sem perguntar.
- **Abre arquivo de qualquer origem sem susto.** PDF, EPUB e Markdown abrem sem executar scripts e sem acessar a rede.

## Cada tipo de arquivo, a sua visão

| Tipo | O que você vê |
|---|---|
| **Markdown** (`.md`) | Texto renderizado e editável no próprio lugar, barra de formatação sobre a seleção, tabelas editáveis na grade, equações, diagramas Mermaid, sumário lateral, exportar HTML/PDF |
| **CSV / TSV** | Tabela com ordenação, filtro, estatísticas da seleção e edição de célula, ligada ao código. Em arquivos de **dezenas de GB**, a mesma tabela, editável, abrindo na hora |
| **Texto gigante** (`.txt`, `.log`, `.md`, `.json` e outros, acima de 20 MB) | Abre sem ler o arquivo inteiro: rolagem do arquivo todo, ir para a linha, busca no disco, edição com desfazer e salvar rápido |
| **JSON** (`.json`, `.jsonc`, `.geojson`) | Árvore ao lado do código, formatar/minificar, links, cores e miniaturas de imagem |
| **YAML / TOML** | Árvore ao lado do código, com validação |
| **DBML** | Diagrama das tabelas e relações ao lado do código, com zoom e exportar SVG/PNG |
| **Mermaid** (`.mmd`) | Diagrama ao lado do código, com zoom e exportar SVG |
| **LaTeX** (`.tex`) | As equações soltas do arquivo, uma por cartão, ligadas ao código |
| **PDF** | Leitor com zoom, busca, citação em markdown e posição de leitura lembrada |
| **EPUB** | Leitor com sumário, capítulo limpo, busca e citação |
| **Código** (Python, Rust, SQL, JS/TS, Shell, C#, Go...) | Destaque de sintaxe para dezenas de linguagens |

### Markdown, o carro-chefe

O markdown é renderizado no próprio texto: você edita o que está vendo. Selecione um trecho e a barra de formatação aparece sobre ele (tipo de bloco, negrito, itálico, tachado, código, equação, link, limpar). Tabelas, equações `$...$` e `$$...$$` e blocos ` ```mermaid ` viram desenho, e com o cursor sobre eles aparece o código.

**Tabelas editáveis na grade**: a tabela `| a | b |` aparece como tabela de verdade e se edita ali mesmo. Clique numa célula e digite (Enter desce, Tab e setas andam, Shift+Enter quebra a linha dentro da célula); o texto é reescrito sempre alinhado e cada edição é um passo no Ctrl+Z. Ao passar o mouse aparecem botões **+** na borda direita (nova coluna), embaixo (nova linha) e entre linhas e colunas (inserir no meio). O botão direito insere e apaga linhas e colunas, move colunas, alinha (esquerda, centro, direita) e copia a tabela como CSV. **Colar CSV, TSV ou uma planilha vira tabela** na hora (Ctrl+Shift+V cola como texto). O arquivo continua markdown puro.

![Markdown com live preview, tabela, equação, diagrama Mermaid e a barra de formatação](docs/img/markdown.gif)

Alterne entre **só o preview**, **só o código** e **código e preview lado a lado**, e mantenha o **sumário lateral** aberto ou deixe-o como barrinhas na borda. Exporte para **HTML** autônomo, **PDF** (sem o cabeçalho e o rodapé do navegador) ou copie como HTML para colar em outro lugar.

![Visões do markdown e o sumário lateral](docs/img/visoes.gif)

As exportações ficam em Arquivo > Exportar, no menu Markdown e no botão direito sobre o conteúdo:

![Exportar o markdown para HTML ou PDF, ou copiar como HTML](docs/img/exportar.gif)

### Tabelas de verdade: CSV

A tabela carrega só as linhas que estão na tela, então arquivos grandes abrem na hora (e os de **dezenas de GB** têm o modo próprio descrito em [Arquivos gigantes](#arquivos-gigantes)). Clique no cabeçalho para ordenar, filtre por uma coluna ou por todas, selecione células para ver soma, média, mínimo, máximo e contagem no rodapé, edite célula por célula (Ctrl+Z desfaz, como no texto) e cole direto do Excel. O cursor do código e a célula da tabela andam juntos.

![CSV como tabela: ordenar, filtrar, selecionar com estatísticas e ver o código](docs/img/csv.gif)

### Arquivos gigantes

Abra um CSV de **15 GB**, um log, um dump, um Markdown ou um JSON de centenas de MB e comece a trabalhar na hora: o Fullpad **não lê o arquivo inteiro**. Ele fica no disco e só os trechos perto da tela ficam na memória; o índice de linhas sai em segundo plano. Qualquer arquivo de texto acima de 20 MB abre assim, sozinho, e a memória não cresce com o tamanho do arquivo.

![Um CSV de 14,6 GB: o cartão para carregar, "Abrir direto na linha" e a tabela já na linha 120.000, com o índice ainda correndo; editar uma célula e desfazer](docs/img/gigantes.gif)

- **Abrir não carrega.** A aba mostra o nome e o tamanho, e o arquivo só é lido quando você clica em **Carregar arquivo**. Reabrir o app com um arquivo de 15 GB não o lê. **Abrir direto na linha** pergunta o número da linha, carrega e já vai para ela.
- **O arquivo todo ao alcance.** A barra de rolagem representa o arquivo inteiro (arraste ou clique para ir a qualquer ponto), Ctrl+G vai à linha, e Ctrl+F **busca no disco**, em fluxo, com os resultados chegando aos poucos e cancelável. Linhas gigantes (um JSON minificado numa linha só) são cortadas só na tela, sem mexer no arquivo.
- **CSV vira tabela, e dá para editar.** A tabela mostra o trecho carregado, a primeira coluna é a **linha do arquivo**, e você edita célula por célula. Ordenar e filtrar ficam de fora, porque exigiriam o arquivo inteiro.
- **Editar de verdade, com desfazer em tudo.** Ctrl+Z e Ctrl+Y valem no arquivo todo, **inclusive nos trechos que já saíram da tela**: o Fullpad volta até lá, desfaz e mostra onde foi. As alterações ficam guardadas num diário e nada se perde ao fechar o app.
- **Salva rápido, do jeito que o seu arquivo precisa.** Trocou um valor por outro do mesmo tamanho? Ele é gravado **no lugar, na hora**. Mudou o tamanho? Aí o resto do arquivo muda de posição e você escolhe, com os riscos explicados: **salvar com segurança** (monta o arquivo novo ao lado e só troca o original no fim; dá para cancelar) ou **salvar direto** (regrava só do ponto editado em diante, sem espaço extra, sem proteção contra queda). O app recomenda o direto quando você editou perto do fim do arquivo.

![Salvar numa cópia de 300 MB: valor do mesmo tamanho grava no lugar; um valor maior abre a escolha entre salvar com segurança e direto](docs/img/gigantes-salvar.gif)

Texto, log e Markdown grandes abrem **como texto** (com destaque de sintaxe), vão à linha na hora e buscam no disco:

![Um log de 300 MB e um Markdown de 150 MB: ir para a linha 3.000.000, buscar no disco e ir à linha 200.000](docs/img/gigantes-texto.gif)

Arquivos comuns não mudam nada: o modo gigante é um caminho à parte, só para texto claramente grande.

### JSON, YAML e TOML em árvore

A árvore fica ao lado do código; passar o mouse num nó pinta o trecho no código e mover o cursor no código acende o nó. O JSON tem parser próprio (números enormes e chaves repetidas ficam como estão) e formata com um passo no Ctrl+Z.

![JSON, YAML e TOML em árvore ao lado do código](docs/img/dados.gif)

### Diagramas: DBML e Mermaid

![Diagrama DBML ao lado do código, com zoom e arrastar](docs/img/dbml.gif)

![Diagrama Mermaid ao lado do código](docs/img/mermaid.gif)

### Equações: LaTeX

O Fullpad não compila documentos LaTeX: ele mostra **as equações** do arquivo, uma por cartão. Passar o mouse no cartão pinta o trecho no código e clicar leva o cursor até lá.

![Equações de um arquivo .tex, uma por cartão](docs/img/latex.gif)

### Leitura: PDF e EPUB

Abas de leitura **nunca gravam no arquivo**. O PDF e o EPUB abrem sem scripts e sem rede, lembram onde você parou (mesmo que o arquivo mude de lugar), têm busca no documento e "Copiar como citação", que já leva o título e a página ou o capítulo.

![PDF: zoom e busca no documento](docs/img/pdf.gif)

![EPUB: sumário, capítulos e busca](docs/img/epub.gif)

### Painéis e janelas

Divida a janela em painéis, lado a lado ou empilhados, como no VS Code. Ao arrastar uma aba aparecem **alvos visíveis** para soltar: uma borda divide o painel, o centro de outro painel move a aba para lá, e soltar fora da janela cria uma janela nova.

![Arrastar uma aba para dividir a janela em painéis](docs/img/paineis.gif)

Os **alvos azuis** mostram, antes de soltar, onde a aba vai cair: o painel inteiro (para mover a aba para ele), o lado ou a base de um painel (para dividi-lo) e as barras da borda externa (para dividir o bloco todo):

![Alvos de encaixe ao arrastar uma aba: cada área azul mostra onde ela cairia](docs/img/encaixe.gif)

### Achar qualquer coisa

![Busca global em todas as abas abertas](docs/img/busca.gif)

![Destaque de sintaxe de várias linguagens](docs/img/codigo.gif)

## Todos os recursos

### Nada se perde

- Cada aba é guardada **enquanto você digita** e a sessão inteira (abas, janelas, painéis, cursor, visão de cada arquivo) volta ao reabrir o app.
- **Notas soltas**: abas que não pertencem a nenhum arquivo, só ao Fullpad. Fechar uma nota a move para a lixeira em vez de apagar.
- **Reabrir aba fechada**: Ctrl+Shift+T reabre a última; Ctrl+Shift+H abre o **histórico de abas fechadas**, com filtro, trazendo de volta título, arquivo, linguagem e visão.
- **Escrita atômica**: toda gravação passa por um arquivo temporário e uma troca; um travamento no meio nunca corrompe a nota nem o seu arquivo. Uma sessão corrompida não impede o app de abrir (ela é guardada à parte e o app recomeça).

### Arquivos gigantes

- **Modo de lotes** para texto acima de 20 MB: o arquivo fica no disco, **nunca é lido inteiro** e o editor mantém só uma janela de lotes seguidos (até 5.000 linhas ou 2 MB cada). Funciona para `.txt`, `.log`, `.md`, `.json`, `.csv` e os demais tipos de texto; arquivo comum não muda em nada. UTF-16 oferece carregar o arquivo inteiro.
- **Abrir não carrega**: cartão com nome, tipo e tamanho, **Carregar arquivo** e **Abrir direto na linha**. Reabrir o app não lê arquivos de GB. Se o índice ainda não chegou à linha pedida (ou à posição em que você parou), o arquivo abre no começo na hora e vai até a linha em segundo plano; rolar, Ctrl+G ou a barra do arquivo cancelam.
- **Rolagem do arquivo todo** (barra própria), **Ctrl+G** para qualquer linha e **Ctrl+F no disco**, em fluxo, com Aa, palavra inteira e regex, resultados que chegam aos poucos e cancelável. Número de linha da margem é o da linha do arquivo; linhas gigantes são cortadas só na exibição (marca `↳`), sem inserir quebra no arquivo.
- **Edição guardada em diário**: cada lote editado fica guardado em disco e só vai para o arquivo ao salvar; fechar o app ou a aba não perde nada. Lote com bytes inválidos para a codificação fica só leitura.
- **Desfazer e refazer em todo o arquivo**, inclusive nos lotes que saíram da tela (o Fullpad carrega o lote, leva a tela até ele e desfaz lá). A bolinha de "não salvo" apaga quando tudo volta ao original.
- **Salvar**: lotes que mantiveram o tamanho são sobrescritos no lugar; se algum mudou de tamanho, uma janela com dois cartões explica e recomenda entre **salvar com segurança** (arquivo novo ao lado, original só trocado no fim, cancelável, com andamento) e **salvar direto** (regrava do ponto editado em diante, sem espaço extra e sem proteção contra queda). "Salvar como" é sempre seguro. Preserva codificação, BOM e quebras de linha, e **nunca sobrescreve uma mudança externa**: se o arquivo mudou, só dá para recarregar ou cancelar.
- **CSV e TSV gigantes** abrem na **tabela editável** (primeira coluna = linha do arquivo, rola junto com o código na visão dividida); ordenar, filtrar e mexer em colunas ficam desligados.
- **Para testar**: `examples/large/` tem geradores (txt, md, csv, json) com tamanho em MB e barra de progresso, sem guardar arquivo gigante no projeto.

### Arquivos de verdade

- **Preserva codificação** (UTF-8, UTF-8 com BOM, CP1252) e **quebras de linha** (CRLF/LF) ao salvar.
- **Arquivo alterado fora do Fullpad**: se a aba não tem alterações, ela se **recarrega sozinha** (e o Ctrl+Z traz o texto de antes); se tem, uma faixa pergunta "Recarregar do disco" ou "Manter o meu"; se o arquivo sumiu, avisa e o texto fica na aba. **Salvar nunca sobrescreve uma mudança externa sem perguntar** (Sobrescrever, Salvar como… ou Cancelar). F5 e Ctrl+R recarregam do disco.
- **Abrir de todo jeito**: Ctrl+O, "Abrir com" do Windows, duplo clique, linha de comando, segunda instância (que entrega o arquivo à janela já aberta) e **arrastar arquivos do Explorer** para a janela.
- **Salvar todos** (Ctrl+Alt+S) e **fechar em lote** (outras, todas, só as salvas), com uma única pergunta se houver alterações.
- **Instância única**: abrir o Fullpad de novo (ou um arquivo "com" ele) entrega os arquivos à janela que já está aberta, em vez de abrir outro app.

### Abas, janelas e painéis

- **Abas**: reordene arrastando; **fixe** abas (um alfinete no lugar do ×, ficam à esquerda e protegidas de fechar em lote); botão do meio fecha; a roda rola a barra na horizontal.
- **Várias janelas**: tire uma aba da janela arrastando (uma "sombra" com o nome segue o ponteiro e a janela nova aparece na hora) ou use o menu; mova abas entre janelas pela barra de abas de outra janela. Janelas flutuantes voltam na posição em que ficaram.
- **Painéis**: divida à direita (Ctrl+\\) ou abaixo (Ctrl+Shift+\\); arraste uma aba para um dos **alvos visíveis** (borda do painel, borda do bloco inteiro, centro de outro painel); cada divisa tem um menu (inverter os lados, alternar entre lado a lado e empilhado, dividir igualmente) e arrasta para redimensionar. Cada painel tem editor, abas e visões próprios.
- **Visão em janela separada**: o preview do markdown, o diagrama ou as equações numa janela só, acompanhando o texto.

### Editor

- **Destaque de sintaxe** para JS, TS, JSON, SQL, Python, CSS, HTML, Rust, YAML, Shell, C#, C, C++, Java, Kotlin, Go, Ruby, TOML, PowerShell, Dockerfile, Lua, Perl, Swift, Diff, INI, XML e DBML, carregado sob demanda. Em arquivos de texto puro, o botão **Lang** do rodapé troca o destaque à mão.
- **Localizar e substituir** em todo editor: contador "3 de 12", anterior/próximo, maiúsculas, palavra inteira, **regex**, substituir um ou todos.
- **Busca global** (Ctrl+Shift+F) em todas as abas da janela, com os mesmos filtros, resultados agrupados por aba e **Substituir tudo** (com confirmação, e um Ctrl+Z por aba).
- **Paleta de um campo só** (Ctrl+P): arquivos abertos, fechados e recentes; `arquivo:42` abre já na linha; `:` vai à linha (Ctrl+G); `@` lista os títulos e símbolos do arquivo (Ctrl+Shift+O); `>` lista **todos os comandos dos menus** com atalho (Ctrl+Shift+P). A busca é aproximada: sem maiúsculas nem acentos.
- **Sumário lateral** (estilo Notion): barrinhas na borda que viram um cartão ao passar o mouse; dá para manter aberto, escolher o lado e **buscar dentro do sumário**. Vale para Markdown, DBML, JSON, YAML e TOML.
- **Números de linha**, quebra de linha, **zoom da janela inteira** (25% a 500%, Ctrl+roda, Ctrl+= e Ctrl+-, controle no rodapé), **tema claro e escuro**.
- **Links clicáveis** em qualquer arquivo (duplo clique ou Ctrl+clique abre no navegador; botão direito copia o link).
- **Menu do tipo de arquivo**: o menu ao lado de "Linguagem" muda conforme a aba (JSON, CSV, Markdown, DBML, Mermaid, LaTeX, PDF/EPUB, Texto), com as ações daquele tipo.
- **Barra de status**: linguagem, visão, tamanho e linhas, linha e coluna, quebra de linha, codificação, zoom.

### Markdown

- **Live preview** editável: títulos, ênfase, listas, tarefas, citações, código com destaque por linguagem, links, imagens, tabelas e o resto do markdown renderizados no texto.
- **Tabelas editáveis na grade**: clique na célula e digite, com Enter, Tab e setas para andar; botões **+** ao passar o mouse (coluna na borda direita, linha embaixo e entre linhas e colunas); botão direito para inserir, apagar, mover e alinhar linhas e colunas e copiar como CSV; **colar CSV, TSV ou planilha vira tabela** (Ctrl+Shift+V cola como texto); a tabela é reescrita alinhada e cada edição é um passo no Ctrl+Z.
- **Barra de formatação** sobre a seleção (estilo Notion) e em Markdown > Formatar: tipo de bloco (texto, títulos 1 a 3, lista, numerada, tarefas, citação, código), **negrito, itálico, tachado, código, equação, link** e limpar formatação; Ctrl+B, Ctrl+I, Ctrl+K, Ctrl+Shift+X e Ctrl+Shift+M; cada ação é um passo no Ctrl+Z.
- **Equações LaTeX** (`$...$` e `$$...$$`, com KaTeX, sem rede e sem links) e **diagramas Mermaid** em blocos de código, desenhados no texto.
- **Três visões**: renderizado no próprio texto, só código e lado a lado (Ctrl+E e Ctrl+Shift+E), ou o preview numa janela separada.
- **Exportar**: HTML autônomo (fontes das equações incluídas), PDF pela impressão do sistema e "copiar como HTML".

### Dados

- **JSON** (`.json`, `.jsonc`, `.geojson`, `.webmanifest`): árvore virtualizada ao lado do código; validação com o erro sublinhado e linha/coluna; **formatar** (indentação 2, 4 ou tab, minificar, ordenar chaves; Alt+Shift+F) sem perder números enormes nem chaves repetidas; comentários e vírgula sobrando aceitos em `.jsonc`; links clicáveis, **cores** e **miniaturas de imagem** nos valores; copiar o caminho de um nó (`$.lista[0].nome`); o código e a árvore andam juntos.
- **YAML** e **TOML**: a mesma árvore, com validação, vários documentos YAML (`---`) e datas do TOML, sem reescrever o seu texto.
- **CSV e TSV**: detecção automática do **separador** (ou escolha manual, que é lembrada), cabeçalho e **decimal** configuráveis, colunas coloridas no código; na tabela, ordenar (como número ou como texto sem acento), filtrar, selecionar células com **estatísticas**, editar célula, colar do Excel, **inserir, apagar e mover linhas e colunas**, renomear o cabeçalho, ordenar o arquivo por uma coluna, copiar como TSV, ajustar a altura de cada linha e abrir o texto inteiro de uma célula cortada. Só as células editadas mudam no arquivo.
- **DBML**: diagrama das tabelas e relações (inclui a sintaxe nova), com diagnóstico de erros, autocompletar, **zoom e arrastar**, "Ajustar", exportar SVG e PNG, e ligação com o código (passar o mouse pinta a linha, o cursor acende o elemento).
- **Mermaid** (`.mmd`, `.mermaid`) e **LaTeX** (`.tex`): o diagrama ou as equações sempre ao lado do código.

### Leitura (PDF e EPUB)

- **Abrir não carrega**: a aba mostra o nome e o tamanho e só lê o arquivo quando você pede. Antes, o PDF passa por uma verificação contra **bombas de compressão**.
- **PDF**: páginas desenhadas só quando aparecem, camada de texto, links, zoom, página atual.
- **EPUB**: sumário (EPUB 2 e 3), capítulo limpo num quadro isolado, tamanho do texto de 60% a 300%, tema claro e escuro.
- **Busca no documento** (Ctrl+F) sem maiúsculas nem acentos, com o resultado realçado e "3 de 17".
- **Copiar como citação** (Ctrl+Shift+C): um bloco markdown com o trecho e a origem (título, página ou capítulo).
- **Posição de leitura por arquivo**: lembrada pelo conteúdo, então mover ou renomear o arquivo não a perde. Arquivo ausente: "Localizar arquivo…". Arquivo alterado: faixa "Recarregar".
- Nunca grava no arquivo, não executa o JavaScript do PDF, abre links só `http`, `https` e `mailto`.

### Instalação e sistema

- **Instalador Windows por usuário** (não pede administrador), em português, com integração opcional: abrir `.md`, `.markdown`, `.dbml` e `.dbmlx` por padrão com o Fullpad e mostrá-lo no "Abrir com" dos arquivos de texto.
- **Atualização automática assinada**: o app procura versão nova ao abrir (e em Ajuda), grava tudo antes de instalar e, depois de atualizar, abre a **nota de versão**; Ajuda > "Histórico de versões" mostra todas.
- **Dados** em `%APPDATA%\fullpad` (Windows) e `~/.local/share/fullpad` (Linux), fora do instalador: desinstalar não apaga as suas notas. `FULLPAD_DATA_DIR` aponta para outra pasta (ótimo para testar).
- A pasta [`examples/`](examples/) tem um arquivo de cada tipo para você ver tudo funcionando.

A lista completa, com as decisões por trás de cada recurso, está em [`docs/AGENTS.md`](docs/AGENTS.md).

## Instalar

**Windows 10/11**: baixe o instalador `Fullpad_<versão>_x64-setup.exe` na [última versão](https://github.com/Brennon-Oliveira/fullpad-releases/releases/latest). A instalação é por usuário (não pede administrador) e o app se atualiza sozinho depois.

> **Aviso do SmartScreen.** O instalador **não tem assinatura de código do Windows** (isso custa um certificado pago), então na primeira execução o Windows mostra "O Windows protegeu o computador / editor desconhecido". Clique em **Mais informações → Executar assim mesmo**. As atualizações automáticas, essas sim, são assinadas por uma chave própria do projeto e o app só aceita as que conferem. O código é aberto: você pode compilar o instalador você mesmo.

**Linux (x86_64)**: baixe o `.AppImage` (qualquer distribuição: `chmod +x` e execute), o `.deb` (Debian/Ubuntu) ou o `.rpm` (Fedora/openSUSE) na [última versão](https://github.com/Brennon-Oliveira/fullpad-releases/releases/latest). Precisa do WebKitGTK 4.1 (já vem nas distribuições atuais). O app se atualiza sozinho, o Fullpad aparece em "Abrir com" dos arquivos de texto e, em sessão Wayland, roda via XWayland (para as janelas, o "manter no topo" e o atalho global funcionarem; `FULLPAD_WAYLAND=1` desliga isso). Detalhes em [`docs/rules/build-linux.md`](docs/rules/build-linux.md). **macOS**: ainda não é suportado.

Os dados ficam em `%APPDATA%\fullpad` (Windows) e `~/.local/share/fullpad` (Linux). `FULLPAD_DATA_DIR=/algum/lugar` sobrescreve (bom para testar sem mexer nas suas notas). Desinstalar **não apaga as suas notas**: elas ficam nessa pasta.

## Compilar e desenvolver

Pré-requisitos: [Rust](https://rustup.rs), [Node](https://nodejs.org) e [pnpm](https://pnpm.io).

- **Windows**: WebView2 (já vem no Win10/11) e o Build Tools do Visual Studio (MSVC).
- **Linux**: `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev pkg-config build-essential`

```sh
cargo install tauri-cli --version "^2" --locked     # uma vez
pnpm --dir ui install
cd crates/app
cargo tauri dev                                     # desenvolvimento
cargo tauri build                                   # instalador / binário
```

Testes (na raiz do repositório):

```sh
cargo test -p fullpad-core                          # testes do core
pnpm --dir ui exec vitest run                       # testes da interface
pnpm --dir ui build                                 # tsc --noEmit + vite build
```

O `.exe` de Windows do mantenedor sai por cross-compile no WSL (veja [`docs/rules/build-windows.md`](docs/rules/build-windows.md)). Ainda não há pipeline no GitHub: os testes rodam localmente.

## Estrutura

```
crates/core   persistência (sessão, notas, escrita atômica, lixeira), parsers, busca. Sem UI, testável
crates/app    Tauri 2: comandos IPC, janelas, instância única, atualização automática
ui/           TypeScript + CodeMirror 6 + Vite: abas, editor, live preview, menus
examples/     um arquivo de exemplo por tipo suportado
docs/         arquitetura, regras do projeto e roteiro
```

## Contribuir

Contribuições são bem-vindas: bugs, ideias, documentação, exemplos e código. Leia o [`CONTRIBUTING.md`](CONTRIBUTING.md) (ambiente, fluxo, regras de código, formato dos commits). Bugs e ideias vão nas [issues](https://github.com/Brennon-Oliveira/fullpad/issues); o ranking do que vem primeiro está na issue fixada "Ranking de prioridades". O roteiro de entrega está em [`docs/PLANO.md`](docs/PLANO.md).

Encontrou uma vulnerabilidade? Não abra issue pública: veja a seção [Segurança](CONTRIBUTING.md#segurança).

## Licença

O Fullpad é distribuído sob a licença **MIT** (veja [`LICENSE`](LICENSE)). As bibliotecas de terceiros que ele usa e as licenças delas estão em [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) (arquivo gerado por `scripts/gerar-licencas.py`; também vai junto do instalador).
