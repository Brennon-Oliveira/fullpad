---
titulo: Comparar (diff) entre abas e com o arquivo em disco
feita: não
versao: —
---

# Comparar (diff)

Ver o que mudou entre dois textos, lado a lado, com as diferenças destacadas.

## Ideia

- **Duas abas**: escolher duas abas (ou clicar numa aba e "Comparar com…") e abrir a comparação.
- **Aba com o arquivo em disco**: quando o arquivo mudou por fora, em vez de só avisar, mostrar o que mudou e deixar escolher: manter o do app, recarregar o do disco ou comparar. Hoje o leitor de PDF/EPUB já avisa "arquivo alterado" com uma faixa; as abas de texto poderiam ganhar a mesma checagem.
- Destaque de linhas acrescentadas, removidas e alteradas, com salto para a próxima diferença.

## Pontos a decidir

- Diff por linha ou também por palavra dentro da linha alterada.
- Só ver ou também **aceitar trechos** (levar uma diferença de um lado para o outro).
- Onde aparece: dois painéis da grade de painéis (já existe a divisão) ou uma visão própria.
- Algoritmo: no Rust (`crates/core`, testável, sem UI) ou na UI; arquivos grandes pedem um teto de tamanho.
- Combinaria com um histórico de versões das notas, se um dia existir (comparar com um ponto anterior).

## Cuidados

- Comparar nunca altera nenhum dos textos; só aceitar trechos escreve, em uma transação (um passo no Ctrl+Z).
- Respeitar `\r\n` e a codificação do arquivo real.
