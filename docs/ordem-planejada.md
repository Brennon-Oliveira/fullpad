# Ordem planejada das issues (arquivo dos milestones)

O Fullpad **não usa mais milestones** do GitHub. A ideia de reservar uma versão para cada issue não funcionou: o número da versão é consequência do que foi entregue (major = recurso grande e/ou que quebra algo; minor = recurso menor; patch = correção), e não o contrário. Este arquivo guarda **só a ordem** que existia, sem versões, para consulta. A fonte da ordem do dia a dia continua sendo a issue fixada **#35 "Ranking de prioridades"**.

## Ordem recomendada (do primeiro ao último)

Cada grupo foi pensado para andar junto; o grupo seguinte vem depois do anterior. As justificativas são as que estavam nos milestones.

1. **#37** Correção ortográfica em português (markdown e texto). Era o recurso novo do editor que mais se queria logo.
2. **#11** Ver HTML, SVG e imagens (visão segura) **e #18** Comparar (diff) entre abas e com o arquivo em disco. O #11 muda a forma de carregar HTML e pode quebrar o que existe (era o "major"); o #18 vai junto.
3. **#13** Edição avançada de texto (vários cursores, seleção em coluna, dobrar blocos) **e #23** Atalhos personalizáveis (e registro único de comandos). O #13 muda a forma de editar (era o "major") e os dois mexem no mapa de teclas, então saem juntos.
4. **#15** Tabelas de markdown renderizadas e editáveis, **#9** Colar imagem no markdown e **#21** Links entre notas e backlinks. "Markdown de verdade"; nada quebra.
5. **#3** Nota ao lado do leitor e **#4** Referência com volta ao ponto do PDF/EPUB. "Ler e anotar"; nada quebra.
6. **#19** Arquivos gigantes e **#24** Seguir log (tail) e modo observar arquivo. "Arquivos grandes e acompanhamento". Se o #19 mudar a forma de abrir arquivos e quebrar algo, passa a ser um grupo "major".
7. **#27** Mapas mentais em arquivo próprio (`.fmap`). Um tipo de arquivo novo; nada quebra.

Já entregue do plano antigo: **#16** (notas rápidas) e **#38** (`.dbmlx`), na 3.1.0.

## Histórico: em que versão cada issue saiu

Os milestones das versões já lançadas foram mantidos como registro. Este é o mesmo mapa, para o caso de eles um dia serem apagados.

| Versão | Issues |
|---|---|
| 1.1.0 | #29 |
| 2.0.0 | #30, #31, #32, #33, #34 |
| 2.1.0 | #1, #8, #10, #36 |
| 3.1.0 | #16, #38 |

## Milestones apagados (descrições originais)

- **2.2.0**: Minor. Notas rápidas (#16) e correção ortográfica em português (#37).
- **3.0.0**: Major. Ver HTML, SVG e imagens (#11) muda a forma de carregar HTML e pode quebrar o que existe; vai junto comparar diferenças (#18).
- **4.0.0**: Major. Edição avançada (#13) muda a forma de editar; vai junto com atalhos personalizáveis (#23), porque os dois mexem no mapa de teclas. (Na hora de apagar, tinha as 11 issues abertas: #3, #4, #9, #13, #15, #19, #21, #23, #24, #27, #37.)
- **4.1.0**: Minor. Markdown de verdade: tabelas editáveis (#15), colar imagem (#9) e links entre notas (#21).
- **4.2.0**: Minor. Ler e anotar: nota ao lado do leitor (#3) e referência com volta (#4).
- **4.3.0**: Minor. Arquivos grandes e acompanhamento: arquivos gigantes (#19) e seguir log (#24).
- **4.4.0**: Minor. Mapas mentais (#27).
