// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { showSaving } from "./saving";

afterEach(() => (document.body.innerHTML = ""));

describe("cartão Salvando…", () => {
  it("ao fechar, devolve o foco a quem o tinha (a tabela), para o Ctrl+Z seguir valendo", () => {
    const t = document.createElement("div");
    t.tabIndex = 0;
    document.body.append(t);
    t.focus();
    const s = showSaving({ poll: async () => ({ done: 0, total: 0 }), cancel: () => {} });
    expect(document.activeElement).not.toBe(t);
    s.close();
    expect(document.activeElement).toBe(t);
    expect(document.querySelector(".saving-back")).toBeNull();
  });

  it("no modo direto não há Cancelar", () => {
    const s = showSaving({ poll: async () => ({ done: 0, total: 0 }), cancel: () => {}, cancelable: false });
    expect(document.querySelector<HTMLButtonElement>(".saving-card button")!.hidden).toBe(true);
    s.close();
  });
});
