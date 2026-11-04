---
titulo: Arquivos gigantes (abrir centenas de MB sem travar)
feita: não
versao: —
---

# Arquivos gigantes

Abrir arquivos muito grandes (logs, dumps, exportações de centenas de MB ou de GB) sem travar o app, lendo só o que está na tela.

## Por que

O Fullpad promete ser rápido, mas hoje o texto inteiro vai para o editor: acima de alguns MB o CodeMirror e o resto do app sofrem, e os modos com análise (JSON, YAML, CSV) já desligam a visão acima de um teto.

## Ideia

- Um **modo de arquivo grande**: acima de um limite, a aba abre em leitura por faixas (o arquivo fica no disco, o Rust devolve só as linhas da tela), como já fazemos com o CSV (`csv_rows`) e o PDF (`reader_read`).
- Índice de linhas construído em segundo plano (posições de início de cada linha), para rolar e ir para a linha (`:42` da [paleta](paleta-de-comandos.md)) sem ler tudo.
- Busca (Ctrl+F) e busca global rodando no Rust, em fluxo, com resultados que chegam aos poucos e cancelável.
- Saber o que acontece com a **edição**: provavelmente só leitura no começo (mais seguro); editar arquivo gigante é outro problema.
- Base para o [seguir log](seguir-log.md).

## Pontos a decidir

- **Limite** para entrar no modo (por exemplo 20 MB?) e o aviso ao usuário ("aberto em modo de leitura por ser grande").
- Leitura somente ou edição limitada (aplicar trocas pequenas gravando por faixa, com escrita atômica de arquivo enorme sendo um problema à parte: o `write_atomic` copia o arquivo inteiro).
- Codificação e quebra de linha: detectar por amostra, não pelo arquivo todo.
- Linhas gigantes (um JSON minificado de 200 MB numa linha só): o índice por linha não ajuda; decidir um teto de comprimento por linha na tela.
- Destaque de sintaxe só na faixa visível, ou nenhum.

## Cuidados

- O arquivo é do usuário: o modo de leitura **nunca grava** (mesma regra das abas de leitura de PDF/EPUB).
- Teto de memória no Rust por chamada, como em `reader::read_range`.
