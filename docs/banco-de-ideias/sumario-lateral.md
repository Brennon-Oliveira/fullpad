---
titulo: Sumário lateral (outline)
feita: sim
versao: próxima (a definir ao gerar a versão)
---

# Sumário lateral

Painel lateral (ou algo equivalente) com a estrutura do arquivo ativo; clicar pula para o trecho.

## Por tipo de arquivo

- **Markdown**: títulos (`#`…`######`) em árvore, com o título atual destacado conforme o cursor/rolagem.
- **JSON**: caminhos (`$.lista[0].nome`), aproveitando `json_analyze` e a árvore que já existe; pode ser a própria árvore em versão compacta.
- **DBML**: tabelas, enums e relações, ligando ao diagrama.
- **YAML/TOML** (quando existirem): chaves e tabelas, ver [yaml-toml](yaml-toml.md).
- **EPUB**: o leitor de EPUB já tem um sumário lateral próprio (Fase 10 do [PLANO](../PLANO.md)); este painel poderia reaproveitá-lo. **PDF**: marcadores (outline) do documento.
- Texto simples: sem sumário (ou só marcadores manuais, a pensar).

## Pontos a definir

- Forma: painel dentro de cada grupo de abas, barra lateral da janela ou popup rápido (Ctrl+Shift+O, estilo "ir para símbolo"). Começar por uma forma só e ver se basta.
- Filtro por texto no sumário.
- Recolher/expandir níveis; lembrar o estado por aba.
- Convive com a grade de painéis: o sumário é do painel com o foco (`cur`).

## Como encaixa

- A extração dos itens deve ficar em funções puras, sem DOM, testadas (como `tree.ts`/`grid.ts`).
- Carregar sob demanda; nada pesa na abertura.
- Pode ser um comando da [paleta](paleta-de-comandos.md) ("Ir para título…").

## Como saiu

Forma: barrinhas na borda do painel que viram um cartão ao passar o mouse, ou o cartão fixo ao lado do arquivo (botão "Manter aberto"); à esquerda por padrão, com opção à direita em Visualizar > Sumário. Markdown, DBML, JSON, YAML e TOML; PDF (marcadores) e texto simples ficaram de fora. O filtro por texto ficou com a paleta (`@`). Detalhes em [AGENTS.md](../AGENTS.md).
