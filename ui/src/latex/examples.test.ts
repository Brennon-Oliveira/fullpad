// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { markdownToBody } from "../mdexport";

/** O exemplo do markdown tem equações de verdade e só um erro de propósito (o que mostra o aviso). */
describe("exemplo de equações", () => {
  it("example.md desenha as equações e só a de teste dá erro", async () => {
    const text = readFileSync(resolve(process.cwd(), "../examples/example.md"), "utf8"); // o vitest roda em ui/
    const body = await markdownToBody(text);
    expect((body.match(/class="katex"/g) ?? []).length).toBeGreaterThanOrEqual(12);
    expect((body.match(/katex-display/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(body.match(/class="math-error"/g)).toHaveLength(1);
    expect(body).toContain("<code>$x^2$</code>"); // código não vira equação
    expect(body).toContain("R$ 5 e depois R$ 10");
  });
});

describe("exemplo do .tex", () => {
  it("example.tex tem as equações de cada forma e só a de teste dá erro", async () => {
    const { scanTex } = await import("./texscan");
    const { renderMath, resetMathForTests } = await import("./render");
    resetMathForTests();
    const text = readFileSync(resolve(process.cwd(), "../examples/example.tex"), "utf8");
    const eqs = scanTex(text);
    expect(eqs.length).toBeGreaterThanOrEqual(14);
    const bad = [];
    for (const e of eqs) if (!(await renderMath(e.tex, e.display)).ok) bad.push(e.tex);
    expect(bad).toEqual(["\\frac{1}{"]);
    expect(eqs.map((e) => e.tex).join("\n")).not.toContain("a^2 + b^2"); // o comentário fica de fora
    expect(eqs.map((e) => e.tex).join("\n")).not.toContain("5"); // o `\$5` é dinheiro
  });
});
