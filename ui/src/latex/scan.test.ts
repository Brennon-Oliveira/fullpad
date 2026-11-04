import { describe, expect, it } from "vitest";
import { MASK, matchMath, scanMath } from "./scan";

const tex = (s: string) => scanMath(s).map((m) => m.tex);

describe("equação em linha", () => {
  it("acha $...$ e guarda a posição", () => {
    const [m] = scanMath("a energia $E = mc^2$ vale");
    expect(m).toMatchObject({ from: 10, to: 20, tex: "E = mc^2", display: false, block: false });
  });

  it("não confunde cifrão de dinheiro com equação", () => {
    expect(tex("custa R$ 5 e R$ 10")).toEqual([]);
    expect(tex("de $5 a $10")).toEqual([]); // fecha antes de dígito
    expect(tex("só $ solto")).toEqual([]);
    expect(tex("$ x$ e $x $")).toEqual([]); // espaço por dentro
  });

  it("aceita um cifrão escapado", () => {
    expect(tex("preço \\$5 e $x$")).toEqual(["x"]);
    expect(tex("\\$a$")).toEqual([]);
    expect(tex("$a\\$b$")).toEqual(["a\\$b"]); // o \$ de dentro não fecha
    expect(tex("\\\\$x$")).toEqual(["x"]); // barra escapada: o $ vale
  });

  it("fica numa linha só", () => {
    expect(tex("$a\nb$")).toEqual([]);
  });

  it("vários na mesma linha", () => {
    expect(tex("$a$ e $b$, depois $c$")).toEqual(["a", "b", "c"]);
  });

  it("depois de um fecho com dígito logo em seguida, tenta de novo", () => {
    expect(tex("$a$1 e $b$")).toEqual(["b"]);
  });
});

describe("equação em bloco", () => {
  it("$$ sozinho nas linhas é bloco", () => {
    const [m] = scanMath("antes\n$$\n\\int_0^1 x\\,dx\n$$\ndepois");
    expect(m).toMatchObject({ display: true, block: true, tex: "\\int_0^1 x\\,dx" });
  });

  it("uma linha só também é bloco, se estiver sozinha", () => {
    expect(scanMath("$$ a + b $$")[0]).toMatchObject({ display: true, block: true, tex: "a + b" });
  });

  it("no meio de um parágrafo é destacada, mas não troca a linha inteira", () => {
    expect(scanMath("veja $$a+b$$ aqui")[0]).toMatchObject({ display: true, block: false });
  });

  it("não atravessa uma linha em branco", () => {
    expect(tex("$$\na\n\nb\n$$")).toEqual([]);
  });

  it("$$ vazio ou sem fecho não é equação, e o 2º $ não abre outra", () => {
    expect(tex("$$$$")).toEqual([]);
    expect(tex("$$ a")).toEqual([]);
    expect(tex("$$ a $ b$")).toEqual([]);
  });
});

describe("código mascarado", () => {
  it("equação que atravessa código não vale", () => {
    expect(tex(`$a ${MASK}${MASK} b$`)).toEqual([]);
  });

  it("cifrão dentro do código não conta", () => {
    expect(tex(`${MASK}${MASK}${MASK} e $x$`)).toEqual(["x"]);
  });
});

describe("matchMath", () => {
  it("só começa em um $ não escapado", () => {
    expect(matchMath("a$b$", 0)).toBeNull();
    expect(matchMath("a$b$", 1)).toEqual({ end: 4, tex: "b", display: false });
  });
});

describe("maskInlineCode", () => {
  it("troca o código em linha, mantendo o tamanho", async () => {
    const { maskInlineCode } = await import("./scan");
    const s = "a `$b$` e ``c ` d`` fim\n`x";
    const m = maskInlineCode(s);
    expect(m).toHaveLength(s.length);
    expect(m).not.toContain("$b$");
    expect(m.startsWith("a ")).toBe(true);
    expect(m.endsWith("fim\n`x")).toBe(true); // crase sem par não é código
  });
});
