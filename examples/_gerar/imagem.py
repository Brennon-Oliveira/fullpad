#!/usr/bin/env python3
"""Gera a imagem de `example.md` em `examples/imagens/example/<hash>.png`.

O nome é o hash do conteúdo (FNV-1a de 64 bits, igual ao `crates/core/src/images.rs`), como o Fullpad nomeia
uma imagem colada. Só Python 3, sem dependências: o PNG é montado com `zlib`.

    python3 examples/_gerar/imagem.py
"""
import struct
import sys
import zlib
from pathlib import Path

W, H = 200, 90


def pixel(x: int, y: int) -> tuple[int, int, int]:
    # degradê azul → verde com uma faixa clara e um quadrado branco no centro
    t = x / (W - 1)
    r, g, b = int(60 + 20 * t), int(120 + 100 * t), int(230 - 90 * t)
    if 40 <= y < 50:
        r, g, b = min(255, r + 60), min(255, g + 40), min(255, b + 20)
    if 85 <= x < 115 and 30 <= y < 60:
        r, g, b = 255, 255, 255
    return r, g, b


def chunk(kind: bytes, data: bytes) -> bytes:
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def png() -> bytes:
    raw = b"".join(b"\x00" + b"".join(bytes(pixel(x, y)) for x in range(W)) for y in range(H))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def fnv1a(data: bytes) -> int:
    h = 0xCBF29CE484222325
    for b in data:
        h = ((h ^ b) * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return h


if __name__ == "__main__":
    data = png()
    out = Path(__file__).resolve().parent.parent / "imagens" / "example"
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.png"):
        old.unlink()
    name = f"{fnv1a(data):016x}.png"
    (out / name).write_bytes(data)
    print(f"imagens/example/{name}")
    sys.exit(0)
