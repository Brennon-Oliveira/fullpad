---
name: gerar-versao
description: "Gera e publica uma versão do Fullpad: lê os commits desde a última tag, calcula a próxima versão, escreve as notas, sobe a versão, gera o instalador de Windows localmente, cria a tag no git e publica o release no repositório público de releases (de onde a atualização automática baixa). Use quando pedirem para gerar, lançar ou publicar uma versão."
---

# Gerar versão

Publica uma versão nova do Fullpad. Quem já tem o app instalado recebe a versão pela atualização automática (o app lê o `latest.json` do release mais recente). Detalhes do instalador, da chave e do `scripts/release.sh`: [../../rules/build-windows.md](../../rules/build-windows.md).

- Código: este repositório (privado). Tag `v<versão>` no commit que gerou a versão.
- Releases: `Brennon-Oliveira/fullpad-releases` (público, só instaladores e `latest.json`).
- Versão: `version` em `crates/app/Cargo.toml` (o `tauri.conf.json` não tem versão).

Argumento opcional: a versão (`0.4.0`) ou o tipo (`patch`, `minor`, `major`), que substitui o cálculo do passo 3.

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

- Árvore suja: **não publique código que não está em commit**. Mostre o que falta e pergunte se é para commitar antes (seguindo [../../rules/commits.md](../../rules/commits.md)) ou parar.
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

Pelos commits ([../../rules/commits.md](../../rules/commits.md)), o maior vence:

| Commits | Sobe |
|---|---|
| `!` ou `BREAKING CHANGE` | major (enquanto for `0.x`: minor; o `1.0.0` é decisão do usuário, na PARADA 4 do PLANO) |
| `feat` | minor |
| `fix`, `perf` ou `refactor` | patch |
| só `docs`, `test`, `build`, `ci`, `chore` | patch, mas pergunte antes se vale publicar |

A versão nova precisa ser maior que a do release mais recente: o updater só oferece versão maior.

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

- Fonte: o resumo e o corpo dos commits. Reescreva para o efeito visível ("Abas arrastadas entre janelas caem no lugar exato"), sem jargão (nada de "refatora", nomes de função ou arquivo).
- Junte commits que tratam da mesma coisa. Omita seções vazias.
- `docs`, `test`, `build`, `ci`, `chore` ficam de fora, a não ser que mudem algo para o usuário (ex.: o instalador).
- Mudança incompatível: diga o que muda e o que a pessoa precisa fazer.

O `scripts/release.sh` lê esse mesmo arquivo para o release e para o `latest.json` (no diálogo, sem os `#`).

## 5. Confirmar com o usuário

Publicar é visível para fora (o release é público e os apps instalados vão atualizar). Mostre a versão anterior, a nova, a lista de commits e as notas, e **espere o ok** antes de seguir. Ajuste se pedirem.

## 6. Subir a versão, testar e gerar

```sh
sed -i 's/^version = ".*"/version = "<nova>"/' crates/app/Cargo.toml   # só a primeira linha `version`, do [package]
cargo check -p fullpad -q          # atualiza o Cargo.lock
cargo test -p fullpad-core -p fullpad
pnpm --dir ui exec vitest run
PUBLISH=0 scripts/release.sh       # build local: instalador assinado + latest.json
```

Confira que a primeira linha `version` do `Cargo.toml` é a do `[package]`. Falhou um teste ou o build: pare, desfaça a mudança de versão e as notas (`git checkout crates/app/Cargo.toml Cargo.lock crates/app/release-notes.md`) e relate a saída.

## 7. Commit e tag

```sh
git add crates/app/Cargo.toml Cargo.lock crates/app/release-notes.md
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

Relate ao usuário a versão, o link do release, a tag e as notas, e lembre que os apps instalados oferecem a atualização ao abrir (ou em Ajuda > "Verificar atualizações…").
