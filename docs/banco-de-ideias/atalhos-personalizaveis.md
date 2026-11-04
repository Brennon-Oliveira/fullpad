---
titulo: Atalhos personalizáveis (e registro único de comandos)
feita: não
versao: —
---

# Atalhos personalizáveis

Prioridade alta, segundo o usuário. Uma tela para mudar qualquer atalho, com aviso de conflito.

## Pré-requisito: registro único de comandos

Hoje as ações vivem espalhadas: `menus.ts` (rótulos e atalhos escritos à mão), o `keydown` global em `main.ts` e os `keymap` do CodeMirror. A [paleta](paleta-de-comandos.md) contorna lendo os menus (`topMenus`). Para personalizar, o certo é um **registro único**: cada comando com `id`, título, atalho padrão, `enabled(contexto)` e `run`; menus, atalhos e paleta leem dele. Já estava como evolução na nota da paleta; esta ideia é o motivo para fazê-lo.

## Ideia

- Janela/aba "Atalhos de teclado" listando todos os comandos com o atalho atual, filtro por nome, e um campo para gravar o atalho novo (pressionar as teclas).
- **Conflitos**: avisar quando o atalho já é de outro comando e deixar trocar ou cancelar; **restaurar o padrão** de um comando ou de todos.
- Atalhos com mais de um passo (acordes, como `Ctrl+K Ctrl+C`) ficam como evolução.
- Os atalhos mostrados nos menus e na paleta passam a ser os do usuário.

## Pontos a decidir

- Onde guardar: um arquivo na pasta de dados (`keybindings.json`, legível e editável à mão) ou `localStorage`. O arquivo combina com a regra de persistência (escrita atômica, ilegível vai para `.corrupt`) e permite levar a configuração para outro computador.
- Atalhos **de dentro do CodeMirror** (editar, mover linha, vários cursores) e os **globais** do app: os dois entram no registro?
- Atalhos que o sistema/WebView toma (Ctrl+P imprime, Ctrl+G) já são interceptados; documentar o que não dá para mudar.
- Teclados com layouts diferentes: usar `e.code` (posição física) ou `e.key` (caractere); hoje o app mistura os dois.

## Cuidados

- Um arquivo de atalhos quebrado nunca pode impedir o app de abrir: volta aos padrões.
- Mesmo comando disparado pelo menu, pelo atalho ou pela paleta tem o mesmo efeito.
