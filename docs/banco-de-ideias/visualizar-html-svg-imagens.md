---
titulo: Ver HTML, SVG e imagens (visão segura)
feita: não
versao: —
---

# Ver HTML, SVG e imagens

Abrir imagens como aba e dar uma visão renderizada ao lado do código para `.html` e `.svg`. O usuário só quer se for **seguro**: "como fizemos com o EPUB, acho viável".

## Ideia

- **Imagens** (`.png`, `.jpg`, `.gif`, `.webp`, `.bmp`, `.ico`): aba só de visualização, com zoom, como o PDF (nunca gravada).
- **SVG**: visão renderizada ao lado do código.
- **HTML**: visão renderizada ao lado do código (já existe `examples/example.html`, que hoje abre como texto).

## Segurança (o ponto central)

Seguir o mesmo modelo do EPUB (`core::epub`, `epubdoc.ts`), que já resolveu isto:

- **SVG** vai como imagem (`<img src="data:image/svg+xml,…">`): dentro de `<img>` o navegador **não executa scripts nem carrega recursos externos**. É a forma mais segura e basta para ver o desenho. Não colocar o SVG inline na página.
- **HTML**: passar pelo **`ammonia`** (lista de permissão) no Rust, como o XHTML do EPUB: sem `<script>`, eventos (`onclick`…), `iframe`, `form`, `object`/`embed`, `base`, `meta`, `link`; links só `http`/`https`/`mailto` abrindo pelo navegador do sistema (`open_url`); imagens locais lidas pelo Rust e entregues como `data:` com teto de tamanho, imagens remotas **não carregam**.
- CSS do HTML pelo `css::sanitize` (lista de permissão, sem `url()`, `@import`, `position`).
- Mostrar num `<iframe sandbox>` **sem** `allow-scripts`, com CSP `default-src 'none'; img-src data:`.
- Imagens: só extensões de imagem, teto de tamanho (como os 8 MB do `json_preview_image`), lidas pelo Rust a partir do que o usuário abriu; nunca protocolo de arquivos aberto.

## Pontos a decidir

- HTML "de verdade" depende de scripts e CSS externo: a visão segura mostra o **documento**, não um site funcionando. Deixar isso claro na interface ("visão sem scripts").
- Imagens muito grandes (dezenas de Mpx): como no PDF, ignorar acima de um limite.
- SVG animado e SVG com fontes/imagens externas: mostrar sem os recursos externos.
- Ligação código ↔ visão (cursor destaca o elemento) fica para depois.

## Cuidados

- O arquivo é do usuário: a visão **nunca grava** nele.
- Qualquer coisa que o sanitizador não conhecer é removida, nunca repassada.
