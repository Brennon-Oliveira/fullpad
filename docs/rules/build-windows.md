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
- Gera só o `.exe`, sem instalador. Não há pipeline no GitHub por enquanto; o instalador NSIS fica para quando houver.
- Se o `cargo-xwin` falhar com "Failed to setup clang-cl symlink", o link velho em `~/.cache/cargo-xwin/clang-cl` aponta para um lugar que não existe mais: apague-o e rode de novo.
- Os avisos `LNK4099` (pdb de `libcmt`/`libvcruntime` não encontrado) são inofensivos.
- Pré-requisitos no WSL: `cargo-xwin`, alvo `x86_64-pc-windows-msvc` (`rustup target add`) e as ferramentas LLVM (`llvm`, `lld`, `clang`; o `tauri-winres` precisa de `llvm-rc`): `sudo apt-get install -y llvm lld clang`.

## Regras

- Falhou o build: o ajuste **não** está concluído. Conserte ou relate o erro com a saída; não pule a etapa.
- Sem as ferramentas no ambiente: diga explicitamente que o build de Windows não foi feito e por quê. Nunca declare "buildado" sem ter rodado.
- Mudanças só em `docs/` ou em arquivos que não entram no app não exigem o build.
- O `.exe` não é commitado (`target/` já é ignorado).
