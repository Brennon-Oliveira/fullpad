# Exemplos do Fullpad

Arquivos para abrir no app (Ctrl+O, ou arraste-os para a janela) e ver o que ele faz com cada tipo. Todo o conteúdo é fictício.

| Arquivo | O que abrir para ver |
|---|---|
| `example.md` | Markdown renderizado e editável; `Ctrl+E` alterna código/renderizado, `Ctrl+Shift+E` lado a lado; blocos de código coloridos; diagramas Mermaid; equações LaTeX (`$...$` e `$$...$$`); tabelas renderizadas e editáveis na grade (botão direito: linhas, colunas, alinhamento, CSV); **imagens** do disco desenhadas (`imagens/example/…`), **Ctrl+V com um print** (ou arrastar uma imagem do Explorer para o editor) guarda o arquivo ao lado e escreve o `![](…)`; Arquivo ▸ Exportar (a imagem vai embutida em `data:`) |
| `example.mmd` | Diagrama Mermaid (fluxograma com subgrafos, rótulos nas setas, estilos e comentários `%%`). Abre com o diagrama ao lado do código (`Ctrl+E`), pan/zoom com a roda e arrastando, botão SVG; apague um trecho para ver o erro de sintaxe na faixa embaixo |
| `example.tex` | Documento LaTeX com destaque de sintaxe. Ao lado do código (`Ctrl+E`) aparecem só as **equações soltas**, uma por cartão (`$..$`, `\(..\)`, `\[..\]`, `$$..$$`, `equation`, `align`, `gather`, `multline`): passar o mouse pinta o trecho no código, clicar leva o cursor até lá, e uma equação com erro é marcada. O documento não é compilado |
| `example.json` | Árvore ao lado do código, links, cores, miniatura de imagem, números enormes preservados, chaves repetidas; `Alt+Shift+F` formata |
| `example.jsonc` | JSON com comentários e vírgulas sobrando (o formatador recusa para não apagar comentários) |
| `example.dbml` | Diagrama do banco de uma escola de idiomas: esquemas, enums, relações, índices, grupos, `Records`. **Renomear**: `F2` no editor sobre o nome de uma tabela, coluna, enum ou grupo (ou sobre um uso dele, num `Ref` ou `Records`), ou duplo clique no nome no diagrama: tudo que o usa muda junto, num passo só do `Ctrl+Z`. **Botão direito numa coluna do diagrama**: tipo, chave primária, não nulo, único, nota. **Notas**: o enum `status_matricula` tem `Note:` no corpo (ícone de documento no cabeçalho do enum, passe o mouse; o `@dbml/parse` puro recusa isso, o Fullpad o aceita por um patch); tabela ou coluna com nota ganha um ícone de documento (passe o mouse para ler; clique para editar, em várias linhas). **Editar** (barra de status, ao lado da visão): desmarcado, o diagrama só se vê |
| `example.dbmlx` + `example.dbmlx.layout.json` + `example-modulo.dbmlx` | O mesmo banco em `.dbmlx`, com o layout salvo ao lado (formato da extensão dbmlx): as tabelas já vêm arrumadas em colunas por esquema. **Arraste uma tabela pelo cabeçalho**, um grupo pela faixa do título (leva as tabelas junto) ou o canto da moldura para aumentá-lo: a posição (e o zoom/posição da vista) são gravadas no JSON, sem tocar no texto do DBML (com **Editar** desmarcado, nada arrasta). O botão **Ver layout** da barra de status troca o código DBML pelo JSON do layout (o diagrama fica ao lado e acompanha) e vira **Ver diagrama**; apague uma tabela do layout para ela voltar ao posicionamento automático, ou quebre o JSON para ver o aviso. Mostra também o **`!include`** (traz `example-modulo.dbmlx` (**Ctrl+clique** no caminho do `!include` abre o módulo, com a faixa "← Voltar para example.dbmlx" e só as tabelas dele; no botão **Ver** do diagrama escolha só um arquivo ou um grupo; as tabelas de fora viram "↗ N ext."), com as anotações de migração `[add]`, `[drop]` e `[modify: …]`, que o diagrama ignora) |
| `example.csv` | Tabela editável: ordenar, filtrar, estatísticas no rodapé, colar, estrutura; células com aspas, vírgulas e quebras de linha |
| `example.tsv` | Separador tab e decimal com vírgula (escolha em CSV ▸ Decimal) |
| `example.pdf` | Aba de leitura: sumário clicável, gráficos, tabelas, busca (`Ctrl+F`), citação (`Ctrl+Shift+C`) |
| `example.epub` | Livro com 8 capítulos e posfácio: sumário, busca, zoom do texto, tema escuro, citação com capítulo |
| `example.py` `.ts` `.rs` `.cs` `.sql` `.html` `.css` `.sh` | Código em cada linguagem. Hoje o destaque de sintaxe vale nos blocos do markdown (veja `example.md`); abertos direto, esses arquivos são texto puro |
| `example.yaml` `example.toml` | Configuração. Abrem com a árvore ao lado do código (Ctrl+E), como o JSON, e o erro de sintaxe fica sublinhado |
| `example.txt` | Texto puro: quebra de linha, localizar, substituir, ir para linha (`Ctrl+Alt+G`) |
| `large/` (**gera** arquivos de centenas de MB, que **não vão para o git**) | Modo de arquivo grande: `python3 examples/large/gerar_csv.py 200` (e `gerar_txt.py`, `gerar_md.py`, `gerar_json.py`) cria `grande.<ext>` com o tamanho pedido em MB. Abre na hora, com aviso fixo, barra de rolagem do arquivo, `Ctrl+G` imediato, `Ctrl+F` em fluxo, linha gigante com `↳` e edição com salvar em fluxo. O CSV grande abre na **tabela editável** (primeira coluna = linha do arquivo, sem ordenar nem filtrar; Ctrl+Shift+E lado a lado); JSON e Markdown abrem **como texto** (sem árvore nem renderizado). Passo a passo e o que testar em [`large/README.md`](large/README.md) |

## Regenerar

`example.json`, `.csv` e `.tsv` saem de `_gerar/dados.py` (só Python 3). `imagens/example/*.png` (a imagem do `example.md`, nomeada pelo hash) sai de `_gerar/imagem.py`. `example.pdf` e `example.epub` saem de `_gerar/pdf.py` e `_gerar/epub.py`, que precisam de `reportlab` e `pillow` (o reportlab ainda não roda no Python 3.14; use 3.12):

```sh
uv venv --python 3.12 /tmp/v && uv pip install --python /tmp/v/bin/python reportlab pillow
/tmp/v/bin/python examples/_gerar/pdf.py
/tmp/v/bin/python examples/_gerar/epub.py
python3 examples/_gerar/dados.py
python3 examples/_gerar/imagem.py
```
