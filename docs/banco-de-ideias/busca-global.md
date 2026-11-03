---
titulo: Busca em todas as abas + refação visual completa da busca
feita: sim
versao: próxima (a definir ao gerar a versão)
---

# Busca em todas as abas (Ctrl+Shift+F)

Duas partes que devem sair **juntas**:

## 1. Localizar em todos os arquivos, resultados agrupados

- Busca em todas as abas abertas (de todos os painéis da janela e, como opção, de todas as janelas).
- Resultados agrupados por aba, cada grupo com a contagem e as linhas com o trecho destacado; clicar leva à aba e ao trecho exato.
- Opções: diferenciar maiúsculas, palavra inteira, expressão regular.
- Substituir em todas as abas (com pré-visualização e uma confirmação; cada aba muda numa transação, para o Ctrl+Z funcionar).
- Opcional: incluir o histórico de abas fechadas (`trash/`), reforçando "nada se perde".
- A busca de conteúdo roda no Rust (`crates/core`) sobre as notas da sessão, para não depender de montar todos os editores; deve ser testável.

## 2. Refação visual completa da busca

Motivação: a busca atual (localizar/substituir) está **muito feia**. Redesenhar a experiência inteira, não só a busca global:

- Painel de busca com identidade visual do app (espaçamento, tipografia, ícones, tema claro/escuro).
- Barra de localizar/substituir do editor refeita no mesmo estilo: campos, alternadores (Aa, palavra, regex) e contador "3 de 12" claros.
- Estados vazios e de erro (regex inválida, nenhum resultado) bem resolvidos.
- Atalhos visíveis e teclado primeiro (Enter/Shift+Enter, Esc, setas na lista de resultados).
- Funcionar bem no markdown renderizado, JSON e DBML.

## A decidir

- Painel lateral fixo ou janelinha flutuante (como `history.ts`)?
- Busca global em arquivos em disco (pasta) fica fora; só abas do Fullpad.

## Entregue

Painel lateral fixo (`globalsearch.ts`), busca no Rust (`search.rs`) e a barra de localizar/substituir refeita (`searchpanel.ts`). Ficaram de fora, por ora: todas as janelas, o histórico de fechadas e a busca na tabela do CSV e na árvore do JSON.
