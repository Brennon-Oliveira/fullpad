#!/usr/bin/env bash
# Diz se o build de Windows está em dia com o código. Ver docs/rules/build-windows.md.
#
#   scripts/check-build-windows.sh         imprime só "ok" ou "pendencia de build"
#   scripts/check-build-windows.sh --hook  modo do hook Stop do Claude Code: lê o JSON do hook na
#                                          entrada; se há pendência, avisa no stderr e sai com 2
#                                          (o que impede o agente de encerrar); senão sai com 0
#
# Pendência = algum arquivo que entra no app é mais novo que o fullpad.exe (ou o .exe não existe).
# Não olha o git, então vale também para mudança já commitada sem build.
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 0
EXE=target/x86_64-pc-windows-msvc/release/fullpad.exe

pending() {
    [ -f "$EXE" ] || return 0
    # Só o que entra no app: código Rust, manifestos, front (sem testes) e o que o instalador usa.
    # `docs/`, `scripts/`, `.claude/`, `target/`, node_modules e saídas geradas ficam de fora.
    [ -n "$(find crates ui/src ui/index.html ui/package.json ui/vite.config.ts Cargo.toml Cargo.lock \
        \( -path '*/gen' -o -path '*/node_modules' -o -path 'ui/public/pdfjs' \) -prune -o \
        -type f -newer "$EXE" \
        ! -name '*.test.ts' ! -name '*.md' -print -quit 2>/dev/null)" ]
}

if [ "${1:-}" = "--hook" ]; then
    input=$(cat)
    # Já bloqueou uma vez neste encerramento: deixa passar para não prender o agente num laço
    # (por exemplo, se o build falhar de verdade e o erro for relatado).
    case "$input" in *'"stop_hook_active":true'* | *'"stop_hook_active": true'*) exit 0 ;; esac
    if pending; then
        echo "pendencia de build: rode o build de Windows (docs/rules/build-windows.md) e reporte o resultado antes de encerrar." >&2
        exit 2
    fi
    exit 0
fi

if pending; then echo "pendencia de build"; else echo ok; fi
