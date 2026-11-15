// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountPostitBar, TOAST_MS } from "./postit";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("barra do post-it", () => {
  it("entra no topo, arrasta a janela e mostra o estado do alfinete", () => {
    document.body.append(document.createElement("div"));
    const bar = mountPostitBar(document.body, { pinned: true, onPin: async (v) => v, onClose: () => {} });
    expect(document.body.firstElementChild).toBe(bar.el);
    expect(bar.el.hasAttribute("data-tauri-drag-region")).toBe(true);
    const pin = bar.el.querySelector<HTMLButtonElement>(".postit-pin")!;
    expect(pin.classList.contains("on")).toBe(true);
    bar.setPinned(false);
    expect(pin.classList.contains("on")).toBe(false);
  });

  it("clicar no alfinete troca o estado e avisa Fixado/Desafixado por um instante", async () => {
    vi.useFakeTimers();
    const onPin = vi.fn(async (v: boolean) => v);
    const bar = mountPostitBar(document.body, { pinned: true, onPin, onClose: () => {} });
    const pin = bar.el.querySelector<HTMLButtonElement>(".postit-pin")!;
    const toast = bar.el.querySelector(".postit-toast")!;
    pin.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(onPin).toHaveBeenLastCalledWith(false);
    expect(toast.textContent).toBe("Desafixado");
    expect(pin.classList.contains("on")).toBe(false);
    pin.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(onPin).toHaveBeenLastCalledWith(true);
    expect(toast.textContent).toBe("Fixado");
    await vi.advanceTimersByTimeAsync(TOAST_MS + 10);
    expect(toast.textContent).toBe("");
  });

  it("se o Rust recusar a troca, o alfinete mostra o que ficou valendo", async () => {
    const bar = mountPostitBar(document.body, { pinned: true, onPin: async () => true, onClose: () => {} });
    const pin = bar.el.querySelector<HTMLButtonElement>(".postit-pin")!;
    pin.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(pin.classList.contains("on")).toBe(true);
  });

  it("o botão de fechar chama onClose", () => {
    const onClose = vi.fn();
    const bar = mountPostitBar(document.body, { pinned: false, onPin: async (v) => v, onClose });
    bar.el.querySelector<HTMLButtonElement>(".postit-close")!.click();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
