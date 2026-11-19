## Novidades

- **CSV pergunta o separador quando não consegue descobrir**: o arquivo abre no código e uma faixa em cima oferece vírgula, ponto e vírgula, tab, barra vertical ou um caractere à sua escolha (por exemplo `+`). Ao escolher, a tabela abre. A escolha fica lembrada para aquele arquivo: fechou e abriu de novo, já vem certo.
- **DBMLX com `!include`**: esquemas divididos em vários arquivos agora abrem. As tabelas e as relações entre os arquivos aparecem no mesmo diagrama, e um erro dentro de um arquivo incluído aparece na linha do `!include`. As anotações de migração (`[add]`, `[drop]`, `[modify: …]`) e o `DiagramView` também são aceitos, e renomear não apaga nenhuma delas.
- **Ctrl+clique no `!include` abre o arquivo**: o caminho vira link. O arquivo aberto mostra uma faixa "← Voltar para" o arquivo principal e entende as relações com os outros arquivos, sem dar erro de tabela que não existe.
- **Escolher o que ver no diagrama**: o botão "Ver" mostra tudo, só um arquivo ou só um grupo de tabelas. O que fica de fora não é desenhado, e as tabelas que ficam mostram "↗ N ext." com quantas relações externas têm.

## Correções

- Arquivos DBMLX com `!include` não dão mais o erro "Expect an identifier".
- CSV muito grande: a pergunta do separador não aparece mais antes de carregar, e a tabela deixa de ficar em branco depois de carregar.
