---
titulo: Temas e aparência (tema, fonte e largura de leitura)
feita: não
versao: —
---

# Temas e aparência

Menos essencial, segundo o usuário, mas interessante.

## Ideia

- **Tema**: hoje o app só segue o claro/escuro do sistema. Escolher à mão (claro, escuro, sépia, automático) e, mais para a frente, temas próprios.
- **Fonte e tamanho do texto** do editor, separados do zoom da janela, e fonte do markdown renderizado.
- **Largura de leitura** do markdown: coluna mais estreita e centralizada (como no Notion), ligável.
- Altura de linha e espaçamento do texto.

## Como encaixa

- As cores já são variáveis CSS (`--bg`, `--fg`, `--accent`…) e o CodeMirror recebe o tema escuro por `tabEffects` (`dark`). Um tema é um conjunto dessas variáveis mais o realce de sintaxe.
- Lembrar a escolha em `localStorage` (como o zoom e os números de linha); por janela, vale para todas.

## Pontos a decidir

- Quais temas, e se o usuário pode escrever o próprio (um arquivo de tema na pasta de dados).
- O tema vale também para o leitor de EPUB (já troca as cores do livro no escuro), o diagrama do DBML e a exportação para HTML/PDF.
- Fontes: só as do sistema, ou embutir alguma (monoespaçada boa) no app.
