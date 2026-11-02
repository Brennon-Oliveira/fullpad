# Fullpad

Editor de notas e markdown rápido, estilo Notepad++: nada se perde ao fechar. Markdown renderizado e editável (live preview). Rust + Tauri 2 + CodeMirror 6.

O roteiro de entrega por fases está em [PLANO.md](PLANO.md). Siga-o: cada fase termina numa PARADA em que o usuário valida antes de seguir.

## Arquitetura

```
crates/core   persistência (sessão, notas, arquivos, escrita atômica, lixeira). Sem UI, testável.
crates/app    Tauri 2: comandos IPC (load_startup, read_note, save_note, save_window, new_note, close_note, open_file, save_file, export_file, list_windows, move_tab, new_window, prewarm, begin_tear, drag_move, end_tear, window_ready, open_preview, preview_info, close_preview, exit_app), janelas, single-instance.
ui/           TypeScript + CodeMirror 6 + Vite (abas, editor, live preview, menus, barra de status).
ui/src/codelangs.ts  linguagens dos blocos de código do markdown (carga sob demanda; para acrescentar uma, é só mais uma entrada).
ui/src/dbmllang.ts  destaque de sintaxe do DBML (CodeMirror StreamLanguage; pequeno, entra no bundle de abertura).
ui/src/entry.ts  ponto de entrada: janelas `preview-*` carregam `previewwin.ts`, as demais `main.ts`.
ui/src/previewwin.ts  janela só com a visão renderizada (preview/diagrama) de uma aba de outra janela.
ui/src/tabdrag.ts  arrastar abas (reordenar e tirar da janela) com eventos de ponteiro.
ui/src/mdpreview.ts  painel do markdown renderizado (somente leitura) para a visão lado a lado; carga sob demanda.
ui/src/dbml/  diagrama DBML (parse → modelo → layout dagre → SVG, pan/zoom). Carregado só sob demanda.
```

- A UI conversa com o Rust só por comandos IPC (`ui/src/api.ts` ↔ `crates/app/src/main.rs`). Lógica de dados vive em `crates/core`, não em `app`.
- Visão do arquivo (`mode` da aba): `source` (só código), `rendered` (markdown renderizado no próprio texto; no DBML, diagrama ao lado) ou `split` (código e renderizado lado a lado; Ctrl+Shift+E). Menu Visualizar e botão "Visão" da barra de status.
- Janelas: cada aba pertence a uma janela (`TabState.window`; `main` é a principal e encerrar o app). Todas as janelas rodam a mesma UI e só enxergam as próprias abas (`load_startup` devolve `Session::view_for`). `session.json` é único: `save_window` só **atualiza e reordena** as abas da janela (nunca remove: uma aba pode estar chegando de outra janela); fechar é `close_note`, mover é `move_tab`/`end_tear`, que gravam a aba na janela de destino e avisam por evento `tab-incoming`. Ao mover, o texto pendente é gravado antes e o histórico de desfazer fica para trás. Fechar uma janela flutuante devolve as abas à principal; fechar a principal grava tudo (`app-exit`) e encerra. Janelas flutuantes são reabertas na posição salva e não têm o menu superior (só abas e barra de status).
- Arrastar uma aba para fora da barra (`tabdrag.ts` + `begin_tear`/`drag_move`/`end_tear`): a aba vai na hora para uma janela própria que **segue o mouse**, como no Chrome; para isso o Rust mantém uma janela reserva escondida e já carregada (`prewarm`, label `spare-*`), que espera a aba em silêncio e só aparece ao recebê-la (`window_ready`). Sobre a barra de abas de outra janela a arrastada se esconde e essa barra mostra um espaço com o título no lugar exato da inserção (`drag-over`/`drag-leave`); ao soltar, `tab-incoming` insere ali. Uma janela de uma aba só anda ela mesma. Toda janela escuta `tab-incoming` **antes** de ler a sessão (`incomingReady`), senão uma aba que chegasse nesse intervalo se perderia.
- Visão em janela separada: `TabState.detached` (menu Visualizar > "... em janela separada"). A aba continua uma só, na janela dona; a janela `preview-<aba>` recebe o texto por eventos (`pv-text`, `pv-cursor`) e devolve `pv-hover:<aba>` (destaque da linha no código), `pv-ready:<aba>` e `pv-closed:<aba>` (fechar a janela traz a visão de volta ao lado do código). Mover a aba de janela ou escolher outra visão a recoloca ao lado do código.
- O documento é sempre texto puro; renderizar markdown ou DBML nunca reescreve o conteúdo.
- DBML: o painel, o diagnóstico (e o autocomplete) compartilham um único `Compiler` em `ui/src/dbml/service.ts`; `ui/src/dbml/editor.ts` entrega os recursos de editor por `import()` dinâmico. `.dbml`/`.dbmlx` ou escolha manual no menu Linguagem (sem detecção por conteúdo). O diagrama usa `@dbml/parse` **v11** (entende a sintaxe nova: relações opcionais `?>`/`<?`, `Records`; o `@dbml/core` pesa 15 MB e a 3.9 não conhece a sintaxe nova) com um `MemoryProjectLayout` de um arquivo só e `@dagrejs/dagre`, ambos via `import()` dinâmico em `ui/src/dbml/panel.ts`: **nada de `dbml/` pode ser importado estaticamente a partir de `main.ts`**, para não pesar a abertura do app. Só visualização por enquanto (sem posições salvas). O modelo guarda o trecho do texto de cada elemento (`span`): passar o mouse no diagrama pinta a linha no código (`hintLines` em `editor.ts`, sem selecionar) e o cursor do editor destaca o elemento no diagrama (`Rendered.focusAt`). Os dois só valem se o diagrama for da mesma versão do texto (`docRev`), senão os trechos apontariam para o lugar errado.
- Dados em `%APPDATA%\fullpad` / `~/.local/share/fullpad`. `FULLPAD_DATA_DIR=/caminho` sobrescreve (use para testar sem mexer nas notas reais).

## Rodar e testar

Pré-requisitos: Rust, Node, pnpm. Dependências de sistema do Linux estão no `README.md`.

```sh
pnpm --dir ui install
cargo test -p fullpad-core            # testes do core (na raiz)
pnpm --dir ui exec vitest run         # testes da UI
pnpm --dir ui build                   # tsc --noEmit + vite build
cd crates/app && cargo tauri dev      # app em desenvolvimento
cd crates/app && cargo tauri build    # instalador / binário
```

Não há pipeline de CI por enquanto (nenhum workflow do GitHub); testes e build rodam localmente. Neste WSL só `core` e a UI compilam nativamente (faltam libs do webkit para `app`); o `app` para Windows sai por cross-compile ([rules/build-windows.md](rules/build-windows.md)). Veja "Pendências de ambiente" no PLANO.

## Convenções

- Código e identificadores seguem o que já existe no módulo; texto de UI, docs e commits em português.
- Mudou comportamento, arquitetura, comando ou convenção: atualize `docs/` no mesmo commit (veja [rules/harness.md](rules/harness.md)).
- Commits: [rules/commits.md](rules/commits.md).
- Persistência (`crates/core`): [rules/persistencia.md](rules/persistencia.md).
- Ao terminar qualquer ajuste, gere o build de Windows e reporte o resultado: [rules/build-windows.md](rules/build-windows.md).

## Segurança

- Sem segredos no repositório. Caminhos de arquivo vindos da UI são tratados como entrada do usuário: o app só lê/grava o que o usuário abriu ou salvou explicitamente.
- Nunca sobrescreva arquivo do usuário sem escrita atômica (veja a regra de persistência).
