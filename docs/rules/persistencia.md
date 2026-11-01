# Persistência (`crates/core`)

A promessa do produto é **nunca perder texto**. Por isso:

- Toda gravação em disco passa por `write_atomic` (escreve em temporário e renomeia). Nunca grave direto sobre o destino: um crash no meio corromperia a nota ou o arquivo do usuário.
- `session.json` corrompido ou ilegível não pode impedir o app de abrir: renomeie-o para `session.json.corrupt` e comece com sessão vazia.
- Fechar uma nota a move para `trash/`; não apaga.
- Arquivos reais preservam encoding (UTF-8, UTF-8 BOM, CP1252) e quebras de linha (CRLF/LF) ao salvar.
- `core` não conhece UI nem Tauri: sem dependência de `tauri` e testável com `FULLPAD_DATA_DIR`/diretório temporário.
- Mudança aqui exige teste em `cargo test -p fullpad-core`.
