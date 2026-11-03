---
titulo: Visão de CSV (tabela editável com funções básicas)
feita: não
versao: —
---

# CSV

Visualização de `.csv` (e `.tsv`) como tabela, **com edição** e funções muito básicas.

## Regra de ouro

O documento continua sendo **texto puro**: a tabela é uma visão do texto. Editar uma célula reescreve só aquele trecho do CSV (uma transação do CodeMirror, um passo no Ctrl+Z); nunca normaliza o resto do arquivo. Preservar encoding e quebra de linha ao salvar, como o resto do app.

## Visão

- Tabela ao lado do código (mesmo esquema do diagrama DBML e da árvore JSON): `source`, `rendered`, `split`.
- Detecção do separador (`,`, `;`, tab) com opção manual; primeira linha como cabeçalho (alternável).
- Tabela virtualizada (arquivos grandes), colunas redimensionáveis, número de linha, congelar cabeçalho.
- Ordenar e filtrar na **visão** sem mexer no texto (ordenar de verdade, reescrevendo o arquivo, é uma ação explícita à parte).
- Ligação código ↔ tabela: o cursor no texto destaca a célula e clicar na célula leva o cursor ao trecho.

## Edição

- Editar célula direto na tabela; adicionar/remover linha e coluna; reordenar colunas.
- Aspas, vírgulas e quebras de linha dentro de células tratadas corretamente (RFC 4180) ao escrever de volta.

## Funções muito básicas

Escopo mínimo, nada de planilha completa:

- Rodapé com soma, média, mínimo, máximo e contagem da coluna ou da seleção.
- Talvez fórmulas simples por coluna, só em memória, sem gravar no arquivo, a decidir.

Fora de escopo: fórmulas encadeadas, referências entre células, gráficos, formatação.

## Como encaixa

- Parser/escritor de CSV no `crates/core` (com posições em UTF-16 por célula para a ligação com o editor), testado; a UI só desenha.
- Carregado sob demanda; nada na abertura do app.
- Tamanho máximo para ligar a visão, como no JSON.
- Dica de tipo por coluna (número, data, texto), decidida no Rust.
