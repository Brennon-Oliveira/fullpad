#!/usr/bin/env bash
# Gera o instalador de Windows assinado e publica a versão nos Releases públicos, de onde o
# atualizador do app a baixa. Ver docs/rules/build-windows.md ("Publicar uma versão").
#
#   scripts/release.sh            gera e publica a versão do crates/app/Cargo.toml
#   PUBLISH=0 scripts/release.sh  só gera (instalador, .sig e latest.json), sem publicar
#   BUILD=0 scripts/release.sh    publica o que já foi gerado (sem compilar de novo)
#   LINUX=0 scripts/release.sh    só Windows (o padrão gera também AppImage, .deb e .rpm, nativos)
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
LDIR="$ROOT/target/release/bundle"
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
  (cd crates/app && cargo tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis)
  [ "$LINUX" = 1 ] && (cd crates/app && cargo tauri build --bundles appimage,deb,rpm)
fi
[ -f "$DIR/$EXE" ] && [ -f "$DIR/$EXE.sig" ] || { echo "falta $DIR/$EXE (ou o .sig): gere antes de publicar" >&2; exit 1; }
if [ "$LINUX" = 1 ]; then
  for f in "${LFILES[@]}"; do
    [ -f "$LDIR/$f" ] && [ -f "$LDIR/$f.sig" ] || { echo "falta $LDIR/$f (ou o .sig): gere antes de publicar (ou LINUX=0)" >&2; exit 1; }
  done
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
if [ "$LINUX" = 1 ]; then for f in "${LFILES[@]}"; do ASSETS+=("$LDIR/$f"); done; fi
gh release create "$TAG" -R "$REPO" --title "Fullpad $VERSION" --notes "$NOTES" "${ASSETS[@]}"
echo "publicado: https://github.com/$REPO/releases/tag/$TAG"
