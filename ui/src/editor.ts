import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { fullpadSearch } from "./searchpanel";
import { Compartment, EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, drawSelection, keymap, lineNumbers, type ViewUpdate } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { codeLanguages } from "./codelangs";
import { dbmlLanguage } from "./dbmllang";
import { linkExtension } from "./links";
import { livePreview } from "./livepreview";

const langC = new Compartment();
const previewC = new Compartment();
const themeC = new Compartment(); // claro/escuro: o CodeMirror ajusta o próprio tema padrão por isso
const supportC = new Compartment(); // recursos extras da linguagem (carregados sob demanda)
const bracketsC = new Compartment(); // fecha ( [ { e aspas sozinho (DBML)
const wrapC = new Compartment();
const overwriteC = new Compartment();
const gutterC = new Compartment(); // números de linha

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
  { tag: [tags.bool, tags.null], color: "var(--syn-keyword)", fontWeight: "bold" },
  { tag: tags.typeName, color: "var(--syn-type)" },
  { tag: tags.definition(tags.variableName), color: "var(--syn-def)", fontWeight: "bold" },
  { tag: tags.propertyName, color: "var(--syn-prop)" },
  { tag: tags.operator, color: "var(--syn-op)", fontWeight: "bold" },
  { tag: [tags.bracket, tags.punctuation], color: "var(--muted)" },
]);

/**
 * Cores do markdown no modo código. São classes (e não cores fixas) para o CSS poder desligá-las no
 * preview renderizado, onde o `livepreview` já estiliza os mesmos elementos.
 */
const markdownSource = HighlightStyle.define([
  { tag: tags.heading, class: "md-heading" },
  { tag: tags.list, class: "md-list" },
  { tag: tags.monospace, class: "md-code" },
  { tag: tags.link, class: "md-link" },
  { tag: tags.url, class: "md-url" },
  { tag: tags.labelName, class: "md-info" },
  { tag: tags.quote, class: "md-quote" },
  { tag: tags.strikethrough, class: "md-strike" },
  { tag: tags.processingInstruction, class: "md-mark" },
]);

/**
 * Destaque de linhas apontadas de fora (o mouse sobre o diagrama): só pinta o fundo, não seleciona nem
 * move o cursor. Qualquer edição apaga o destaque, porque os trechos deixariam de valer.
 */
