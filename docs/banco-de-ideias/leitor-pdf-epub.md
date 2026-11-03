---
titulo: Leitor de PDF e EPUB (aba binária, só leitura)
feita: não
versao: —
---

# Leitor de PDF e EPUB

> **Andamento:** a base (aba binária) e o PDF básico estão feitos, na [Fase 10 do PLANO](../PLANO.md) (aguardando a PARADA do usuário). Falta a integração com as notas no PDF e o EPUB. O comportamento atual está em `docs/AGENTS.md`; esta ideia só vira `feita: sim` quando o EPUB sair.

Abrir PDF e EPUB dentro do Fullpad **somente para ler**. Não haverá edição nesta ideia.

Prioridades, nesta ordem:

1. **Abrir o app e abrir um arquivo continuam imediatos**, como numa nota de texto. Nada de PDF/EPUB pesa na abertura. Diagramas, PDF e EPUB podem demorar um pouco para carregar, e o tamanho do binário não é problema.
2. **Integração com as notas** vale mais que recursos de leitura. O leitor melhora depois.
3. Segurança: o arquivo aberto é entrada não confiável.

## Base comum: aba binária / só leitura

Hoje o documento é sempre texto puro (`Encoding` UTF-8/CP1252, `read_note`/`save_note`). PDF e EPUB são binários, então precisam de um tipo de aba novo:

- Só leitura, **nunca grava** no arquivo. Não passa por `save_note` nem por `write_atomic` sobre o original.
- Tipo da aba em um campo próprio `kind` (`text` / `pdf` / `epub`) em `TabState`, com `#[serde(other)]` (não reaproveitar `Language`). O menu do tipo de arquivo (`langMenuItems`) mostra "PDF" ou "EPUB" conforme a aba.
- Aberta por caminho (o usuário abriu explicitamente); a sessão guarda só o caminho e a posição de leitura (página/capítulo, rolagem, zoom), nunca o conteúdo do arquivo. Cada leitor grava a sua posição.
- Tolerar valores desconhecidos em campos novos da sessão (`#[serde(other)]`), como já é regra para `Language`/`ViewMode`.
- Integra com o que já existe: painéis, arrastar aba entre janelas, histórico de abas fechadas, barra de status (página X de Y, zoom).

### Carregamento sob demanda (botão)

Abrir uma aba de PDF/EPUB **não lê nem processa o arquivo**. No centro da aba aparece o nome, o tamanho (só metadados do arquivo) e um botão "Carregar". Vale em todo caminho de entrada: Arquivo > Abrir, linha de comando / "Abrir com", restaurar a sessão e reabrir do histórico.

- Evita abrir um arquivo errado por engano e pagar o processamento à toa.
- Uma aba esquecida aberta não pesa na abertura do app: depois de reiniciar, ela volta ao botão.
- Depois do clique, a aba fica carregada até fechar a aba ou o app.
- `pdf.js` e o leitor de EPUB só são importados (`import()`) ao clicar.

### Arquivo ausente ou alterado

- **Ausente ou movido**: no lugar do botão aparece o aviso, e o botão vira "Localizar arquivo…", que abre o seletor de arquivos. O caminho escolhido substitui o antigo na aba (a posição de leitura é mantida).
- **Alterado no disco com a aba carregada**: só avisa (faixa com "Recarregar"). Nunca recarrega sozinho.

### Transporte dos bytes e desempenho

- A leitura é um comando IPC no Rust que devolve **binário cru** (`tauri::ipc::Response`), nunca JSON.
- Para PDFs grandes, leitura **por faixas** (`offset`/`len`), usada pelo modo de range do pdf.js.
- Tudo que for pesado fica no Rust ou em `import()` dinâmico; nada disso entra no bundle de abertura.
- `crates/core` decide o que pode ser lido: só o caminho que o usuário abriu ou salvou. Sem protocolo de arquivos aberto, seguindo a regra de segurança do projeto.
- Esta base é a primeira entrega; PDF e EPUB entram em cima dela.

## PDF: usar pdf.js

Decisão: **pdf.js** (Mozilla). Preferido ao `<embed>` nativo porque o WebKitGTK (Linux) não abre PDF e porque queremos controle de zoom, tema e barra de status.

- Carga sob demanda via `import()` (como DBML e `marked`). O worker também só carrega ao abrir um PDF.
- Páginas em `<canvas>` virtualizadas, camada de texto selecionável, busca no documento, zoom próprio (convive com o zoom da janela de `zoom.ts`).
- Endurecimento: `isEvalSupported: false` e `enableScripting: false` (o JavaScript embutido no PDF nunca roda); ações `Launch`, `file:` e `javascript:` ignoradas; links só `http`/`https`/`mailto`, pelo `open_url`.
- Limites contra bombas: tamanho máximo do canvas por página (`maxCanvasPixels`), teto de dimensão da página e de páginas renderizadas ao mesmo tempo.
- Compatibilidade: as versões novas do pdf.js usam recursos recentes de JS. Testar cedo no WebKitGTK (Linux) e ter o build `legacy` como plano B. No Windows (WebView2) não há esse problema.
- Tema escuro opcional (inverter/filtrar o canvas).

## EPUB: ler o epub.js, recriar melhor em Rust

Decisão: **não usar o epub.js como dependência.** Ele serve só de **referência de leitura** (como o formato é interpretado, os casos de borda, a ordem de resolução). A implementação é nossa, **em Rust + a estrutura do Fullpad**, no espírito do `json.rs`: lógica no `crates/core`, testável, sem UI.

### Leitor (core)

