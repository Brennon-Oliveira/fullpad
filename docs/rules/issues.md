# Issues: bugs, melhorias e novidades

As ideias, melhorias e bugs do Fullpad vivem nas **Issues** do repositório (`Brennon-Oliveira/fullpad`), não em arquivos do projeto. Skills: criar [criar-issue](../skills/criar-issue/SKILL.md), editar [editar-issue](../skills/editar-issue/SKILL.md) (labels, prioridade, milestone, refinar rascunhos) e implementar [implementar-issue](../skills/implementar-issue/SKILL.md).

> Enquanto a migração não termina, as ideias antigas ainda estão em [../banco-de-ideias/](../banco-de-ideias/README.md). Ideia nova vai direto para uma issue.

## Tipos (label obrigatória, uma só)

| Label | O que é | Exemplo |
|---|---|---|
| `feature` | **Novidade**: algo novo que o app passa a ter. Pode ser em cima de algo que existe, mas é uma capacidade nova no geral | Suporte a LaTeX, notas rápidas |
| `improvement` | **Melhoria**: aprimora algo que já existe, sem ser uma capacidade nova | Rolar o sumário até o item atual, busca mais rápida |
| `bug` | **Bug**: algo que está errado (comportamento diferente do esperado) | O clique cai na linha errada |

Na dúvida entre `feature` e `improvement`: se a pessoa precisaria aprender uma coisa nova para usar, é `feature`.

## Outras labels

- **Prioridade** (no máximo uma; sem ela, a issue está por triar): `prio: alta` (as "melhores", fazer primeiro; num bug, urgente), `prio: boa`, `prio: media`, `prio: futura`.
- **Estado**: `refinar` = ideia crua, que precisa de conversa antes de planejar (é o que a flag `--draft` da skill põe). Sai quando a issue ganha forma.
- **Área** (opcional, uma ou mais): `area: editor`, `area: abas`, `area: markdown`, `area: leitor`, `area: dados`, `area: busca`, `area: sistema`.
- `duplicate` e `wontfix` ao fechar sem fazer.

## Ordem

- O ranking dentro de uma prioridade fica numa issue fixada, **"Ranking de prioridades"** (criada junto com a migração das ideias antigas; a skill `criar-issue` a mantém): uma lista de tarefas com `- [ ] #12` na ordem sugerida (o GitHub mostra o título e o estado de cada uma). Mudou a ordem: edite a lista, não os títulos.

## Escrita

- **Português**, acentuação correta, para quem decide o que fazer, não para quem programa. Sem segredos, sem caminhos de máquina.
- **Título**: o nome da coisa, curto, sem prefixo de tipo (o tipo é a label) e sem ponto final. Bom: `Changelog completo com intervalo de versões`. Ruim: `[feature] adicionar changelog`. Bug: descreva o efeito: `Clique no markdown renderizado cai na linha errada`.
- **Corpo**: seções abaixo, na ordem. Omita uma seção só se não tiver nada a dizer; não escreva "N/A".
- Decisões já tomadas pelo usuário ficam em destaque (em **Decisões**), para não serem rediscutidas.
- Link para outras issues com `#12`. Link para o código: caminho entre crases (`ui/src/menus.ts`).

### `feature`

```markdown
## O que é
<um parágrafo: o que a pessoa passa a poder fazer>

## Por que
<o problema ou a vontade por trás>

## Ideia
<como seria, em tópicos: comportamento visível>

## Decisões
<o que já foi decidido, para não rediscutir>

## Como encaixa
<o que já existe e se reaproveita, o que muda; sem prometer implementação>

## Pontos a decidir
- <pergunta em aberto>

## Fora de escopo
- <o que não entra>

## Cuidados
- <segurança, persistência, desempenho, regras do projeto que valem aqui>
```

### `improvement`

```markdown
## O que já existe
<como funciona hoje (confira no app/código)>

## O que melhorar
<o que incomoda ou limita>

## Proposta
<como deveria ficar>

## Pontos a decidir
- <pergunta em aberto>

## Cuidados
- <o que não pode piorar>
```

### `bug`

```markdown
## O que acontece
<o comportamento errado>

## O que deveria acontecer
<o esperado>

## Como reproduzir
1. <passo>

## Ambiente
- Versão do Fullpad: <x.y.z>
- Sistema: <Windows 11, ...>
- Tipo de arquivo / situação: <md, json, várias janelas...>

## Evidência
<mensagem de erro, captura, arquivo de exemplo>

## Causa provável
<só se já se sabe; senão omita>
```

### Rascunho (`--draft`)

Para ideias cruas: o mínimo, com a label `refinar`.

```markdown
## Ideia
<o que o usuário disse, limpo mas sem inventar>

## Perguntas a refinar
- <o que falta definir antes de planejar>
```

## Milestones

Um milestone é uma **versão** (`2.1.0`, sem `v`). Serve para planejar ("vai na 2.1.0") e, fechado, para registrar em que versão a issue saiu. `criar-issue --milestone=2.1.0` e `editar-issue --milestone=2.1.0` criam o milestone se ele não existir.

## Ciclo de vida

- **Implementou**: `implementar-issue` liga os commits à issue com `Refs #12` (nunca `Closes`: fechar antes da versão sair esconderia o que ainda não foi entregue) e comenta nela.
- **Entregou**: ao gerar a versão, a `gerar-versao` fecha as issues citadas por `Refs #n` nos commits, com o **milestone da versão** (`2.0.0`). Comente o que mudou de natureza em relação à ideia original, se mudou.
- **Mudou de ideia**: feche com `wontfix` e um comentário com o motivo; não apague.
- **Refinar**: a conversa vai em comentários da própria issue; quando a ideia ganha forma, reescreva o corpo no formato do tipo e tire a label `refinar`.
- O comportamento final de uma feature entregue passa a ser documentado em `docs/AGENTS.md` (arquitetura), como sempre.

## Comandos úteis

```sh
gh issue list -R Brennon-Oliveira/fullpad --label feature --label "prio: alta"
gh issue view 12 -R Brennon-Oliveira/fullpad
gh issue edit 12 -R Brennon-Oliveira/fullpad --add-label "prio: boa" --remove-label refinar
gh issue close 12 -R Brennon-Oliveira/fullpad --comment "Entregue na 2.1.0" 
```
