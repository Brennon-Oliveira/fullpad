# Plano de implementação

Cada fase termina em uma **PARADA**: um ponto em que o app está usável e eu espero sua análise e testes antes de seguir. Os critérios de aceite dizem o que checar.

Legenda: ✅ feito · ⬜ pendente

## Fase 0 — Esqueleto (entregue)

- ✅ Workspace cargo (`core` + `app`) e UI Vite/TS
- ✅ `core`: modelo, `Store`, escrita atômica, sessão tolerante a corrupção, lixeira. 6 testes
- ✅ `app`: comandos IPC, single-instance, janela que só aparece quando a UI está pronta
- ✅ UI: abas, CodeMirror (markdown em modo código), autosave 400 ms, flush ao perder foco/fechar, restauração de aba ativa, cursor e scroll
- ⬜ **Ainda não compilado/rodado** o crate `app` (ver "Pendências de ambiente")

**PARADA 0:** rodar `tauri dev` no Windows e validar o checklist da Fase 1.

## Fase 1 — MVP "nunca perde nada"

| Milestone | Entrega | Critério de aceite |
|---|---|---|
| 1.1 | App abre, digita, autosave | Digitar, matar o processo (Gerenciador de Tarefas) e reabrir: o texto está lá |
| 1.2 | Abas | Ctrl+T, Ctrl+W, Ctrl+Tab, clique do meio fecha; fechar a última cria uma nova |
| 1.3 | Sessão completa | Reabrir restaura aba ativa, cursor e scroll de cada aba |
| 1.4 | Robustez | `session.json` corrompido não impede abrir; nota fechada vai para `trash/` |
| 1.5 | Single instance e start rápido | Abrir 2x reaproveita a janela; medir tempo até a janela aparecer (meta: < 500 ms) |
| 1.6 | Atalhos e polimento | Reordenar abas por arrastar, menu de contexto da aba, restaurar aba fechada (Ctrl+Shift+T) a partir de `trash/` |

**PARADA 1:** você usa o app como bloco de notas por alguns dias. Quero saber: tempo de abertura, qualquer perda de texto, incômodos nas abas.

## Fase 2 — Markdown renderizado (live preview)

| Milestone | Entrega | Critério de aceite |
|---|---|---|
| 2.1 | Toggle renderizado/código por aba (botão + Ctrl+E), salvo na sessão | Alternar não altera o texto nem o undo |
| 2.2 | Decorations: títulos, negrito/itálico/código inline, esconder marcadores fora da linha do cursor | Cursor na linha mostra a sintaxe; fora dela, renderizado |
| 2.3 | Listas, checkboxes clicáveis, citações, links, linha horizontal | Clicar no checkbox alterna `[ ]`/`[x]` no texto |
| 2.4 | Blocos de código com highlight por linguagem | Linguagens comuns coloridas, sem travar |
| 2.5 | Tabelas e imagens (caminho relativo e URL) | Tabela renderizada, editável célula a célula pela linha-fonte |
| 2.6 | Tema claro/escuro seguindo o SO, fonte configurável | Segue o tema do Windows |

Regra: o documento é sempre texto puro; renderizar nunca reescreve o conteúdo. Desligar decorations em arquivos grandes (> ~2 MB).

**PARADA 2:** você escreve notas reais em markdown. Quero saber: o que parece estranho ao editar, o que falta renderizar.

## Fase 3 — Arquivos reais

| Milestone | Entrega | Critério de aceite |
|---|---|---|
| 3.1 | Abrir arquivo (Ctrl+O, arrastar, argumento de linha de comando) | Abre `.md`/`.txt`; segunda instância repassa o arquivo à janela existente |
| 3.2 | Salvar / Salvar como (Ctrl+S) e converter nota avulsa em arquivo | Ctrl+S grava no caminho; avulsa nunca pergunta nada |
| 3.3 | Buffer sombra | Editar arquivo real sem salvar, fechar e reabrir: edição volta, arquivo em disco intocado |
| 3.4 | Encoding e quebras de linha | UTF-8, UTF-8 BOM e CP1252 detectados; CRLF/LF preservados ao salvar |
| 3.5 | Mudança externa | Arquivo alterado fora do app: aviso para recarregar ou manter |
| 3.6 | Instalador e associação | MSI/NSIS associa `.md` e `.txt` (opcional, escolhido na instalação) |

**PARADA 3:** testar com seus arquivos reais, incluindo acentuação, CRLF e arquivos que outro programa edita.

## Fase 4 — Conforto

| Milestone | Entrega | Critério de aceite |
|---|---|---|
| 4.1 | Busca no arquivo (Ctrl+F) e substituir | Já vem do CodeMirror; só ajustar visual |
| 4.2 | Busca em todas as notas (Ctrl+Shift+F) | Resultados clicáveis que abrem a aba na posição |
| 4.3 | Atalho global + bandeja | Atalho abre/foca a janela com nota nova; fechar a janela pode manter na bandeja (opção) |
| 4.4 | Lista/histórico de notas fechadas | Recuperar nota de `trash/` pela UI |
| 4.5 | Configurações | Arquivo `settings.json`: tema, fonte, atalho global, comportamento da bandeja |

**PARADA 4:** versão 1.0. Revisamos o que sobrou e decidimos o que entra depois (sync, exportar HTML/PDF, SQLite+FTS).

## Pendências de ambiente

- O WSL desta máquina não tem `pkg-config` nem `libwebkit2gtk-4.1-dev`, então o crate `app` não compila nativamente aqui. O `.exe` de Windows sai por cross-compile com `cargo-xwin` (veja `docs/rules/build-windows.md`); o app em si só foi executado no Windows do usuário.
- Ícones atuais são um quadrado azul provisório; trocar por `pnpm tauri icon <imagem>` quando tiver um.
