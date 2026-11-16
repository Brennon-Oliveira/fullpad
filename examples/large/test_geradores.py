"""Testes dos geradores de arquivos grandes. Rode da raiz do repositório:

    python3 -m unittest discover -s examples/large -p "test_*.py" -v

Cada gerador roda com ~1 MB (rápido) e o resultado é conferido: tamanho aproximado, UTF-8, validade (CSV e
JSON de verdade), e os casos de borda que o arquivo promete (linha gigante, CRLF, aspas, quebra dentro de
célula, a palavra RARA). Os arquivos grandes de verdade nunca são criados aqui.
"""
import csv
import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import _comum  # noqa: E402

AQUI = pathlib.Path(__file__).resolve().parent
MB = 1024 * 1024


def gerar(nome: str, mb: float, *extra: str, pasta: pathlib.Path) -> pathlib.Path:
    saida = pasta / f"saida-{nome}-{mb}{'-'.join(extra)}.{nome.split('_')[1]}"
    r = subprocess.run([sys.executable, str(AQUI / nome), str(mb), "-o", str(saida), *extra], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return saida


class Geradores(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._dir = tempfile.TemporaryDirectory()
        cls.pasta = pathlib.Path(cls._dir.name)

    @classmethod
    def tearDownClass(cls):
        cls._dir.cleanup()

    def tamanho_ok(self, p: pathlib.Path, mb: float):
        n = p.stat().st_size
        self.assertGreaterEqual(n, mb * MB, "ficou menor que o pedido")
        self.assertLessEqual(n, mb * MB * 1.2, f"passou muito do pedido: {n / MB:.2f} MB")

    def texto(self, p: pathlib.Path) -> str:
        return p.read_bytes().decode("utf-8")  # levanta se não for UTF-8 válido

    def test_txt(self):
        p = gerar("gerar_txt.py", 1, pasta=self.pasta)
        self.tamanho_ok(p, 1)
        t = self.texto(p)
        self.assertIn("RARA", t)
        self.assertEqual(t.count("\r\n"), 30, "o trecho em CRLF")
        self.assertEqual(t.count("\r"), 30)
        self.assertGreater(max(len(l) for l in t.split("\n")), 100_000, "a linha gigante")
        self.assertIn("requisição", t)

    def test_md(self):
        p = gerar("gerar_md.py", 1, pasta=self.pasta)
        self.tamanho_ok(p, 1)
        t = self.texto(p)
        self.assertTrue(t.startswith("# Capítulo 0:"))
        self.assertIn("RARA", t)
        self.assertIn("```python", t)
        self.assertIn("| Indicador |", t)
        self.assertGreater(max(len(l) for l in t.split("\n")), 100_000)

    def test_csv_e_valido(self):
        p = gerar("gerar_csv.py", 1, pasta=self.pasta)
        self.tamanho_ok(p, 1)
        t = self.texto(p)
        csv.field_size_limit(10 * MB)
        linhas = list(csv.reader(io.StringIO(t, newline="")))
        self.assertEqual(linhas[0], ["id", "nome", "cidade", "valor", "data", "observacao"])
        self.assertTrue(all(len(l) == 6 for l in linhas), "toda linha tem 6 campos, inclusive as com aspas e quebra dentro")
        self.assertEqual([int(l[0]) for l in linhas[1:] if l[0].isdigit()][:3], [0, 1, 2])
        obs = [l[5] for l in linhas[1:]]
        self.assertTrue(any("\n" in o for o in obs), "célula com quebra de linha dentro")
        self.assertTrue(any('"aspas"' in o for o in obs), "aspas escapadas")
        self.assertTrue(any("RARA" in o for o in obs))
        self.assertTrue(any(len(o) > 100_000 for o in obs), "a célula gigante")
        # a linha do arquivo continua sendo uma por \n: a quebra dentro da célula cria mais linhas de texto que registros
        self.assertGreater(t.count("\n"), len(linhas))

    def test_json_e_valido(self):
        p = gerar("gerar_json.py", 1, pasta=self.pasta)
        self.tamanho_ok(p, 1)
        dados = json.loads(self.texto(p))
        self.assertIsInstance(dados, list)
        ids = [d["id"] for d in dados if isinstance(d["id"], int)]
        self.assertEqual(ids[:3], [0, 1, 2])
        self.assertEqual(ids, sorted(ids))
        self.assertTrue(any(d["id"] == "gigante" and len(d["texto"]) > 100_000 for d in dados))
        self.assertTrue(any(d.get("obs") == "RARA: ocorrência única" for d in dados))
        self.assertTrue(any(d.get("obs") is None for d in dados))

    def test_json_minificado_e_uma_linha_so(self):
        p = gerar("gerar_json.py", 1, "--minificado", pasta=self.pasta)
        self.tamanho_ok(p, 1)
        t = self.texto(p)
        self.assertEqual(t.count("\n"), 1, "só a quebra final")
        self.assertTrue(t.endswith("]\n"))
        self.assertGreater(len(json.loads(t)), 1000)

    def test_tamanho_acompanha_o_pedido(self):
        a = gerar("gerar_csv.py", 0.5, pasta=self.pasta).stat().st_size
        b = gerar("gerar_csv.py", 2, pasta=self.pasta).stat().st_size
        self.assertGreater(b, a * 3)

    def test_mesmo_pedido_mesmo_arquivo(self):
        for nome in ["gerar_txt.py", "gerar_md.py", "gerar_csv.py", "gerar_json.py"]:
            um = gerar(nome, 0.3, pasta=self.pasta).read_bytes()
            outro = (self.pasta / "repetido").with_suffix("." + nome.split("_")[1].split(".")[0])
            r = subprocess.run([sys.executable, str(AQUI / nome), "0.3", "-o", str(outro)], capture_output=True)
            self.assertEqual(r.returncode, 0)
            self.assertEqual(um, outro.read_bytes(), f"{nome} não é determinístico")

    def test_tamanho_invalido_e_recusado(self):
        for ruim in ["0", "-5", "abc", "99999"]:
            r = subprocess.run([sys.executable, str(AQUI / "gerar_txt.py"), ruim, "-o", str(self.pasta / "x.txt")], capture_output=True, text=True)
            self.assertEqual(r.returncode, 2, ruim)
        self.assertFalse((self.pasta / "x.txt").exists())

    def test_saida_padrao_fica_em_examples_large_e_fora_do_git(self):
        r = subprocess.run(["git", "check-ignore", "-q", str(AQUI / "grande.csv")], cwd=AQUI)
        self.assertEqual(r.returncode, 0, "examples/large/grande.* tem de estar no .gitignore")


class Fluxo:
    """Um `stderr` de mentira, com ou sem terminal e com a codificação escolhida."""

    def __init__(self, tty: bool, encoding: str = "utf-8"):
        self._buf = io.StringIO()
        self._tty = tty
        self.encoding = encoding

    def isatty(self) -> bool:
        return self._tty

    def write(self, texto: str) -> int:
        return self._buf.write(texto)

    def flush(self) -> None:
        pass

    def getvalue(self) -> str:
        return self._buf.getvalue()


class BarraDeProgresso(unittest.TestCase):
    def test_formatos(self):
        self.assertEqual(_comum.formatar_tamanho(512 * MB), "512 MB")
        self.assertEqual(_comum.formatar_tamanho(1536 * MB), "1,50 GB")
        self.assertEqual(_comum.formatar_tempo(7), "0:07")
        self.assertEqual(_comum.formatar_tempo(332), "5:32")
        self.assertEqual(_comum.formatar_tempo(3729), "1:02:09")
        self.assertEqual(_comum.formatar_barra(0.5, 10), "█████░░░░░")
        self.assertEqual(_comum.formatar_barra(2, 4), "████", "passou de 100%: não estoura")
        self.assertEqual(_comum.formatar_barra(-1, 4), "░░░░")

    def test_sem_terminal_escreve_uma_linha_a_cada_10_por_cento_e_o_100_so_uma_vez(self):
        f = Fluxo(tty=False)
        p = _comum.Progresso("teste", 100 * MB, f)
        for mb in range(0, 101, 1):
            p.atualizar(mb * MB)
        p.terminar(100 * MB)
        linhas = f.getvalue().splitlines()
        self.assertEqual(len(linhas), 10, linhas)
        self.assertIn(" 10%", linhas[0])
        self.assertIn("100%", linhas[-1])
        self.assertTrue(linhas[-1].rstrip().endswith("pronto"))
        self.assertNotIn("\r", f.getvalue())

    def test_com_terminal_redesenha_a_mesma_linha_e_fecha_com_quebra(self):
        f = Fluxo(tty=True)
        p = _comum.Progresso("teste", 10 * MB, f)
        p.atualizar(1 * MB)  # o primeiro quadro sai na hora
        p.atualizar(5 * MB, fim=False)  # dentro dos 0,25 s: não redesenha
        p.terminar(10 * MB)
        saida = f.getvalue()
        self.assertEqual(saida.count("\n"), 1, "uma quebra só, no fim")
        self.assertEqual(saida.count("\r"), 2, "o primeiro quadro e o final, sem repetir os do meio")
        self.assertTrue(saida.endswith("\n"))
        self.assertIn("100%", saida)

    def test_primeiros_instantes_nao_inventam_um_tempo_restante(self):
        f = Fluxo(tty=True)
        p = _comum.Progresso("teste", 100 * MB, f)
        p.atualizar(0)
        self.assertIn("calculando", f.getvalue())
        self.assertNotIn("faltam", f.getvalue())

    def test_sem_unicode_usa_caracteres_simples(self):
        f = Fluxo(tty=False, encoding="ascii")  # um console que não escreve o bloco cheio
        p = _comum.Progresso("teste", MB, f)
        p.terminar(MB)
        self.assertNotIn("█", f.getvalue())
        self.assertIn("#", f.getvalue())

    def test_o_gerador_mostra_progresso_no_stderr_e_so_o_resumo_no_stdout(self):
        with tempfile.TemporaryDirectory() as d:
            r = subprocess.run([sys.executable, str(AQUI / "gerar_txt.py"), "2", "-o", str(pathlib.Path(d) / "x.txt")], capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("100%", r.stderr)
        self.assertEqual(len(r.stdout.strip().splitlines()), 1, "o stdout é só o resumo")
        self.assertIn("MB em", r.stdout)


def pico_de_memoria_kb(nome: str, mb: float, saida: pathlib.Path, *extra: str) -> int:
    """Roda o gerador e devolve o pico de memória (RSS) do processo dele, em KB."""
    p = subprocess.Popen([sys.executable, str(AQUI / nome), str(mb), "-o", str(saida), *extra], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    _, status, uso = os.wait4(p.pid, 0)
    p.returncode = os.waitstatus_to_exitcode(status)  # o Popen não sabe que o processo já foi coletado
    assert p.returncode == 0, f"{nome} falhou"
    return uso.ru_maxrss  # KB no Linux


@unittest.skipUnless(sys.platform.startswith("linux"), "mede o RSS pelo wait4 (Linux)")
class MemoriaConstante(unittest.TestCase):
    """O gerador grava em blocos: a memória não pode acompanhar o tamanho do arquivo (senão não serviria para gerar
    arquivos de GB). Um arquivo de 160 MB gerado inteiro em memória passaria de 160 MB de pico; em blocos, fica nos
    poucos MB do interpretador mais o bloco."""

    CASOS = [("gerar_txt.py", ()), ("gerar_md.py", ()), ("gerar_csv.py", ()), ("gerar_json.py", ()), ("gerar_json.py", ("--minificado",))]

    def test_o_pico_de_memoria_nao_cresce_com_o_tamanho_do_arquivo(self):
        with tempfile.TemporaryDirectory() as d:
            for nome, extra in self.CASOS:
                out = pathlib.Path(d) / "saida"
                pequeno = pico_de_memoria_kb(nome, 40, out, *extra)
                grande = pico_de_memoria_kb(nome, 160, out, *extra)
                rotulo = f"{nome} {' '.join(extra)}".strip()
                self.assertLess(grande, 100_000, f"{rotulo}: pico de {grande / 1024:.0f} MB gerando 160 MB (tudo na memória?)")
                self.assertLess(grande - pequeno, 20_000, f"{rotulo}: 4x o tamanho custou {(grande - pequeno) / 1024:.0f} MB a mais de memória")
                self.assertGreater(out.stat().st_size, 150 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
