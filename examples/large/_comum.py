"""Parte comum dos geradores de arquivos grandes (`gerar_txt.py`, `gerar_md.py`, `gerar_csv.py`, `gerar_json.py`).

Só Python 3 (biblioteca padrão). Os arquivos saem em `examples/large/grande.<ext>` e **não vão para o git**.
"""
import argparse
import pathlib
import sys

MB = 1024 * 1024
AQUI = pathlib.Path(__file__).resolve().parent
# acima disto a linha gigante deixa de caber numa fração razoável do arquivo e o teste fica sem graça
GIGANTE_MAX = 3 * MB


def argumentos(descricao: str, nome: str, padrao_mb: float = 100.0, extra=None) -> argparse.Namespace:
    """Lê `MB` (tamanho aproximado, em mebibytes de 1.048.576 bytes) e `--saida`."""
    p = argparse.ArgumentParser(description=descricao, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("mb", nargs="?", type=float, default=padrao_mb, help=f"tamanho aproximado em MB (padrão: {padrao_mb:g}); aceita decimais, como 0.5")
    p.add_argument("--saida", "-o", type=pathlib.Path, default=AQUI / nome, help=f"onde gravar (padrão: examples/large/{nome})")
    if extra:
        extra(p)
    a = p.parse_args()
    if not 0 < a.mb <= 20_000:
        p.error("o tamanho tem de estar entre 0 e 20000 MB")
    return a


class Saida:
    """Arquivo de saída com contagem de bytes: grava texto UTF-8 em blocos e diz quando passou do alvo."""

    def __init__(self, caminho: pathlib.Path, mb: float):
        self.caminho = caminho
        self.alvo = int(mb * MB)
        self.escritos = 0
        caminho.parent.mkdir(parents=True, exist_ok=True)
        self._f = caminho.open("wb", buffering=4 * MB)

    def __enter__(self):
        return self

    def __exit__(self, *erro):
        self._f.close()
        if erro[0] is None:
            print(f"{self.caminho} ({self.escritos / MB:.1f} MB)")
        else:
            print(f"interrompido: {self.caminho} ficou incompleto", file=sys.stderr)

    def escrever(self, texto: str) -> None:
        dados = texto.encode("utf-8")
        self._f.write(dados)
        self.escritos += len(dados)

    @property
    def completo(self) -> bool:
        return self.escritos >= self.alvo

    @property
    def metade(self) -> bool:
        return self.escritos >= self.alvo // 2

    @property
    def tamanho_gigante(self) -> int:
        """Bytes da linha gigante: até 3 MB, e nunca mais que 15% do arquivo (arquivo pequeno, linha pequena)."""
        return int(min(GIGANTE_MAX, self.alvo * 0.15))
