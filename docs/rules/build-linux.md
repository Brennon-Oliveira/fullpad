# Build de Linux

O Fullpad roda no Linux com o mesmo código do Windows (Tauri 2 sobre WebKitGTK). O desenvolvimento acontece num Linux (WSL), então o app compila e roda **nativamente**; só o Windows precisa de cross-compile ([build-windows.md](build-windows.md)).

## Dependências

`sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev pkg-config build-essential` O `.rpm` é montado pelo próprio bundler do Tauri (não precisa de `rpmbuild`). O pacote do Arch é montado por `scripts/pacman.py` (precisa só do Python 3.14, pelo `compression.zstd`; nada de `makepkg` nem do binário `zstd`). O AppImage baixa o `linuxdeploy` na primeira vez (precisa de rede).

## Verificação rápida

```sh
cargo check -p fullpad
cargo test -p fullpad-core && cargo test -p fullpad
pnpm --dir ui exec vitest run
```

## Pacotes

```sh
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/fullpad.key" TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
cd crates/app && cargo tauri build --bundles appimage,deb,rpm
```

O pacote do Arch (`.pkg.tar.zst`) vem depois, pelo mesmo `.deb`: `python3 scripts/pacman.py target/release/bundle <versão> target/release/bundle/pacman`. Saída em `target/release/bundle/{appimage,deb,rpm,pacman}/` (cada um com o `.sig` da atualização). `scripts/release.sh` gera os três **em paralelo** com o instalador de Windows (a UI compila uma vez, o `beforeBuildCommand` fica desligado e o Linux usa `CARGO_TARGET_DIR=target/linux`, senão o cargo serializaria os dois no lock do `target/`; saída em `target/linux/release/bundle/`) e, no fim, `scripts/pacman.py`, que reaproveita a árvore de arquivos do `.deb` (o Tauri CLI não tem alvo pacman) e escreve `fullpad-<versão>-1-x86_64.pkg.tar.zst` (`.PKGINFO` com `depend = webkit2gtk-4.1` e `gtk3`, `.MTREE`, sem assinatura) em `bundle/pacman/`. Instala-se com `sudo pacman -U fullpad-<versão>-1-x86_64.pkg.tar.zst`. O release publica os quatro arquivos, **mas o pacote do Arch fica fora do `latest.json`**: o atualizador do Tauri só conhece AppImage, deb e rpm, então quem instala pelo pacman atualiza instalando o pacote novo (a atualização automática de dentro do app não vale para ele). O script **não publica nada se qualquer um falhar**: o Linux funcionar é critério para lançar e põe no `latest.json` as chaves `linux-x86_64-appimage`/`-deb`/`-rpm` (o atualizador escolhe pelo tipo de pacote em que o app foi instalado; `LINUX=0` pula). Atualizar no Linux: AppImage troca o próprio arquivo; `.deb` e `.rpm` pedem a senha pelo `pkexec`; depois de instalar, o app reinicia sozinho (`install_update`).

`crates/app/linux/fullpad.desktop` é o modelo do atalho (deb, rpm e AppImage usam o mesmo): `Exec=fullpad %F` (abre arquivos passados pelo gerenciador de arquivos, inclusive `file://`) e `MimeType` com os tipos de texto, o que põe o Fullpad no "Abrir com" **sem tomar o padrão de ninguém**. DBML, PDF e EPUB não têm tipo MIME padrão e ficam de fora.

## Ambiente gráfico (`linux_env` em `main.rs`)

- **Wayland:** o app força o backend **X11 (XWayland)**, porque o Wayland não deixa o app posicionar janelas, mantê-las no topo nem registrar atalho global, e o Fullpad usa os três (arrastar aba para fora, post-its, "Manter no topo", Ctrl+Alt+N). Custo: em tela com escala fracionária o texto pode ficar menos nítido. `FULLPAD_WAYLAND=1` mantém o Wayland nativo (perde esses recursos); um `GDK_BACKEND` definido pela pessoa sempre vale.
- `WEBKIT_DISABLE_DMABUF_RENDERER=1` por padrão (tela em branco em NVIDIA e no WSLg); defina a variável você mesmo para mudar.
- **Criar janela escondida e mexer nela:** no Linux a janela GTK só existe depois de mostrada. Chamar, por exemplo, `set_ignore_cursor_events` antes do `show` derruba o app (pânico no `tao`); faça depois de mostrar (foi o bug da janela-sombra do arrasto).
- Atalho global: se o desktop já usa Ctrl+Alt+N, o registro falha, vai para o stderr e o app segue.

## O que é igual e o que difere do Windows

Igual: tudo da UI, os dados (`~/.local/share/fullpad`, `FULLPAD_DATA_DIR`), leitores, post-its, grade de painéis, atualização automática assinada. Difere: não há integração de instalador (os pacotes só registram o "Abrir com"), novas notas usam LF (`Eol::default`), sem ícone de bandeja.

Não testado em Wayland nativo nem em outros desktops além do WSLg; problemas vão para issues.
