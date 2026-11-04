---
titulo: Links entre notas ([[nome]]) e backlinks
feita: não
versao: —
---

# Links entre notas

`[[outra nota]]` vira um link que abre (ou cria) a nota, e um painel mostra quais notas apontam para a atual.

## Ideia

- Digitar `[[` completa com os nomes das notas e arquivos (a mesma lista do Ctrl+P: abas abertas, fechadas e recentes).
- Duplo clique ou Ctrl+clique no link abre a aba; se não existe, oferece criar uma nota com esse título. Mesmo gesto dos links de URL (`links.ts`).
- **Backlinks**: um painel (no molde do [sumário lateral](sumario-lateral.md)) lista as notas que apontam para a atual, com a linha em que aparecem; clicar leva até lá.
- Já estava no "fora de escopo" da [referência com volta](referencia-com-volta.md): as duas se completam (link para uma nota, link para um ponto de PDF/EPUB).

## Pontos a decidir

- **Como resolver o nome**: pelo título da nota (a primeira linha) ou pelo nome do arquivo; o que fazer com nomes repetidos ou notas renomeadas.
- **Backlinks sem varrer tudo**: reaproveitar a busca global em Rust (`search.rs`) por `[[nome]]`, ou manter um índice simples em memória atualizado ao salvar.
- Alias `[[nome|texto]]` e links para um título dentro da nota (`[[nome#título]]`, que reaproveita o sumário).
- Escopo: só as abas e notas do Fullpad ou também arquivos de uma pasta (depende de uma futura "abrir pasta").

## Cuidados

- O documento continua texto puro; o link é só uma forma de escrever e navegar.
- Renomear uma nota não deve quebrar os links em silêncio: no mínimo avisar quais notas apontavam para ela.
