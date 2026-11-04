---
titulo: Seguir log (tail) e modo observar arquivo
feita: não
versao: —
---

# Seguir log (tail)

Ideia do usuário: um "tail" para arquivos de log, tipo um *watch mode*, mas focado em log.

## Ideia

- Uma aba (ou um botão numa aba de arquivo) em modo **seguir**: quando o arquivo cresce, as linhas novas aparecem sozinhas no fim e a tela acompanha, como o `tail -f`.
- Rolar para cima **pausa** o acompanhamento (com um aviso "3 linhas novas ↓" para voltar ao fim), e voltar ao fim retoma.
- Lida com **rotação de log** (o arquivo é renomeado/recriado): reabre quando o arquivo some e volta.
- Filtro ao vivo por texto ou expressão regular, e **destaque** por nível (`ERROR`, `WARN`, `INFO`) e por data/hora, com cores.
- Um modo "observar" mais geral: recarregar o arquivo sozinho quando ele muda por fora (hoje só há a faixa "Recarregar" nas abas de leitura), com a opção de comparar o que mudou (ver [comparar](comparar-diff.md)).

## Como encaixa

- Depende das [abas para arquivos gigantes](arquivos-gigantes.md): ler só o fim e acompanhar o crescimento, sem recarregar o arquivo inteiro.
- No Rust: observar o arquivo (`notify`, ou comparar tamanho e data a cada poucos centenas de ms), ler só os bytes novos e avisar a UI por evento.
- Só leitura: seguir um log nunca grava nele.

## Pontos a decidir

- Intervalo de atualização e custo com vários logs seguidos ao mesmo tempo.
- Teto de linhas mantidas na tela (descartar as mais antigas) para não crescer sem fim.
- Destaque de linhas por nível: lista fixa ou regras do usuário.
- Como aparece: nova aba de tipo "log" ou só um modo de qualquer aba de arquivo.
