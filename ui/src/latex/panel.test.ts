// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createLatexPanel } from "./panel";

const flush = () => new Promise((r) => setTimeout(r, 40));
const DOC = "\\documentclass{article}\n\\begin{document}\nA energia $E=mc^2$ e\n\\[ \\int_0^1 x\\,dx \\]\n\\end{document}\n";

describe("painel de equações do .tex", () => {
  it("mostra uma equação por cartão, com a linha e o desenho do KaTeX", async () => {
    const host = document.createElement("div");
    const panel = createLatexPanel(host);
    panel.show(DOC, true, 1);
    await flush();
    const cards = host.querySelectorAll(".tex-eq");
    expect(host.classList.contains("on")).toBe(true);
    expect(cards).toHaveLength(2);
    expect(cards[0]!.querySelector(".tex-eq-line")!.textContent).toBe("linha 3");
    expect(cards[1]!.querySelector(".tex-eq-line")!.textContent).toBe("linha 4");
    expect(cards[0]!.querySelector(".katex")).not.toBeNull();
    expect(cards[1]!.querySelector(".katex-display")).not.toBeNull();
  });

  it("equação com erro mostra o texto e o motivo, e as outras seguem", async () => {
    const host = document.createElement("div");
    const panel = createLatexPanel(host);
    panel.show("$\\frac{1}{$ e $x$", true, 1);
    await flush();
    const cards = host.querySelectorAll(".tex-eq");
    expect(cards[0]!.classList.contains("err")).toBe(true);
    expect(cards[0]!.querySelector(".tex-eq-body")!.textContent).toBe("\\frac{1}{");
    expect(cards[0]!.querySelector(".tex-eq-error")!.textContent!.length).toBeGreaterThan(0);
    expect(cards[1]!.querySelector(".katex")).not.toBeNull();
  });

  it("sem equações mostra o aviso", async () => {
    const host = document.createElement("div");
    const panel = createLatexPanel(host);
    panel.show("\\documentclass{article}\n\\begin{document}Olá\\end{document}", true, 1);
    await flush();
    expect(host.querySelectorAll(".tex-eq")).toHaveLength(0);
    expect(host.querySelector(".dbml-msg")!.textContent).toContain("Nenhuma equação");
  });

  it("passar o mouse avisa o trecho; clicar leva o cursor; o cursor acende o cartão", async () => {
    const host = document.createElement("div");
    const onHover = vi.fn();
    const onPick = vi.fn();
    const panel = createLatexPanel(host, { onHover, onPick });
    panel.show(DOC, true, 7);
    await flush();
    const card = host.querySelectorAll<HTMLElement>(".tex-eq")[0]!;
    const from = DOC.indexOf("$E");
    card.dispatchEvent(new MouseEvent("mouseenter"));
    expect(onHover).toHaveBeenLastCalledWith([{ from, to: from + "$E=mc^2$".length }], 7);
    card.dispatchEvent(new MouseEvent("mouseleave"));
    expect(onHover).toHaveBeenLastCalledWith(null, 7);
    card.click();
    expect(onPick).toHaveBeenCalledWith(from, 7);

    panel.setCursor(from + 2, 7);
    expect(card.classList.contains("on")).toBe(true);
    panel.setCursor(from + 2, 6); // de outra versão do texto: não vale
    expect(card.classList.contains("on")).toBe(false);
  });

  it("texto novo espera o debounce; esconder descarta", async () => {
    vi.useFakeTimers();
    try {
      const host = document.createElement("div");
      const panel = createLatexPanel(host);
      panel.show("$a$", true, 1);
      await vi.advanceTimersByTimeAsync(50);
      panel.update("$a$ e $b$", 2);
      await vi.advanceTimersByTimeAsync(100);
      expect(host.querySelectorAll(".tex-eq")).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(300);
      expect(host.querySelectorAll(".tex-eq")).toHaveLength(2);
      panel.hide();
      expect(host.classList.contains("on")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
