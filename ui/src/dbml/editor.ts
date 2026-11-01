import { type Diagnostic, linter } from "@codemirror/lint";
import type { Extension, Text } from "@codemirror/state";
import { type DbmlDiagnostic, loadDbmlService } from "./service";

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

/** Recursos de editor exclusivos do DBML: sublinhado de erros (e, depois, autocomplete). */
export async function dbmlEditorSupport(): Promise<Extension> {
  const svc = await loadDbmlService();
  return [
    linter(
      (view) => {
        if (view.state.doc.length > MAX_SUPPORT_CHARS) return [];
        const text = view.state.doc.toString();
        return toLintDiagnostics(text, view.state.doc, svc.diagnostics(text));
      },
      { delay: 500 },
    ),
  ];
}
