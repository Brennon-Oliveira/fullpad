// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createState, createView, tabEffects, type TabConfig } from "./editor";
import { runFormat } from "./mdtoolbar";

const cfg = (over: Partial<TabConfig> = {}): TabConfig => ({
  markdown: false,
  dbml: false,
  json: false,
  dark: false,
  preview: false,
  wrap: true,
  overwrite: false,
  mdFormat: false,
  lineNumbers: true,
  ...over,
});

describe("números de linha", () => {
  it("só aparecem quando a configuração liga, numa margem separada do texto", () => {
    const parent = document.createElement("div");
    const view = createView(parent, createState("a\nb\nc", 0, () => {}));
    expect(parent.querySelector(".cm-lineNumbers")).toBeNull();
    view.dispatch({ effects: tabEffects(cfg()) });
    const nums = [...parent.querySelectorAll(".cm-lineNumbers .cm-gutterElement")].map((e) => e.textContent).filter(Boolean);
    expect(nums).toEqual(expect.arrayContaining(["1", "2", "3"])); // o "9" é o medidor invisível do CodeMirror
    expect(parent.querySelector(".cm-gutters")?.contains(parent.querySelector(".cm-content"))).toBe(false);
    expect(view.state.doc.toString()).toBe("a\nb\nc"); // o número não é texto do documento
    view.dispatch({ effects: tabEffects(cfg({ lineNumbers: false })) });
    expect(parent.querySelector(".cm-lineNumbers")).toBeNull();
    view.destroy();
  });
});

describe("barra de formatação do markdown", () => {
  it("aparece ao selecionar e traz os botões; sem seleção não aparece", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = createView(parent, createState("uma palavra aqui", 0, () => {}));
    view.dispatch({ effects: tabEffects(cfg({ markdown: true, mdFormat: true })) });
    view.dispatch({ selection: { anchor: 4, head: 11 } });
    view.requestMeasure();
    await new Promise((r) => setTimeout(r, 50));
    const bar = document.querySelector(".fp-fmt");
    expect(bar).not.toBeNull();
    expect(bar!.querySelectorAll("button").length).toBe(7);
    (bar!.querySelector(".fp-fmt-btn.b") as HTMLButtonElement).click();
    expect(view.state.doc.toString()).toBe("uma **palavra** aqui");
    view.dispatch({ selection: { anchor: 0 } });
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector(".fp-fmt")).toBeNull();
  });
});

describe("somente leitura (nota de versão)", () => {
  it("recusa digitar, colar e formatar, mas deixa selecionar", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = createView(parent, createState("texto da nota", 0, () => {}));
    view.dispatch({ effects: tabEffects(cfg({ markdown: true, mdFormat: true, readOnly: true })) });
    expect(view.state.readOnly).toBe(true);
    view.dispatch({ selection: { anchor: 0, head: 5 } });
    expect(view.state.selection.main.to).toBe(5);
    expect(runFormat(view, "bold")).toBe(true);
    expect(view.state.doc.toString()).toBe("texto da nota");
    view.dispatch({ effects: tabEffects(cfg({ markdown: true, mdFormat: true })) });
    expect(view.state.readOnly).toBe(false);
    view.destroy();
  });
});
