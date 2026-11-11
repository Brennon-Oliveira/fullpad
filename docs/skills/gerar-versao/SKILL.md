---
name: gerar-versao
description: "Gera e publica uma versão do Fullpad: lê os commits desde a última tag, usa a versão pedida (argumento ou --bug/--minor/--major) ou pergunta qual, escreve as notas, sobe a versão, gera o instalador de Windows localmente, cria a tag no git e publica o release no repositório público de releases (de onde a atualização automática baixa). Use quando pedirem para gerar, lançar ou publicar uma versão."
---

# Gerar versão

Publica uma versão nova do Fullpad. Quem já tem o app instalado recebe a versão pela atualização automática (o app lê o `latest.json` do release mais recente). Detalhes do instalador, da chave e do `scripts/release.sh`: [../../rules/build-windows.md](../../rules/build-windows.md).

- Código: este repositório (público, aberto a contribuições). Tag `v<versão>` no commit que gerou a versão.
- Releases: `Brennon-Oliveira/fullpad-releases` (público para ler, mas só o mantenedor publica: instaladores e `latest.json`, sem código). É de lá que o app instalado se atualiza, então ninguém além do mantenedor deve ter permissão de escrita nele.
- Versão: `version` em `crates/app/Cargo.toml` (o `tauri.conf.json` não tem versão).

## Argumentos

```
/gerar-versao [versao] [--bug | --minor | --major] [--commit] [--approve]
```

**Qual versão sai** (passo 3):

- `[versao]`: a versão que será a atual, e é a usada. Aceita qualquer formato (`0.5.0`, `v0.5.0`, `V0.5.0`, `v 0.5.0`...): só os três números importam, e ela é normalizada para `x.y.z` (a tag fica `vx.y.z`). Menos de três números: pare e pergunte.
- `--bug`: soma 1 ao último número da última versão (`0.4.2` → `0.4.3`).
- `--minor`: soma 1 ao do meio e zera o último (`0.4.2` → `0.5.0`).
- `--major`: soma 1 ao primeiro e zera os outros dois (`6.4.2` → `7.0.0`).
- Sem versão e sem flag de versão: **não escolha sozinho**. Diga qual é a versão atual (a da última tag) e o que os commits desde ela sugerem (tabela do passo 3), e pergunte qual usar.
- Versão e flag juntas: vale a versão; avise que a flag foi ignorada. Mais de uma flag de versão: pare e pergunte.

**O que pular das perguntas:**

- `--commit`: se a árvore estiver suja, **não pergunta** (passo 1): commita o que houver (seguindo [../../rules/commits.md](../../rules/commits.md)), dá `git push origin main` e segue com a release. Sem a flag, pergunta. Com a árvore limpa a flag não muda nada.
- `--approve`: **não pede aprovação** das notas de versão (passo 5): mostra as notas no relatório e avança sozinho. Sem a flag, para, mostra como vão ficar e pede para aprovar ou rejeitar.

As duas flags só dispensam a pergunta; os testes, o build e as demais conferências continuam valendo, e qualquer falha ainda para o processo.

## 1. Pré-condições (pare se falhar)

Rode na raiz do repositório:

```sh
git status --porcelain            # precisa estar vazio
git branch --show-current         # main
git fetch origin && git status -sb   # sem divergir de origin/main
ls ~/.tauri/fullpad.key           # chave privada das atualizações
command -v gh cargo-tauri cargo-xwin makensis
gh auth status
```

- Árvore suja: **não publique código que não está em commit**. Com `--commit`: commite o que houver (um commit por mudança lógica, [../../rules/commits.md](../../rules/commits.md)), dê `git push origin main` e siga. Sem a flag: mostre o que falta e pergunte se é para commitar antes (e dar push) ou parar.
- Sem a chave: pare. Sem ela, os apps instalados recusam a versão; não gere outra chave sem o usuário saber que isso quebra a atualização de quem já instalou.

## 2. Última versão e commits desde ela

```sh
LAST=$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null)
git log "$LAST"..HEAD --no-merges --format='%h%x09%s%n%b%x1e'
gh release list -R Brennon-Oliveira/fullpad-releases --limit 5
```

- Sem tag `v*` ainda: use o release mais recente do repositório de releases como versão anterior e pergunte ao usuário a partir de qual commit contar (as versões 0.2.0 e 0.2.1 foram publicadas antes de existir esta skill).
- Nenhum commit desde a tag: não há o que publicar; pare.
- Confira que a tag e o release mais recente batem. Se divergirem, mostre e pergunte.

## 3. Próxima versão

Pelos argumentos (veja acima): a versão passada, ou a da flag `--bug`/`--minor`/`--major` aplicada à última versão. **Sem nenhum dos dois, pare e pergunte**, dizendo qual é a versão atual e o que os commits sugerem. A sugestão sai dos commits ([../../rules/commits.md](../../rules/commits.md)), o maior vence:

| Commits | Sobe |
|---|---|
| `!` ou `BREAKING CHANGE` | major (enquanto for `0.x`: minor; o `1.0.0` é decisão do usuário, na PARADA 4 do PLANO) |
| `feat` | minor |
| `fix`, `perf` ou `refactor` | patch |
| só `docs`, `test`, `build`, `ci`, `chore` | patch, mas pergunte antes se vale publicar |

A versão nova precisa ser maior que a do release mais recente: o updater só oferece versão maior. Igual ou menor: pare e diga qual é a atual.

## 4. Notas de versão

Em português, para quem usa o app, não para quem programa. Elas aparecem em três lugares: **no diálogo de atualização**, na **nota de versão** que o app abre depois de atualizar (e em Ajuda > "Ver nota de versão") e na página do release. Seja curto: no máximo uns 8 itens.

