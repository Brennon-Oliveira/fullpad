---
titulo: Tabelas de markdown renderizadas e editáveis
feita: não
versao: —
---

# Tabelas de markdown

O live preview hoje não renderiza tabelas: elas aparecem como texto com `|`. A ideia é mostrá-las como grade e deixar editar sem cuidar do alinhamento à mão.

## Ideia

- Tabela `| a | b |` renderizada como grade no live preview, no painel renderizado e na exportação.
- Editar uma célula pela grade reescreve a tabela **alinhada** no texto. O texto continua markdown puro.
- Comandos: inserir/apagar linha e coluna, mover coluna, alinhar a coluna (`:---`, `:---:`, `---:`).
- **Converter** de e para CSV (colar um CSV vira tabela; "copiar como CSV").
- Entra na [barra de formatação](barra-de-formatacao.md) como um tipo de bloco ("Tabela") e na paleta.

## Pontos a decidir

- Só visual (renderiza) numa primeira entrega, ou já com edição na grade.
- Reaproveitar o painel de tabela do CSV (`ui/src/csv/panel.ts`: edição por célula que devolve só trocas de texto, ordenar, colar) em vez de fazer outro.
- Células com várias linhas: markdown não tem; usar `<br>` ou recusar.
- Tabelas largas: rolagem horizontal dentro do bloco, sem quebrar o layout.

## Cuidados

- Não usar margem vertical nos widgets do `.cm-md-*` (ver [AGENTS.md](../AGENTS.md)).
- Cada edição é uma transação do editor; nunca reescrever o resto do documento.
