---
titulo: Painel de tarefas (todos os `- [ ]` num só lugar)
feita: não
versao: —
---

# Painel de tarefas

> **Estado: interessante, mas precisa de muito refinamento antes de planejar.**

Reúne as tarefas (`- [ ]` e `- [x]`) das abas e notas num painel, agrupadas por nota, com um clique para ir até a linha e marcar como feita sem sair do painel.

## Por que

A lista de tarefas já existe no markdown (e na [barra de formatação](barra-de-formatacao.md)). Falta enxergar todas juntas.

## Perguntas a refinar

- **Fonte**: só as abas abertas desta janela (como a busca global hoje), todas as notas (inclusive as fechadas e as de outras janelas) ou arquivos de uma pasta?
- **Como achar**: a busca global em Rust (`search.rs`) com uma expressão pronta, ou um leitor próprio de tarefas (precisa ignorar blocos de código).
- **O que mostrar**: pendentes primeiro, filtro por nota, por texto, por feitas; contagem ("3 de 8").
- **Marcar pelo painel**: reescrever o `[ ]` no texto da nota (uma transação por aba) com a nota possivelmente fechada ou não carregada.
- Datas, prioridade, tags: entra ou fica fora (markdown puro não tem; convenção como `@data`?).
- Forma: painel lateral (no molde do [sumário](sumario-lateral.md) e da busca global) ou janelinha da [paleta](paleta-de-comandos.md) (um prefixo novo).

## Cuidados

- Marcar uma tarefa só troca o caractere dentro dos colchetes; nunca reescreve o resto da linha.
