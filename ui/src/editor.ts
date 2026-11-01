import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension, type StateEffect } from "@codemirror/state";
import { EditorView, drawSelection, keymap, type ViewUpdate } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { dbmlLanguage } from "./dbmllang";
import { livePreview } from "./livepreview";

const langC = new Compartment();
const previewC = new Compartment();
const supportC = new Compartment(); // recursos extras da linguagem (carregados sob demanda)
const wrapC = new Compartment();
const overwriteC = new Compartment();

const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "bold" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "var(--accent)" },
  { tag: tags.url, color: "var(--muted)" },
  { tag: tags.monospace, fontFamily: "var(--mono)" },
  { tag: tags.quote, color: "var(--muted)" },
  { tag: tags.processingInstruction, color: "var(--muted)" },
  { tag: tags.contentSeparator, color: "var(--muted)" },
  // DBML (e qualquer linguagem com tokens de código)
  { tag: tags.comment, color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: tags.keyword, color: "var(--syn-keyword)", fontWeight: "bold" },
  { tag: tags.string, color: "var(--syn-string)" },
  { tag: tags.special(tags.string), color: "var(--syn-string)" },
  { tag: tags.number, color: "var(--syn-number)" },
  { tag: tags.atom, color: "var(--syn-number)" },
  { tag: tags.typeName, color: "var(--syn-type)" },
  { tag: tags.definition(tags.variableName), color: "var(--syn-def)", fontWeight: "bold" },
  { tag: tags.propertyName, color: "var(--syn-prop)" },
  { tag: tags.operator, color: "var(--syn-op)", fontWeight: "bold" },
  { tag: [tags.bracket, tags.punctuation], color: "var(--muted)" },
]);

const phrases = EditorState.phrases.of({
  Find: "Localizar",
  Replace: "Substituir",
  next: "próximo",
  previous: "anterior",
  all: "todos",
  "match case": "maiúsc./minúsc.",
  "by word": "palavra inteira",
  regexp: "regex",
  replace: "substituir",
  "replace all": "substituir todos",
  close: "fechar",
  "Go to line": "Ir para linha",
  go: "ir",
});

export interface TabConfig {
  markdown: boolean;
  dbml: boolean;
  /** Diagnóstico/autocomplete da linguagem; `undefined` enquanto carrega ou quando não há. */
  support?: Extension;
  preview: boolean;
  wrap: boolean;
  overwrite: boolean;
}

/** Sobrescrever (tecla Insert): cada caractere digitado substitui o seguinte. */
const overwriteExt = [
  EditorView.inputHandler.of((view, from, to, text) => {
    if (from !== to || text.length !== 1 || text === "\n") return false;
    if (from >= view.state.doc.lineAt(from).to) return false;
    view.dispatch({
      changes: { from, to: from + 1, insert: text },
      selection: { anchor: from + 1 },
      userEvent: "input.type",
    });
    return true;
  }),
  EditorView.editorAttributes.of({ class: "cm-overwrite" }),
];

export function tabEffects(c: TabConfig): StateEffect<unknown>[] {
  return [
    langC.reconfigure(c.markdown ? markdown({ base: markdownLanguage }) : c.dbml ? dbmlLanguage : []),
    previewC.reconfigure(c.preview ? livePreview() : []),
    supportC.reconfigure(c.support ?? []),
    wrapC.reconfigure(c.wrap ? EditorView.lineWrapping : []),
    overwriteC.reconfigure(c.overwrite ? overwriteExt : []),
  ];
}

export function createState(
  doc: string,
  cursor: number,
  onUpdate: (u: ViewUpdate) => void,
): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: Math.min(cursor, doc.length) },
    extensions: [
      history(),
      drawSelection(),
      phrases,
      langC.of([]),
      previewC.of([]),
      supportC.of([]),
      wrapC.of(EditorView.lineWrapping),
      overwriteC.of([]),
      syntaxHighlighting(highlight),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      EditorView.updateListener.of(onUpdate),
    ],
  });
}

export function createView(parent: HTMLElement, state: EditorState): EditorView {
  return new EditorView({ state, parent });
}
