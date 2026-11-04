---
titulo: Notas rápidas (post-it sempre no topo e captura global)
feita: não
versao: —
---

# Notas rápidas

O usuário achou a do post-it **genial**.

## Ideia

- **Post-it**: uma janela pequena de nota que fica **sempre por cima** das outras (alvo: anotar enquanto se lê ou trabalha em outro programa). Menu da aba ou botão: "Manter no topo"; quando ligado, a janela flutua, e dá para deixá-la pequena, sem a barra de menu (as janelas flutuantes já não têm o menu superior).
- **Captura rápida**: um atalho **global** do Windows (funciona com o app em segundo plano) que abre ou foca uma nota nova, pronta para digitar, e some de novo com Esc ou ao perder o foco, sem tirar nada do lugar.
- Opcional: transparência/opacidade ajustável para o post-it não atrapalhar.

## Como encaixa

- As janelas flutuantes já existem (`new_window`, mover aba para uma janela nova, `prewarm`). O "sempre no topo" é um atributo da janela do Tauri (`set_always_on_top`) e entra na lista de janelas lembradas da sessão (`WindowState`).
- O atalho global exige o plugin `tauri-plugin-global-shortcut`; escolher um atalho padrão que não conflite e deixá-lo configurável (liga com os [atalhos personalizáveis](atalhos-personalizaveis.md)).
- A nota da captura é uma nota comum (`new_note`): nada de formato novo, nada de perder texto.

## Pontos a decidir

- Atalho global padrão e se vem ligado ou desligado (um atalho global ocupa uma combinação do sistema inteiro).
- A captura abre uma janela própria pequena ou usa a janela principal.
- Lembrar posição, tamanho e "sempre no topo" de cada janela ao reabrir o app.
- Ícone de bandeja (para o app ficar vivo em segundo plano e responder ao atalho) e o que acontece ao fechar a janela principal.
