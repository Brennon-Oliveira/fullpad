---
titulo: Changelog completo (todas as versões, com intervalo)
feita: não
versao: —
---

# Changelog completo

Prioridade alta, pedida pelo usuário. Ver o que mudou de uma versão para outra, **incluindo várias versões de uma vez**, e ter também o changelog geral, completo, de todas as versões.

## Ideia

- **Histórico de versões** no app (Ajuda > "Histórico de versões…"): todas as versões, da mais nova para a mais antiga, cada uma com data e as notas (Novidades, Correções, Melhorias).
- **Intervalo**: escolher "de 1.0.0 até 2.3.0" e ver tudo junto, agrupado por tipo ou por versão.
- **Ao atualizar pulando versões** (de 1.1.0 direto para 2.3.0): a nota que abre depois da atualização mostra tudo o que entrou **desde a versão que a pessoa tinha**, não só a da última.
- O diálogo de "há uma versão nova" também pode resumir o que há entre a instalada e a nova.
- Filtro por texto (achar "em que versão entrou a busca global").

## Como encaixa (hoje)

- O app embute só `crates/app/release-notes.md`, a nota da versão atual (`startup_release_notes`, `release_notes`). As notas das anteriores ficam na mensagem da tag anotada (`git show vX.Y.Z`) e nos releases públicos de `fullpad-releases`.
- A skill `gerar-versao` sobrescreve o `release-notes.md` a cada versão.

## Pontos a decidir

- **Fonte**: um `CHANGELOG.md` acumulado e embutido no app (funciona sem rede; a skill `gerar-versao` passa a acrescentar a versão nova no topo), ou ler os releases do GitHub (mostra até versões ainda não instaladas, mas exige rede). Provável: embutido, e o `latest.json`/release traz o resumo da versão nova.
- **Retroativo**: montar o arquivo das versões já publicadas a partir das mensagens das tags (`v0.1.0` em diante; as notas das 0.2.0 e 0.2.1 foram feitas antes da skill e podem estar incompletas).
- **Formato**: markdown com um cabeçalho por versão (`## 2.0.0 · 2026-11-04`), para o app conseguir separar as versões e montar intervalos; definir o formato exato e testar o parser (função pura, `ui/src/changelog.ts`).
- **Onde aparece**: uma aba só de leitura (como a nota de versão de hoje) ou janelinha própria com a seleção de intervalo.
- Saber a versão anterior da pessoa: guardar a última versão que ela abriu (o app já grava `version` na pasta de dados em `Store::note_running_version`).

## Cuidados

- A nota de versão atual continua se abrindo sozinha na primeira abertura; o histórico completo é uma ação a pedido.
- Texto sempre em português, para quem usa o app (a regra das notas já vale).