- ZIP via crate `zip`; `container.xml` → `content.opf` (metadados, manifest, spine) → `nav`/`toc.ncx` (sumário). Erros claros e tolerância a EPUBs malformados (sem sumário, spine com item faltando).
- XML com `quick-xml`, **sem resolver entidades** nem DTD externo (contra "billion laughs" e XXE).
- EPUB com DRM/criptografia: erro claro, sem tentar ler.
- Escopo: EPUB reflowable (cobre quase tudo). Fixed-layout e mídia embutida ficam de fora no início.

### Defesa em camadas (o arquivo é entrada não confiável)

1. **Sanitização do XHTML no Rust com a crate `ammonia`** (lista de permissão, não de bloqueio). Fora: `script`, eventos inline (`on*`), `iframe`, `object`, `embed`, `form`, `base`, `meta`, `link`, `svg` com script, `href="javascript:"`.
2. **`<iframe sandbox>` sem `allow-scripts` e sem `allow-same-origin`** (origem opaca).
3. **CSP no documento do iframe**: `default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'`. Nada de rede, o que também bloqueia pixel de rastreio.
4. **Links**: o iframe nunca navega. O clique é interceptado pelo app: link interno vai para o capítulo; externo vai pelo `open_url` (só `http`/`https`/`mailto`).
5. **Recursos internos** (imagem, CSS, fonte) são lidos do próprio ZIP no Rust e reescritos para `data:` dentro do capítulo. O caminho é normalizado (sem `..`, sem absoluto, sem `file:`) e há teto de tamanho por recurso. Em `srcdoc` as URLs relativas não resolvem, então essa reescrita é obrigatória.
6. **Limites do ZIP**: soma máxima descomprimida, número máximo de entradas, razão de compressão e tamanho por entrada. O limite conta os **bytes realmente lidos** (`take()`), não o tamanho declarado no cabeçalho, que pode mentir. Nunca extrair para o disco.

### CSS do livro

O iframe já contém o dano visual (um `position: fixed` só cobre o próprio iframe, nunca a interface do app). Os riscos reais são recursos externos, esconder texto ou desenhar uma falsa interface dentro do livro, e cores que brigam com o tema. Plano:

- Passar o CSS por um parser no Rust (`lightningcss`) e remover `@import`, `url()` que não virou `data:`, `position: fixed/sticky`, `behavior`, `-moz-binding` e `expression()`.
- O CSS do livro entra numa `@layer` **abaixo** do tema do app (cor, fundo, fonte base, largura máxima). Assim o tema do Fullpad ganha. Uma opção "usar o estilo do livro" pode vir depois.

### UI

- Renderiza no iframe com o tema do app; rolagem contínua primeiro, paginação depois.
- Sumário lateral reaproveita a ideia de [sumário lateral](sumario-lateral.md).

## Integração com as notas (prioridade)

O caso de uso principal é ler o PDF/EPUB **ao lado das notas**, nos painéis divididos que o app já tem. Escopo desta ideia: só **suportar** os formatos. Entram duas integrações, as que não tocam em código existente:

- **Copiar seleção como citação**: "Copiar como citação" (menu de contexto e atalho) põe na área de transferência um bloco markdown com a origem, por exemplo:

  ```
  > trecho selecionado,
  > mantendo as quebras de linha.
  > — *Título do livro*, p. 42
  ```

  No EPUB a origem é o capítulo, em vez da página. Só escreve na área de transferência.
- **Posição de leitura persistida**:
  - Na sessão: a aba guarda página/capítulo, rolagem e zoom. Ao carregar (botão) ou reabrir pelo histórico, o leitor volta onde parou.
  - **Por arquivo**: um pequeno registro na pasta de dados, indexado pelo arquivo, lembra a última posição mesmo depois de fechar a aba. Abrir o mesmo PDF/EPUB dias depois vai para a última página lida. Gravação com `write_atomic`, tolerante a registro corrompido (começa vazio) e com teste em `cargo test -p fullpad-core`, como manda a regra de [persistência](../rules/persistencia.md). Pelo caminho do arquivo, ou melhor, por uma identidade que sobreviva a mover o arquivo (a decidir na implementação).

Ficaram fora, em ideias próprias: [referência com volta](referencia-com-volta.md) e [nota ao lado do leitor](nota-ao-lado-do-leitor.md).

## Testes

- Em `cargo test -p fullpad-core`, com EPUBs gerados no próprio teste: válido, sem sumário, zip corrompido/truncado, script malicioso, bomba de compressão, muitas entradas, caminhos com `..`, entidades XML (laughs e XXE).
- Amostras maliciosas de EPUB e de PDF para teste manual na interface (script gerador fora do repositório; os arquivos não entram no git).

## Fora de escopo agora

- Editar PDF ou EPUB.
- Anotações/marcações.
- Converter EPUB/PDF em markdown (pode virar ideia própria depois; combina com "documento é sempre texto").
- Associar `.pdf` e `.epub` no instalador.
- Suporte ao Linux (WebKitGTK): fica para depois, quando houver VM para testar.
- Criar notas a partir do leitor: ver [nota ao lado do leitor](nota-ao-lado-do-leitor.md) e [referência com volta](referencia-com-volta.md).

## Ordem sugerida

1. **PARADA 1**: aba binária (`kind`, botão de carregar, ausente/alterado, bytes crus) + PDF básico com a posição de leitura.
2. **PARADA 2**: integração com as notas no PDF (citação como markdown e posição por arquivo).
3. **PARADA 3**: EPUB (leitor em Rust, defesas, sumário, posição).
4. **PARADA 4**: citação e posição no EPUB e melhorias de leitura (busca, tema, paginação).
