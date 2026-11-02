# Build de Windows após cada ajuste

O produto roda no Windows, mas o desenvolvimento acontece no WSL. Por isso, **ao terminar qualquer ajuste** (feature, correção, mudança de docs que afete o app não conta), gere o build de Windows antes de dar a tarefa por concluída e diga no relatório final se passou ou falhou.

## Como

Na raiz do repositório:

```sh
pnpm --dir ui build
cargo xwin build --release --target x86_64-pc-windows-msvc -p fullpad --features tauri/custom-protocol
```

- Saída: `target/x86_64-pc-windows-msvc/release/fullpad.exe`.
- `--features tauri/custom-protocol` é obrigatório: sem ele o `.exe` carrega o servidor de dev (`localhost:1420`) em vez do front embutido. O `cargo tauri build` injeta isso sozinho; o `cargo xwin` não.
- Isso gera só o `.exe` solto (verificação rápida). O instalador é a seção abaixo.
- Se o `cargo-xwin` falhar com "Failed to setup clang-cl symlink", o link velho em `~/.cache/cargo-xwin/clang-cl` aponta para um lugar que não existe mais: apague-o e rode de novo.
- Os avisos `LNK4099` (pdb de `libcmt`/`libvcruntime` não encontrado) são inofensivos.
- Pré-requisitos no WSL: `cargo-xwin`, alvo `x86_64-pc-windows-msvc` (`rustup target add`) e as ferramentas LLVM (`llvm`, `lld`, `clang`; o `tauri-winres` precisa de `llvm-rc`): `sudo apt-get install -y llvm lld clang`.

## Regras

- Falhou o build: o ajuste **não** está concluído. Conserte ou relate o erro com a saída; não pule a etapa.
- Sem as ferramentas no ambiente: diga explicitamente que o build de Windows não foi feito e por quê. Nunca declare "buildado" sem ter rodado.
- Mudanças só em `docs/` ou em arquivos que não entram no app não exigem o build.
- O `.exe` não é commitado (`target/` já é ignorado).

## Instalador (NSIS)

Configurado em `crates/app/tauri.conf.json` (`bundle`): só NSIS, instalação por usuário (`currentUser`, sem pedir administrador), em português, WebView2 baixado se faltar. A versão vem do `crates/app/Cargo.toml` (o `tauri.conf.json` não tem `version`).

A integração com o Windows **não** usa o `fileAssociations` do Tauri (ele sempre associa, grava "Open with Fullpad" em inglês e não registra `OpenWithProgids`, então o app sumia do "Abrir com" quando não era o padrão). Ela fica em:

- `crates/app/windows/installer.nsi`: cópia do template do `tauri-bundler` 2.10.4 com as linhas marcadas `FULLPAD` (inclui os ganchos depois das variáveis do Tauri, acrescenta a página e lê as escolhas no `.onInit`). **Ao atualizar o Tauri**, compare com o template novo e reaplique só essas linhas.
- `crates/app/windows/fullpad.nsh` (`installerHooks`): página "Integração com o Windows" com duas opções, as duas marcadas por padrão:
  - abrir `.md`/`.markdown`/`.dbml`/`.dbmlx` com o Fullpad por padrão (ProgIDs `Fullpad.md`/`Fullpad.dbml`, `Capabilities` + `RegisteredApplications`). O Windows não deixa um instalador passar por cima de um programa que o usuário já escolheu (`UserChoice`); nesse caso o instalador oferece abrir `ms-settings:defaultapps?registeredAppUser=Fullpad`;
  - mostrar o Fullpad em "Abrir com" nos arquivos de texto (`OpenWithProgids` numa lista de extensões e `SystemFileAssociations\text\OpenWithList`), sem mudar o padrão deles.
- As escolhas ficam em `HKCU\Software\Fullpad` (`AssocDefault`, `AssocOpenWith`): a atualização automática (modo passivo, sem páginas) reaplica o que foi escolhido. Reinstalar refaz a integração do zero, e desinstalar a remove (devolvendo o padrão anterior de cada extensão). Também limpa a associação gravada pelo instalador 0.1.0 (ProgIDs `Markdown`, `Texto`, `DBML`).

```sh
cd crates/app && cargo tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
```

- Saída: `target/x86_64-pc-windows-msvc/release/bundle/nsis/Fullpad_<versão>_x64-setup.exe` (e o `.sig` da atualização).
- Sem `TAURI_SIGNING_PRIVATE_KEY` o build falha no fim (`createUpdaterArtifacts`); use `scripts/release.sh` (abaixo), que a configura.
- Pré-requisitos extras no WSL: `cargo install tauri-cli --version "^2" --locked` e `makensis` (`sudo apt-get install -y nsis`).
- Neste `cargo-tauri` os comandos `beforeDevCommand`/`beforeBuildCommand` rodam em `crates/`, por isso o `--dir ../ui`.
- Os dados do usuário ficam em `%APPDATA%\fullpad`; o desinstalador só apaga `%APPDATA%\dev.brennon.fullpad` (a opção "apagar dados do aplicativo"), então **as notas sobrevivem à desinstalação**. Não mude o nome da pasta de dados sem rever isso.
- Sem assinatura de código: o SmartScreen avisa "editor desconhecido" na primeira execução.

## Atualização automática e publicar uma versão

O app usa o `tauri-plugin-updater` (só do lado do Rust: `check_update`, `download_update`, `install_update`). A janela principal procura versão nova 5 s depois de abrir e pelo menu Ajuda > "Verificar atualizações…"; se houver, pergunta, baixa, **grava todas as janelas** e roda o instalador em modo passivo, que fecha e reabre o app.

- O código é privado; as versões ficam nos Releases do repositório **público** `Brennon-Oliveira/fullpad-releases` (só instaladores e `latest.json`, sem código). Endpoint: `releases/latest/download/latest.json`.
- As atualizações são assinadas com uma chave própria do updater (não é assinatura de código do Windows). A pública está no `tauri.conf.json` (`plugins.updater.pubkey`); a **privada fica em `~/.tauri/fullpad.key`, fora do repositório, sem senha**. Sem ela não dá para publicar uma versão que os apps já instalados aceitem: guarde uma cópia em lugar seguro.

Para publicar, use a skill `gerar-versao` ([../skills/gerar-versao/SKILL.md](../skills/gerar-versao/SKILL.md)): ela calcula a versão pelos commits, escreve as notas, cria a tag `v<versão>` e chama o script. Por baixo:

1. Suba `version` em `crates/app/Cargo.toml` (o updater só oferece versão maior).
2. Escreva as notas em `crates/app/release-notes.md` (markdown; vão embutidas no app como a nota de versão que abre depois de atualizar).
3. `scripts/release.sh`: gera o instalador assinado, monta o `latest.json` e cria o release `v<versão>` com os dois arquivos. `PUBLISH=0` só gera.
