# Commits e títulos de PR

Os commits são a fonte das notas de versão: a skill `gerar-versao` ([../skills/gerar-versao/SKILL.md](../skills/gerar-versao/SKILL.md)) lê o histórico desde a última tag `v*`, calcula a próxima versão e escreve as notas a partir dos commits (elas aparecem no diálogo de atualização do app). Commit mal escrito vira nota de versão ruim ou versão errada.

## Formato

`tipo(escopo opcional): resumo`

Tipos: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`.

- `feat`: capacidade nova para quem usa o projeto. Gera versão minor.
- `fix`: correção de comportamento errado. Gera versão patch.
- `perf`, `refactor`: melhoria sem mudar o comportamento esperado.
- `docs`, `test`, `build`, `ci`, `chore`: manutenção; ficam fora das seções principais das notas.

## Resumo

- Em **português**, no **imperativo**, na primeira linha, curto.
- Descreve o **efeito da mudança para quem usa o projeto**, não o arquivo alterado.
  - Bom: `feat(abas): permite restaurar a aba fechada com Ctrl+Shift+T`
  - Ruim: `feat: altera main.ts`
- O escopo é a área do produto afetada (`abas`, `sessao`, `preview`, `arquivos`), opcional.

## Corpo

Obrigatório quando a mudança não é trivial: explique **o que mudou e por quê** (contexto, decisão, o que foi descartado). Linha em branco entre o resumo e o corpo.

## Mudança incompatível

Coloque `!` depois do tipo (e do escopo) e acrescente o rodapé:

```
feat(sessao)!: troca o formato do session.json

BREAKING CHANGE: o campo `tabs` passa a ser uma lista de objetos. Sessões antigas são migradas na primeira abertura; versões anteriores não leem o novo formato.
```

O rodapé explica o que quebra e **o que fazer para migrar**. Mudança incompatível gera versão major.

## Um commit por mudança lógica

Não misture feature, correção e refatoração no mesmo commit. Cada commit deve ficar coerente e, quando possível, passar nos testes sozinho.

## Pull requests

O título do PR segue o mesmo formato (`tipo(escopo): resumo`), para que um merge com squash gere um commit válido. A descrição do PR repete o corpo e o `BREAKING CHANGE`, se houver.
