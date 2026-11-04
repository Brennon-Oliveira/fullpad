# Histórico de versões

Uma seção por versão, da mais nova para a mais antiga. A skill `gerar-versao` acrescenta a versão nova no topo; o app embute este arquivo (Ajuda > "Histórico de versões…"). As versões até a 2.0.0 foram reconstruídas das mensagens das tags.

## 2.1.0 · 2026-11-04

### Novidades

- **Equações (LaTeX)** no markdown: `$...$` e `$$...$$` aparecem desenhadas, e com o cursor dentro vê-se o código. Valem também no painel renderizado e na exportação (HTML, PDF e copiar como HTML). Na barra de formatação há o botão **√x** (Ctrl+Shift+M).
- **Arquivos `.tex`**: abrem com destaque de sintaxe e, ao lado do código, as equações soltas do arquivo, uma por cartão (passe o mouse para ver o trecho, clique para ir até ele).
- **Diagramas Mermaid**: um bloco ` ```mermaid ` vira o diagrama no markdown e na exportação. Arquivos `.mmd` e `.mermaid` abrem com o diagrama ao lado do código, com zoom, arrastar, exportar em SVG e o erro de sintaxe numa faixa.
- **Histórico de versões** (Ajuda): o changelog completo do app. Depois de atualizar pulando versões, a nota mostra tudo o que entrou desde a sua.
- **Busca no sumário lateral**: a lupa do sumário fixa a lista e filtra só os títulos dela.

### Correções

- **Arquivo alterado fora do Fullpad**: o app percebe a mudança. Sem edições suas, a aba recarrega sozinha (Ctrl+Z volta); com edições, uma faixa pergunta se recarrega ou mantém o seu. Salvar não grava mais por cima de uma mudança externa sem perguntar. Novo: Arquivo > "Recarregar do disco" (F5 ou Ctrl+R).
- A nota de versão não aceita mais edição.

## 2.0.0 · 2026-11-04

### Novidades

- **Ctrl+P**: busca arquivos pelo nome entre as abas abertas, as fechadas e as abertas recentemente. Digite `:42` (ou Ctrl+G) para ir a uma linha, `arquivo:42` para abrir já na linha, `@` para pular para um título e `>` (Ctrl+Shift+P) para os comandos.
- **Barra de formatação** no markdown: ao selecionar um texto aparece uma barra com tipo de bloco, negrito, itálico, tachado, código, link e limpar formatação (Ctrl+B, Ctrl+I, Ctrl+K).
- **Sumário lateral**: barrinhas na borda que mostram os títulos ao passar o mouse, ou fixo ao lado do arquivo (Visualizar > Sumário, à esquerda ou à direita).
- **Buscar em todas as abas** (Ctrl+Shift+F), com substituir em todas, e um localizar e substituir novo, com contador de resultados.
- **YAML e TOML** abrem com árvore ao lado do código, como o JSON, e mostram o erro de sintaxe.
- **Mais linguagens coloridas** nos arquivos de texto (C, Java, Go, Ruby, Lua, XML, Dockerfile e outras), com o seletor "Lang" na barra de status.
- **Abas**: fixar, fechar outras, todas ou só as salvas, salvar todos, fechar com o botão do meio e rolar a barra com a roda do mouse.

### Correções

- No markdown renderizado, o clique agora cai na linha certa.

## 1.1.0 · 2026-11-03

- **Tabela para CSV e TSV**: abra arquivos `.csv` e `.tsv` como uma tabela editável. Você escolhe entre só a tabela (padrão), só o código ou os dois lado a lado. O texto do arquivo continua sendo a única fonte: editar uma célula muda só os caracteres dela.
- **Editar na tabela**: duplo clique, F2 ou digitar. Dá para colar um bloco de células de qualquer formato (inclusive do Excel), renomear colunas, inserir, apagar e mover linhas e colunas, e ordenar o arquivo de verdade. Tudo desfaz com Ctrl+Z.
- **Separador automático**: o app descobre se o arquivo usa vírgula, ponto e vírgula, tab ou barra vertical, e você pode escolher na mão (a escolha nunca é trocada depois). O separador decimal é o ponto, ou a vírgula se você preferir.
- **Ordenar, filtrar e somar**: clique no cabeçalho para ordenar, filtre pela caixa acima da tabela e veja soma, média, mínimo, máximo e contagem no rodapé. Colunas coloridas também no modo código.
- **Números de linha no código**: uma margem à parte mostra o número de cada linha em qualquer tipo de arquivo. Visualizar > "Números de linha" liga e desliga.

- A tabela lê o arquivo por faixas e abre arquivos de dezenas de MB; acima de 50 milhões de caracteres uma faixa avisa que só o código está disponível.

## 1.0.0 · 2026-11-03

- **Leitor de PDF**: abra PDFs dentro do Fullpad, só para ler. O arquivo só é lido quando você clica em "Carregar", então abrir continua instantâneo. Tem texto selecionável, links, zoom (Ctrl+roda e Ctrl+/-) e página X de Y.
- **Leitor de EPUB**: livros com sumário ao lado, imagens e o estilo do livro adaptado ao tema claro ou escuro, com zoom do texto.
- **Volta de onde parou**: o PDF e o EPUB reabrem na página ou no capítulo em que você estava, mesmo depois de fechar a aba ou mover o arquivo de pasta.
- **Copiar como citação**: selecione um trecho e use Ctrl+Shift+C (ou o botão direito) para copiar em markdown com o nome do livro e a página ou o capítulo, pronto para colar numa nota.
- **Busca no PDF e no EPUB** (Ctrl+F): ignora maiúsculas e acentos, mostra "3 de 17" e destaca o trecho.
- **Arraste arquivos** do Explorer para a janela do Fullpad para abri-los, com um aviso na tela.

- PDFs e EPUBs são abertos com proteção: scripts nunca rodam, e arquivos feitos para travar o programa (bombas de compressão) são recusados com um aviso. O arquivo original nunca é alterado.

## 0.6.0 · 2026-11-02

- Links clicáveis em qualquer tipo de arquivo (e no markdown renderizado): o cursor vira mão e o link ganha destaque ao passar o mouse; um clique só seleciona, duplo clique ou Ctrl+clique abre no navegador, e o botão direito oferece "Copiar link".
- Zoom de 25% a 500%: Ctrl + roda do mouse (de 5 em 5%), Ctrl+= e Ctrl+- (de 10 em 10%) e Ctrl+0 para voltar a 100%. Também está em Visualizar > Zoom e na barra de status, com lupas para diminuir e aumentar e o valor atual, que abre a lista de tamanhos prontos. O zoom fica lembrado.
- O menu "JSON" agora muda conforme o arquivo: JSON, Markdown (exportar e copiar como HTML), DBML ou Texto, cada um com as ações que fazem sentido para ele.

- O PDF exportado não mostra mais o endereço interno do app no rodapé: cada página traz o nome "Fullpad".

## 0.5.0 · 2026-11-02

- O Fullpad ganhou um ícone novo: uma folha com um cursor de texto, no azul do app. Ele aparece no executável, no instalador, na barra de tarefas e nos atalhos.

- O diálogo de atualização não repete mais o título "Novidades" no começo das notas.

## 0.4.0 · 2026-11-02

- Arquivos JSON (`.json`, `.jsonc`, `.geojson`) abrem com uma árvore ao lado do texto: listas e objetos se expandem e recolhem, e Ctrl+clique abre tudo abaixo do nó. Para JSON colado numa nota, escolha Linguagem > JSON.
- Na árvore, links abrem no navegador, cores como `#ff8800` ou `rgb(10,120,200)` ganham um quadradinho colorido e imagens (por link ou arquivo do seu computador) aparecem numa miniatura ao passar o mouse.
- Passar o mouse num item da árvore mostra a linha dele no texto, e o cursor do texto destaca o item na árvore. O caminho do item (como `$.lista[0].nome`) aparece na barra de status.
- Novo menu "JSON": formatar o documento ou a seleção (Alt+Shift+F), minificar, ordenar chaves e escolher a indentação. Também está no botão direito, no texto e em cada item da árvore, com copiar caminho, chave e valor.
- Erros de sintaxe no JSON ficam sublinhados no texto, com a mensagem ao passar o mouse, e o texto ganha cores e blocos que dobram.

- Formatar o JSON não altera números nem chaves repetidas (por exemplo, `12345678901234567890` continua igual). Se houver comentários, o Fullpad avisa em vez de apagá-los.
- Em JSONs muito grandes (mais de 300 mil itens) a árvore não é montada, mas o texto continua editável.

## 0.3.0 · 2026-11-02

- Depois de atualizar, o Fullpad abre esta nota de versão para mostrar o que mudou.
- Ajuda > "Ver nota de versão" abre a nota de novo quando quiser.
- Fechar a nota de versão não a guarda no histórico de abas fechadas.

## 0.2.1 · 2026-11-02

Versão de teste da atualização automática.
