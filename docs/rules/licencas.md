# Licenças e dependências

O Fullpad é de código aberto (licença do projeto em `LICENSE`) e distribui bibliotecas de terceiros. Para isso não virar problema:

- **Nada de copyleft forte.** GPL, AGPL, LGPL, EUPL, SSPL e afins **não entram** como dependência (nem de Rust, nem de npm, nem como dado embarcado) sem decisão explícita do mantenedor. Copyleft fraco em nível de arquivo (MPL-2.0, EPL-2.0) é aceito quando o componente é usado **sem modificação** e com o código-fonte apontado (hoje: `cssparser`, `selectors`, `dtoa-short`, `option-ext`, `elkjs`).
- **`THIRD_PARTY_LICENSES.md` é gerado**, não editado à mão: `python3 scripts/gerar-licencas.py`. Ele lê `cargo tree`/`cargo metadata` (Rust, só dependências normais, Windows e Linux), `pnpm licenses list --prod` (UI) e os arquivos de licença dos dados que o app embarca (pdf.js, KaTeX), e **falha** se aparecer licença fora da lista permitida.
- **Mudou uma dependência** (`Cargo.lock`, `ui/pnpm-lock.yaml`) ou o que `vite.config.ts` copia para o app: rode o script e commite o resultado junto. `python3 scripts/gerar-licencas.py --check` diz se está em dia (sai com 1 se não).
- Dependência nova com licença que o script não conhece: **leia a licença**, decida e, se for aceitar, acrescente-a em `PERMITIDAS` ou `FRACO` (com o motivo em `NOTAS`). Pacote sem arquivo de licença no pacote publicado: copie o texto do repositório para `scripts/licencas/pacotes/` e registre em `TEXTOS_DO_REPOSITORIO`.
- O arquivo vai no instalador (`bundle.resources` em `crates/app/tauri.conf.json`) e fica na pasta de instalação, ao lado da `LICENSE`.
- **Única parte GPL conhecida:** as fontes Liberation Sans do pdf.js (`standard_fonts/LiberationSans-*.ttf`), GPL-2.0 com exceção de fonte, como arquivos de dados separados (mera agregação; documentado em `THIRD_PARTY_LICENSES.md`). Se um dia isso incomodar, dá para tirá-las da cópia que o `vite.config.ts` faz: o pdf.js cai nas fontes Foxit (BSD) e nas do sistema.
- Conteúdo novo em `examples/` precisa ser **original ou de domínio público**: nada de trecho de livro, imagem ou fonte de terceiros com direitos reservados.
