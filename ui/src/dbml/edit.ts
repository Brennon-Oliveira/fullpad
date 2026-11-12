/**
 * Editar atributos de uma coluna pelo diagrama: tipo, chave primária, não nulo, único e nota. Como o
 * renomear, produz só trocas de texto (UTF-16) para o chamador aplicar numa transação, e nada vale sem
 * passar por `verifyChanges` (o texto novo continua um DBML válido, com a mesma estrutura).
 */
import type { Column, DTable, Diagram } from "./model";
import { type TextChange, verifyChanges } from "./rename";
import type { DbmlService } from "./service";

export type Flag = "pk" | "not null" | "unique";

export interface ColumnRef {
  table: DTable;
  column: Column;
}

/** A coluna cuja declaração começa em `decl`. */
export function columnAt(d: Diagram, decl: number): ColumnRef | null {
  for (const table of d.tables) {
    const column = table.columns.find((c) => c.span?.from === decl);
    if (column) return { table, column };
  }
  return null;
}

/** Onde estão os `[` `]` das configurações no fim da declaração (fora de textos entre aspas); `null` se não há. */
export function settingsBracket(decl: string): { open: number; close: number } | null {
  let quote: string | null = null;
  let open = -1;
  let depth = 0;
  for (let i = 0; i < decl.length; i++) {
    const ch = decl[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "[") {
      if (depth === 0) open = i;
      depth++;
    } else if (ch === "]" && depth > 0) {
      depth--;
      if (depth === 0 && decl.slice(i + 1).trim() === "") return { open, close: i };
    }
  }
  return null;
}

const idOf = (t: DTable) => ({ schema: t.schema ?? undefined, table: t.name });

function finish(svc: DbmlService, d: Diagram, text: string, changes: TextChange[]): { changes: TextChange[] } | { error: string } {
  if (changes.length === 0) return { error: "Nada a alterar." };
  const bad = verifyChanges(svc, d, text, changes);
  return bad ? { error: bad } : { changes };
}

/** Liga ou desliga `pk`, `not null` ou `unique`. */
export function setFlag(svc: DbmlService, d: Diagram, text: string, ref: ColumnRef, flag: Flag, on: boolean): { changes: TextChange[] } | { error: string } {
  const span = ref.column.span;
  if (!span) return { error: "Coluna sem posição no texto." };
  if (!on) return finish(svc, d, text, svc.columnSettingEdits(text, { ...idOf(ref.table), column: ref.column.name }, flag, null));
  const decl = text.slice(span.from, span.to);
  const br = settingsBracket(decl);
  // já tem `[...]`: acrescenta no fim da lista; senão abre uma no fim da linha da coluna
  const change: TextChange = br
    ? { from: span.from + br.close, to: span.from + br.close, insert: `, ${flag}` }
    : (() => {
        const end = span.from + decl.replace(/\s+$/, "").length;
        return { from: end, to: end, insert: ` [${flag}]` };
      })();
  return finish(svc, d, text, [change]);
}

/** Escreve o texto como string do DBML (`'...'`). */
export const quoteString = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** Muda a nota da coluna; `null` ou vazio tira. */
export function setNote(svc: DbmlService, d: Diagram, text: string, ref: ColumnRef, note: string | null): { changes: TextChange[] } | { error: string } {
  const value = note === null || note.trim() === "" ? null : note;
  if (value !== null && /[\r\n]/.test(value)) return { error: "A nota não pode ter quebra de linha aqui." };
  const edits = svc.columnSettingEdits(text, { ...idOf(ref.table), column: ref.column.name }, "note", value === null ? null : quoteString(value));
  return finish(svc, d, text, edits);
}

/** Muda o tipo da coluna (`varchar(80)`, `decimal(10, 2)`, `status`…). */
export function setType(svc: DbmlService, d: Diagram, text: string, ref: ColumnRef, type: string): { changes: TextChange[] } | { error: string } {
  const span = ref.column.span;
  const t = type.trim();
  if (!span) return { error: "Coluna sem posição no texto." };
  if (t === "") return { error: "O tipo não pode ficar vazio." };
  if (/[\r\n\[\]{}]/.test(t)) return { error: "O tipo não pode ter quebra de linha nem colchetes ou chaves." };
  if (t === ref.column.type) return { error: "O tipo é o mesmo." };
  const decl = text.slice(span.from, span.to);
  const br = settingsBracket(decl);
  const head = br ? decl.slice(0, br.open) : decl;
  // o nome da coluna (entre aspas ou não), depois o tipo até as configurações ou o fim da linha
  const m = /^(?:"(?:[^"\\\n]|\\.)*"|\S+)(\s+)/.exec(head);
  if (!m) return { error: "Não foi possível achar o tipo no texto." };
  const from = span.from + m[0].length;
  const to = span.from + head.replace(/\s+$/, "").length;
  if (to <= from) return { error: "Não foi possível achar o tipo no texto." };
  return finish(svc, d, text, [{ from, to, insert: t }]);
}
