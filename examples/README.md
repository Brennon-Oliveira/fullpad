# Exemplos do Fullpad

Arquivos para abrir no app (Ctrl+O, ou arraste-os para a janela) e ver o que ele faz com cada tipo. Todo o conteúdo é fictício.

| Arquivo | O que abrir para ver |
|---|---|
| `example.md` | Markdown renderizado e editável; `Ctrl+E` alterna código/renderizado, `Ctrl+Shift+E` lado a lado; blocos de código coloridos; diagramas Mermaid; equações LaTeX (`$...$` e `$$...$$`); Arquivo ▸ Exportar |
| `example.mmd` | Diagrama Mermaid (fluxograma com subgrafos, rótulos nas setas, estilos e comentários `%%`). Abre com o diagrama ao lado do código (`Ctrl+E`), pan/zoom com a roda e arrastando, botão SVG; apague um trecho para ver o erro de sintaxe na faixa embaixo |
| `example.tex` | Documento LaTeX com destaque de sintaxe. Ao lado do código (`Ctrl+E`) aparecem só as **equações soltas**, uma por cartão (`$..$`, `\(..\)`, `\[..\]`, `$$..$$`, `equation`, `align`, `gather`, `multline`): passar o mouse pinta o trecho no código, clicar leva o cursor até lá, e uma equação com erro é marcada. O documento não é compilado |
| `example.json` | Árvore ao lado do código, links, cores, miniatura de imagem, números enormes preservados, chaves repetidas; `Alt+Shift+F` formata |
| `example.jsonc` | JSON com comentários e vírgulas sobrando (o formatador recusa para não apagar comentários) |
| `example.dbml` | Diagrama do banco de uma escola de idiomas: esquemas, enums, relações, índices, grupos, `Records` |
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
