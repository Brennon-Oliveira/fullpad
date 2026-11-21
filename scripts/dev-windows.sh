#!/usr/bin/env bash
# Build de DESENVOLVIMENTO para Windows (a partir do WSL): compila, fecha a versão de desenvolvimento que estiver
# aberta e abre a nova. Convive com o Fullpad instalado sem dividir nada com ele (outro identificador, outra pasta de
# dados `fullpad-dev`, outro `.exe` e ícone vermelho). Ver docs/rules/build-dev.md.
#
#   scripts/dev-windows.sh [--no-run] [arquivo ...]
#
#   --no-run   só compila (não fecha nem abre)
#   arquivo    caminhos entregues ao app ao abrir (como "Abrir com")
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
OUT=target/dev
EXE="$OUT/x86_64-pc-windows-msvc/release/fullpad.exe"
DEVEXE="$OUT/fullpad-dev.exe" # nome próprio: o `taskkill` daqui nunca toca o `fullpad.exe` do app instalado

RUN=1
if [ "${1:-}" = "--no-run" ]; then RUN=0; shift; fi

pnpm --dir ui build
# TAURI_CONFIG troca identificador, nome e ícone só nesta compilação; a feature liga o modo de desenvolvimento do código
TAURI_CONFIG="$(cat crates/app/tauri.dev.conf.json)" \
    cargo xwin build --release --target x86_64-pc-windows-msvc -p fullpad \
    --features tauri/custom-protocol,dev-build --target-dir "$OUT"

if [ "$RUN" = 0 ]; then
    cp -f "$EXE" "$DEVEXE.new" 2>/dev/null && mv -f "$DEVEXE.new" "$DEVEXE" 2>/dev/null || true
    echo "build de desenvolvimento pronto: $DEVEXE"
    exit 0
fi

timeout 20 taskkill.exe /F /IM fullpad-dev.exe >/dev/null 2>&1 || true
sleep 1
cp -f "$EXE" "$DEVEXE"
(setsid nohup "./$DEVEXE" "$@" </dev/null >/tmp/fullpad-dev.log 2>&1 &)
up=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    if tasklist.exe | grep -qi 'fullpad-dev.exe'; then up=1; break; fi
done
if [ "$up" = 1 ]; then
    echo "Fullpad DEV aberto às $(date +%H:%M:%S): $(tasklist.exe | grep -i 'fullpad-dev.exe' | head -1 | awk '{print "PID " $2}')"
else
    echo "Fullpad DEV não ficou aberto: veja /tmp/fullpad-dev.log" >&2
    exit 1
fi
