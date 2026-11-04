#!/usr/bin/env bash
# Fullpad — exemplo de Shell: script de backup de notas com opções, funções e traps.
set -euo pipefail
IFS=$'\n\t'

readonly VERSAO="1.2.0"
readonly PADRAO_ORIGEM="${HOME}/.local/share/fullpad"
readonly PADRAO_DESTINO="${HOME}/backups"

uso() {
  cat <<AJUDA
Uso: ${0##*/} [-o ORIGEM] [-d DESTINO] [-k DIAS] [-n] [-v]

  -o  pasta a copiar        (padrão: ${PADRAO_ORIGEM})
  -d  pasta dos backups     (padrão: ${PADRAO_DESTINO})
  -k  dias para manter      (padrão: 30)
  -n  só mostra o que faria (dry-run)
  -v  mostra a versão
AJUDA
}

log()  { printf '\e[32m[%s]\e[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
erro() { printf '\e[31m[erro]\e[0m %s\n' "$*" >&2; }

origem="$PADRAO_ORIGEM"
destino="$PADRAO_DESTINO"
manter=30
simular=false

while getopts ":o:d:k:nvh" opcao; do
  case "$opcao" in
    o) origem="$OPTARG" ;;
    d) destino="$OPTARG" ;;
    k) manter="$OPTARG" ;;
    n) simular=true ;;
    v) echo "backup-notas $VERSAO"; exit 0 ;;
    h) uso; exit 0 ;;
    :) erro "a opção -$OPTARG precisa de um valor"; exit 2 ;;
    \?) erro "opção desconhecida: -$OPTARG"; uso; exit 2 ;;
  esac
done

[[ -d "$origem" ]] || { erro "origem não existe: $origem"; exit 1; }
[[ "$manter" =~ ^[0-9]+$ ]] || { erro "-k precisa de um número"; exit 2; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

arquivo="${destino}/notas-$(date +%Y%m%d-%H%M%S).tar.gz"

executar() {
  if $simular; then
    echo "  (simulação) $*"
  else
    "$@"
  fi
}

log "Copiando ${origem} → ${arquivo}"
executar mkdir -p "$destino"
executar tar -czf "$arquivo" -C "$(dirname "$origem")" "$(basename "$origem")"

total=0
while IFS= read -r -d '' antigo; do
  log "Removendo backup antigo: ${antigo##*/}"
  executar rm -f -- "$antigo"
  ((total++)) || true
done < <(find "$destino" -name 'notas-*.tar.gz' -mtime "+${manter}" -print0 2>/dev/null)

tamanho=$(du -sh "$destino" 2>/dev/null | cut -f1)
log "Pronto: ${total} backup(s) antigo(s) removido(s); pasta com ${tamanho:-?}"
