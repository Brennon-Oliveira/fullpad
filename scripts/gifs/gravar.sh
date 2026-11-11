#!/usr/bin/env bash
# Grava os GIFs do README a partir do Fullpad aberto no Windows, com os arquivos de `examples/` já
# abertos em abas (é o estado normal de quem abre a pasta de exemplos). Roda no WSL.
#
#   scripts/gifs/gravar.sh              grava todas as cenas
#   scripts/gifs/gravar.sh csv json     só essas
#
# Como usar: rode o comando e, **em até 30 s, clique na janela do Fullpad** (o Windows não deixa um
# programa em segundo plano trazê-la para a frente). Depois não toque no mouse nem no teclado até
# terminar (~2 min): o script digita atalhos de verdade na janela. Só navega e seleciona; não edita
# nenhum arquivo. Saída: docs/img/<cena>.gif.
#
# Cada cena começa abrindo a aba pela paleta (Ctrl+P) **sem gravar**, porque a lista da paleta mostra
# o caminho dos arquivos na máquina de quem grava. Confira os quadros antes de commitar.
# Precisa de: python3 com Pillow (`python3 -m venv /tmp/gifs && /tmp/gifs/bin/pip install pillow`,
# informe com PY=/tmp/gifs/bin/python).
set -euo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd); RAIZ=$(cd "$AQUI/../.." && pwd)
PY=${PY:-python3}
WTEMP=$(cd /mnt/c && cmd.exe /c "echo %TEMP%" 2>/dev/null | tr -d '\r'); WT=$(wslpath "$WTEMP")
mkdir -p "$WT/fpgifs" "$RAIZ/docs/img"; cp "$AQUI/gravar.ps1" "$WT/fpgifs/gravar.ps1"
TMP=$(mktemp -d)

nav() { echo "c:ctrl+p|q:0.6|u:$1|q:0.7|c:enter|q:1.5"; }                    # abre a aba pela paleta, sem gravar
baixo() { local s=""; for _ in $(seq "$1"); do s+="c:down|w:0.3|"; done; echo "${s%|}"; }

cena() {  # cena <nome> <passos> [largura]
  local nome=$1 passos=$2 larg=${3:-1000}
  if [ -n "${SO:-}" ] && [[ " $SO " != *" $nome "* ]]; then return; fi
  echo "gravando: $nome"
  (cd /mnt/c && powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$WTEMP\\fpgifs\\gravar.ps1" \
      -Dir "$WTEMP\\fpgifs\\$nome" -Steps "$passos" -Fps 8 | tail -1)
  rm -rf "$TMP/$nome"; mkdir -p "$TMP/$nome"; cp "$WT/fpgifs/$nome"/* "$TMP/$nome/"
  "$PY" "$AQUI/montar.py" "$TMP/$nome" "$RAIZ/docs/img/$nome.gif" "$larg" 96
}
SO="$*"

cena paleta "q:0.3|r|w:0.6|c:ctrl+shift+p|w:0.9|c:down|w:0.35|c:down|w:0.35|c:down|w:0.35|t:ir|w:0.9|c:esc|w:0.5|x"
cena markdown "$(nav example.md)|r|w:1.2|c:pagedown|w:0.9|c:pagedown|w:0.9|c:pagedown|w:0.9|c:ctrl+home|w:0.6|$(baixo 7)|c:home|c:ctrl+shift+right|c:ctrl+shift+right|c:ctrl+shift+right|w:1.6|c:right|w:0.6|x"
cena csv "$(nav example.csv)|r|w:1.2|$(baixo 3)|c:right|w:0.3|c:right|w:0.3|c:shift+down|w:0.3|c:shift+down|w:0.3|c:shift+down|w:0.3|c:shift+down|w:1.4|c:esc|w:0.6|x"
cena json "$(nav example.json)|r|w:1.2|$(baixo 8)|w:1.0|x"
cena dbml "$(nav example.dbml)|r|w:1.6|$(baixo 9)|w:1.2|x"
cena mermaid "$(nav example.mmd)|r|w:1.8|$(baixo 6)|w:1.2|x"
cena latex "$(nav example.tex)|r|w:1.2|$(baixo 7)|w:1.2|x"   # termina na aba do .tex, como o app costuma ficar
rm -rf "$TMP"
echo "feito: confira docs/img/*.gif antes de commitar"
