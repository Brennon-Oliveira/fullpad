---
titulo: Paleta de comandos (Ctrl+Shift+P)
feita: sim
versao: 2.0.0
---

# Paleta de comandos

Lista pesquisável (busca aproximada) de todas as ações do app: formatar JSON, trocar linguagem, dividir painel, exportar, mudar visão, zoom, reabrir aba fechada, abrir nota de versão etc.

## Ideia

- Atalho Ctrl+Shift+P abre uma janelinha com campo de filtro e lista; Enter executa, Esc fecha.
- Mostra o atalho de cada comando e o caminho do menu de onde vem.
- Comandos dependem do contexto: os do tipo de arquivo (JSON, Markdown, DBML, Texto) só aparecem quando a aba ativa os aceita, como no menu superior (`langMenuItems`).
- Recentes e mais usados primeiro.
- Também aceita prefixos úteis no futuro (`:` ir para linha, `@` símbolo/título, `>` comandos), sem fechar a porta para o sumário lateral.

## Como encaixa

- Hoje as ações vivem espalhadas em `menus.ts`. O ideal é um **registro único de comandos** (id, título, atalho, `enabled(ctx)`, `run`) do qual menus, atalhos e paleta leiam. Evita duplicar e mantém a paleta sempre em dia.
- Reaproveita `popup.ts`/janelinha de `history.ts` para o visual.
- Só UI; não exige mudança em `crates/core`.

## Cuidados

- Não perder o estado do foco do editor ao abrir/fechar a paleta.
- Mesmo comando disparado pela paleta, menu ou atalho deve ter o mesmo efeito (uma transação no CodeMirror, um passo no Ctrl+Z).

## Como saiu

Junto com a busca de arquivos (Ctrl+P), numa janelinha só: sem prefixo busca abas abertas, fechadas e recentes (mostrando a fonte à direita); `:` linha (Ctrl+G), `@` títulos/símbolos (Ctrl+Shift+O), `>` comandos (Ctrl+Shift+P). Os comandos vêm dos menus achatados, não de um registro único: isso fica como evolução. Detalhes em [AGENTS.md](../AGENTS.md).
