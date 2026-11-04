// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const result = vi.hoisted(() => ({
  next: { ok: true, svg: '<svg viewBox="0 0 200 100" width="100%" style="max-width: 200px"><g class="node"></g></svg>' } as
    | { ok: true; svg: string }
    | { ok: false; error: string },
}));
const renderMermaid = vi.hoisted(() => vi.fn(async (_code: string, _dark: boolean) => result.next));
vi.mock("./render", () => ({ MAX_MERMAID_CHARS: 100, renderMermaid }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("../api", () => ({ api: { exportFile: vi.fn() } }));

import { createMermaidPanel, svgSize } from "./panel";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  renderMermaid.mockClear();
  result.next = { ok: true, svg: '<svg viewBox="0 0 200 100" width="100%" style="max-width: 200px"><g class="node"></g></svg>' };
});

describe("svgSize", () => {
  it("lê o viewBox e cai para width/height", () => {
    const t = document.createElement("template");
    t.innerHTML = '<svg viewBox="0 0 320 180"></svg><svg width="50" height="40"></svg><svg></svg>';
    const [a, b, c] = Array.from(t.content.querySelectorAll("svg"));
    expect(svgSize(a!)).toEqual({ w: 320, h: 180 });
    expect(svgSize(b!)).toEqual({ w: 50, h: 40 });
    expect(svgSize(c!)).toEqual({ w: 800, h: 600 });
  });
});

describe("createMermaidPanel", () => {
  it("desenha o SVG sem o max-width do Mermaid e mostra o painel", async () => {
    const host = document.createElement("div");
    const panel = createMermaidPanel(host);
    panel.show("flowchart LR\n A-->B", true);
    await flush();
    const svg = host.querySelector("g svg")!;
    expect(host.classList.contains("on")).toBe(true);
    expect(svg.getAttribute("width")).toBe("200");
    expect(svg.getAttribute("height")).toBe("100");
    expect(svg.hasAttribute("style")).toBe(false);
  });

  it("erro de sintaxe aparece na faixa e mantém o último diagrama", async () => {
    const host = document.createElement("div");
    const panel = createMermaidPanel(host);
    panel.show("flowchart LR\n A-->B", true);
    await flush();
    result.next = { ok: false, error: "Parse error on line 2" };
    panel.show("flowchart LR\n A-->", false);
    await flush();
    const err = host.querySelector<HTMLElement>(".dbml-error")!;
    expect(err.hidden).toBe(false);
    expect(err.textContent).toBe("Parse error on line 2");
    expect(host.querySelector("g svg")).not.toBeNull();
  });

  it("texto vazio mostra o aviso e não chama o Mermaid", async () => {
    const host = document.createElement("div");
    const panel = createMermaidPanel(host);
    panel.show("  \n", true);
    await flush();
    expect(renderMermaid).not.toHaveBeenCalled();
    expect(host.querySelector(".dbml-msg")!.textContent).toContain("Nenhum diagrama");
  });

  it("texto grande demais não é desenhado", async () => {
    const host = document.createElement("div");
    const panel = createMermaidPanel(host);
    panel.show("x".repeat(101), true);
    await flush();
    expect(renderMermaid).not.toHaveBeenCalled();
    expect(host.querySelector(".dbml-msg")!.textContent).toContain("grande demais");
  });

  it("mudar o tema com o mesmo texto desenha de novo, com o tema novo", async () => {
    const host = document.createElement("div");
    let dark = false;
    const panel = createMermaidPanel(host, { isDark: () => dark });
    panel.show("flowchart LR\n A-->B", true);
    await flush();
    panel.show("flowchart LR\n A-->B", false);
    await flush();
    expect(renderMermaid).toHaveBeenCalledTimes(1); // nada mudou
    dark = true;
    panel.show("flowchart LR\n A-->B", false);
    await flush();
    expect(renderMermaid).toHaveBeenCalledTimes(2);
    expect(renderMermaid).toHaveBeenLastCalledWith("flowchart LR\n A-->B", true);
  });

  it("update espera o debounce; esconder descarta o desenho em andamento", async () => {
    vi.useFakeTimers();
    try {
      const host = document.createElement("div");
      const panel = createMermaidPanel(host);
      panel.show("flowchart LR\n A-->B", true);
      await vi.advanceTimersByTimeAsync(0);
      renderMermaid.mockClear();
      panel.update("flowchart LR\n A-->C");
      expect(renderMermaid).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(300);
      expect(renderMermaid).toHaveBeenCalledTimes(1);
      panel.hide();
      expect(host.classList.contains("on")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
