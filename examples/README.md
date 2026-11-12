# Exemplos do Fullpad

Arquivos para abrir no app (Ctrl+O, ou arraste-os para a janela) e ver o que ele faz com cada tipo. Todo o conteúdo é fictício.

| Arquivo | O que abrir para ver |
|---|---|
| `example.md` | Markdown renderizado e editável; `Ctrl+E` alterna código/renderizado, `Ctrl+Shift+E` lado a lado; blocos de código coloridos; diagramas Mermaid; equações LaTeX (`$...$` e `$$...$$`); Arquivo ▸ Exportar |
| `example.mmd` | Diagrama Mermaid (fluxograma com subgrafos, rótulos nas setas, estilos e comentários `%%`). Abre com o diagrama ao lado do código (`Ctrl+E`), pan/zoom com a roda e arrastando, botão SVG; apague um trecho para ver o erro de sintaxe na faixa embaixo |
| `example.tex` | Documento LaTeX com destaque de sintaxe. Ao lado do código (`Ctrl+E`) aparecem só as **equações soltas**, uma por cartão (`$..$`, `\(..\)`, `\[..\]`, `$$..$$`, `equation`, `align`, `gather`, `multline`): passar o mouse pinta o trecho no código, clicar leva o cursor até lá, e uma equação com erro é marcada. O documento não é compilado |
| `example.json` | Árvore ao lado do código, links, cores, miniatura de imagem, números enormes preservados, chaves repetidas; `Alt+Shift+F` formata |
| `example.jsonc` | JSON com comentários e vírgulas sobrando (o formatador recusa para não apagar comentários) |
| `example.dbml` | Diagrama do banco de uma escola de idiomas: esquemas, enums, relações, índices, grupos, `Records`. **Renomear**: `F2` no editor sobre o nome de uma tabela, coluna, enum ou grupo (ou sobre um uso dele, num `Ref` ou `Records`), ou duplo clique no nome no diagrama: tudo que o usa muda junto, num passo só do `Ctrl+Z`. **Botão direito numa coluna do diagrama**: tipo, chave primária, não nulo, único, nota |
| `example.dbmlx` + `example.dbmlx.layout.json` | O mesmo banco em `.dbmlx`, com o layout salvo ao lado (formato da extensão dbmlx): as tabelas já vêm arrumadas em colunas por esquema. **Arraste uma tabela pelo cabeçalho**, um grupo pela faixa do título (leva as tabelas junto) ou o canto da moldura para aumentá-lo: a posição (e o zoom/posição da vista) são gravadas no JSON, sem tocar no texto do DBML. O botão **Ver layout** da barra de status troca o código DBML pelo JSON do layout (o diagrama fica ao lado e acompanha) e vira **Ver diagrama**; apague uma tabela do layout para ela voltar ao posicionamento automático, ou quebre o JSON para ver o aviso |
| `example.csv` | Tabela editável: ordenar, filtrar, estatísticas no rodapé, colar, estrutura; células com aspas, vírgulas e quebras de linha |
| `example.tsv` | Separador tab e decimal com vírgula (escolha em CSV ▸ Decimal) |
| `example.pdf` | Aba de leitura: sumário clicável, gráficos, tabelas, busca (`Ctrl+F`), citação (`Ctrl+Shift+C`) |
| `example.epub` | Livro com 8 capítulos e posfácio: sumário, busca, zoom do texto, tema escuro, citação com capítulo |
| `example.py` `.ts` `.rs` `.cs` `.sql` `.html` `.css` `.sh` | Código em cada linguagem. Hoje o destaque de sintaxe vale nos blocos do markdown (veja `example.md`); abertos direto, esses arquivos são texto puro |
| `example.yaml` `example.toml` | Configuração. Abrem com a árvore ao lado do código (Ctrl+E), como o JSON, e o erro de sintaxe fica sublinhado |
| `example.txt` | Texto puro: quebra de linha, localizar, substituir, ir para linha (`Ctrl+Alt+G`) |

## Regenerar

`example.json`, `.csv` e `.tsv` saem de `_gerar/dados.py` (só Python 3). `example.pdf` e `example.epub` saem de `_gerar/pdf.py` e `_gerar/epub.py`, que precisam de `reportlab` e `pillow` (o reportlab ainda não roda no Python 3.14; use 3.12):

```sh
uv venv --python 3.12 /tmp/v && uv pip install --python /tmp/v/bin/python reportlab pillow
/tmp/v/bin/python examples/_gerar/pdf.py
/tmp/v/bin/python examples/_gerar/epub.py
python3 examples/_gerar/dados.py
```
