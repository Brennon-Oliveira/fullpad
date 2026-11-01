// @vitest-environment jsdom
import { closeBrackets } from "@codemirror/autocomplete";
import { insertNewlineAndIndent } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { dbmlLanguage } from "./dbmllang";

// o jsdom não mede texto; o CodeMirror só precisa que isso não quebre
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const views: EditorView[] = [];
afterEach(() => views.splice(0).forEach((v) => v.destroy()));

function make(doc: string, anchor: number) {
  const v = new EditorView({
    state: EditorState.create({ doc, selection: { anchor }, extensions: [dbmlLanguage, closeBrackets()] }),
  });
  views.push(v);
  return v;
}

/** Digita um caractere passando pelos manipuladores de entrada (como o navegador faria). */
function type(view: EditorView, ch: string) {
  const { from, to } = view.state.selection.main;
  const handled = view.state.facet(EditorView.inputHandler).some((h) => h(view, from, to, ch, () => view.state.update({})));
  if (!handled) view.dispatch({ changes: { from, to, insert: ch }, selection: { anchor: from + 1 } });
}

describe("edição de DBML", () => {
  it.each([
    ["(", "()"],
    ["[", "[]"],
    ["{", "{}"],
  ])("ao abrir %s, fecha sozinho", (open, expected) => {
    const v = make("", 0);
    type(v, open);
    expect(v.state.doc.toString()).toBe(expected);
    expect(v.state.selection.main.head).toBe(1);
  });

  it("digitar o fechamento pula o que já existe", () => {
    const v = make("", 0);
    type(v, "[");
    type(v, "]");
    expect(v.state.doc.toString()).toBe("[]");
    expect(v.state.selection.main.head).toBe(2);
  });

  it("Enter entre { e } abre a linha recuada", () => {
    const v = make("Table t {}", 9);
    insertNewlineAndIndent({ state: v.state, dispatch: v.dispatch.bind(v) });
    expect(v.state.doc.toString()).toBe("Table t {\n  \n}");
  });

  it("aninha o recuo e o } volta um nível", () => {
    const v = make("Table t {\n  indexes {}\n}", 21);
    insertNewlineAndIndent({ state: v.state, dispatch: v.dispatch.bind(v) });
    expect(v.state.doc.toString()).toBe("Table t {\n  indexes {\n    \n  }\n}");
  });
});
