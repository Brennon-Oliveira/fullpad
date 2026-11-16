#!/usr/bin/env bash
# Gera o instalador de Windows assinado e publica a versão nos Releases públicos, de onde o
# atualizador do app a baixa. Ver docs/rules/build-windows.md ("Publicar uma versão").
#
#   scripts/release.sh            gera e publica a versão do crates/app/Cargo.toml
#   PUBLISH=0 scripts/release.sh  só gera (instalador, .sig e latest.json), sem publicar
#   BUILD=0 scripts/release.sh    publica o que já foi gerado (sem compilar de novo)
#   LINUX=0 scripts/release.sh    só Windows (o padrão gera também AppImage, .deb, .rpm e o pacote do Arch, nativos)
#   NOTES="..." / NOTES_FILE=arq  notas da versão (padrão: crates/app/release-notes.md, que também
#                                 vai embutido no app como a nota de versão)
set -euo pipefail

REPO=Brennon-Oliveira/fullpad-releases
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

VERSION=$(sed -n 's/^version = "\(.*\)"/\1/p' crates/app/Cargo.toml | head -1)
TAG="v$VERSION"
DIR="$ROOT/target/x86_64-pc-windows-msvc/release/bundle/nsis"
EXE="Fullpad_${VERSION}_x64-setup.exe"
LINUX="${LINUX:-1}"
# o Linux compila num diretório próprio: o cargo trava o `target/` inteiro e os dois builds esperariam um ao outro
LTARGET="$ROOT/target/linux"
LDIR="$LTARGET/release/bundle"
# pacote do Arch (pacman -U): montado por scripts/pacman.py a partir da árvore do .deb; sem .sig nem chave no
# latest.json (o atualizador do Tauri não conhece pacman)
PKG="fullpad-${VERSION}-1-x86_64.pkg.tar.zst"
LFILES=("appimage/Fullpad_${VERSION}_amd64.AppImage" "deb/Fullpad_${VERSION}_amd64.deb" "rpm/Fullpad-${VERSION}-1.x86_64.rpm")

# chave privada das atualizações: fora do repositório (perdê-la = não dá mais para atualizar quem já instalou)
export TAURI_SIGNING_PRIVATE_KEY="${TAURI_SIGNING_PRIVATE_KEY:-$HOME/.tauri/fullpad.key}"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
[ -n "${TAURI_SIGNING_PRIVATE_KEY}" ] || { echo "sem chave de assinatura" >&2; exit 1; }

if [ "${PUBLISH:-1}" = 1 ] && gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
  echo "$TAG já foi publicada em $REPO; suba a versão em crates/app/Cargo.toml" >&2
  exit 1
fi

if [ "${BUILD:-1}" = 1 ]; then
  # a UI é compilada uma vez só (os dois builds a embutem) e o `beforeBuildCommand` é desligado:
  # dois `vite build` ao mesmo tempo escreveriam na mesma pasta
  pnpm --dir ui build
  NOPRE='{"build":{"beforeBuildCommand":""}}'
  LOGDIR=$(mktemp -d)
  (cd crates/app && cargo tauri build --config "$NOPRE" --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis) >"$LOGDIR/windows.log" 2>&1 &
  WIN=$!
  LIN=
  if [ "$LINUX" = 1 ]; then
    (cd crates/app && CARGO_TARGET_DIR="$LTARGET" cargo tauri build --config "$NOPRE" --bundles appimage,deb,rpm) >"$LOGDIR/linux.log" 2>&1 &
    LIN=$!
  fi
  FAIL=0
  wait "$WIN" || { echo "build de Windows falhou:" >&2; tail -n 40 "$LOGDIR/windows.log" >&2; FAIL=1; }
  if [ -n "$LIN" ]; then
    wait "$LIN" || { echo "build de Linux falhou:" >&2; tail -n 40 "$LOGDIR/linux.log" >&2; FAIL=1; }
  fi
  if [ "$FAIL" = 0 ] && [ "$LINUX" = 1 ]; then
    python3 "$ROOT/scripts/pacman.py" "$LDIR" "$VERSION" "$LDIR/pacman" >/dev/null || { echo "pacote do Arch falhou" >&2; FAIL=1; }
  fi
  [ "$FAIL" = 0 ] || { echo "nada foi publicado (logs completos em $LOGDIR)" >&2; exit 1; }
  echo "builds ok (logs em $LOGDIR)"
fi
[ -f "$DIR/$EXE" ] && [ -f "$DIR/$EXE.sig" ] || { echo "falta $DIR/$EXE (ou o .sig): gere antes de publicar" >&2; exit 1; }
if [ "$LINUX" = 1 ]; then
  for f in "${LFILES[@]}"; do
    [ -f "$LDIR/$f" ] && [ -f "$LDIR/$f.sig" ] || { echo "falta $LDIR/$f (ou o .sig): gere antes de publicar (ou LINUX=0)" >&2; exit 1; }
  done
  [ -f "$LDIR/pacman/$PKG" ] || { echo "falta $LDIR/pacman/$PKG: gere antes de publicar (ou LINUX=0)" >&2; exit 1; }
fi

NOTES="${NOTES:-$(cat "${NOTES_FILE:-crates/app/release-notes.md}")}"
python3 - "$DIR" "$EXE" "$VERSION" "$REPO" "$TAG" "$NOTES" "$LINUX" "$LDIR" "${LFILES[@]}" <<'EOF'
import json, sys, datetime, os
d, exe, version, repo, tag, notes, linux, ldir, *lfiles = sys.argv[1:]
sig = open(f"{d}/{exe}.sig").read().strip()
# o diálogo de atualização mostra texto puro: sem os "#" dos títulos do markdown
plain = "\n".join(l.lstrip("#").strip() if l.startswith("#") else l for l in notes.strip().splitlines())
latest = {
    "version": version,
    "notes": plain,
    "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "platforms": {
        "windows-x86_64": {
            "signature": sig,
            "url": f"https://github.com/{repo}/releases/download/{tag}/{exe}",
        }
    },
}
# Linux: o atualizador escolhe a chave pelo tipo de pacote em que o app foi instalado
if linux == "1":
    for f in lfiles:
        kind = {"AppImage": "appimage", "deb": "deb", "rpm": "rpm"}[f.rsplit(".", 1)[1]]
        name = os.path.basename(f)
        latest["platforms"][f"linux-x86_64-{kind}"] = {
            "signature": open(f"{ldir}/{f}.sig").read().strip(),
            "url": f"https://github.com/{repo}/releases/download/{tag}/{name}",
        }
json.dump(latest, open(f"{d}/latest.json", "w"), indent=2, ensure_ascii=False)
EOF

echo "gerado: $DIR/$EXE"
[ "${PUBLISH:-1}" = 1 ] || exit 0

ASSETS=("$DIR/$EXE" "$DIR/latest.json")
if [ "$LINUX" = 1 ]; then for f in "${LFILES[@]}"; do ASSETS+=("$LDIR/$f"); done; ASSETS+=("$LDIR/pacman/$PKG"); fi
gh release create "$TAG" -R "$REPO" --title "Fullpad $VERSION" --notes "$NOTES" "${ASSETS[@]}"
echo "publicado: https://github.com/$REPO/releases/tag/$TAG"
