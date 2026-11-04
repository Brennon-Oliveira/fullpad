---
titulo: Edição avançada de texto (vários cursores, seleção em coluna, dobrar blocos)
feita: não
versao: —
---

# Edição avançada de texto

Os recursos de edição de quem vem do Notepad++ e do VS Code, em todos os tipos de arquivo.

## Ideia

- **Vários cursores**: Ctrl+clique (ou Alt+clique) para acrescentar um, e "selecionar a próxima ocorrência" da palavra sob o cursor (como o Ctrl+D do VS Code), até "selecionar todas as ocorrências".
- **Seleção em coluna** (retangular): Alt+arrastar com o mouse ou Alt+Shift+setas, para editar a mesma coluna de várias linhas de uma vez (muito útil em CSV, tabelas e listas alinhadas).
- **Dobrar blocos** em todos os tipos: o JSON já dobra; estender a código (por indentação ou chaves) e a títulos do markdown, com setas na margem e comandos Dobrar/Desdobrar tudo.
- Outros que costumam vir junto: mover linha para cima/baixo (Alt+↑/↓), duplicar linha, apagar linha, comentar/descomentar, ordenar as linhas selecionadas, juntar linhas.

## Por que

O CodeMirror 6 já traz quase tudo isso (`rectangularSelection`, `crosshairCursor`, múltiplas seleções, `foldGutter`, `selectNextOccurrence`). O trabalho é ligar, escolher atalhos, pôr nos menus (e, por isso, na [paleta](paleta-de-comandos.md)) e fazer conviver com o que o app já tem.

## Pontos a decidir

- **Atalhos**: evitar os que o app já usa (Ctrl+D, Ctrl+Shift+D, Alt+Shift+F são do JSON etc.); revisar conflitos antes.
- **Convivência**: a [barra de formatação](barra-de-formatacao.md) e os comandos de formatação com vários cursores (aplicar em cada seleção); a busca do editor e a busca global; o "ir para linha" da paleta.
- **Markdown renderizado**: o que fazer com vários cursores quando o texto está renderizado (provavelmente funciona como no código, mostrando o trecho sob cada cursor).
- **Dobrar**: lembrar o que está dobrado por aba (ou não); as linhas dobradas nunca saem do documento.
- Visualizar > menu com os itens, e uma linha na barra de status ("3 cursores").

## Cuidados

- O documento continua texto puro; dobrar é só visual.
- Cada comando continua uma transação (um passo no Ctrl+Z), mesmo com vários cursores.
