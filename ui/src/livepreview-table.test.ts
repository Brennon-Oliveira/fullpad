// @vitest-environment jsdom
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { livePreview } from "./livepreview";

const TABLE = "| Nome | Qtd |\n| --- | ---: |\n| Maçã | 3 |\n| Pera | 12 |";
const DOC = `Antes\n\n${TABLE}\n\nDepois\n`;

function make(doc: string, cursor: number, fixed = false, readOnly = false) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [markdown({ base: markdownLanguage }), livePreview({ fixed }), EditorState.readOnly.of(readOnly)],
    }),
  });
  ensureSyntaxTree(view.state, doc.length, 5000);
  view.dispatch({ selection: { anchor: cursor } });
  return view;
}
const cell = (v: EditorView, row: number, col: number) =>
  v.dom.querySelector<HTMLElement>(`.cm-md-table [data-row="${row}"][data-col="${col}"]`)!;
const type = (c: HTMLElement, text: string) => {
  c.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
  const ta = c.querySelector("textarea")!;
  ta.value = text;
  ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
};

describe("tabelas no live preview", () => {
  it("vira grade quando o cursor está fora, sem mexer no texto", () => {
    const view = make(DOC, DOC.length);
    expect(view.dom.querySelectorAll(".cm-md-table").length).toBe(1);
    expect(view.dom.querySelectorAll(".cm-md-table th").length).toBe(2);
    expect(view.dom.querySelectorAll(".cm-md-table td").length).toBe(4);
    expect(cell(view, 1, 0).textContent).toBe("Pera");
    expect(cell(view, 0, 1).style.textAlign).toBe("right");
    expect(view.state.doc.toString()).toBe(DOC);
    view.destroy();
  });
  it("mostra o código quando o cursor toca a tabela", () => {
    const view = make(DOC, DOC.indexOf("Maçã"));
    expect(view.dom.querySelectorAll(".cm-md-table").length).toBe(0);
    view.dispatch({ selection: { anchor: DOC.length } });
    expect(view.dom.querySelectorAll(".cm-md-table").length).toBe(1);
    view.destroy();
  });
  it("editar uma célula reescreve só a tabela, alinhada, numa transação", () => {
    const view = make(DOC, DOC.length);
    type(cell(view, 0, 0), "Laranja");
    const out = view.state.doc.toString();
    expect(out).toBe(`Antes\n\n| Nome    | Qtd |\n| ------- | --: |\n| Laranja |   3 |\n| Pera    |  12 |\n\nDepois\n`);
    view.destroy();
  });
  it("célula com barra e quebra de linha vira \\| e <br>", () => {
    const view = make(DOC, DOC.length);
    type(cell(view, 1, 0), "a|b\nc");
    expect(view.state.doc.toString()).toContain("a\\|b<br>c");
    view.destroy();
  });
  it("não grava quando nada mudou", () => {
    const view = make(DOC, DOC.length);
    type(cell(view, 0, 0), "Maçã");
    expect(view.state.doc.toString()).toBe(DOC);
    view.destroy();
  });
  it("painel fixo e aba só de leitura não editam", () => {
    for (const view of [make(DOC, 0, true), make(DOC, DOC.length, false, true)]) {
      expect(view.dom.querySelectorAll(".cm-md-table").length).toBe(1);
      cell(view, 0, 0).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
      expect(cell(view, 0, 0).querySelector("textarea")).toBeNull();
      view.destroy();
    }
  });
  it("tabela dentro de lista fica como texto", () => {
    const doc = `- item\n\n  ${TABLE.replace(/\n/g, "\n  ")}\n\nfim\n`;
    const view = make(doc, doc.length);
    expect(view.dom.querySelectorAll(".cm-md-table").length).toBe(0);
    view.destroy();
  });
  it("renderiza negrito e código dentro da célula", () => {
    const doc = "| a |\n| - |\n| **x** `y` |\n";
    const view = make(doc, doc.length);
    expect(view.dom.querySelector(".cm-md-table td strong")?.textContent).toBe("x");
    expect(view.dom.querySelector(".cm-md-table td code")?.textContent).toBe("y");
    view.destroy();
  });
});
