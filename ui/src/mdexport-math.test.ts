// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mathStyles } from "./latex/render";
import { markdownToBody, markdownToHtml } from "./mdexport";

describe("exportação com equações", () => {
  it("troca $...$ e $$...$$ pelo desenho do KaTeX e mantém o resto", async () => {
    const body = await markdownToBody("# T\n\nA energia $E = mc^2$ vale.\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nfim\n");
    expect(body).toContain("<h1>T</h1>");
    expect(body).toMatch(/<p>A energia <span class="katex">/);
    expect(body).toContain('<div class="math-display"><span class="katex-display">');
    expect(body).not.toMatch(/\$E|\$\$/);
  });

  it("não mexe em dinheiro, cifrão escapado nem código", async () => {
    const body = await markdownToBody("Custa R$ 5 e R$ 10. Escapado: \\$a$. Código: `$b$`.\n\n```\n$c$\n```\n");
    expect(body).not.toContain("katex");
    expect(body).toContain("R$ 5 e R$ 10");
    expect(body).toContain("<code>$b$</code>");
    expect(body).toContain("$c$");
  });

  it("equação com erro sai como texto marcado, sem quebrar o documento", async () => {
    const body = await markdownToBody("antes $\\frac{1}{$ depois $x$\n");
    expect(body).toContain('<code class="math-error">\\frac{1}{</code>');
    expect(body).toMatch(/depois <span class="katex">/);
  });

  it("$$ no meio da frase é equação em linha destacada", async () => {
    const body = await markdownToBody("veja $$a+b$$ aqui\n");
    expect(body).toContain("katex-display");
    expect(body).toContain("<p>veja ");
  });

  it("só MathML para colar em outro programa", async () => {
    const body = await markdownToBody("$x^2$\n", "mathml");
    expect(body).toContain("<math");
    expect(body).not.toContain("katex-html");
  });

  it("sem cifrão no texto, nada de KaTeX", async () => {
    const body = await markdownToBody("só texto\n");
    expect(body).toBe("<p>só texto</p>\n");
  });

  it("o HTML exportado leva o CSS do KaTeX com as fontes embutidas, só quando há equação", async () => {
    const fontes = async () => new Uint8Array([1, 2, 3]).buffer;
    const css = await mathStyles(fontes);
    expect(css).toContain("@font-face");
    expect(css).toContain("url(data:font/woff2;base64,AQID)");
    expect(css).not.toContain("url(fonts/");

    const sem = await markdownToHtml("# oi\n", "t");
    expect(sem).not.toContain("@font-face");
    const com = await markdownToHtml("$x$\n", "t");
    expect(com).toContain('class="katex');
    expect(com).toContain("@font-face"); // as fontes que não carregam em teste ficam com o endereço de antes
  });
});