Escreva em `crates/app/release-notes.md` (substituindo o conteúdo da versão anterior; o app embute esse arquivo e põe o título "Nota de versão V<versão>" em cima, então não escreva título de primeiro nível):

```markdown
## Novidades

- <o que dá para fazer agora>

## Correções

- <o que deixou de dar errado>

## Melhorias

- <mais rápido, mais estável...>
```

- Fonte: o resumo e o corpo dos commits. **Entra tudo o que muda algo para quem usa, tenha ou não issue**: uma correção feita na conversa, sem `Refs`, entra como qualquer outra. Issue não é critério para a nota. Reescreva para o efeito visível ("Abas arrastadas entre janelas caem no lugar exato"), sem jargão (nada de "refatora", nomes de função ou arquivo).
- Junte commits que tratam da mesma coisa. Omita seções vazias.
- `docs`, `test`, `build`, `ci`, `chore` ficam de fora, a não ser que mudem algo para o usuário (ex.: o instalador).
- **Não cite números de issue** (`#12`) nem links do repositório de código nas notas: elas aparecem como texto puro no diálogo de atualização e na página do release, que fica em **outro repositório** (`fullpad-releases`), onde `#12` apontaria para uma issue que não existe ou para outra.
- Mudança incompatível: diga o que muda e o que a pessoa precisa fazer.

**Histórico (`crates/app/CHANGELOG.md`)**: depois de escrever a nota, acrescente a mesma nota **no topo** do `crates/app/CHANGELOG.md`, logo abaixo do texto de abertura e acima da versão anterior, com o cabeçalho `## <nova> · <aaaa-mm-dd>` (data de hoje) e as seções rebaixadas para `###` (`### Novidades`, `### Correções`, `### Melhorias`). O app separa as versões pelo cabeçalho `## x.y.z`, então **nenhum outro `##` pode começar por um número de versão**, e as versões ficam da mais nova para a mais antiga, sem repetir. O arquivo vai embutido no app (Ajuda > "Histórico de versões…") e a nota que abre depois de atualizar mostra tudo o que entrou desde a versão que a pessoa tinha.

O `scripts/release.sh` lê o `release-notes.md` para o release e para o `latest.json` (no diálogo, sem os `#`). O diálogo de atualização mostra o texto como está, **sem acrescentar título**: os títulos (`Novidades`, `Correções`, `Melhorias`) são os das próprias notas.

## 5. Confirmar com o usuário

Publicar é visível para fora (o release é público e os apps instalados vão atualizar). Mostre a versão anterior, a nova, a lista de commits e as notas como vão ficar.

- Sem `--approve`: **espere o ok** (aprovar ou rejeitar) antes de seguir. Rejeitou: ajuste as notas como pedirem e mostre de novo.
- Com `--approve`: não pergunte; deixe as notas no relatório e avance.

## 6. Subir a versão, testar e gerar

```sh
sed -i 's/^version = ".*"/version = "<nova>"/' crates/app/Cargo.toml   # só a primeira linha `version`, do [package]
cargo check -p fullpad -q          # atualiza o Cargo.lock
cargo test -p fullpad-core -p fullpad
pnpm --dir ui exec vitest run
PUBLISH=0 scripts/release.sh       # build local: instalador assinado + latest.json
```

Confira que a primeira linha `version` do `Cargo.toml` é a do `[package]`. Falhou um teste ou o build: pare, desfaça a mudança de versão e as notas (`git checkout crates/app/Cargo.toml Cargo.lock crates/app/release-notes.md crates/app/CHANGELOG.md`) e relate a saída.

## 7. Commit e tag

```sh
git add crates/app/Cargo.toml Cargo.lock crates/app/release-notes.md crates/app/CHANGELOG.md
git commit -m "chore(versao): <nova>" -m "<notas>"   # com as linhas de atribuição da sessão
git tag -a v<nova> -m "Fullpad <nova>" -m "$(cat crates/app/release-notes.md)"
git push origin main v<nova>
```

A tag anotada guarda as notas: `git show v<nova>` diz o que entrou em cada versão.

## 8. Publicar

```sh
BUILD=0 scripts/release.sh
```

Publica o instalador já gerado e o `latest.json` como release `v<nova>`.

## 9. Conferir

```sh
curl -sL "https://github.com/Brennon-Oliveira/fullpad-releases/releases/latest/download/latest.json?n=$RANDOM" | grep '"version"'
```

Precisa mostrar a versão nova (o GitHub pode levar alguns segundos). Se a publicação falhar depois da tag, não apague a tag: corrija e rode o passo 8 de novo.

## 10. Fechar as issues entregues

Esta etapa só trata das issues; **não decide o que entra nas notas** (isso vem de todos os commits, passo 4). Issues citadas por `Refs #n` nos commits desde a última tag (`git log "$LAST"..HEAD --format=%B | grep -oE 'Refs #[0-9]+'`) saíram nesta versão. Para cada uma ainda aberta: garanta o milestone `<nova>` (crie se faltar, método em [../../rules/issues.md](../../rules/issues.md)) e feche com comentário:

```sh
gh issue edit <n> -R Brennon-Oliveira/fullpad --milestone "<nova>"
gh issue close <n> -R Brennon-Oliveira/fullpad --reason completed --comment "Entregue na <nova>."
```

Feche também o milestone `<nova>` quando todas as issues dele estiverem fechadas. Não feche issue que o usuário não citou nos commits; na dúvida, liste e pergunte.

Relate ao usuário a versão, o link do release, a tag, as notas e as issues fechadas, e lembre que os apps instalados oferecem a atualização ao abrir (ou em Ajuda > "Verificar atualizações…").
