// @vitest-environment jsdom
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { livePreview } from "./livepreview";
import { maskedText } from "./mathpreview";

const flush = () => new Promise((r) => setTimeout(r, 30));

function make(doc: string, cursor: number, fixed = false) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ base: markdownLanguage }), livePreview({ fixed })] }),
  });
  ensureSyntaxTree(view.state, doc.length, 5000);
  view.dispatch({ selection: { anchor: cursor } }); // reconstrói com a árvore pronta
  return view;
}
const count = (v: EditorView, sel = ".cm-md-math") => v.dom.querySelectorAll(sel).length;

describe("equações no live preview", () => {
  const DOC = "A energia vale $E = mc^2$ no repouso.\n\nOutra linha.\n";

  it("troca $...$ pela equação quando o cursor está fora, sem mexer no texto", async () => {
    const view = make(DOC, DOC.length);
    expect(count(view)).toBe(1);
    await flush();
    expect(view.dom.querySelector(".cm-md-math .katex")).not.toBeNull();
    expect(view.dom.textContent).not.toContain("$E");
    expect(view.state.doc.toString()).toBe(DOC);
    view.destroy();
  });

  it("mostra o código quando o cursor toca a equação", () => {
    const view = make(DOC, DOC.indexOf("mc^2"));
    expect(count(view)).toBe(0);
    expect(view.dom.textContent).toContain("$E = mc^2$");
    view.dispatch({ selection: { anchor: DOC.length } });
    expect(count(view)).toBe(1);
    view.destroy();
  });

  it("$$ em bloco, com várias linhas, vira um widget só", async () => {
    const doc = "antes\n\n$$\n\\int_0^1 x\\,dx\n= \\frac12\n$$\n\ndepois\n";
    const view = make(doc, 0);
    expect(count(view, ".cm-md-math-block")).toBe(1);
    await flush();
    expect(view.dom.querySelector(".cm-md-math-block .katex-display")).not.toBeNull();
    expect(view.dom.querySelector(".katex-html")?.textContent).not.toContain("\\int"); // o código só fica na anotação do MathML
    // cursor dentro do bloco: volta o código
    view.dispatch({ selection: { anchor: doc.indexOf("frac") } });
    expect(count(view, ".cm-md-math-block")).toBe(0);
    view.destroy();
  });

  it("não procura equação em código, bloco de código nem endereço", () => {
    const doc = "`$a$` e [x](https://e.com/?q=$b$)\n\n```js\nconst s = `$c$`;\n```\n\n    $d$\n";
    const view = make(doc, doc.length);
    expect(count(view)).toBe(0);
    view.destroy();
  });

  it("dinheiro não vira equação", () => {
    const doc = "Custa R$ 5 e depois R$ 10.\n";
    expect(count(make(doc, doc.length))).toBe(0);
  });

  it("equação com erro aparece como o texto dela, marcada, sem quebrar a linha", async () => {
    const doc = "ok $\\frac{1}{$ e $x^2$ fim\n";
    const view = make(doc, doc.length);
    await flush();
    const widgets = [...view.dom.querySelectorAll(".cm-md-math")];
    expect(widgets).toHaveLength(2);
    expect(widgets[0]!.classList.contains("err")).toBe(true);
    expect(widgets[0]!.textContent).toBe("\\frac{1}{");
    expect(widgets[0]!.getAttribute("title")).toMatch(/^Erro na equação/);
    expect(widgets[1]!.querySelector(".katex")).not.toBeNull(); // a vizinha segue desenhada
    view.destroy();
  });

  it("no painel só de leitura (fixed) fica sempre renderizada", async () => {
    const view = make(DOC, DOC.indexOf("mc^2"), true);
    expect(count(view)).toBe(1);
    view.destroy();
  });

  it("não troca o bloco mermaid por equação", () => {
    const doc = "```mermaid\nflowchart LR\n  A[\"$x$\"] --> B\n```\n";
    const view = make(doc, doc.length, true);
    expect(count(view)).toBe(0);
    view.destroy();
  });
});

describe("maskedText", () => {
  it("troca o código por MASK e mantém o tamanho e as quebras de linha", () => {
    const doc = "a `b$` c\n```\nx\n```\n";
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
    ensureSyntaxTree(state, doc.length, 5000);
    const m = maskedText(state);
    expect(m).toHaveLength(doc.length);
    expect(m.split("\n")).toHaveLength(doc.split("\n").length);
    expect(m).not.toContain("b$");
  });
});