const setHint = StateEffect.define<{ from: number; to: number }[] | null>();
const hintField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    if (tr.docChanged) value = Decoration.none;
    for (const e of tr.effects) {
      if (!e.is(setHint)) continue;
      const doc = tr.state.doc;
      const lines = new Set<number>();
      for (const r of e.value ?? []) {
        const a = doc.lineAt(Math.min(r.from, doc.length)).number;
        const b = doc.lineAt(Math.min(Math.max(r.to, r.from), doc.length)).number;
        for (let n = a; n <= b; n++) lines.add(n);
      }
      value = Decoration.set([...lines].sort((x, y) => x - y).map((n) => Decoration.line({ class: "cm-hint-line" }).range(doc.line(n).from)));
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Sublinhado do erro de sintaxe do JSON (vindo do Rust). Qualquer edição o apaga: o trecho deixaria de
 * valer, e a próxima verificação o recoloca.
 */
const setJsonError = StateEffect.define<{ from: number; to: number; message: string } | null>();
const jsonErrorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    if (tr.docChanged) value = Decoration.none;
    for (const e of tr.effects) {
      if (!e.is(setJsonError)) continue;
      const len = tr.state.doc.length;
      const r = e.value;
      if (!r || len === 0) value = Decoration.none;
      else {
        const from = Math.min(r.from, len - 1);
        const to = Math.min(Math.max(r.to, from + 1), len);
        value = Decoration.set([Decoration.mark({ class: "cm-json-error", attributes: { title: r.message } }).range(from, to)]);
      }
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Células do CSV destacadas no código: as selecionadas na tabela (mais forte) e a sob o mouse (mais
 * suave). Marcam só o texto das células, não a linha. Qualquer edição apaga: os trechos deixariam de valer.
 */
function cellMarkField(effect: ReturnType<typeof StateEffect.define<{ from: number; to: number }[] | null>>, cls: string) {
  return StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, tr) {
      if (tr.docChanged) value = Decoration.none;
      for (const e of tr.effects) {
        if (!e.is(effect)) continue;
        const len = tr.state.doc.length;
        const marks = (e.value ?? [])
          .map((r) => ({ from: Math.min(r.from, len), to: Math.min(r.to, len) }))
          .filter((r) => r.to > r.from)
          .map((r) => Decoration.mark({ class: cls }).range(r.from, r.to));
        value = Decoration.set(marks, true);
      }
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}
const setCellSel = StateEffect.define<{ from: number; to: number }[] | null>();
const setCellHover = StateEffect.define<{ from: number; to: number }[] | null>();
const cellSelField = cellMarkField(setCellSel, "cm-csv-sel");
const cellHoverField = cellMarkField(setCellHover, "cm-csv-hover");

/** Destaca (ou limpa, com `null`) o trecho das células selecionadas na tabela. */
export const csvSelectionMarks = (spans: { from: number; to: number }[] | null) => setCellSel.of(spans);
/** Destaca (ou limpa, com `null`) o trecho da célula sob o mouse na tabela. */
export const csvHoverMarks = (spans: { from: number; to: number }[] | null) => setCellHover.of(spans);

/** Efeito para sublinhar o erro (ou limpar, com `null`). */
export const jsonErrorMark = (r: { from: number; to: number; message: string } | null) => setJsonError.of(r);

/** Campo do destaque de linhas, para outras visões do mesmo texto (o painel do markdown). */
export const hintExtension: Extension = hintField;

/** Efeito para destacar os trechos (ou limpar, com `null`). */
export const hintLines = (spans: { from: number; to: number }[] | null) => setHint.of(spans);

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

/** Cores de sintaxe, para outras visões do mesmo texto (o painel do markdown renderizado). */
export const syntaxColors: Extension = syntaxHighlighting(highlight);

export interface TabConfig {
  markdown: boolean;
  dbml: boolean;
  json: boolean;
  /** Tema escuro do sistema: sem isso o CodeMirror pinta popups e seleção como se fosse claro. */
  dark: boolean;
  /** Diagnóstico/autocomplete da linguagem; `undefined` enquanto carrega ou quando não há. */
  support?: Extension;
  preview: boolean;
  wrap: boolean;
  overwrite: boolean;
  /** Números de linha na margem (só onde o código aparece: o markdown renderizado e a tabela não têm). */
  lineNumbers: boolean;
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
    langC.reconfigure(c.markdown ? markdown({ base: markdownLanguage, codeLanguages }) : c.dbml ? dbmlLanguage : []),
    previewC.reconfigure(c.preview ? livePreview() : []),
    supportC.reconfigure(c.support ?? []),
    bracketsC.reconfigure(c.dbml || c.json ? closeBrackets() : []),
    themeC.reconfigure(EditorView.darkTheme.of(c.dark)),
    wrapC.reconfigure(c.wrap ? EditorView.lineWrapping : []),
    overwriteC.reconfigure(c.overwrite ? overwriteExt : []),
    gutterC.reconfigure(c.lineNumbers ? lineNumbers() : []),
  ];
}

/** O app segue o tema do sistema (veja o CSS); aqui só avisamos o CodeMirror. */
export function isDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
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
      bracketsC.of([]),
      themeC.of(EditorView.darkTheme.of(isDark())),
      wrapC.of(EditorView.lineWrapping),
      overwriteC.of([]),
      gutterC.of([]),
      hintField,
      jsonErrorField,
      cellSelField,
      cellHoverField,
      linkExtension,
      syntaxHighlighting(highlight),
      syntaxHighlighting(markdownSource),
      fullpadSearch,
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      EditorView.updateListener.of(onUpdate),
    ],
  });
}

export function createView(parent: HTMLElement, state: EditorState): EditorView {
  return new EditorView({ state, parent });
}
