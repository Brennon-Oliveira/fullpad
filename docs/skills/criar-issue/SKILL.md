---
name: criar-issue
description: "Cria uma issue do Fullpad (bug, improvement ou feature) no padrão do projeto. Sem --draft, refina a ideia conversando com o usuário (perguntas curtas, olhando o código) e só cria a issue pronta, depois do ok; com --draft, pula a conversa e cria um rascunho com a label refinar. Use quando pedirem para criar, registrar ou anotar uma issue, bug, melhoria, novidade ou ideia."
argument-hint: "[--bug | --improvement | --feature] [--draft] [--milestone=nome] [texto da ideia]"
---

# Criar issue

Registra um bug, uma melhoria ou uma novidade como issue de `Brennon-Oliveira/fullpad`. O padrão (tipos, labels, escrita, seções) está em [../../rules/issues.md](../../rules/issues.md): **leia-o antes de começar**. Aqui está só o roteiro.

## Argumentos

```
/criar-issue [--bug | --improvement | --feature] [--draft] [--milestone=nome] [texto da ideia]
```

- `--bug` (algo errado), `--improvement` (aprimora o que existe), `--feature` (novidade). Sem flag de tipo: deduza do texto e **diga qual escolheu** ao mostrar a issue; só pergunte se for realmente ambíguo. Mais de uma flag de tipo: pare e pergunte.
- `--draft`: **pula o refinamento**. Cria na hora um rascunho (label `refinar`), no formato "Rascunho" da regra. É para ideias cruas, que o usuário vai refinar depois.
- `--milestone=nome`: põe a issue nesse milestone (a versão em que se pretende entregar, como `2.1.0`); **cria o milestone se não existir** (veja o passo 4). Aceita o nome com ou sem `v` (`v2.1.0` vira `2.1.0`).
- O resto do texto é a ideia. Sem texto: pergunte "o que é?" (uma pergunta só) e siga.

## 1. Entender e conferir duplicata

1. Pegue o texto e o tipo.
2. Procure issue parecida antes de criar:

```sh
gh issue list -R Brennon-Oliveira/fullpad --state all --search "<palavras-chave>" --limit 10
```

Achou algo próximo: mostre (número, título, estado) e pergunte se é a mesma coisa (aí comente nela em vez de criar outra) ou se segue. Com `--draft`, só avise na resposta final.

## 2. Refinar (sem `--draft`)

O objetivo é a issue **sair pronta**, no formato do tipo, sem seção vazia por preguiça. Converse com o usuário.

- **Antes de perguntar, olhe o código/docs** (`docs/AGENTS.md`, os módulos citados): não pergunte o que o repositório responde. Em qualquer tipo, **confira o que o texto diz que existe hoje** (funções, comandos, versões, tags: `git tag`, `grep`); em `improvement` e `bug`, veja como é hoje (e, em bug, tente localizar a causa provável; não corrija nada). Afirmação que o código desmente: corrija na issue e avise o usuário; afirmação duvidosa que você não consegue conferir: vai para **Pontos a decidir**, nunca como fato.
- Pergunte em **rodadas curtas** (até 3 ou 4 perguntas por vez), as que mais mudam a issue. Use a ferramenta de perguntas com opções quando a resposta for uma escolha, e texto livre quando for aberta. Sugira uma resposta recomendada quando tiver uma.
- O que cobrir, por tipo:
  - `feature`: por que, o que a pessoa vê/faz (comportamento), decisões que o usuário já tomou, o que fica **fora**, riscos (segurança, persistência, desempenho) e o que existe para reaproveitar.
  - `improvement`: o que incomoda hoje, como deveria ficar, o que não pode piorar.
  - `bug`: passos para reproduzir, esperado vs. obtido, versão do app, tipo de arquivo/situação, evidência.
- Pergunte a **prioridade** (`prio: alta`, `boa`, `media`, `futura`, ou sem prioridade/por triar) e sugira a **área**.
- Pare de perguntar quando as seções do formato puderem ser escritas. O que o usuário não souber decidir vai para **Pontos a decidir** (feature/improvement), não fica inventado.
- Seções sem fonte ficam de fora: **Decisões** só com o que o usuário disse estar decidido; **Fora de escopo** só se ele disse (pergunte uma vez); **Cuidados** só com riscos que ele citou ou que o código evidencia (nada de enchimento como "texto em português"). Menu, atalho ou nome que você está propondo (e que o usuário não escolheu) é escrito como **proposto**.
- Se, no meio da conversa, o usuário disser que quer deixar para refinar depois, mude para o modo rascunho.

Escreva a issue no formato do tipo ([../../rules/issues.md](../../rules/issues.md)): título curto sem prefixo, português, sem segredos. O título que o usuário deu (argumento ou conversa) prevalece sobre o de qualquer nota que você tenha lido. Se o título mudou depois do refinamento, **repita a busca de duplicata** (passo 1).

## 3. Mostrar e confirmar

Mostre: tipo, **título**, **labels** (tipo, prioridade, área), e o **corpo completo**. Pergunte se pode criar ou o que ajustar. Só crie depois do ok. (Com `--draft` não há confirmação: crie e mostre o resultado.)

## 4. Criar

```sh
gh issue create -R Brennon-Oliveira/fullpad \
  --title "<título>" \
  --label "<tipo>" --label "<prio: ...>" --label "<area: ...>" \
  --body-file - <<'EOF'
<corpo>
EOF
```

- Sempre uma label de tipo (`bug`, `improvement` ou `feature`). Prioridade só se o usuário disse (em `--draft`, não invente). Rascunho: label `refinar`.
- Use `--body-file -` com heredoc de aspas simples (não `--body`), para o markdown não ser alterado pelo shell.
- Não use `--assignee`.
- **Milestone** (só se veio `--milestone=nome`): confira se existe e crie se faltar, **antes** de criar a issue:

```sh
gh api "repos/Brennon-Oliveira/fullpad/milestones?state=all&per_page=100" -q '.[].title' | grep -Fx "<nome>" \
  || gh api -X POST repos/Brennon-Oliveira/fullpad/milestones -f title="<nome>" -f description="Versão <nome>"
```

  e acrescente `--milestone "<nome>"` ao `gh issue create`. Sem a flag, a issue fica sem milestone (ele é da versão que entregar, e a `gerar-versao` o define ao fechar).

Se existir a issue fixada **"Ranking de prioridades"** (`gh issue list --search "Ranking de prioridades in:title"`) e a nova tem prioridade, acrescente `- [ ] #<n>` à lista, na posição que o usuário disser (sem resposta, no fim do grupo da prioridade), editando o corpo dessa issue.

## 5. Relatar

Diga o número, o link e as labels. Se o usuário quiser mudar algo depois: `gh issue edit <n> ...` ([../../rules/issues.md](../../rules/issues.md), "Comandos úteis").

## Regras

- **Não implemente nada**: esta skill só registra. Não crie issue sem o ok (exceto `--draft`).
- Nunca invente decisão do usuário nem preencha seção com suposição: pergunte, ou ponha em "Pontos a decidir".
- Texto sempre em português, com acentuação correta.
