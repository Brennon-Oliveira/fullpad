# Banco de ideias: como funciona

Esta pasta guarda features pensadas para o Fullpad que ainda não entraram no [PLANO](../PLANO.md). Uma ideia por arquivo. Aqui se registra a intenção e as decisões já tomadas; a entrega por fases continua sendo do PLANO.

## Estrutura

```
banco-de-ideias/
  README.md    índice (tabela com título, feita e versão de cada ideia)
  prioridades.md  as ideias ordenadas por importância (melhores, boas, médias, a refinar, futuras)
  AGENTS.md    este arquivo
  <ideia>.md   uma ideia (nome em kebab-case, sem acento: busca-global.md)
```

## Cabeçalho obrigatório

Todo arquivo de ideia começa com este bloco:

```yaml
---
titulo: <nome da ideia>
feita: não | sim
versao: <versão em que saiu, ex.: 0.7.0; "—" enquanto não foi feita>
---
```

- `feita: não` exige `versao: —`; `feita: sim` exige a versão em que a ideia foi entregue (a mesma do release).
- O título do cabeçalho deve bater com o da tabela do `README.md`.

## Corpo da ideia

Não há modelo rígido, mas siga esta ordem quando fizer sentido:

1. `# Título` e um parágrafo dizendo o que é.
2. **Decisões já tomadas** do usuário (ex.: "usar pdf.js", "epub.js só como referência"), em destaque, para não serem rediscutidas.
3. Como encaixa na arquitetura atual (qual crate, quais módulos da UI, o que reaproveitar), respeitando as regras de [AGENTS.md](../AGENTS.md) e [persistência](../rules/persistencia.md).
4. Pontos a decidir, fora de escopo e ordem sugerida.
5. Links para outras ideias relacionadas (`[sumário lateral](sumario-lateral.md)`).

Texto em português, com acentuação correta.

## Rotinas

- **Nova ideia**: crie o arquivo com o cabeçalho (`feita: não`, `versao: —`), acrescente uma linha na tabela do `README.md` e encaixe-a em [prioridades.md](prioridades.md) (pergunte ao usuário o nível se ele não disse).
- **Ao implementar**: trabalhe a ideia pelo PLANO (ou direto, se o usuário pedir). Ao entregar, ajuste o cabeçalho para `feita: sim` com a versão, atualize a tabela do `README.md` e remova do corpo o que mudou de natureza (o comportamento final passa a ser documentado em `docs/AGENTS.md`, na seção de arquitetura).
- **Ideia descartada**: não apague; troque o `titulo` para começar com "[Descartada]" e explique o motivo no topo do corpo.
- Não implemente uma ideia só porque ela está aqui: o usuário escolhe quando começar.
