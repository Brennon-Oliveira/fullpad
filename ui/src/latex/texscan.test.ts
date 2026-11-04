import { describe, expect, it } from "vitest";
import { maskComments, scanTex } from "./texscan";

const tex = (s: string) => scanTex(s).map((e) => e.tex);

describe("equações de um .tex", () => {
  const DOC = String.raw`\documentclass{article}
\begin{document}
Em linha: $a^2 + b^2 = c^2$ e \(x_1\).
\[ \int_0^1 x\,dx \]
$$ \sum_{k=1}^n k $$
\end{document}`;

  it("acha as quatro formas de delimitar, na ordem, com posição e modo", () => {
    const eqs = scanTex(DOC);
    expect(eqs.map((e) => e.tex)).toEqual(["a^2 + b^2 = c^2", "x_1", "\\int_0^1 x\\,dx", "\\sum_{k=1}^n k"]);
    expect(eqs.map((e) => e.display)).toEqual([false, false, true, true]);
    expect(DOC.slice(eqs[0]!.from, eqs[0]!.to)).toBe("$a^2 + b^2 = c^2$");
  });

  it("ambientes: equation e align vão inteiros; multline e eqnarray, embrulhados", () => {
    const [a, b, c, d] = tex(String.raw`\begin{equation}E=mc^2\end{equation}
\begin{align*} a &= b \\ c &= d \end{align*}
\begin{multline} x \\ y \end{multline}
\begin{eqnarray} p &=& q \end{eqnarray}`);
    expect(a).toBe(String.raw`\begin{equation}E=mc^2\end{equation}`);
    expect(b).toBe(String.raw`\begin{align*} a &= b \\ c &= d \end{align*}`);
    expect(c).toBe(String.raw`\begin{gathered} x \\ y \end{gathered}`);
    expect(d).toBe(String.raw`\begin{aligned} p &=& q \end{aligned}`);
  });

  it("displaymath e math usam só o corpo", () => {
    const eqs = scanTex(String.raw`\begin{displaymath} a+b \end{displaymath} \begin{math} c \end{math}`);
    expect(eqs.map((e) => [e.tex, e.display])).toEqual([["a+b", true], ["c", false]]);
  });

  it("ignora comentários, cifrão escapado e quebra de linha com espaço", () => {
    // `% $a$` é comentário; `\$5` é dinheiro; `\\[2pt]` é quebra de linha; `\%` é um percentual, não comentário
    expect(tex(String.raw`% $a$ comentado
custa \$5 e $b$ \\[2pt] fim \% $c$`)).toEqual(["b", "c"]);
    expect(maskComments("a % x\nb \\% y")).toHaveLength("a % x\nb \\% y".length);
    expect(maskComments("a % x")).not.toContain("x");
    expect(maskComments("a \\% x")).toBe("a \\% x");
  });

  it("ambiente que não é de matemática não vira equação", () => {
    expect(tex(String.raw`\begin{itemize} \item $x$ \end{itemize}`)).toEqual(["x"]);
  });

  it("um arquivo que é só uma fórmula vale inteiro", () => {
    const [e] = scanTex("\n  \\frac{a}{b} + \\sqrt{c}  \n");
    expect(e).toMatchObject({ tex: "\\frac{a}{b} + \\sqrt{c}", display: true });
  });

  it("um documento sem equações não vira uma equação só", () => {
    expect(tex(String.raw`\documentclass{article}\begin{document}Olá\end{document}`)).toEqual([]);
    expect(tex("   \n")).toEqual([]);
    expect(tex("% só comentário\n")).toEqual([]);
  });
});
