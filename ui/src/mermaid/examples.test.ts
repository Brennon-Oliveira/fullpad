// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import mermaid from "mermaid";

/** Os exemplos da pasta `examples/` têm de ser diagramas válidos para o Mermaid de verdade (sem simulação). */
const read = (name: string) => readFileSync(resolve(process.cwd(), "../examples", name), "utf8") // o vitest roda em ui/;

describe("exemplos de Mermaid", () => {
  it("example.mmd é um diagrama válido", async () => {
    await expect(mermaid.parse(read("example.mmd"))).resolves.toBeTruthy();
  });

  it("os blocos mermaid de example.md são válidos", async () => {
    const blocks = [...read("example.md").matchAll(/^```mermaid\n([\s\S]*?)^```/gm)].map((m) => m[1]!);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const code of blocks) await expect(mermaid.parse(code)).resolves.toBeTruthy();
  });
});
