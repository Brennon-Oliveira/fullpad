// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createIncludeView } from "./incview";

describe("código do arquivo incluído", () => {
  it("mostra o texto somente leitura com a faixa de voltar, e esconde", () => {
    const host = document.createElement("div");
    const back = vi.fn();
    const v = createIncludeView(host, back);
    v.show("foundation.dbmlx", "Table a {\n  id int\n}\n", "← Voltar para database.dbmlx");
    expect(v.shown).toBe(true);
    expect(host.querySelector(".cm-content")!.textContent).toContain("Table a");
    expect(host.querySelector(".cm-content")!.getAttribute("contenteditable")).toBe("false");
    expect(host.querySelector(".incbar")!.textContent).toContain("foundation.dbmlx");
    host.querySelector<HTMLButtonElement>(".incbar button")!.click();
    expect(back).toHaveBeenCalled();
    v.hide();
    expect(v.shown).toBe(false);
  });
});
