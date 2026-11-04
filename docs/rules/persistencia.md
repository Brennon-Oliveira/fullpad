# Persistência (`crates/core`)

A promessa do produto é **nunca perder texto**. Por isso:

- Toda gravação em disco passa por `write_atomic` (escreve em temporário e renomeia). Nunca grave direto sobre o destino: um crash no meio corromperia a nota ou o arquivo do usuário.
- `session.json` corrompido ou ilegível não pode impedir o app de abrir: renomeie-o para `session.json.corrupt` e comece com sessão vazia.
- Campos de escolha do usuário gravados na sessão (`Language`, `ViewMode`, `TabKind`) toleram valores desconhecidos (`#[serde(other)]`): uma versão mais nova do app pode gravar uma linguagem que esta não conhece, e isso não pode invalidar o `session.json` inteiro. A exceção de comportamento é `TabKind`: o desconhecido vira `Unknown` (só leitura), nunca `Text`, porque uma aba de texto ligada a um arquivo binário deixaria o usuário gravar por cima dele. `Encoding` e `Eol` ficam estritos de propósito: chutar uma codificação poderia gravar o arquivo do usuário com bytes errados.
- Fechar uma nota a move para `trash/`; não apaga. Única exceção: a nota de versão (`TabState.release_notes`), cujo texto vem embutido no app e é refeito em Ajuda > "Ver nota de versão"; ela é apagada ao fechar e não vai para o histórico.
- Abas de leitura (PDF/EPUB) nunca gravam no arquivo: `save_file` as recusa e o leitor só lê por `reader::read_range` (teto por chamada), sempre pelo id de uma aba que o usuário abriu.
- Gravar num arquivo real **nunca sobrescreve uma mudança feita por outro programa** sem a pessoa confirmar: a aba guarda o carimbo do arquivo (`disk.rs`) e `save_file` sem `force` devolve `Error::Conflict` se ele mudou desde a última leitura ou gravação. `force` só vem de uma escolha explícita ("Sobrescrever").
- Arquivos reais preservam encoding (UTF-8, UTF-8 BOM, CP1252) e quebras de linha (CRLF/LF) ao salvar.
- `core` não conhece UI nem Tauri: sem dependência de `tauri` e testável com `FULLPAD_DATA_DIR`/diretório temporário.
- Mudança aqui exige teste em `cargo test -p fullpad-core`.
