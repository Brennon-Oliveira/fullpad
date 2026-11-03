import { describe, expect, it } from "vitest";
import { formatQuote, pageLabel, sourceName } from "./quote";

describe("citação", () => {
  it("vira um bloco markdown com a origem", () => {
    expect(formatQuote("O texto que você selecionou.", "Livro.pdf", 42)).toBe("> O texto que você selecionou.\n> — *Livro*, p. 42");
  });

  it("as quebras de linha do PDF viram espaço, não parágrafo", () => {
    expect(formatQuote("primeira linha\nsegunda linha\r\nterceira", "L.pdf", 1)).toBe("> primeira linha segunda linha terceira\n> — *L*, p. 1");
  });

  it("linha em branco separa parágrafos", () => {
    expect(formatQuote("um\nparágrafo\n\noutro parágrafo", "L.pdf", 3)).toBe("> um parágrafo\n>\n> outro parágrafo\n> — *L*, p. 3");
  });

  it("desfaz a hifenização de fim de linha, mas só quando a próxima letra é minúscula", () => {
    expect(formatQuote("a informa-\nção chegou", "L.pdf", 1)).toContain("a informação chegou");
    expect(formatQuote("ex-\nMinistro", "L.pdf", 1)).toContain("ex- Ministro");
    expect(formatQuote("guarda-chuva e co­ração", "L.pdf", 1)).toContain("guarda-chuva e coração");
  });

  it("trecho que atravessa páginas cita o intervalo", () => {
    expect(pageLabel(42, 42)).toBe("p. 42");
    expect(pageLabel(42, 43)).toBe("pp. 42–43");
    expect(formatQuote("x", "L.pdf", 42, 43)).toContain("*L*, pp. 42–43");
  });

  it("escapa o que quebraria o itálico do título", () => {
    expect(formatQuote("x", "a*b_c [1].pdf", 1)).toContain("*a\\*b\\_c \\[1\\]*");
  });

  it("sem texto, não há citação", () => {
    for (const empty of ["", "   ", "\n\n", "   "]) expect(formatQuote(empty, "L.pdf", 1), JSON.stringify(empty)).toBeNull();
  });

  it("nome da fonte sem a extensão", () => {
    expect(sourceName("Meu Livro.PDF")).toBe("Meu Livro");
    expect(sourceName("sem-extensao")).toBe("sem-extensao");
    expect(sourceName(".pdf")).toBe(".pdf");
  });
});
