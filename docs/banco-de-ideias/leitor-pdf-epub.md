---
titulo: Leitor de PDF e EPUB (aba binária, só leitura)
feita: não
versao: —
---

# Leitor de PDF e EPUB

Abrir PDF e EPUB dentro do Fullpad **somente para ler**. Não haverá edição nesta ideia.

## Base comum: aba binária / só leitura

Hoje o documento é sempre texto puro (`Encoding` UTF-8/CP1252, `read_note`/`save_note`). PDF e EPUB são binários, então precisam de um tipo de aba novo:

- Só leitura, **nunca grava** no arquivo. Não passa por `save_note` nem por `write_atomic` sobre o original.
- Aberta por caminho (o usuário abriu explicitamente); a sessão guarda só o caminho e a posição de leitura (página/capítulo, rolagem, zoom), nunca o conteúdo do arquivo.
- Leitura dos bytes por comando IPC no Rust (`crates/core` decide o que pode ser lido). Sem protocolo de arquivos aberto, seguindo a regra de segurança do projeto.
- Tolerar valores desconhecidos em campos novos da sessão (`#[serde(other)]`), como já é regra para `Language`/`ViewMode`.
- Integra com o que já existe: painéis, arrastar aba entre janelas, histórico de abas fechadas, barra de status (página X de Y, zoom).

Esta base é a primeira entrega; PDF e EPUB entram em cima dela.

## PDF: usar pdf.js

Decisão: **pdf.js** (Mozilla). Preferido ao `<embed>` nativo porque o WebKitGTK (Linux) não abre PDF e porque queremos controle de zoom, tema e barra de status.

- Carga sob demanda via `import()` (como DBML e `marked`): nada de pdf.js no bundle de abertura. O worker também só carrega ao abrir um PDF.
- Páginas em `<canvas>` virtualizadas, camada de texto selecionável, busca no documento, zoom próprio (convive com o zoom da janela de `zoom.ts`).
- Tema escuro opcional (inverter/filtrar o canvas).
- Links dentro do PDF: só `http`/`https`/`mailto`, pelo `open_url`.

## EPUB: ler o epub.js, recriar melhor em Rust

Decisão: **não usar o epub.js como dependência.** Ele serve só de **referência de leitura** (como o formato é interpretado, os casos de borda, a ordem de resolução). A implementação é nossa, **em Rust + a estrutura do Fullpad**, no espírito do `json.rs`: lógica no `crates/core`, testável, sem UI.

Plano da implementação:

- `crates/core`: leitor de EPUB (ZIP via crate `zip`): `container.xml` → `content.opf` (metadados, manifest, spine) → `nav`/`toc.ncx` (sumário). Erros claros e tolerância a EPUBs malformados.
- Capítulo em XHTML é **sanitizado no Rust** (sem scripts, sem eventos inline, sem recursos externos) antes de ir para a UI.
- Imagens/CSS internos servidos por comando IPC restrito ao conteúdo do próprio EPUB aberto (nada fora do ZIP).
- UI: renderiza em iframe com `sandbox`, usando o tema do app; rolagem contínua primeiro, paginação depois.
- Sumário lateral reaproveita a ideia de [sumário lateral](sumario-lateral.md).
- Escopo: EPUB reflowable (cobre quase tudo). Fixed-layout e mídia embutida ficam de fora no início.
- Testes em `cargo test -p fullpad-core` com EPUBs de exemplo pequenos (válido, sem toc, zip corrompido, com script malicioso).

## Fora de escopo agora

- Editar PDF ou EPUB.
- Anotações/marcações.
- Converter EPUB/PDF em markdown (pode virar ideia própria depois; combina com "documento é sempre texto").

## Ordem sugerida

1. Aba binária/só leitura.
2. PDF (pdf.js).
3. EPUB (leitor em Rust).
4. Persistir posição de leitura.
