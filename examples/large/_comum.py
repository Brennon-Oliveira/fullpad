"""Parte comum dos geradores de arquivos grandes (`gerar_txt.py`, `gerar_md.py`, `gerar_csv.py`, `gerar_json.py`).

Só Python 3 (biblioteca padrão). Os arquivos saem em `examples/large/grande.<ext>` e **não vão para o git**.
"""
from __future__ import annotations

import argparse
import collections
import pathlib
import shutil
import sys
import time

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


def formatar_tamanho(n: float) -> str:
    """"512 MB", "1,50 GB": em MB até 1 GB, depois em GB."""
    if n >= 1024 * MB:
        return f"{n / (1024 * MB):.2f} GB".replace(".", ",")
    return f"{n / MB:.0f} MB"


def formatar_tempo(segundos: float) -> str:
    """"0:07", "5:32", "1:02:09"."""
    s = max(0, int(round(segundos)))
    h, resto = divmod(s, 3600)
    m, s = divmod(resto, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def formatar_barra(fracao: float, largura: int, cheio: str = "█", vazio: str = "░") -> str:
    fracao = min(1.0, max(0.0, fracao))
    n = int(round(fracao * largura))
    return cheio * n + vazio * (largura - n)


class Progresso:
    """Barra de progresso no `stderr` (o `stdout` fica só com o resumo final).

    Num terminal, redesenha uma linha só (`\r`), no máximo 4 vezes por segundo:

        gerar_csv  [██████████░░░░░░░░░░]  52%  1,04 / 2,00 GB  48 MB/s  faltam 0:21

    Sem terminal (saída redirecionada, testes), escreve uma linha a cada 10%."""

    def __init__(self, nome: str, alvo: int, fluxo=None):
        self.nome, self.alvo = nome, max(1, alvo)
        self.fluxo = fluxo if fluxo is not None else sys.stderr
        self.tty = bool(getattr(self.fluxo, "isatty", lambda: False)())
        self.inicio = time.monotonic()
        self._ultimo = 0.0
        self._amostras: collections.deque = collections.deque(maxlen=64)
        self._largura_anterior = 0
        self._decil = 0
        enc = getattr(self.fluxo, "encoding", None) or "utf-8"
        try:
            "█░".encode(enc)
            self._cheio, self._vazio = "█", "░"
        except (UnicodeEncodeError, LookupError):
            self._cheio, self._vazio = "#", "-"

    def velocidade(self, escritos: int, agora: float) -> float:
        """Bytes por segundo nos últimos ~3 s (ou desde o começo, se faz menos que isso)."""
        self._amostras.append((agora, escritos))
        while len(self._amostras) > 2 and agora - self._amostras[0][0] > 3.0:
            self._amostras.popleft()
        t0, b0 = self._amostras[0]
        dt = agora - t0
        return (escritos - b0) / dt if dt > 0.05 else escritos / max(agora - self.inicio, 1e-6)

    def linha(self, escritos: int, agora: float, largura_total: int = 100) -> str:
        fracao = min(1.0, escritos / self.alvo)
        vel = self.velocidade(escritos, agora)
        if escritos >= self.alvo:
            fim = "pronto"
        elif escritos == 0 or vel <= 0 or agora - self.inicio < 1.0:
            fim = "calculando…" if self._cheio == "█" else "calculando..."  # nos primeiros instantes a velocidade ainda não diz nada
        else:
            fim = "faltam " + formatar_tempo((self.alvo - escritos) / vel)
        resto = f"  {fracao * 100:3.0f}%  {formatar_tamanho(escritos)} / {formatar_tamanho(self.alvo)}  {vel / MB:.0f} MB/s  {fim}"
        nome = f"  {self.nome}  "
        largura_barra = max(10, min(40, largura_total - len(nome) - len(resto) - 2))
        return f"{nome}[{formatar_barra(fracao, largura_barra, self._cheio, self._vazio)}]{resto}"

    def atualizar(self, escritos: int, fim: bool = False) -> None:
        agora = time.monotonic()
        if self.tty:
            if not fim and agora - self._ultimo < 0.25:
                return
            self._ultimo = agora
            texto = self.linha(escritos, agora, shutil.get_terminal_size((100, 20)).columns - 1)
            pad = " " * max(0, self._largura_anterior - len(texto))
            self._largura_anterior = len(texto)
            self.fluxo.write("\r" + texto + pad)
            self.fluxo.flush()
        else:
            decil = int(min(1.0, escritos / self.alvo) * 10)
            if decil > self._decil or (fim and self._decil < 10):
                self._decil = max(decil, self._decil) if not fim else 10
                self.fluxo.write(self.linha(escritos, agora) + "\n")
                self.fluxo.flush()

    def terminar(self, escritos: int) -> None:
        self.atualizar(escritos, fim=True)
        if self.tty:
            self.fluxo.write("\n")
            self.fluxo.flush()

    def interromper(self) -> None:
        if self.tty:
            self.fluxo.write("\n")
            self.fluxo.flush()


class Saida:
    """Arquivo de saída com contagem de bytes: grava texto UTF-8 em blocos e diz quando passou do alvo."""

    def __init__(self, caminho: pathlib.Path, mb: float, nome: str | None = None, fluxo=None):
        self.caminho = caminho
        self.alvo = int(mb * MB)
        self.escritos = 0
        self.inicio = time.monotonic()
        self.progresso = Progresso(nome or pathlib.Path(sys.argv[0]).stem, self.alvo, fluxo)
        caminho.parent.mkdir(parents=True, exist_ok=True)
        self._f = caminho.open("wb", buffering=4 * MB)

    def __enter__(self):
        return self

    def __exit__(self, *erro):
        self._f.close()
        if erro[0] is None:
            self.progresso.terminar(self.escritos)
            tempo = time.monotonic() - self.inicio
            print(f"{self.caminho} ({self.escritos / MB:.1f} MB em {formatar_tempo(tempo)}, {self.escritos / MB / max(tempo, 1e-6):.0f} MB/s)")
        else:
            self.progresso.interromper()
            print(f"interrompido: {self.caminho} ficou incompleto (apague-o)", file=sys.stderr)

    def escrever(self, texto: str) -> None:
        dados = texto.encode("utf-8")
        self._f.write(dados)
        self.escritos += len(dados)
        self.progresso.atualizar(self.escritos)

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
