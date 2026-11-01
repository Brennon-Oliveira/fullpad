# Fullpad

Editor de notas e markdown rápido, estilo Notepad++ (nada se perde ao fechar), com markdown renderizado editável. Rust + Tauri 2 + CodeMirror 6.

Plano: [docs/PLANO.md](docs/PLANO.md)

## Estrutura

```
crates/core   persistência (sessão, notas, escrita atômica) — sem UI, testável
crates/app    Tauri: comandos IPC, janela, single-instance
ui/           TypeScript + CodeMirror 6 + Vite
```

## Rodar

Pré-requisitos: Rust, Node, pnpm.

```sh
cargo install tauri-cli --version "^2" --locked     # uma vez
pnpm --dir ui install
cd crates/app
cargo tauri dev                                     # desenvolvimento
cargo tauri build                                   # instalador / binário
cargo test -p fullpad-core                          # testes do core (na raiz)
```

O CI (`.github/workflows/build.yml`) gera o `.exe` do Windows como artifact.

- **Windows**: precisa do WebView2 (já vem no Win10/11) e do Build Tools (MSVC).
- **Linux**: `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev pkg-config build-essential`.
- Dados ficam em `%APPDATA%\fullpad` / `~/.local/share/fullpad`. `FULLPAD_DATA_DIR=/algum/lugar` sobrescreve (bom para testar sem mexer nas suas notas).
