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

  it("\"Abrir direto na linha\" fica à esquerda do principal e só abre a janelinha ao clicar (sem campo no cartão)", () => {
    const root = document.createElement("div");
    document.body.append(root);
    renderLargeGate(root, { name: "x.csv", size: 30e6, edited: false }, () => {}, () => {});
    const buttons = [...root.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Abrir direto na linha", "Carregar arquivo"]);
    expect(root.querySelector("input")).toBeNull();
    expect(document.querySelector(".gate-modal")).toBeNull();
    buttons[0].click();
    expect(document.querySelector(".gate-modal")).not.toBeNull();
    root.remove();
    document.querySelector(".saving-back")?.remove();
  });

  it("a janelinha pergunta a linha (de 1) e o cartão carrega indo para ela (de 0)", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const load = vi.fn();
    const at = vi.fn();
    renderLargeGate(root, { name: "x.csv", size: 30e6, edited: false }, load, at);
    root.querySelector<HTMLButtonElement>("button")!.click();
    const input = document.querySelector<HTMLInputElement>(".gate-modal-input")!;
    input.value = "1500";
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(at).toHaveBeenCalledWith(1499));
    expect(load).not.toHaveBeenCalled();
    expect(document.querySelector(".gate-modal")).toBeNull();
    root.remove();
  });

  it("Esc e Cancelar não carregam nada", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const at = vi.fn();
    renderLargeGate(root, { name: "x.csv", size: 30e6, edited: false }, () => {}, at);
    root.querySelector<HTMLButtonElement>("button")!.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector(".gate-modal")).toBeNull());
    root.querySelector<HTMLButtonElement>("button")!.click();
    document.querySelector<HTMLButtonElement>(".gate-modal .rd-btn:not(.primary)")!.click();
    await vi.waitFor(() => expect(document.querySelector(".gate-modal")).toBeNull());
    expect(at).not.toHaveBeenCalled();
    root.remove();
  });

  it("linha inválida não fecha a janelinha nem carrega", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const at = vi.fn();
    renderLargeGate(root, { name: "x.csv", size: 30e6, edited: false }, () => {}, at);
    root.querySelector<HTMLButtonElement>("button")!.click();
    const input = document.querySelector<HTMLInputElement>(".gate-modal-input")!;
    for (const v of ["", "0", "-3", "abc"]) {
      input.value = v;
      document.querySelector<HTMLButtonElement>(".gate-modal .primary")!.click();
    }
    expect(at).not.toHaveBeenCalled();
    expect(input.classList.contains("invalid")).toBe(true);
    expect(document.querySelector(".gate-modal")).not.toBeNull();
    root.remove();
    document.querySelector(".saving-back")?.remove();
  });

  it("o selo vem da extensão", () => {
    expect(kindOf("a.tar.gz")).toBe("GZ");
    expect(kindOf("app.log.1")).toBe("1");
    expect(kindOf("LEIAME")).toBe("TEXTO");
  });
});
