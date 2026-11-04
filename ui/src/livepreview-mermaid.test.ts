// @vitest-environment jsdom
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

vi.mock("./mermaid/render", async (orig) => {
  const real = await orig<typeof import("./mermaid/render")>();
  return { ...real, renderMermaid: vi.fn(async () => ({ ok: true as const, svg: "<svg></svg>" })), cachedMermaid: vi.fn(() => undefined) };
});

import { livePreview, mermaidAt } from "./livepreview";

const DOC = "antes\n\n```mermaid\ngraph TD\n  A-->B\n```\n\ndepois\n";

function make(doc: string, cursor: number, fixed = false) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [markdown({ base: markdownLanguage }), livePreview({ fixed })],
    }),
  });
  ensureSyntaxTree(view.state, doc.length, 5000);
  // o campo reconstrói quando a árvore muda; força uma transação depois de analisar
  view.dispatch({ selection: { anchor: cursor } });
  return view;
}

const widgets = (v: EditorView) => v.dom.querySelectorAll(".cm-md-mermaid").length;

describe("mermaidAt", () => {
  it("só vale para bloco ```mermaid fechado e com texto", () => {
    const find = (doc: string) => {
      const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
      const tree = ensureSyntaxTree(state, doc.length, 5000)!;
      let found: ReturnType<typeof mermaidAt> = null;
      tree.iterate({ enter: (n) => { if (n.name === "FencedCode") found = mermaidAt(state, n.node); } });
      return found;
    };
    expect(find(DOC)).toEqual({ from: 7, to: DOC.indexOf("```\n\ndepois") + 3, code: "graph TD\n  A-->B" });
    expect(find("```mermaid\ngraph TD\n")).toBeNull(); // sem a cerca de fechar
    expect(find("```mermaid\n```\n")).toBeNull(); // vazio
    expect(find("```js\nx\n```\n")).toBeNull();
  });
});

describe("diagrama no live preview", () => {
  it("troca o bloco pelo widget quando o cursor está fora", () => {
    const view = make(DOC, 1);
    expect(widgets(view)).toBe(1);
    expect(view.dom.textContent).not.toContain("graph TD");
    expect(view.state.doc.toString()).toBe(DOC); // o texto nunca muda
    view.destroy();
  });

  it("mostra o código quando o cursor toca o bloco", () => {
    const view = make(DOC, DOC.indexOf("A-->B"));
    expect(widgets(view)).toBe(0);
    view.dispatch({ selection: { anchor: DOC.length } });
    expect(widgets(view)).toBe(1);
    view.dispatch({ selection: { anchor: DOC.indexOf("graph") } });
    expect(widgets(view)).toBe(0);
    view.destroy();
  });

  it("no painel só de leitura o diagrama aparece sempre", () => {
    const view = make(DOC, DOC.indexOf("A-->B"), true);
    expect(widgets(view)).toBe(1);
    view.destroy();
  });

  it("outras linguagens e blocos abertos continuam sendo código", () => {
    const view = make("```js\nx\n```\n\n```mermaid\nsem fechar\n", 0);
    expect(widgets(view)).toBe(0);
    view.destroy();
  });
});
