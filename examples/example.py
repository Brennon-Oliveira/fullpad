"""Gerenciador de tarefas em linha de comando — exemplo de Python para o Fullpad."""
from __future__ import annotations

import asyncio
import json
import re
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from datetime import date, datetime, timedelta
from enum import Enum, auto
from functools import lru_cache, wraps
from pathlib import Path
from typing import Callable, Iterable, Iterator, Protocol, TypeVar

T = TypeVar("T")
ARQUIVO = Path.home() / ".tarefas.json"


class Prioridade(Enum):
    BAIXA = auto()
    MEDIA = auto()
    ALTA = auto()

    @classmethod
    def de_texto(cls, texto: str) -> "Prioridade":
        try:
            return cls[texto.strip().upper()]
        except KeyError as erro:
            raise ValueError(f"prioridade desconhecida: {texto!r}") from erro


@dataclass(order=True)
class Tarefa:
    prazo: date
    titulo: str = field(compare=False)
    prioridade: Prioridade = field(default=Prioridade.MEDIA, compare=False)
    etiquetas: set[str] = field(default_factory=set, compare=False)
    feita: bool = field(default=False, compare=False)

    def atrasada(self, hoje: date | None = None) -> bool:
        return not self.feita and self.prazo < (hoje or date.today())

    def para_dict(self) -> dict:
        d = asdict(self)
        d.update(prazo=self.prazo.isoformat(), prioridade=self.prioridade.name, etiquetas=sorted(self.etiquetas))
        return d


class Repositorio(Protocol):
    def todas(self) -> Iterable[Tarefa]: ...
    def salvar(self, tarefas: Iterable[Tarefa]) -> None: ...


def cronometrar(funcao: Callable[..., T]) -> Callable[..., T]:
    """Decorator que mostra quanto tempo a função levou."""

    @wraps(funcao)
    def interno(*args, **kwargs):
        inicio = datetime.now()
        try:
            return funcao(*args, **kwargs)
        finally:
            print(f"[{funcao.__name__}] {(datetime.now() - inicio).total_seconds() * 1000:.1f} ms")

    return interno


class RepositorioJson:
    def __init__(self, caminho: Path = ARQUIVO) -> None:
        self.caminho = caminho

    def todas(self) -> Iterator[Tarefa]:
        if not self.caminho.exists():
            return
        for bruto in json.loads(self.caminho.read_text(encoding="utf-8")):
            yield Tarefa(
                prazo=date.fromisoformat(bruto["prazo"]),
                titulo=bruto["titulo"],
                prioridade=Prioridade[bruto["prioridade"]],
                etiquetas=set(bruto["etiquetas"]),
                feita=bruto["feita"],
            )

    def salvar(self, tarefas: Iterable[Tarefa]) -> None:
        dados = [t.para_dict() for t in sorted(tarefas)]
        temporario = self.caminho.with_suffix(".tmp")
        temporario.write_text(json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8")
        temporario.replace(self.caminho)  # troca atômica: nada se perde


@lru_cache(maxsize=128)
def normalizar(titulo: str) -> str:
    return re.sub(r"\s+", " ", titulo).strip().casefold()


@cronometrar
def agrupar_por_etiqueta(tarefas: Iterable[Tarefa]) -> dict[str, list[str]]:
    grupos: dict[str, list[str]] = defaultdict(list)
    for t in tarefas:
        for etiqueta in t.etiquetas or {"(sem etiqueta)"}:
            grupos[etiqueta].append(t.titulo)
    return dict(sorted(grupos.items()))


async def lembrar(tarefa: Tarefa, antecedencia: timedelta = timedelta(hours=1)) -> str:
    await asyncio.sleep(0.01)  # finge uma chamada de rede
    return f"⏰ {tarefa.titulo} vence em {tarefa.prazo:%d/%m/%Y} (aviso {antecedencia} antes)"


async def main() -> None:
    hoje = date.today()
    tarefas = [
        Tarefa(hoje + timedelta(days=2), "Escrever o relatório", Prioridade.ALTA, {"trabalho", "escrita"}),
        Tarefa(hoje - timedelta(days=1), "Pagar a conta de luz", Prioridade.ALTA, {"casa"}),
        Tarefa(hoje + timedelta(days=9), "Comprar um caderno novo", etiquetas={"casa", "compras"}),
        Tarefa(hoje, "Ler um capítulo do livro", Prioridade.BAIXA, feita=True),
    ]
    repo: Repositorio = RepositorioJson(Path("tarefas-exemplo.json"))
    repo.salvar(tarefas)

    atrasadas = [t.titulo for t in repo.todas() if t.atrasada()]
    print("Atrasadas:", atrasadas or "nenhuma")
    print(agrupar_por_etiqueta(repo.todas()))

    avisos = await asyncio.gather(*(lembrar(t) for t in tarefas if not t.feita))
    print(*avisos, sep="\n")

    quadrados = {n: n**2 for n in range(1, 6) if n % 2}
    print(f"{quadrados=} {normalizar('  Olá   Mundo ')!r}")


if __name__ == "__main__":
    asyncio.run(main())
