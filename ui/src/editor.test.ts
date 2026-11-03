// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createState, createView, tabEffects, type TabConfig } from "./editor";

const cfg = (over: Partial<TabConfig> = {}): TabConfig => ({
  markdown: false,
  dbml: false,
  json: false,
  dark: false,
  preview: false,
  wrap: true,
  overwrite: false,
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
