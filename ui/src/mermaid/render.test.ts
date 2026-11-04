// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const render = vi.fn(async (_id: string, code: string) => {
  if (code.includes("ERRO")) throw new Error("Syntax error in text\nParse error on line 2: esperava algo");
  return { svg: `<svg data-code="${code.length}"></svg>` };
});
const initialize = vi.fn();
vi.mock("mermaid", () => ({ default: { initialize, render } }));

import { MAX_MERMAID_CHARS, cleanError, isMermaidInfo, renderMermaid, resetMermaidForTests } from "./render";

beforeEach(() => {
  resetMermaidForTests();
  render.mockClear();
  initialize.mockClear();
});

describe("isMermaidInfo", () => {
  it("reconhece a linguagem pela primeira palavra", () => {
    expect(isMermaidInfo("mermaid")).toBe(true);
    expect(isMermaidInfo("  Mermaid  ")).toBe(true);
    expect(isMermaidInfo("mermaid title=x")).toBe(true);
    expect(isMermaidInfo("mermaidx")).toBe(false);
    expect(isMermaidInfo("js")).toBe(false);
    expect(isMermaidInfo("")).toBe(false);
  });
});

describe("renderMermaid", () => {
  it("desenha em modo estrito e sem tentar rede, com o tema pedido", async () => {
    const r = await renderMermaid("graph TD; A-->B", false);
    expect(r).toEqual({ ok: true, svg: expect.stringContaining("<svg") });
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: "strict", theme: "default", startOnLoad: false }));
    await renderMermaid("graph TD; A-->C", true);
    expect(initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "dark" }));
  });

  it("guarda em cache por texto e tema", async () => {
    await renderMermaid("graph TD; X-->Y", false);
    await renderMermaid("graph TD; X-->Y", false);
    expect(render).toHaveBeenCalledTimes(1);
    await renderMermaid("graph TD; X-->Y", true);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("devolve a mensagem do parser em vez de quebrar", async () => {
    const r = await renderMermaid("ERRO", false);
    expect(r).toEqual({ ok: false, error: "Parse error on line 2: esperava algo" });
  });

  it("não desenha texto grande demais", async () => {
    const r = await renderMermaid("a".repeat(MAX_MERMAID_CHARS + 1), false);
    expect(r.ok).toBe(false);
    expect(render).not.toHaveBeenCalled();
  });

  it("desenha um por vez, na ordem pedida", async () => {
    const order: string[] = [];
    render.mockImplementationOnce(async (_i, c) => (await new Promise((r) => setTimeout(r, 10)), order.push(c), { svg: "<svg/>" }));
    render.mockImplementationOnce(async (_i, c) => (order.push(c), { svg: "<svg/>" }));
    await Promise.all([renderMermaid("primeiro", false), renderMermaid("segundo", false)]);
    expect(order).toEqual(["primeiro", "segundo"]);
  });
});

describe("cleanError", () => {
  it("tira o cabeçalho genérico e aceita qualquer valor", () => {
    expect(cleanError(new Error("Syntax error in text\nlinha boa"))).toBe("linha boa");
    expect(cleanError("texto")).toBe("texto");
    expect(cleanError(new Error(""))).toBe("diagrama inválido");
  });
});
