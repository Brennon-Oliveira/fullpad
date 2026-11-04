# Prioridades das ideias

Lista das ideias do banco organizada por **importância**, a partir do que o usuário disse de cada uma ("muito importante", "genial", "fenomenal", "menos essencial", "precisa refinar", "muito futura"). Dentro de cada grupo, a ordem é a sugerida para fazer (a primeira é a mais forte). Não é compromisso de entrega: o usuário escolhe quando começar ([AGENTS.md](AGENTS.md)).

Este arquivo é só a visão por prioridade; o índice com `feita` e `versao` continua no [README](README.md). Ao mudar o ranking, mude aqui; ao entregar uma ideia, ela passa para "Já feitas".

## Melhores (fazer primeiro)

| # | Ideia | Por que está aqui | Depende de |
|---|---|---|---|
| 1 | [Changelog completo](changelog-completo.md) | "Muito importante": ver tudo que mudou entre versões, com intervalo e o geral | `gerar-versao` passa a acumular um `CHANGELOG.md` |
| 2 | [Edição avançada de texto](edicao-avancada.md) | "Fenomenal"; o CodeMirror já traz quase tudo, o custo é baixo para o ganho | atalhos sem conflito |
| 3 | [Notas rápidas (post-it)](notas-rapidas.md) | "Genial"; janela sempre no topo e captura global | plugin de atalho global |
| 4 | [Arquivos gigantes](arquivos-gigantes.md) | "Muito interessante, muito útil"; combina com a promessa de ser rápido | leitura por faixas (já existe no CSV/PDF) |
| 5 | [Atalhos personalizáveis](atalhos-personalizaveis.md) | "Importante"; também limpa a arquitetura (registro único de comandos) | registro único de comandos |

## Boas (vale muito, depois das melhores)

| # | Ideia | Por que está aqui | Depende de |
|---|---|---|---|
| 6 | [Seguir log (tail)](seguir-log.md) | Ideia do usuário; "muito útil" para quem lê logs | [Arquivos gigantes](arquivos-gigantes.md) |
| 7 | [Colar imagem no markdown](colar-imagem.md) | "Parece legal"; falta para anotar com prints | decidir onde guardar as imagens |
| 8 | [Ver HTML, SVG e imagens](visualizar-html-svg-imagens.md) | "Seria bom, se for seguro"; o modelo do EPUB já resolve a segurança | `ammonia` e `css::sanitize` (já existem) |
| 9 | [Suporte a LaTeX](latex.md) | "Logo teremos"; completa a barra de formatação (botão √x) | escolher KaTeX ou MathJax |
| 10 | [Suporte a Mermaid](mermaid.md) | Mesmo molde do DBML, que já existe | carga sob demanda |
| 11 | [Tabelas de markdown](tabelas-markdown.md) | Fecha um buraco do live preview; reaproveita a tabela do CSV | painel do CSV |
| 12 | [Comparar (diff)](comparar-diff.md) | Útil com arquivos alterados por fora e com o seguir log | algoritmo de diff |
| 13 | [Links entre notas](links-entre-notas.md) | Vira rede de notas; usa a paleta e a busca global | índice de backlinks |

## Médias (interessantes, sem urgência)

| # | Ideia | Por que está aqui |
|---|---|---|
| 14 | [Temas e aparência](temas-e-aparencia.md) | "Interessante, menos essencial" |
| 15 | [Ferramentas de texto](ferramentas-de-texto.md) | Muitas ideias soltas; precisa ser planejada e fatiada antes |
| 16 | [Mapas mentais](mapas-mentais.md) | Formato ainda a decidir; grande |
| 17 | [Nota ao lado do leitor](nota-ao-lado-do-leitor.md) | Pequena, mas só interessa a quem lê PDF/EPUB |
| 18 | [Referência com volta](referencia-com-volta.md) | Idem; mexe em `links.ts` e na identidade do arquivo |

## A refinar (boas, mas ainda sem forma)

Antes de planejar, precisam de conversa.

| Ideia | O que falta definir |
|---|---|
| [Espaços de trabalho nomeados](espacos-de-trabalho.md) | O que é um espaço e o que acontece com as abas ao trocar |
| [Painel de tarefas](painel-de-tarefas.md) | A fonte das tarefas, como achá-las e como marcar pelo painel |

## Muito futuras

| Ideia | Observação |
|---|---|
| [Backup e sincronização](backup-e-sincronizacao.md) | "Muito futura": só registrada para não se perder |

## Já feitas

[Visão de CSV](csv.md) (1.1.0), [Busca em todas as abas](busca-global.md), [YAML e TOML](yaml-toml.md), [Paleta de comandos](paleta-de-comandos.md), [Barra de formatação](barra-de-formatacao.md) e [Sumário lateral](sumario-lateral.md) (as cinco últimas na 2.0.0).
