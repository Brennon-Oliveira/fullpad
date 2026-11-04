---
titulo: Suporte a Mermaid (no markdown e em arquivos próprios)
feita: não
versao: —
---

# Mermaid

Diagramas escritos em texto (fluxogramas, sequência, classes, estados, Gantt, ER etc.) renderizados no app.

## Ideia

- **No markdown**: blocos de código com a linguagem `mermaid` viram o diagrama no live preview, no painel renderizado e na exportação. Hoje esses blocos só ganham destaque de código.
- **Arquivos próprios**: `.mmd`/`.mermaid` com destaque e o diagrama ao lado do código, no mesmo molde do DBML (`ui/src/dbml/`): pan e zoom, ligação cursor ↔ elemento quando for possível, e o diagrama em janela separada (`detached`).

## Pontos a decidir

- A biblioteca `mermaid` é pesada: **só carregar por `import()` na primeira vez** que aparecer um diagrama (mesma regra do DBML: nada de importar estaticamente a partir de `main.ts`).
- Segurança: `securityLevel: "strict"` (sem HTML nem scripts nos rótulos) e renderização sem rede.
- Tema: acompanhar claro/escuro do sistema, trocando quando o tema muda.
- Erro de sintaxe: mostrar a mensagem do parser no lugar do diagrama, sem perder o texto.
- Exportação: o diagrama como SVG embutido no HTML e no PDF.
- Compartilhar o painel de pan/zoom com o do DBML em vez de duplicar.

## Cuidados

- O documento continua texto puro; só se renderiza.
- Limite de tamanho do texto para renderizar, como `MAX_DIAGRAM_CHARS` do DBML.
