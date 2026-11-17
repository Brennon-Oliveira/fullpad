// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { kindOf, renderLargeGate } from "./gate";

describe("cartão Carregar do arquivo grande", () => {
  it("mostra o nome, o tipo e o tamanho, e não carrega até clicar", () => {
    const root = document.createElement("div");
    const load = vi.fn();
    renderLargeGate(root, { name: "grande-15gb.csv", size: 15 * 1024 ** 3, edited: false }, load);
    expect(root.textContent).toContain("grande-15gb.csv");
    expect(root.textContent).toContain("CSV");
    expect(root.textContent).toContain("15,0 GB");
    expect(root.textContent).toContain("só é lido quando você carregar");
    expect(load).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>("button")!.click();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("clicar duas vezes só carrega uma", () => {
    const root = document.createElement("div");
    const load = vi.fn();
    renderLargeGate(root, { name: "x.log", size: 30e6, edited: false }, load);
    const b = root.querySelector<HTMLButtonElement>("button")!;
    b.click();
    b.click();
    expect(load).toHaveBeenCalledTimes(1);
    expect(b.disabled).toBe(true);
  });

  it("avisa das alterações guardadas de antes", () => {
    const root = document.createElement("div");
    renderLargeGate(root, { name: "x.log", size: 30e6, edited: true }, () => {});
    expect(root.textContent).toContain("alterações suas guardadas");
  });

  it("\"Abrir direto na linha\" pergunta a linha e carrega indo para ela (a linha é a partir de 1; o app usa a partir de 0)", () => {
    const root = document.createElement("div");
    const load = vi.fn();
    const at = vi.fn();
    renderLargeGate(root, { name: "x.csv", size: 30e6, edited: false }, load, at);
    const buttons = [...root.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons[0].textContent).toBe("Abrir direto na linha"); // à esquerda do principal
    expect(buttons.at(1)?.textContent).toBe("Carregar arquivo");
    const ask = root.querySelector<HTMLElement>(".large-gate-ask")!;
    expect(ask.hidden).toBe(true);
    buttons[0].click();
    expect(ask.hidden).toBe(false);
    const input = root.querySelector<HTMLInputElement>("input")!;
    input.value = "1500";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(at).toHaveBeenCalledWith(1499);
    expect(load).not.toHaveBeenCalled();
  });

  it("linha inválida não carrega nada", () => {
    const root = document.createElement("div");
    const at = vi.fn();
    renderLargeGate(root, { name: "x.csv", size: 30e6, edited: false }, () => {}, at);
    root.querySelector<HTMLButtonElement>("button")!.click();
    const input = root.querySelector<HTMLInputElement>("input")!;
    for (const v of ["", "0", "-3", "abc"]) {
      input.value = v;
      root.querySelector<HTMLButtonElement>(".large-gate-ask button")!.click();
    }
    expect(at).not.toHaveBeenCalled();
    expect(input.classList.contains("invalid")).toBe(true);
  });

  it("o selo vem da extensão", () => {
    expect(kindOf("a.tar.gz")).toBe("GZ");
    expect(kindOf("app.log.1")).toBe("1");
    expect(kindOf("LEIAME")).toBe("TEXTO");
  });
});
