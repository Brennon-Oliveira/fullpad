// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { cachedMath, cleanMathError, katexCss, loadMath, renderMath, renderMathSync, resetMathForTests } from "./render";

beforeEach(resetMathForTests);

describe("renderMath (KaTeX de verdade)", () => {
  it("desenha uma equação em linha e guarda em cache", async () => {
    const r = await renderMath("E = mc^2", false);
    expect(r.ok && r.html).toContain("katex");
    expect(cachedMath("E = mc^2", false)).toBe(r);
    expect(cachedMath("E = mc^2", true)).toBeUndefined(); // em bloco é outro desenho
  });

  it("equação em bloco usa o modo de destaque", async () => {
    const r = await renderMath("\\int_0^1 x\\,dx", true);
    expect(r.ok && r.html).toContain("katex-display");
  });

  it("erro de sintaxe volta como mensagem curta, nunca como exceção", async () => {
    const r = await renderMath("\\frac{1}{", false);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).not.toMatch(/^KaTeX/);
    expect(!r.ok && r.error.length).toBeGreaterThan(0);
  });

  it("não gera link nem carrega nada com \\href, \\url e afins (trust: false)", async () => {
    for (const tex of ["\\href{https://example.com}{x}", "\\url{https://example.com}", "\\includegraphics{a.png}", "\\htmlClass{a}{x}"]) {
      const r = await renderMath(tex, false);
      // ou dá erro, ou o comando aparece como texto: nunca um <a>, <img> ou atributo href/src
      if (r.ok) expect(r.html, tex).not.toMatch(/<a[\s>]|<img|href=|src=|class="[^"]*\ba\b/);
    }
  });

  it("recusa equação grande demais", async () => {
    const r = await renderMath("x".repeat(10_001), false);
    expect(r).toEqual({ ok: false, error: "equação grande demais para desenhar" });
  });

  it("põe o CSS do KaTeX na página uma vez, com as fontes do app", async () => {
    await renderMath("a", false);
    await renderMath("b", false);
    const styles = document.querySelectorAll("style#fp-katex-css");
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toContain("@font-face");
    expect(styles[0]!.textContent).toMatch(/url\([^)]*katex\/fonts\/KaTeX_Main-Regular\.woff2\)/);
    expect(styles[0]!.textContent).not.toContain(".ttf");
  });

  it("renderMathSync só funciona depois de carregar", async () => {
    expect(renderMathSync("a", false)).toBeNull();
    await loadMath();
    expect(renderMathSync("a", false)).toMatchObject({ ok: true });
  });
});

describe("katexCss", () => {
  it("troca a pasta das fontes e tira woff e ttf", () => {
    const css = '@font-face{src:url(fonts/A.woff2) format("woff2"),url(fonts/A.woff) format("woff"),url(fonts/A.ttf) format("truetype")}';
    expect(katexCss(css, "/katex/fonts/")).toBe('@font-face{src:url(/katex/fonts/A.woff2) format("woff2")}');
  });
});

describe("cleanMathError", () => {
  it("tira o prefixo do KaTeX e fica com a primeira linha", () => {
    expect(cleanMathError(new Error("KaTeX parse error: Undefined control sequence: \\foo at position 1: \\foo\nresto"))).toBe(
      "Undefined control sequence: \\foo at position 1: \\foo",
    );
  });
});
