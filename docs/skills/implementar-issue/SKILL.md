---
name: implementar-issue
description: "Implementa uma issue do Fullpad: lê a issue, confere se está pronta (sem a label refinar e sem pontos em aberto), planeja, implementa com testes e docs, gera o build de Windows e relata, ligando os commits à issue com Refs #n. Aceita --approve (não pede aprovação do plano) e --commit (commita as mudanças). Use quando pedirem para implementar, fazer, resolver ou corrigir uma issue."
argument-hint: "<número> [--approve] [--commit]"
---

# Implementar issue

Implementa uma issue de `Brennon-Oliveira/fullpad`. Esta skill **só implementa**: não cria versão (isso é a `gerar-versao`) nem fecha a issue (quem fecha, com o milestone da versão, é a `gerar-versao`, pelos `Refs #n` dos commits). Padrão das issues: [../../rules/issues.md](../../rules/issues.md). Regras do projeto: `docs/AGENTS.md`, [../../rules/commits.md](../../rules/commits.md), [../../rules/persistencia.md](../../rules/persistencia.md), [../../rules/build-windows.md](../../rules/build-windows.md).

## Argumentos

```
/implementar-issue <número> [--approve] [--commit]
```

- `<número>`: a issue. Sem número: liste as abertas com `prio` e pergunte qual.
- `--approve`: **não pede aprovação** do plano (passo 3): mostra o plano no relatório e avança. Sem a flag, para e pede ok.
- `--commit`: ao terminar, **commita** as mudanças (um commit por mudança lógica, `Refs #n`). Sem a flag, deixa tudo no working tree e diz o que mudou. Nunca dá `git push`.

## 1. Ler e conferir se está pronta

```sh
gh issue view <n> -R Brennon-Oliveira/fullpad --json number,title,state,labels,milestone,body,comments
git status --porcelain && git branch --show-current
```

- Issue **fechada**: pare e diga.
- Label **`refinar`** (rascunho): **pare**: ainda não é uma issue pronta. Sugira `/editar-issue <n> --refinar`. Só siga se o usuário mandar mesmo assim.
- **Pontos a decidir** em aberto (no corpo ou nos comentários): pergunte ao usuário **antes de codar**, com opções e uma recomendação quando houver. Registre as decisões como **comentário na issue** (`gh issue comment`), para não se perderem.
- Árvore suja com mudanças que não são desta issue: avise e pergunte como proceder (não misture).
- Leia o que a issue cita (`docs/AGENTS.md`, módulos, issues ligadas) e confira o que ela afirma que existe hoje; divergência: avise.

## 2. Entender o que "pronto" significa

Escreva para si (e para o plano) os **critérios de aceite** a partir da issue: o que a pessoa passa a ver/fazer (`feature`), o que fica melhor sem piorar (`improvement`), o que deixa de dar errado e como reproduzir (`bug`). Respeite **Fora de escopo** e **Cuidados**.

Por tipo:
- `bug`: **reproduza antes** (teste que falha, quando der); ache a causa; corrija o menor possível; o teste passa a guardar o bug.
- `improvement`: preserve o comportamento existente que não é alvo; teste o que mudou.
- `feature`: divida em fatias coerentes (cada uma testável e commitável).

## 3. Plano (e aprovação)

Mostre um plano curto: as fatias, os arquivos/módulos que mexem (`crates/core` para lógica de dados, UI para interface; regras da arquitetura em `docs/AGENTS.md`), os testes, e o que fica **de fora** ou **bloqueado por falta de decisão**.

- Sem `--approve`: **espere o ok**.
- Com `--approve`: siga.
- Se algo bloquear (falta decisão), anote, passe para a próxima fatia e relate tudo junto no fim (não pare a cada passo).

## 4. Implementar

- Código e identificadores seguem o módulo; texto de UI, docs e commits em **português**.
- **Testes** de tudo que for lógica (`cargo test -p fullpad-core`, `pnpm --dir ui exec vitest run`); `pnpm --dir ui build` (inclui `tsc`).
- **Docs**: mudou comportamento, arquitetura, comando ou convenção, atualize `docs/` **no mesmo commit** (`docs/AGENTS.md`, regras).
- Persistência: escrita atômica, campos tolerantes ([persistência](../../rules/persistencia.md)). Segurança: caminhos vindos da UI são entrada do usuário.
- Não amplie o escopo: o que a issue não pede e você achou útil vira **sugestão no relatório** (ou uma issue nova, se o usuário quiser), não código.

## 5. Build de Windows e conferências

Ao terminar, como em [../../rules/build-windows.md](../../rules/build-windows.md):

```sh
pnpm --dir ui build
cargo xwin build --release --target x86_64-pc-windows-msvc -p fullpad --features tauri/custom-protocol
scripts/check-build-windows.sh    # precisa dizer: ok
```

Falhou teste ou build: **não está concluído**; conserte ou relate a saída. Mudança só de docs não exige o build.

## 6. Commits (com `--commit`)

Um commit por mudança lógica ([commits.md](../../rules/commits.md)): `tipo(escopo): resumo` em português, corpo explicando o que e por quê, e **`Refs #<n>`** no rodapé (nunca `Closes`: fechar a issue é da `gerar-versao`, com o milestone da versão). `bug` → `fix`; `feature` → `feat`; `improvement` → `feat`/`perf`/`refactor` conforme o efeito. Termine com as linhas de atribuição da sessão. Sem push.

## 7. Registrar na issue e relatar

Comente na issue (`gh issue comment <n> -R Brennon-Oliveira/fullpad`): o que foi feito, como testar na mão, o que ficou de fora ou bloqueado, e os commits (hash). Não feche e não mude o milestone.

Relate ao usuário: o que entrou, testes e build (passou ou falhou, com a saída se falhou), o que ficou de fora, sugestões, e lembre que a issue fecha na próxima `gerar-versao`.

## Regras

- Nunca invente decisão da issue: pergunte, ou registre como bloqueio.
- Nunca publique versão, dê push nem feche a issue.
- Texto sempre em português, com acentuação correta.
