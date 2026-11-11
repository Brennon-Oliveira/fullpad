#!/usr/bin/env bash
# Grava os GIFs do README a partir do Fullpad aberto no Windows, com os arquivos de `examples/` já
# abertos em abas (é o estado normal de quem abre a pasta de exemplos). Roda no WSL.
#
#   scripts/gifs/gravar.sh                grava todas as cenas
#   scripts/gifs/gravar.sh csv json       só essas
#
# COMO USAR: rode o comando e, em até 60 s, CLIQUE NA JANELA DO FULLPAD (o Windows não deixa um
# programa em segundo plano trazê-la para a frente). Depois NÃO TOQUE no mouse nem no teclado até
# terminar (alguns minutos): o script usa o mouse e digita atalhos de verdade. Mexer o mouse
# interrompe a gravação (de propósito: é o jeito de abortar).
#
# O que ele faz com o app: navega, passa o mouse, seleciona, rola, ordena e filtra a tabela do CSV,
# divide a janela em painéis e desfaz. NÃO edita nenhum arquivo e não exporta nada (só mostra os
# menus). As coordenadas dos cliques são para a janela do Fullpad MAXIMIZADA numa tela de 2582×1550
# pixels (a captura sai nesse tamanho); em outro tamanho, ajuste as coordenadas das cenas.
#
# Cada cena abre a aba pela paleta (Ctrl+P) SEM gravar, porque a lista da paleta mostra o caminho dos
# arquivos na máquina de quem grava. Confira os quadros dos GIFs antes de commitar.
# Precisa de: python3 estável (3.12 ou 3.13; o 3.14 com o Pillow 13 caiu com falha de segmentação) com Pillow e
# numpy (`python3 -m venv /tmp/gifs && /tmp/gifs/bin/pip install pillow numpy`, informe com PY=/tmp/gifs/bin/python). Saída: docs/img/<cena>.gif.
set -euo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd); RAIZ=$(cd "$AQUI/../.." && pwd)
PY=${PY:-python3}
WTEMP=$(cd /mnt/c && cmd.exe /c "echo %TEMP%" 2>/dev/null | tr -d '\r'); WT=$(wslpath "$WTEMP")
mkdir -p "$WT/fpgifs" "$RAIZ/docs/img"; cp "$AQUI/gravar.ps1" "$WT/fpgifs/gravar.ps1"
TMP=$(mktemp -d)
SO="$*"

nav() { echo "c:ctrl+p|q:0.6|u:$1|q:0.7|c:enter|q:2.0|p:1300,800|q:0.8"; }   # abre a aba pela paleta, sem gravar, e afasta o ponteiro das abas (tooltip com o caminho)
vai() { echo "c:ctrl+g|q:0.5|t:$1|c:enter"; }                 # vai à linha N (modo ":" da paleta)

