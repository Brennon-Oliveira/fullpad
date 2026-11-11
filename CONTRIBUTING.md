# Contribuindo com o Fullpad

Obrigado por querer ajudar! O Fullpad é um editor de notas e markdown rápido, no estilo Notepad++: **nada se perde ao fechar**. Contribuições de todo tipo são bem-vindas: relatar um bug, sugerir uma ideia, melhorar a documentação, acrescentar um exemplo, corrigir um erro ou implementar uma novidade.

O projeto, as issues, os commits e a interface são em **português (Brasil)**. Escreva em português, com a acentuação correta. Se o seu português não é fluente, escreva como conseguir: o importante é a ideia, e a gente ajusta junto.

## Sumário

- [Antes de começar](#antes-de-começar)
- [Relatar um bug ou sugerir uma ideia](#relatar-um-bug-ou-sugerir-uma-ideia)
- [Preparar o ambiente](#preparar-o-ambiente)
- [Como o código está organizado](#como-o-código-está-organizado)
- [Fluxo de uma contribuição](#fluxo-de-uma-contribuição)
- [Regras que valem para todo código](#regras-que-valem-para-todo-código)
- [Testes](#testes)
- [Documentação e exemplos](#documentação-e-exemplos)
- [Commits e Pull Requests](#commits-e-pull-requests)
- [Dependências e licenças](#dependências-e-licenças)
- [Segurança](#segurança)
- [Versões e atualização automática](#versões-e-atualização-automática)
- [Usando ferramentas de IA](#usando-ferramentas-de-ia)
- [Licença das contribuições](#licença-das-contribuições)

## Antes de começar

1. **Procure nas [issues](https://github.com/Brennon-Oliveira/fullpad/issues)** se a ideia ou o bug já existe. Se existe, comente nela em vez de abrir outra.
2. **Mudança grande? Converse antes.** Uma novidade que mexe em vários módulos, no formato do `session.json` ou em como o app abre arquivos merece uma issue (ou um comentário numa existente) *antes* do código. Evita trabalho jogado fora para os dois lados.
3. **Correção pequena** (erro de digitação, bug óbvio, ajuste de documentação) pode ir direto como Pull Request, sem issue.
4. Seja gentil e objetivo nas conversas. Críticas são ao código e às ideias, nunca às pessoas.

Para escolher algo para fazer: as issues têm label de tipo (`bug`, `improvement`, `feature`) e de prioridade (`prio: alta`, `prio: boa`, `prio: media`, `prio: futura`). A ordem sugerida dentro de cada prioridade está na issue fixada **"Ranking de prioridades"**. Issues com a label `refinar` ainda são ideias cruas: ajudam mais com conversa do que com código.

## Relatar um bug ou sugerir uma ideia

Use os formulários em **Issues → New issue**; eles já pedem o que importa:

- **Bug**: o que acontece, o que deveria acontecer, como reproduzir (passo a passo), a **versão do Fullpad** (Ajuda → "Ver nota de versão": a versão está no título da aba), o sistema e o tipo de arquivo. Se possível, anexe um arquivo pequeno que reproduza o problema.
- **Novidade** ou **melhoria**: o que a pessoa passa a poder fazer e por quê. Descreva o problema e a vontade por trás; a solução pode ser discutida depois.

**Nunca cole nas issues o conteúdo das suas notas, caminhos de arquivos pessoais ou segredos.** Reduza o problema a um texto de exemplo.

Os padrões completos de escrita das issues estão em [`docs/rules/issues.md`](docs/rules/issues.md).

## Preparar o ambiente

Pré-requisitos: [Rust](https://rustup.rs) (estável), [Node](https://nodejs.org) e [pnpm](https://pnpm.io).

**Dependências de sistema**

- **Windows**: WebView2 (já vem no Windows 10/11) e o Build Tools do Visual Studio (MSVC).
- **Linux**: `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev pkg-config build-essential`
- **macOS** não é uma plataforma suportada por enquanto.

**Primeira vez**

```sh
git clone https://github.com/Brennon-Oliveira/fullpad.git
cd fullpad
cargo install tauri-cli --version "^2" --locked     # uma vez
pnpm --dir ui install
```

**Dia a dia**

```sh
cd crates/app && cargo tauri dev        # o app em desenvolvimento (recarrega a interface ao salvar)
cargo test -p fullpad-core              # testes do core (rode na raiz)
pnpm --dir ui exec vitest run           # testes da interface
pnpm --dir ui build                     # confere os tipos (tsc) e gera o front
cd crates/app && cargo tauri build      # instalador / binário
```

> **Use uma pasta de dados de teste** para não mexer nas suas notas de verdade:
> `FULLPAD_DATA_DIR=/tmp/fullpad-dev cargo tauri dev`
> Os dados reais ficam em `%APPDATA%\fullpad` (Windows) e `~/.local/share/fullpad` (Linux).

Se você desenvolve no **WSL**, só o `core` e a interface compilam nativamente (faltam bibliotecas do webkit para o `app`). O `.exe` de Windows sai por cross-compile; os passos estão em [`docs/rules/build-windows.md`](docs/rules/build-windows.md). Isso é uma tarefa do mantenedor depois do merge: **você não precisa gerar o instalador para abrir um PR**, basta passar nos testes e no `pnpm --dir ui build`.

## Como o código está organizado

```
crates/core   persistência (sessão, notas, arquivos, escrita atômica, lixeira), parsers (JSON, YAML,
              TOML, CSV, EPUB, PDF), busca. Sem UI e sem Tauri: testável sozinho.
crates/app    Tauri 2: comandos IPC, janelas, instância única, atualização automática.
ui/           TypeScript + CodeMirror 6 + Vite: abas, editor, live preview, menus, barra de status.
examples/     um arquivo de exemplo por tipo suportado (também é o material de teste manual).
docs/         a documentação de verdade do projeto (arquitetura, regras, roteiro).
scripts/      geração de versão e das licenças de terceiros.
```

Duas regras de arquitetura que você vai encontrar logo:

- A interface conversa com o Rust **só por comandos IPC** (`ui/src/api.ts` ↔ `crates/app/src/main.rs`).
- **Lógica de dados vive em `crates/core`**, não em `crates/app`.

O mapa completo, módulo por módulo, com as decisões e os porquês, está em [`docs/AGENTS.md`](docs/AGENTS.md). É longo de propósito: **leia a parte do módulo que você vai mexer** antes de começar. O roteiro do que já foi entregue e do que vem está em [`docs/PLANO.md`](docs/PLANO.md).

## Fluxo de uma contribuição

1. Faça um **fork** e crie uma branch a partir da `main` (`fix/clique-na-linha-errada`, `feat/exportar-docx`...).
2. Faça a mudança em passos pequenos: **um commit por mudança lógica** (veja [Commits](#commits-e-pull-requests)).
3. Rode os [testes](#testes) e abra o app (`cargo tauri dev`) para **ver a mudança funcionando**: teste que passa não prova que a tela está certa.
4. Atualize a [documentação e os exemplos](#documentação-e-exemplos) no mesmo PR.
5. Abra o **Pull Request** contra a `main`, com o título no formato dos commits e uma descrição que diga **o que muda para quem usa e por quê**. Se resolve uma issue, cite-a (`Refs #12`).
6. Responda aos comentários da revisão com novos commits (não precisa reescrever o histórico). O merge pode ser feito com *squash*, e nesse caso o título do PR vira o commit: por isso ele segue o formato dos commits.

Um PR pequeno e focado é revisado muito mais rápido do que um grande. Se a mudança cresceu, divida.

## Regras que valem para todo código

Estas regras existem por causa de bugs reais e da promessa do produto. Um PR que as quebra não será aceito, mesmo que o resto esteja ótimo.

**Nunca perder texto** (detalhes em [`docs/rules/persistencia.md`](docs/rules/persistencia.md)):

- Toda gravação em disco passa por `write_atomic` (escreve num temporário e renomeia). Nunca grave direto sobre o destino.
- `session.json` corrompido não pode impedir o app de abrir.
- Fechar uma nota a move para `trash/`; não a apaga.
- Gravar num arquivo real **nunca sobrescreve uma mudança feita por outro programa** sem a pessoa confirmar.
- Mudança em `crates/core` **exige teste** em `cargo test -p fullpad-core`.

**Segurança** (o app abre arquivos de origem desconhecida):

- Caminhos de arquivo vindos da interface são **entrada do usuário**: o app só lê e grava o que a pessoa abriu ou salvou explicitamente.
- Nada de segredos no repositório.
- Conteúdo de arquivos (HTML do EPUB, SVG de diagrama, CSS de livro) passa por listas de permissão e roda sem scripts nem rede. Não afrouxe esses filtros sem discutir antes numa issue.

**Desempenho de abertura**: bibliotecas pesadas (`mermaid`, `katex`, `pdfjs-dist`, `@dbml/parse`, `dagre`) são carregadas **sob demanda, com `import()`**, nunca por `import` estático a partir de `main.ts`. Abrir o app tem de continuar rápido.

**Preview do markdown**: nunca use margem vertical (`margin-top`/`margin-bottom`) em linhas ou widgets `.cm-md-*`; use `padding`. O CodeMirror não conta a margem no mapa de alturas e o clique cai na linha errada (há teste em `preview-css.test.ts`).

**O documento é sempre texto puro**: renderizar markdown, DBML ou qualquer visão nunca reescreve o conteúdo.

**Estilo**: siga o que já existe no módulo (nomes, organização, comentários em português). Texto de interface, documentação e commits são em português.

## Testes

```sh
cargo test -p fullpad-core        # core (na raiz do repositório)
pnpm --dir ui exec vitest run     # interface
pnpm --dir ui build               # tsc --noEmit + vite build
```

- Corrigiu um bug? Acrescente um teste que **falharia antes** da correção.
- Funções puras (sem DOM) são fáceis de testar e são o lugar certo para lógica: veja `grid.ts`/`grid.test.ts`, `mdformat.ts`/`mdformat.test.ts` e `palettecore.ts` como modelo. Para componentes com DOM, os testes usam `jsdom`.
- Não há pipeline de CI por enquanto: os testes rodam na sua máquina. Rode-os antes de abrir o PR e diga na descrição o que você rodou.

## Documentação e exemplos

- **Mudou comportamento, arquitetura, comando ou convenção?** Atualize `docs/` **no mesmo PR**. O [`docs/AGENTS.md`](docs/AGENTS.md) é a fonte de verdade da arquitetura.
- **Recurso novo que muda o que o app faz com um tipo de arquivo** (uma opção nova do CSV, um tipo novo de diagrama...): acrescente-o ao exemplo do tipo em [`examples/`](examples/) e atualize a linha correspondente no `examples/README.md`. Tipo de arquivo novo ganha o seu `example.<ext>`. Regras de um bom exemplo: [`docs/rules/exemplos.md`](docs/rules/exemplos.md). O conteúdo dos exemplos tem de ser **original ou de domínio público**.
- Exemplos gerados (`example.json`, `example.csv`, `example.pdf`, `example.epub`) saem dos scripts em `examples/_gerar/`: altere o script e rode-o, nunca edite o resultado à mão.
- **Abra o exemplo no app** antes de entregar. Se o recurso não aparece ali, ainda não está pronto.

## Commits e Pull Requests

Os commits seguem um formato próprio porque **viram as notas de versão** que aparecem para quem atualiza o app. O padrão completo está em [`docs/rules/commits.md`](docs/rules/commits.md); o resumo:

```
tipo(escopo opcional): resumo no imperativo, em português
```

- Tipos: `feat` (capacidade nova), `fix` (correção), `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`.
- O resumo descreve o **efeito para quem usa**, não o arquivo alterado.
  - Bom: `feat(abas): permite restaurar a aba fechada com Ctrl+Shift+T`
  - Ruim: `feat: altera main.ts`
- Mudança não trivial leva um **corpo** explicando o que mudou e por quê (e o que foi descartado).
- Mudança incompatível: `!` depois do tipo e o rodapé `BREAKING CHANGE:` dizendo o que quebra e como migrar.
- **Um commit por mudança lógica.** Não misture funcionalidade, correção e refatoração.
- Issue não é pré-requisito. O `Refs #n` é só para quando o commit entrega uma issue existente.

O título do Pull Request segue o mesmo formato.

### Lista de conferência do PR

- [ ] Os testes passam (`cargo test -p fullpad-core`, `pnpm --dir ui exec vitest run`, `pnpm --dir ui build`).
- [ ] Abri o app e vi a mudança funcionando (usando `FULLPAD_DATA_DIR` de teste).
- [ ] Testes novos para o que mudou (obrigatório em `crates/core`).
- [ ] `docs/` e `examples/` atualizados.
- [ ] Se mexi em dependências: rodei `python3 scripts/gerar-licencas.py` e commitei o resultado.
- [ ] Nenhuma gravação em disco fora de `write_atomic`; nenhum `import` estático de biblioteca pesada.
- [ ] Commits no formato do projeto, em português.

## Dependências e licenças

O Fullpad é distribuído com bibliotecas de terceiros, e a gente se compromete a **não ter copyleft forte** (GPL, AGPL, LGPL e afins) nas dependências. Antes de acrescentar uma biblioteca:

1. Confira a licença dela e a das dependências que ela puxa. Aceitas sem conversa: MIT, Apache-2.0, BSD, ISC, Zlib, Unicode, CC0 e semelhantes.
2. Copyleft fraco em nível de arquivo (MPL-2.0, EPL-2.0) só se for usada **sem modificação**; discuta na issue.
3. GPL/AGPL/LGPL: **não entram**.
4. Depois de mexer em `Cargo.lock` ou `ui/pnpm-lock.yaml`, regenere os avisos:

```sh
python3 scripts/gerar-licencas.py           # reescreve THIRD_PARTY_LICENSES.md
python3 scripts/gerar-licencas.py --check   # só confere (falha se estiver desatualizado ou com licença fora da lista)
```

Prefira não acrescentar dependência quando poucas linhas resolvem. Detalhes em [`docs/rules/licencas.md`](docs/rules/licencas.md).

## Segurança

**Não abra uma issue pública para uma vulnerabilidade.** Use o relato privado do GitHub (aba **Security → Report a vulnerability** do repositório) e descreva o problema, como reproduzi-lo e o impacto. Depois da correção publicada, o crédito é seu, se você quiser.

Vale como vulnerabilidade, por exemplo: abrir um arquivo (PDF, EPUB, Markdown, CSV...) que executa código, lê ou grava fora do que a pessoa abriu, ou que trava o app com um arquivo pequeno (bomba de compressão, entidade XML, etc.); e qualquer jeito de perder ou sobrescrever texto sem confirmação.

## Versões e atualização automática

Só o mantenedor publica versões. O app instalado se atualiza a partir dos Releases do repositório `Brennon-Oliveira/fullpad-releases`, onde somente o mantenedor tem permissão de escrita, e as atualizações são assinadas com uma chave que não está (e nunca estará) no repositório. Um instalador seu, feito de um fork, **não** é aceito pelas instalações oficiais; se você distribui o seu, troque a chave pública e o endereço do atualizador pelos seus. Os passos estão em [`docs/rules/build-windows.md`](docs/rules/build-windows.md).

Você não precisa mexer em versão, `CHANGELOG.md` nem `release-notes.md`: isso sai dos commits, na hora de gerar a versão.

## Usando ferramentas de IA

Pode usar assistentes de código. O repositório tem instruções para eles (`CLAUDE.md`, `AGENTS.md`, `docs/`, `.claude/`, `.agents/`): a **fonte de verdade é `docs/`**, e os outros arquivos são só ponteiros. Quem abre o PR responde por ele: leia o que foi gerado, rode os testes e veja a mudança funcionando. PR com código que o autor não entende ou não testou será devolvido.

## Licença das contribuições

Ao enviar uma contribuição, você concorda que ela é licenciada sob a mesma licença do projeto (veja o arquivo [`LICENSE`](LICENSE)). Não envie código que você não tem o direito de licenciar assim, nem trechos copiados de projetos com licença incompatível (por exemplo GPL).

---

Dúvida que não coube aqui? Abra uma issue com a pergunta: se ela surgiu para você, provavelmente vai ajudar a próxima pessoa. 💙
