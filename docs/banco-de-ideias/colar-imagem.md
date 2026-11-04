---
titulo: Colar imagem no markdown
feita: não
versao: —
---

# Colar imagem no markdown

Ctrl+V com uma imagem na área de transferência (um print, uma imagem copiada de um site) salva o arquivo e insere `![](caminho/imagem.png)` no cursor.

## Por que

Hoje o markdown só mostra imagens que já existem em algum lugar. Para anotar com prints, é o que mais falta.

## Pontos a decidir

- **Onde guardar.** Nota ligada a um arquivo: numa pasta ao lado dele (por exemplo `imagens/` ou `<nome>.assets/`). Nota solta: não há pasta "ao lado"; guardar na pasta de dados do app (junto de `notes/`) e escrever um caminho que continue valendo, ou pedir onde salvar na primeira vez.
- **Nome do arquivo**: data e hora (`2026-11-04-153012.png`) ou perguntar; nunca sobrescrever um que já exista.
- **Formato e tamanho**: PNG como vem; teto de tamanho e aviso se passar.
- **Arrastar uma imagem de fora** para o editor (hoje arrastar arquivos abre-os como abas): decidir se uma imagem solta vira texto de imagem ou segue abrindo.
- **Mostrar a imagem** no live preview e no painel renderizado, inclusive quando o caminho for relativo ao arquivo da aba (o JSON já resolve imagens locais pela pasta do arquivo, com extensões permitidas e teto de 8 MB: o mesmo cuidado serve aqui).
- Exportação para HTML autônomo: embutir a imagem em `data:` ou manter o caminho.

## Cuidados

- Gravar sempre pela escrita atômica; nunca por cima de um arquivo do usuário.
- O caminho é entrada do usuário: o app só lê imagens de extensões de imagem e não segue `..` para fora do que faz sentido.
- Colar é uma transação do editor (um passo no Ctrl+Z); desfazer não apaga o arquivo da imagem sem avisar (decidir se sobra órfão).