cena() {  # cena <nome> <passos> [fps] [largura] [velocidade]
  local nome=$1 passos=$2 fps=${3:-6} larg=${4:-960} vel=${5:-1}
  if [ -n "$SO" ] && [[ " $SO " != *" $nome "* ]]; then return; fi
  echo "gravando: $nome"
  (cd /mnt/c && powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$WTEMP\\fpgifs\\gravar.ps1" \
      -Dir "$WTEMP\\fpgifs\\$nome" -Steps "$passos" -Fps "$fps" | tail -2)
  rm -rf "$TMP/$nome"; mkdir -p "$TMP/$nome"; cp "$WT/fpgifs/$nome"/* "$TMP/$nome/" 2>/dev/null || true
  [ -f "$TMP/$nome/tempos.txt" ] || { echo "  SEM QUADROS em $nome (a gravação abortou: foco perdido ou mouse mexido); pulei"; return 0; }
  # o Pillow às vezes cai ao quantizar (já vi falha de segmentação intermitente): tenta de novo
  for _ in 1 2 3; do
    "$PY" "$AQUI/montar.py" "$TMP/$nome" "$RAIZ/docs/img/$nome.gif" "$larg" 64 "$vel" && return 0
  done
  echo "  não consegui montar o GIF de $nome"; return 0
}

# Onde está a aba ativa? A posição das abas muda conforme a rolagem da barra, então abre o arquivo e
# acha a linha azul sob a aba ativa na imagem (devolve o x do centro da aba, em pixels da janela).
aba_ativa_x() {
  (cd /mnt/c && powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$WTEMP\\fpgifs\\gravar.ps1" \
      -Dir "$WTEMP\\fpgifs\\sonda" -Steps "$(nav "$1")|r|s|x" -Fps 6 >/dev/null)
  "$PY" - "$WT/fpgifs/sonda/f0001.jpg" <<'PYEOF'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
xs = [x for y in (85, 86, 87) for x in range(im.width)
      if (lambda p: p[2] > 140 and p[2] - p[0] > 60 and p[2] - p[1] > 20)(im.getpixel((x, y)))]
print((min(xs) + max(xs)) // 2 if xs else 1400)
PYEOF
}

# Coordenadas em pixels da janela (2582×1550): menus em y=66 (Arquivo 62, Visualizar 254, Markdown 510);
# barra de abas em y≈111; painel de edição de y=135 a 1440.

# Paleta de um campo só: `>` lista todos os comandos dos menus, com atalho.
cena paleta "p:1300,800|q:0.9|r|w:0.6|c:ctrl+shift+p|w:0.9|c:down|w:0.35|c:down|w:0.35|c:down|w:0.35|t:ir|w:0.9|c:esc|w:0.5|x"

# Markdown: live preview, tabela, equação, diagrama Mermaid e a barra de formatação sobre a seleção.
cena markdown "$(nav example.md)|r|w:1.0|p:1300,900|h:-4|w:0.6|h:-4|w:0.6|$(vai 380)|w:1.5|$(vai 471)|w:2.0|$(vai 514)|w:2.0|c:home|c:ctrl+shift+right|c:ctrl+shift+right|c:ctrl+shift+right|w:1.8|c:right|w:0.4|x"

# Visões do markdown e o sumário lateral (passar o mouse na borda abre o cartão).
cena visoes "$(nav example.md)|r|p:30,850|g:30,850|w:1.6|g:900,500|w:0.3|p:254,66|k|q:0.5|g:376,203|k|w:2.0|p:254,66|k|q:0.4|g:315,115|k|p:1300,800|w:1.4|p:254,66|k|q:0.4|g:340,159|k|w:1.0|p:1300,800|w:0.5|x" 6 960 1.4

# Exportações do markdown (só mostra os menus: não exporta nada).
cena exportar "$(nav example.md)|r|w:0.5|p:62,66|k|w:0.5|g:261,628|w:0.9|g:593,628|w:0.8|g:580,672|w:0.8|g:647,729|w:0.8|c:esc|w:0.3|c:esc|w:0.6|p:510,66|k|w:0.6|g:597,174|w:0.8|g:597,218|w:0.8|g:597,274|w:0.8|c:esc|w:0.5|x" 6 960 1.3

# Painéis: arrastar uma aba mostra os alvos para soltar; soltar na borda divide a janela; arrastar
# de volta para a barra de abas desfaz. A aba é achada pela imagem (a barra rola). O ponteiro NÃO pode
# ficar parado sobre uma aba (aparece um tooltip com o caminho do arquivo): por isso `p:` e já `D`.
if [ -z "$SO" ] || [[ " $SO " == *" paineis "* ]]; then
  X=$(aba_ativa_x example.md)
  cena paineis "$(nav example.md)|r|w:0.8|p:$X,111|D|g:1700,400|g:2511,818|w:1.4|U|w:2.0|p:1366,112|D|g:1170,112|w:0.5|U|p:1300,800|w:1.5|x" 6 960 1.2
fi

# Encaixe: com dois painéis, arrastar uma aba acende áreas azuis que mostram onde ela vai cair: o
# painel inteiro, o lado ou a base de um painel e as barras da borda externa (que dividem o bloco
# todo). A janela é dividida antes, sem gravar, e a aba volta para a barra de abas no fim.
if [ -z "$SO" ] || [[ " $SO " == *" encaixe "* ]]; then
  X=$(aba_ativa_x example.md)
  cena encaixe "$(nav example.md)|p:$X,111|D|g:1700,400|g:2511,818|U|q:1.8|r|p:1366,112|D|g:640,800|w:1.1|g:1240,800|w:1.1|g:640,1440|w:1.1|g:1291,1500|w:1.1|g:20,800|w:1.1|g:1291,150|w:1.1|g:2300,800|w:0.8|g:1170,112|w:0.5|U|p:1300,800|w:1.2|x" 6 960 1.2
fi

# CSV: tabela, ordenar pelo cabeçalho (3 cliques), filtrar, selecionar células (estatísticas no rodapé)
# e a visão do código com as colunas coloridas.
cena csv "$(nav example.csv)|r|w:0.8|p:1950,201|g:1950,201|k|w:0.9|k|w:0.9|k|w:0.7|g:157,157|k|t:Livros|w:1.4|c:ctrl+a|c:backspace|w:0.7|g:568,314|D|g:1960,470|U|w:1.6|c:esc|w:0.4|c:ctrl+e|w:1.4|c:ctrl+e|w:0.8|x"

# JSON, YAML e TOML em árvore ao lado do código.
cena dados "$(nav example.json)|r|w:1.0|p:1380,213|g:1380,213|k|w:0.8|g:1443,380|k|w:0.9|g:1418,778|k|w:0.9|g:1380,213|R|w:1.2|c:esc|w:0.4|x|$(nav example.yaml)|r|w:1.0|g:1342,580|k|w:0.9|g:1362,615|k|w:0.9|x|$(nav example.toml)|r|w:1.4|x"

# Diagrama DBML: passar o mouse pinta o trecho no código; roda dá zoom; arrastar move; Ajustar enquadra.
cena dbml "$(nav example.dbml)|r|w:1.2|p:1866,283|g:1866,283|w:0.8|g:1380,555|w:0.8|g:1530,555|w:0.9|p:1913,770|h:3|w:0.8|h:3|w:0.8|g:1913,770|D|g:1700,640|U|w:0.8|g:2361,164|k|w:1.4|x"

# Mermaid: o mesmo painel de diagrama, com zoom e arrastar.
cena mermaid "$(nav example.mmd)|r|w:1.4|p:1847,534|g:1847,534|w:0.9|p:1935,800|h:3|w:0.8|h:3|w:0.8|g:1935,800|D|g:1750,650|U|w:0.8|g:2440,164|k|w:1.4|x"

# PDF: abas de leitura (o arquivo nunca é gravado), zoom e busca no documento.
cena pdf "$(nav example.pdf)|r|w:1.0|p:1270,832|h:-4|w:0.7|h:-4|w:0.7|h:4|w:0.6|g:216,157|k|w:0.9|g:291,157|k|w:0.9|c:ctrl+f|q:0.5|t:cooperativa|c:enter|w:1.6|c:esc|w:0.4|x"

# EPUB: sumário ao lado, capítulo limpo, busca.
cena epub "$(nav example.epub)|r|w:1.0|p:125,328|g:125,328|k|w:1.4|g:125,369|k|w:1.4|p:1505,818|h:-4|w:0.8|h:-4|w:0.8|c:ctrl+f|q:0.5|t:farol|c:enter|w:1.6|c:esc|w:0.4|x"

# Busca global nas abas abertas.
cena busca "$(nav example.md)|c:ctrl+shift+f|q:0.7|r|t:mermaid|c:enter|w:2.2|c:esc|w:0.6|x"

# Destaque de sintaxe de várias linguagens; "Lang" no rodapé escolhe o destaque de um arquivo de texto.
cena codigo "$(nav example.py)|r|w:1.0|p:336,1523|g:336,1523|k|w:1.2|g:336,1400|w:0.6|c:esc|w:0.4|x|$(nav example.rs)|r|w:1.0|x|$(nav example.sql)|r|w:1.0|x|$(nav example.sh)|r|w:1.0|x"

# Equações do .tex: um cartão por equação, ligado ao código. Termina nesta aba, como o app costuma ficar.
cena latex "$(nav example.tex)|r|w:1.0|p:1900,382|g:1900,382|w:0.7|g:1900,501|w:0.7|g:1900,866|k|w:1.0|g:1900,1037|w:0.7|g:1900,1166|k|w:1.2|x"

rm -rf "$TMP"
echo "feito: confira docs/img/*.gif antes de commitar"
