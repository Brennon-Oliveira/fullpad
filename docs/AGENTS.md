# Fullpad

Editor de notas e markdown rápido, estilo Notepad++: nada se perde ao fechar. Markdown renderizado e editável (live preview). Rust + Tauri 2 + CodeMirror 6.

O roteiro de entrega por fases está em [PLANO.md](PLANO.md). Siga-o: cada fase termina numa PARADA em que o usuário valida antes de seguir.

## Arquitetura

```
crates/core   persistência (sessão, notas, arquivos, escrita atômica, lixeira). Sem UI, testável.
crates/app    Tauri 2: comandos IPC (load_startup, read_note, save_note, save_session, new_note, close_note, open_file, save_file), janela, single-instance.
ui/           TypeScript + CodeMirror 6 + Vite (abas, editor, live preview, menus, barra de status).
```

- A UI conversa com o Rust só por comandos IPC (`ui/src/api.ts` ↔ `crates/app/src/main.rs`). Lógica de dados vive em `crates/core`, não em `app`.
- O documento é sempre texto puro; renderizar markdown nunca reescreve o conteúdo.
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
