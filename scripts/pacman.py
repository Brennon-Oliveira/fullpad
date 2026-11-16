#!/usr/bin/env python3
"""Monta o pacote do Arch Linux (`.pkg.tar.zst`, para `pacman -U`) a partir da árvore do .deb.

O bundler do Tauri não tem alvo pacman; o do .deb deixa a árvore pronta em
`<bundle>/deb/Fullpad_<versão>_amd64/data`, e o pacote do Arch é o mesmo conteúdo com um
`.PKGINFO` (e um `.MTREE`) no lugar do `control`. Não precisa de makepkg nem do binário zstd:
usa o `compression.zstd` do Python 3.14.

    scripts/pacman.py <pasta bundle> <versão> <pasta de saída>

Escreve `fullpad-<versão>-1-x86_64.pkg.tar.zst`. Sem assinatura (o atualizador do Tauri não
conhece pacman; quem usa Arch atualiza instalando o pacote novo).
"""
import gzip
import hashlib
import io
import os
import sys
import tarfile
import time
from compression import zstd

DESCRICAO = "Editor de notas e markdown rápido"
URL = "https://github.com/Brennon-Oliveira/fullpad"
DEPENDE = ["webkit2gtk-4.1", "gtk3"]


def main() -> None:
    bundle, versao, saida = sys.argv[1:4]
    raiz = os.path.join(bundle, "deb", f"Fullpad_{versao}_amd64", "data")
    if not os.path.isdir(raiz):
        sys.exit(f"falta {raiz}: gere o .deb antes (cargo tauri build --bundles deb)")

    entradas = []  # (caminho relativo, caminho no disco)
    for dirpath, dirnames, filenames in os.walk(raiz):
        dirnames.sort()
        for nome in dirnames + sorted(filenames):
            disco = os.path.join(dirpath, nome)
            entradas.append((os.path.relpath(disco, raiz), disco))
    entradas.sort()

    agora = int(time.time())
    tamanho = sum(os.path.getsize(d) for _, d in entradas if os.path.isfile(d))
    pkginfo = "\n".join(
        [
            "pkgname = fullpad",
            "pkgbase = fullpad",
            f"pkgver = {versao}-1",
            f"pkgdesc = {DESCRICAO}",
            f"url = {URL}",
            f"builddate = {agora}",
            "packager = Unknown Packager",
            f"size = {tamanho}",
            "arch = x86_64",
            "license = MIT",
            *[f"depend = {d}" for d in DEPENDE],
            "",
        ]
    ).encode()

    def info(nome: str, tipo=tarfile.REGTYPE, modo=0o644, tam=0) -> tarfile.TarInfo:
        t = tarfile.TarInfo(nome)
        t.type, t.mode, t.size, t.mtime = tipo, modo, tam, agora
        t.uid = t.gid = 0
        t.uname = t.gname = "root"
        return t

    # .MTREE: o pacman o usa em `pacman -Qk`; formato mtree com sha256 e modo de cada arquivo
    mtree = ["#mtree", "/set type=file uid=0 gid=0 mode=644"]
    for rel, disco in entradas:
        modo = os.stat(disco).st_mode & 0o777
        if os.path.isdir(disco):
            mtree.append(f"./{rel} type=dir mode={modo:o} time={agora}.0")
        else:
            h = hashlib.sha256(open(disco, "rb").read()).hexdigest()
            mtree.append(
                f"./{rel} mode={modo:o} size={os.path.getsize(disco)} time={agora}.0 sha256digest={h}"
            )
    mtree_gz = gzip.compress(("\n".join(mtree) + "\n").encode(), mtime=0)

    bruto = io.BytesIO()
    with tarfile.open(fileobj=bruto, mode="w", format=tarfile.PAX_FORMAT) as tar:
        tar.addfile(info(".PKGINFO", tam=len(pkginfo)), io.BytesIO(pkginfo))
        tar.addfile(info(".MTREE", tam=len(mtree_gz)), io.BytesIO(mtree_gz))
        for rel, disco in entradas:
            if os.path.isdir(disco):
                tar.addfile(info(rel, tarfile.DIRTYPE, 0o755))
            else:
                modo = os.stat(disco).st_mode & 0o777
                with open(disco, "rb") as f:
                    tar.addfile(info(rel, modo=modo, tam=os.path.getsize(disco)), f)

    os.makedirs(saida, exist_ok=True)
    destino = os.path.join(saida, f"fullpad-{versao}-1-x86_64.pkg.tar.zst")
    with open(destino, "wb") as f:
        f.write(zstd.compress(bruto.getvalue(), level=19))
    print(destino)


if __name__ == "__main__":
    main()
