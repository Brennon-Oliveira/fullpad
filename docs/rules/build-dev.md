# Build de desenvolvimento (convive com o app instalado)

O mantenedor tem o Fullpad **instalado e em uso** no Windows. O build que o agente gera a cada ajuste é de **desenvolvimento** e nunca pode afetar o instalado: nem dados, nem janelas, nem atualização, nem atalho. Por isso o build de desenvolvimento é **outro aplicativo** para o sistema:

| | Instalado (produção) | Desenvolvimento |
|---|---|---|
| Executável | `fullpad.exe` | `fullpad-dev.exe` (`target/dev/`) |
| Identificador | `dev.brennon.fullpad` | `dev.brennon.fullpad.dev` (instância única, dados do WebView2 e `localStorage` à parte) |
| Pasta de dados | `%APPDATA%\fullpad` | `%APPDATA%\fullpad-dev` |
| Ícone | azul | **vermelho** (`crates/app/icons-dev/`, gerado por `scripts/gerar-icones-dev.py`) |
| Título da janela | `… — Fullpad` | `… — Fullpad DEV`, faixa vermelha no topo e selo "DEV" |
| Atualização automática | sim | **desligada** (`check_update` devolve nada) |
| Atalho global Ctrl+Alt+N | registrado | **não registrado** (tomaria o do instalado) |

`FULLPAD_DATA_DIR` continua sobrescrevendo a pasta de dados nos dois.

## Como funciona

- `crates/app/Cargo.toml`: feature **`dev-build`** (`DEV_BUILD` em `main.rs`) escolhe a pasta `fullpad-dev` (`Store::open_default_named`), desliga atalho e atualização e faz o `load_startup` devolver `dev: true` (a UI mostra a marca e o título).
- `crates/app/tauri.dev.conf.json`: identificador, nome e ícones do build de desenvolvimento. Entra por `TAURI_CONFIG` **só** na compilação de desenvolvimento (o `tauri.conf.json` não muda).
- `scripts/dev-windows.sh`: o comando do dia a dia. Compila para `target/dev` (diretório de alvo próprio: não disputa o cache com o build de produção), copia o `.exe` para `target/dev/fullpad-dev.exe`, **fecha só o `fullpad-dev.exe` aberto** e abre o novo. **Nunca use `taskkill /IM fullpad.exe`**: é o nome do app instalado.

```sh
scripts/dev-windows.sh                        # compila, fecha o DEV aberto e abre o novo
scripts/dev-windows.sh /caminho/arquivo.dbmlx # idem, abrindo o arquivo
scripts/dev-windows.sh --no-run               # só compila
```

A primeira compilação do `target/dev` é longa (todas as dependências); as seguintes são rápidas.

## Regra para o agente

Ao terminar um ajuste (testes passando e commit feito): rode `scripts/dev-windows.sh` (**sem** passar o arquivo se ele já está nas abas restauradas: passá-lo de novo abre uma aba duplicada), confira que o processo novo subiu e **escreva na resposta** "app DEV fechado e reaberto às HH:MM:SS (processo novo, depois do build das HH:MM)". O hook `Stop` (`scripts/check-build-windows.sh`) cobra o build de desenvolvimento.

## Versão de produção

O instalador e o `scripts/release.sh` (skill `gerar-versao`) **nunca** usam nada daqui: o `release.sh` faz `unset TAURI_CONFIG`, não liga a feature `dev-build` e usa o `tauri.conf.json` (identificador, nome e ícones de produção, pasta `fullpad`, atalho e atualização ligados). Conferir isso faz parte de gerar a versão (passo 6 da skill).

## Colaboradores

Para rodar o seu build sem tocar nos dados de um Fullpad instalado, use o mesmo mecanismo: `cargo tauri dev --features dev-build --config crates/app/tauri.dev.conf.json` (Linux/macOS/Windows nativo) usa a pasta `fullpad-dev` e outro identificador. `FULLPAD_DATA_DIR=/tmp/fullpad-teste` isola ainda mais.
