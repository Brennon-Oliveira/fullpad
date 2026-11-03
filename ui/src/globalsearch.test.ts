// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { SearchMatch, TabHits } from "./api";
import { mountGlobalSearch, previewNode, summary } from "./globalsearch";

const match = (o: Partial<SearchMatch> = {}): SearchMatch => ({ start: 0, end: 3, line: 1, col: 1, preview: "foo bar", preview_start: 0, preview_end: 3, replacement: null, ...o });
const hit = (id: string, n: number): TabHits => ({ id, hits: { total: n, matches: Array.from({ length: Math.min(n, 3) }, () => match()) } });

describe("busca global", () => {
  it("resume em português", () => {
    expect(summary([])).toBe("Nenhum resultado");
    expect(summary([hit("a", 1)])).toBe("1 resultado em 1 arquivo");
    expect(summary([hit("a", 4), hit("b", 2)])).toBe("6 resultados em 2 arquivos");
  });

  it("destaca o achado e nunca interpreta HTML", () => {
    const n = previewNode(match({ preview: "<b>x</b> alvo", preview_start: 9, preview_end: 13 }));
    expect(n.querySelector("mark")!.textContent).toBe("alvo");
    expect(n.querySelector("b")).toBeNull();
    expect(n.textContent).toBe("<b>x</b> alvo");
  });

  function setup(search: (...a: unknown[]) => Promise<TabHits[]>) {
    const root = document.createElement("aside");
    document.body.append(root);
    const host = {
      titleOf: (id: string) => `Aba ${id}`,
      tabIds: () => ["a", "b"],
      search: vi.fn(search),
      open: vi.fn(),
      applyReplace: vi.fn(async () => 0),
      confirm: vi.fn(async () => true),
      close: vi.fn(),
    };
    const gs = mountGlobalSearch(root, host);
    return { root, host, gs };
  }

  it("busca ao digitar, agrupa por aba e clicar leva ao resultado", async () => {
    vi.useFakeTimers();
    const { root, host, gs } = setup(async () => [hit("a", 2), hit("b", 1)]);
    gs.show();
    const input = root.querySelector<HTMLInputElement>(".gs-input")!;
    input.value = "foo";
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(300);
    expect(root.querySelector(".gs-status")!.textContent).toBe("3 resultados em 2 arquivos");
    expect(root.querySelectorAll(".gs-file")).toHaveLength(2);
    expect(root.querySelector(".gs-name")!.textContent).toBe("Aba a");
    root.querySelector<HTMLElement>(".gs-match")!.click();
    expect(host.open).toHaveBeenCalledWith("a", expect.objectContaining({ line: 1 }));
    vi.useRealTimers();
  });

  it("expressão inválida aparece como erro, não como 'nenhum resultado'", async () => {
    const { root, gs } = setup(async () => {
      throw "unclosed group";
    });
    gs.show("(");
    await vi.waitFor(() => expect(root.querySelector(".gs-status")!.textContent).toContain("Expressão inválida: unclosed group"));
  });

  it("substituir tudo pede confirmação e busca de novo com a troca", async () => {
    const { root, host, gs } = setup(async () => [hit("a", 2)]);
    gs.show("foo");
    await vi.waitFor(() => expect(root.querySelector(".gs-status")!.textContent).toContain("2 resultados"));
    root.querySelectorAll<HTMLInputElement>(".gs-input")[1].value = "baz";
    [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Substituir tudo")!.click();
    await vi.waitFor(() => expect(host.applyReplace).toHaveBeenCalled());
    expect(host.confirm).toHaveBeenCalledWith(expect.stringContaining('2 resultados em 1 arquivo por "baz"'));
    expect(host.search).toHaveBeenCalledWith("foo", expect.anything(), "baz");
  });

  it("recusar a confirmação não troca nada", async () => {
    const { root, host, gs } = setup(async () => [hit("a", 1)]);
    host.confirm.mockResolvedValue(false);
    gs.show("foo");
    await vi.waitFor(() => expect(root.querySelector(".gs-status")!.textContent).toContain("1 resultado"));
    [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Substituir tudo")!.click();
    await vi.waitFor(() => expect(host.confirm).toHaveBeenCalled());
    expect(host.applyReplace).not.toHaveBeenCalled();
  });

  it("Esc fecha o painel", () => {
    const { root, host, gs } = setup(async () => []);
    gs.show();
    root.querySelector(".gs-input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(host.close).toHaveBeenCalled();
  });
});
