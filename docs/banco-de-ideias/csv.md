---
titulo: Visão de CSV (tabela editável com funções básicas)
feita: sim
versao: 1.1.0
---

# CSV

Visualização de `.csv` (e `.tsv`) como tabela, **com edição** e funções muito básicas. Entregue na [Fase 11](../PLANO.md).

## Regra de ouro

O documento continua sendo **texto puro**: a tabela é uma visão do texto. Editar uma célula reescreve só aquele trecho do CSV (uma transação do CodeMirror, um passo no Ctrl+Z); nunca normaliza o resto do arquivo. Preservar encoding e quebra de linha ao salvar, como o resto do app.

Preservação ao editar (decidido):

- Só os caracteres da célula mudam. O resto do arquivo (`\r\n`, linhas em branco, aspas que já existiam em outras células) fica byte a byte igual.
- Valor novo só ganha aspas se precisar (separador, aspas ou quebra de linha dentro dele; `"` vira `""`). Célula que já tinha aspas e ainda cabe nelas as mantém.

## Visões (como o markdown)

Três visões, a mesma `ViewMode` do resto do app:

- `rendered`: **só a tabela editável**. É a **padrão** ao abrir um CSV.
- `source`: só o código.
- `split`: código e tabela lado a lado (Ctrl+Shift+E).

Menu Visualizar e botão "Visão" da barra de status, como no markdown. Menu superior "CSV" (separador, cabeçalho, visão).

## Tabela

- Virtualizada, **lendo por faixas**: o Rust guarda só um índice de linhas e a UI pede as que estão na tela. Serve para arquivos grandes (meta: dezenas de MB; o teto exato sai da medição na 11.A).
- Colunas redimensionáveis, número de linha, cabeçalho congelado, primeira linha como cabeçalho (alternável).
- Ordenar e filtrar na **visão**, sem mexer no texto. Ordenar de verdade, reescrevendo o arquivo, é uma ação explícita à parte.
- Ligação código ↔ tabela: o cursor no texto destaca a célula e clicar na célula leva o cursor ao trecho (só vale se a tabela é da mesma versão do texto, `rev`, como no JSON).
- Dica de tipo por coluna (número, data, texto), decidida no Rust; número alinhado à direita.

## Separador

- **Detecção automática** pela estrutura, não pela extensão só: `.tsv` é tab; nos demais, testa-se `,` `;` tab (e `|`) contando os separadores **fora das aspas** nas primeiras linhas. Vence o candidato cuja contagem é a mesma (e maior que zero) em todas as linhas amostradas, começando pelo cabeçalho. Sem candidato consistente, usa `,`.
- **Escolha manual** no menu "CSV". A escolha fica em `TabState` (por aba/arquivo, sobrevive a reiniciar, opaca para o Rust como o `reader`) e **vale dali em diante**: o app nunca mais redetecta sobre uma escolha manual. Há a opção "Automático" para voltar.
- Cabeçalho (ligado/desligado) e separador decimal moram no mesmo campo.

## Edição (etapas 2 e 3 da fase)

- Editar célula direto na tabela (duplo clique, F2 ou digitando; Enter grava e desce, Tab grava e anda, Esc cancela, Delete esvazia a seleção). **Entregue na 11.D.**
- Renomear coluna (célula do cabeçalho), colar um bloco de células em qualquer formato (Ctrl+V; tab/quebra/aspas como no Excel), altura por linha. **Entregues junto da 11.E.**
- Adicionar/remover linha e coluna; reordenar colunas; ordenar o arquivo de verdade (ação explícita). **Entregue na 11.E.**
- Aspas, separadores e quebras de linha dentro de células tratados corretamente (RFC 4180) ao escrever de volta.

## Funções muito básicas

- Rodapé com soma, média, mínimo, máximo e contagem da coluna ou da seleção.
- **Números**: o separador decimal é o **ponto** por padrão, sem inferência. O usuário pode trocar para vírgula no menu "CSV"; a escolha fica por aba, no mesmo campo do separador e do cabeçalho, e sobrevive a reiniciar. Valor que não é número naquele formato fica de fora da conta (e o rodapé diz quantos), em vez de ser adivinhado.
- **Fórmulas: fora do escopo** (nem em memória).

Fora de escopo: fórmulas de qualquer tipo, referências entre células, gráficos, formatação.

## Como encaixa

- Parser/escritor de CSV no `crates/core` (`csv.rs`, posições em UTF-16 por célula para a ligação com o editor), testado; a UI só desenha.
- Colorir as colunas no editor de código (uma decoração por coluna, cores que se repetem), útil mesmo sem a tabela.
- Carregado sob demanda; nada na abertura do app.
- Tamanho máximo para ligar a visão, como no JSON.
