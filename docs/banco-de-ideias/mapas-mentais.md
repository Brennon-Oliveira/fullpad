---
titulo: Mapas mentais em arquivo próprio
feita: não
versao: —
---

# Mapas mentais

Criar e editar mapas mentais como um tipo de arquivo, com visão gráfica ao lado do texto.

## Ideia

- Um arquivo de texto (extensão e formato a decidir) descreve o mapa; a visão gráfica mostra os nós e as ligações e deixa criar, mover e reorganizar, escrevendo de volta no texto.
- Mesma filosofia dos outros tipos: o **texto é a fonte**; a visão é só uma forma de ver e editar. Nada de formato binário que o usuário não consiga ler num editor.

## Pontos a decidir (na hora de fazer)

- **Formato**: inventar um formato próprio (por exemplo, uma lista com recuo, fácil de escrever à mão e de ver num diff) ou adotar um já existente (Freeplane/FreeMind `.mm` em XML, OPML, o mind map do Mermaid, markmap a partir de markdown). Critérios: legível sem o app, importar/exportar, e não perder informação.
- **Edição na visão gráfica**: só leitura primeiro (como o diagrama do DBML) ou edição direta (arrastar, criar filho com Tab, irmão com Enter).
- **Posições dos nós**: layout automático (não guarda nada) ou posições salvas no arquivo.
- Reaproveitar o painel de pan/zoom e o layout dos diagramas (`ui/src/dbml/`), e talvez a biblioteca do [Mermaid](mermaid.md) se o formato for o dele.
- Exportar como imagem/SVG/PDF e como lista em markdown.
- Combina com o [sumário lateral](sumario-lateral.md): os nós de primeiro nível.

## Cuidados

- Carregar sob demanda; não pesar a abertura.
- Escrever sempre pela escrita atômica e preservar o que o formato escolhido tiver além do que o app entende.
