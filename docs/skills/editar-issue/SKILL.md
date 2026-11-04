---
name: editar-issue
description: "Edita uma issue do Fullpad: título, corpo, labels (adicionar ou remover), prioridade, milestone, estado. Aceita --milestone=nome (cria se não existir), --label=+x,-y, --priority=nome e --refinar (conversa com o usuário para transformar um rascunho em issue de verdade). Sem nada pedido, pergunta o que mudar. Use quando pedirem para editar, atualizar, mover de milestone, mudar prioridade, rotular, fechar ou refinar uma issue."
argument-hint: "<número> [--milestone=nome] [--label=+x,-y] [--priority=nome] [--refinar] [o que mudar]"
---

# Editar issue

Altera uma issue de `Brennon-Oliveira/fullpad` conforme o usuário pedir. Padrão do projeto (tipos, labels, formato do corpo): [../../rules/issues.md](../../rules/issues.md); leia-o antes de reescrever qualquer coisa.

## Argumentos

```
/editar-issue <número> [--milestone=nome] [--label=+x,-y] [--priority=nome] [--refinar] [o que mudar]
```

- `<número>`: a issue (`12` ou `#12`). Sem número: liste as abertas recentes (`gh issue list`) e pergunte qual.
- `--milestone=nome`: põe a issue nesse milestone e **cria o milestone se não existir** (método abaixo). `--milestone=nenhum` tira. Aceita o nome com ou sem `v`.
- `--label=+x,-y`: adiciona `x` e remove `y`. Repita a flag ou separe por vírgula. Sem sinal, adiciona. Nome com espaço, entre aspas (`--label="+area: busca"`). Só valem labels que existem (`gh label list`); label inexistente: avise e pergunte se é para criar ou se foi engano. Não deixe a issue com duas de tipo.
- `--priority=nome`: `alta`, `boa`, `media`, `futura` ou `nenhuma`. Troca a label `prio: ...` atual pela nova (nunca duas). Se existir a issue fixada **"Ranking de prioridades"**, mova a linha `- [ ] #<n>` para o grupo certo (pergunte a posição, ou ponha no fim do grupo).
- `--refinar`: modo conversa, veja o passo 3.
- Texto livre: o que o usuário quer mudar ("troca o título para…", "fecha como wontfix", "acrescenta isto em Cuidados").

## 1. Ler a issue

```sh
gh issue view <n> -R Brennon-Oliveira/fullpad --json number,title,state,labels,milestone,body,comments
```

Entenda o estado atual (tipo, prioridade, `refinar`, milestone, aberta ou fechada). Issue inexistente: pare e diga.

## 2. Decidir o que fazer

- **Só flags** (`--milestone`, `--label`, `--priority`, sem texto nem `--refinar`): faça **só isso**, sem perguntas, e relate o antes e o depois. É o caso rápido.
- **Texto livre**: faça o que pediu. Se for ambíguo, pergunte uma vez.
- **Nada** (nem flag, nem texto): mostre o estado atual (título, labels, milestone, estado) e **pergunte o que mudar**.
- Misturou flags e texto: aplique tudo.

Comandos (um `gh issue edit` só, quando der):

```sh
gh issue edit <n> -R Brennon-Oliveira/fullpad \
  --title "<novo>" --body-file - \
  --add-label "<x>" --remove-label "<y>" \
  --milestone "<nome>"          # ou --remove-milestone
gh issue close <n> -R Brennon-Oliveira/fullpad --reason completed --comment "<por quê>"   # ou "not planned" + label wontfix
gh issue reopen <n> -R Brennon-Oliveira/fullpad
```

- **Milestone**: confira/crie antes de usar:

```sh
gh api "repos/Brennon-Oliveira/fullpad/milestones?state=all&per_page=100" -q '.[].title' | grep -Fx "<nome>" \
  || gh api -X POST repos/Brennon-Oliveira/fullpad/milestones -f title="<nome>" -f description="Versão <nome>"
```

- **Corpo**: ao reescrever, mantenha o formato do tipo e **não perca informação** que o usuário não pediu para tirar. Mostre o que mudou (antes e depois dos trechos alterados). Mudança pequena em seção: edite só ela.
- Fechar: com motivo em comentário. Entregue em versão: use o milestone da versão (a `gerar-versao` já faz isso). Descartada: `wontfix`.
- Trocar de tipo (`feature` ↔ `improvement` ↔ `bug`): vale, mas ajuste o corpo ao formato do tipo novo.

## 3. `--refinar`: de rascunho a issue de verdade

Para uma issue com a label `refinar` (ideia crua), ou qualquer uma que o usuário queira aprofundar. O objetivo é **sair pronta**, no formato do tipo, sem a label `refinar`.

1. Leia a issue e os comentários. **Olhe o código e os docs** antes de perguntar (`docs/AGENTS.md`, módulos citados); confira o que a issue afirma que existe hoje. Não pergunte o que o repositório responde.
2. Converse em **rodadas curtas** (3 ou 4 perguntas), começando pelas **"Perguntas a refinar"** da issue e pelo que mais muda o resultado. Use a ferramenta de perguntas com opções quando for escolha, texto livre quando for aberta; sugira a resposta recomendada quando tiver uma.
   - `feature`: por quê, comportamento visível, decisões já tomadas, o que fica fora, riscos, o que reaproveitar.
   - `improvement`: o que incomoda, como deveria ficar, o que não pode piorar.
   - `bug`: passos, esperado vs. obtido, versão, ambiente, evidência; tente localizar a causa (sem corrigir).
3. Pergunte **prioridade** e **área** se faltarem.
4. Pare quando as seções do formato puderem ser escritas. O que o usuário não decidir vai para **Pontos a decidir**; nada de inventar decisão. Seções sem fonte ficam de fora (**Decisões** só com o que ele disse estar decidido; **Cuidados** só com riscos citados ou evidentes no código; proposta sua é escrita como **proposta**).
5. **Mostre a issue reescrita** (título, labels, corpo) e peça o ok. Só então: `gh issue edit` com o corpo novo, remova `refinar`, ajuste prioridade e área. Se o usuário parar no meio e quiser continuar depois, deixe a issue como está (com `refinar`) e, se houver decisões úteis, registre-as como comentário.

## 4. Relatar

Diga o que mudou (antes → depois: labels, milestone, título, estado) e o link.

## Regras

- Faça só o que foi pedido; não "arrume" outras coisas da issue.
- Nunca apague issue nem comentário. Fechar com motivo; descartar com `wontfix`.
- Português, com acentuação correta, sem segredos.
