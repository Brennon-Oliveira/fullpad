---
titulo: Suporte a LaTeX (no markdown e em arquivos próprios)
feita: não
versao: —
---

# LaTeX

Equações renderizadas, no markdown e em arquivos próprios.

## Ideia

- **No markdown**: `$...$` (em linha) e `$$...$$` (em bloco) renderizados no live preview, no painel renderizado (`mdpreview.ts`) e na exportação (HTML, PDF, copiar como HTML). Com o cursor dentro, mostra o código, como o resto do live preview.
- **Arquivos próprios**: `.tex` com destaque de sintaxe e, para equações soltas, uma visão renderizada ao lado do código (como o diagrama do DBML). Decidir se vale só equações (fórmulas) ou também documentos LaTeX completos (isto é bem maior: compilar de verdade não cabe no app).
- Entra na barra de formatação: o botão **√x** do Notion, que ficou de fora de propósito até existir LaTeX (ver [barra de formatação](barra-de-formatacao.md)).

## Pontos a decidir

- Biblioteca: KaTeX (rápida, só matemática) ou MathJax (mais completa, mais pesada). Em qualquer caso, carregar **sob demanda** com `import()`, como o resto (nada pesa na abertura).
- Fontes do KaTeX viajam no app (sem rede), como as do pdf.js em `ui/public/`.
- Segurança: renderizar sem `\href`/`\url` que abram links não pedidos, e com `trust: false`.
- Exportação para PDF/HTML autônomo: o CSS e as fontes precisam ir junto.
- Erro de sintaxe na equação: mostrar o trecho com o erro em vez de quebrar a linha inteira.

## Cuidados

- O documento continua texto puro: renderizar nunca reescreve o conteúdo.
- Não usar margem vertical nas linhas e widgets do `.cm-md-*` (o mapa de alturas do CodeMirror não a conta; ver [AGENTS.md](../AGENTS.md)).
