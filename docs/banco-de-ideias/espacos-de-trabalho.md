---
titulo: Espaços de trabalho nomeados
feita: não
versao: —
---

# Espaços de trabalho nomeados

> **Estado: ideia crua, precisa de mais conversa antes de planejar.** O que está aqui é só o ponto de partida.

Salvar o conjunto atual de abas e painéis com um nome ("Projeto X", "Estudos") e trocar entre eles sem perder nenhum.

## Por que

O app guarda uma sessão única. Quem alterna entre assuntos acumula abas de coisas diferentes na mesma janela.

## Perguntas a refinar

- O que **é** um espaço de trabalho: só um conjunto de abas e a grade de painéis, ou também janelas flutuantes, zoom, a pasta aberta (se vier a existir a ideia de abrir pasta)?
- Ao trocar de espaço, as abas do que sai **fecham** (e ficam guardadas no espaço) ou só **escondem**? E as não salvas (notas soltas)?
- Uma aba pode estar em mais de um espaço, ou pertence a um só?
- Como trocar: menu, paleta (`>`), atalho, seletor na barra de status?
- Um espaço padrão ("Geral") para quem não quer usar o recurso?

## Pontos de apoio

- A sessão (`session.json`), `WindowState.layout` e o histórico de abas fechadas já guardam quase tudo; um espaço seria uma sessão com nome.
- Persistência segue a [regra do projeto](../rules/persistencia.md): escrita atômica, campos tolerantes, nada de perder texto ao trocar.
