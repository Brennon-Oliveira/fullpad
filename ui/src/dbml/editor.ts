import { type Completion, type CompletionContext, type CompletionResult, autocompletion, snippet } from "@codemirror/autocomplete";
import { type Diagnostic, linter } from "@codemirror/lint";
import { type Extension, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { type DbmlCompletion, type DbmlDiagnostic, type DbmlService, loadDbmlService } from "./service";

/** Acima disso o diagnóstico no editor desliga para não pesar. */
export const MAX_SUPPORT_CHARS = 500_000;

/** (linha, coluna) a partir de 1 → posição no documento, sem sair da linha. */
function offsetAt(doc: Text, row: number, column: number): number {
  const line = doc.line(Math.min(Math.max(row, 1), doc.lines));
  return line.from + Math.min(Math.max(column - 1, 0), line.length);
}

/**
 * Converte os diagnósticos do parser em diagnósticos do CodeMirror. `text` é o texto que gerou
 * os diagnósticos: as correções sugeridas usam posições nele, então só se aplicam se o documento
 * ainda for idêntico.
 */
export function toLintDiagnostics(text: string, doc: Text, diags: DbmlDiagnostic[]): Diagnostic[] {
  return diags.map((d) => {
    let from = offsetAt(doc, d.startRow, d.startColumn);
    let to = offsetAt(doc, d.endRow, d.endColumn);
    if (to <= from) {
      // intervalo vazio (ex.: fim da linha): marca ao menos um caractere
      if (from < doc.length) to = from + 1;
      else from = Math.max(0, from - 1);
    }
    return {
      from,
      to: Math.max(to, from + 1 <= doc.length ? from + 1 : from),
      severity: d.type,
      message: d.text,
      actions: (d.quickFixes ?? []).map((f) => ({
        name: f.title,
        apply(view) {
          if (view.state.doc.toString() !== text) return;
          view.dispatch({ changes: f.edits.map((e) => ({ from: e.start, to: e.end, insert: e.newText })) });
        },
      })),
    };
  });
}

const KIND_TYPE: Record<number, string> = {
  1: "function",
  3: "property", // coluna
  4: "variable",
  5: "class", // tabela
  9: "property", // configuração
  15: "enum",
  16: "enum",
  17: "keyword",
  24: "type", // tipo de coluna
};

/** `$1`/`$0` do Monaco → `${1}`/`${}` do snippet do CodeMirror. */
export function toSnippetTemplate(monaco: string): string {
  return monaco.replace(/\$0/g, "${}").replace(/\$(\d+)/g, "${$1}");
}

export function toCompletionOptions(items: DbmlCompletion[]): Completion[] {
  return items.map((i) => {
    const isSnippet = ((i.insertTextRules ?? 0) & 4) !== 0;
    const c: Completion = { label: i.label, type: KIND_TYPE[i.kind ?? -1] ?? "text", detail: i.detail };
    if (isSnippet) c.apply = snippet(toSnippetTemplate(i.insertText));
    else if (i.insertText !== i.label) c.apply = i.insertText;
    return c;
  });
}

/** Fonte de autocomplete: sugere ao digitar uma palavra, após um caractere gatilho ou com Ctrl+Espaço. */
export function dbmlCompletionSource(svc: DbmlService) {
  return (ctx: CompletionContext): CompletionResult | null => {
    if (ctx.state.doc.length > MAX_SUPPORT_CHARS) return null;
    const word = ctx.matchBefore(/[\w$]*/);
    const from = word ? word.from : ctx.pos;
    const prev = ctx.pos > 0 ? ctx.state.sliceDoc(ctx.pos - 1, ctx.pos) : "";
    if (!ctx.explicit && from === ctx.pos && !svc.triggerCharacters.includes(prev)) return null;
    const options = toCompletionOptions(svc.completions(ctx.state.doc.toString(), ctx.pos));
    return options.length > 0 ? { from, options, validFor: /^[\w$]*$/ } : null;
  };
}

const INCLUDE = /^(\s*!include\s+)(["'])(.*?)\2/;

/**
 * O caminho de um `!include "x"` é um link: sublinhado ao passar o mouse e **Ctrl+clique** (ou Cmd+clique) abre
 * o arquivo (`open` recebe o caminho como está escrito e o editor onde se clicou).
 */
export function includeLinks(open: (written: string, view: EditorView) => void): Extension {
  const mark = Decoration.mark({ class: "cm-include-link" });
  const build = (view: EditorView): DecorationSet => {
    const ranges = [];
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to; ) {
        const line = view.state.doc.lineAt(pos);
        const m = INCLUDE.exec(line.text);
        if (m) ranges.push(mark.range(line.from + m[1].length + 1, line.from + m[1].length + 1 + m[3].length));
        pos = line.to + 1;
      }
    }
    return Decoration.set(ranges, true);
  };
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = build(view);
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
        }
      },
      { decorations: (v) => v.decorations },
    ),
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos === null) return false;
        const line = view.state.doc.lineAt(pos);
        const m = INCLUDE.exec(line.text);
        if (!m) return false;
        const from = line.from + m[1].length + 1;
        if (pos < from || pos > from + m[3].length) return false; // só o caminho (entre as aspas) é o link
        e.preventDefault();
        open(m[3], view);
        return true;
      },
    }),
  ];
}

/** Recursos de editor exclusivos do DBML: sublinhado de erros, autocomplete e o Ctrl+clique do `!include`. */
export async function dbmlEditorSupport(openInclude?: (written: string, view: EditorView) => void): Promise<Extension> {
  const svc = await loadDbmlService();
  return [
    openInclude ? includeLinks(openInclude) : [],
    linter(
      (view) => {
        if (view.state.doc.length > MAX_SUPPORT_CHARS) return [];
        const text = view.state.doc.toString();
        return toLintDiagnostics(text, view.state.doc, svc.diagnostics(text));
      },
      { delay: 500 },
    ),
    autocompletion({ override: [dbmlCompletionSource(svc)] }),
  ];
}
