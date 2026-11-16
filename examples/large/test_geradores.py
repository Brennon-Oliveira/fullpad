"""Testes dos geradores de arquivos grandes. Rode da raiz do repositório:

    python3 -m unittest discover -s examples/large -p "test_*.py" -v

Cada gerador roda com ~1 MB (rápido) e o resultado é conferido: tamanho aproximado, UTF-8, validade (CSV e
JSON de verdade), e os casos de borda que o arquivo promete (linha gigante, CRLF, aspas, quebra dentro de
célula, a palavra RARA). Os arquivos grandes de verdade nunca são criados aqui.
"""
import csv
import io
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

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


if __name__ == "__main__":
    unittest.main()
