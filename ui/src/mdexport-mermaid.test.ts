import { describe, expect, it, vi } from "vitest";

const { renderMermaid } = vi.hoisted(() => ({ renderMermaid: vi.fn(async (code: string) =>
  code.includes("ERRO") ? { ok: false as const, error: "x" } : { ok: true as const, svg: `<svg data-n="${code.length}"></svg>` },
) }));
vi.mock("./mermaid/render", async (orig) => ({ ...(await orig<typeof import("./mermaid/render")>()), renderMermaid }));

import { markdownToBody, markdownToHtml } from "./mdexport";

describe("exportação com Mermaid", () => {
  it("troca o bloco ```mermaid pelo SVG, no tema claro, e mantém o resto", async () => {
    const body = await markdownToBody("# T\n\n```mermaid\ngraph TD; A-->B\n```\n\ntexto\n\n```js\nx\n```\n");
    expect(body).toContain('<figure class="mermaid"><svg');
    expect(body).not.toContain("graph TD");
    expect(body).toContain("<h1>T</h1>");
    expect(body).toContain('<code class="language-js">');
    expect(renderMermaid).toHaveBeenCalledWith("graph TD; A-->B", false);
  });

  it("diagrama com erro continua como bloco de código", async () => {
    const body = await markdownToBody("```mermaid\nERRO\n```\n");
    expect(body).not.toContain("<figure");
    expect(body).toContain("ERRO");
  });

  it("acha o diagrama dentro de lista e citação", async () => {
    const body = await markdownToBody("- item\n\n  ```mermaid\n  graph LR; A-->B\n  ```\n\n> ```mermaid\n> graph TD; C-->D\n> ```\n");
    expect(body.match(/<figure class="mermaid">/g)).toHaveLength(2);
  });

  it("o HTML autônomo e o de impressão trazem o estilo da figura", async () => {
    const html = await markdownToHtml("```mermaid\ngraph TD; A-->B\n```\n", "t");
    expect(html).toContain("figure.mermaid");
    expect(html).not.toContain("<script");
  });

  it("sem diagramas, o Mermaid nem é carregado", async () => {
    renderMermaid.mockClear();
    await markdownToBody("# só texto\n");
    expect(renderMermaid).not.toHaveBeenCalled();
  });
});
