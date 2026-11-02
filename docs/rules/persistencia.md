# Persistência (`crates/core`)

A promessa do produto é **nunca perder texto**. Por isso:

- Toda gravação em disco passa por `write_atomic` (escreve em temporário e renomeia). Nunca grave direto sobre o destino: um crash no meio corromperia a nota ou o arquivo do usuário.
- `session.json` corrompido ou ilegível não pode impedir o app de abrir: renomeie-o para `session.json.corrupt` e comece com sessão vazia.
- Campos de escolha do usuário gravados na sessão (`Language`, `ViewMode`) toleram valores desconhecidos (`#[serde(other)]`): uma versão mais nova do app pode gravar uma linguagem que esta não conhece, e isso não pode invalidar o `session.json` inteiro. `Encoding` e `Eol` ficam estritos de propósito: chutar uma codificação poderia gravar o arquivo do usuário com bytes errados.
- Fechar uma nota a move para `trash/`; não apaga. Única exceção: a nota de versão (`TabState.release_notes`), cujo texto vem embutido no app e é refeito em Ajuda > "Ver nota de versão"; ela é apagada ao fechar e não vai para o histórico.
- Arquivos reais preservam encoding (UTF-8, UTF-8 BOM, CP1252) e quebras de linha (CRLF/LF) ao salvar.
- `core` não conhece UI nem Tauri: sem dependência de `tauri` e testável com `FULLPAD_DATA_DIR`/diretório temporário.
- Mudança aqui exige teste em `cargo test -p fullpad-core`.
