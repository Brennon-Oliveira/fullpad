---
titulo: Barra de formatação ao selecionar (estilo Notion)
feita: sim
versao: próxima (a definir ao gerar a versão)
---

# Barra de formatação ao selecionar

Ao selecionar texto num arquivo markdown, aparece uma barra flutuante acima da seleção, como a do Notion, com os comandos de texto que o markdown tem.

## O que entrou

- Tipo de bloco: texto normal, títulos 1 a 3, lista, lista numerada, lista de tarefas, citação e bloco de código.
- Negrito, itálico, tachado, código, link e limpar formatação.
- Atalhos Ctrl+B, Ctrl+I, Ctrl+K e Ctrl+Shift+X, e o submenu Markdown > Formatar (por isso também aparece na paleta).
- Cada ação é uma transação do editor (um passo no Ctrl+Z); o texto continua markdown puro.

## Ficou de fora

- **Sublinhado**: o markdown não tem; exigiria `<u>` e tratamento no preview e na exportação.
- **Cor do texto**: não existe em markdown puro.
- **Equação**: entra junto com a renderização de LaTeX, que ainda não existe.
- Itens do Notion que não cabem aqui: comentário, "habilidades" e edição com IA.

Detalhes de implementação em [AGENTS.md](../AGENTS.md) (`mdformat.ts` e `mdtoolbar.ts`).
