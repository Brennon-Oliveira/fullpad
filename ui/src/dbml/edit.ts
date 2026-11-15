/**
 * Editar atributos de uma coluna pelo diagrama: tipo, chave primária, não nulo, único e nota. Como o
 * renomear, produz só trocas de texto (UTF-16) para o chamador aplicar numa transação, e nada vale sem
 * passar por `verifyChanges` (o texto novo continua um DBML válido, com a mesma estrutura).
 */
import { type Column, type DTable, type Diagram, parseDbml } from "./model";
import { type TextChange, applyChanges, verifyChanges } from "./rename";
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

/**
 * A nota como texto do DBML: `'...'` numa linha só; com quebras de linha, `'''...'''`. `null` se não dá
 * para escrever (um `'''` dentro do texto fecharia a nota antes da hora).
 */
export function noteLiteral(s: string): string | null {
  if (!/[\r\n]/.test(s)) return quoteString(s);
  if (s.includes("'''")) return null;
  return `'''\n${s.replace(/\r\n?/g, "\n").replace(/\\/g, "\\\\")}\n'''`;
}

const norm = (s?: string | null) => (s ?? "").replace(/\s+/g, " ").trim();

/** Aplica as trocas e confere que a nota lida de volta é a pedida (o DBML pode ler aspas e barras de outro jeito). */
function checkNote(text: string, changes: TextChange[], read: (d: Diagram) => string | undefined, expected: string | null, svc: DbmlService): string | null {
  const parsed = parseDbml(svc.interpret, applyChanges(text, changes));
  if (!parsed.diagram) return "O texto novo não é um DBML válido.";
  return norm(read(parsed.diagram)) === norm(expected) ? null : "Não foi possível escrever essa nota (o DBML leria outro texto).";
}

/** Fim (exclusivo) do texto entre aspas que começa em `i` (`'..'`, `".."`, `` `..` `` ou `'''..'''`); -1 se não fecha. */
export function stringEnd(s: string, i: number): number {
  const q = s[i];
  if (q !== "'" && q !== '"' && q !== "`") return -1;
  if (s.startsWith("'''", i)) {
    for (let j = i + 3; j < s.length; j++) {
      if (s[j] === "\\") j++;
      else if (s.startsWith("'''", j)) return j + 3;
    }
    return -1;
  }
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === "\\") j++;
    else if (s[j] === q) return j + 1;
    else if (q !== "`" && s[j] === "\n") return -1;
  }
  return -1;
}

/** A nota escrita no corpo da tabela (`Note: '...'` ou `Note { '...' }`), em posições do trecho da tabela. */
export function bodyNote(decl: string): { from: number; to: number; litFrom: number; litTo: number } | null {
  let depth = 0;
  for (let i = 0; i < decl.length; i++) {
    const ch = decl[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const e = stringEnd(decl, i);
      if (e < 0) return null;
      i = e - 1;
    } else if (ch === "/" && decl[i + 1] === "/") {
      const nl = decl.indexOf("\n", i);
      if (nl < 0) return null;
      i = nl;
    } else if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (depth === 1) {
      const ls = decl.lastIndexOf("\n", i - 1) + 1;
      if (decl.slice(ls, i).trim() !== "") continue; // só no começo da linha
      const m = /^note\s*([:{])\s*/i.exec(decl.slice(i));
      if (!m) continue;
      const litFrom = i + m[0].length;
      const litTo = stringEnd(decl, litFrom);
      if (litTo < 0) return null;
      let to = litTo;
      if (m[1] === "{") {
        const rest = /^\s*\}/.exec(decl.slice(litTo));
        if (!rest) return null;
        to = litTo + rest[0].length;
      }
      return { from: ls, to, litFrom, litTo };
    }
  }
  return null;
}

/** A tabela cuja declaração começa em `decl`. */
export function tableAt(d: Diagram, decl: number): DTable | null {
  return d.tables.find((t) => t.span?.from === decl) ?? null;
}

/** Muda a nota da coluna; `null` ou vazio tira. Aceita várias linhas. */
export function setNote(svc: DbmlService, d: Diagram, text: string, ref: ColumnRef, note: string | null): { changes: TextChange[] } | { error: string } {
  const value = note === null || note.trim() === "" ? null : note;
  const lit = value === null ? null : noteLiteral(value);
  if (value !== null && lit === null) return { error: "A nota não pode ter três aspas simples seguidas (''') quando tem várias linhas." };
  const edits = svc.columnSettingEdits(text, { ...idOf(ref.table), column: ref.column.name }, "note", lit);
  const r = finish(svc, d, text, edits);
  if ("error" in r) return r;
  const bad = checkNote(text, r.changes, (nd) => nd.tables.find((t) => t.id === ref.table.id)?.columns.find((c) => c.name === ref.column.name)?.note, value, svc);
  return bad ? { error: bad } : r;
}

/**
 * Muda a nota da tabela; `null` ou vazio tira. A nota fica onde já está (`Note:` no corpo ou
 * `[note: ...]` no cabeçalho); sem nota, nasce uma `Note:` no fim do corpo.
 */
export function setTableNote(svc: DbmlService, d: Diagram, text: string, table: DTable, note: string | null): { changes: TextChange[] } | { error: string } {
  const span = table.span;
  if (!span) return { error: "Tabela sem posição no texto." };
  const value = note === null || note.trim() === "" ? null : note;
  const lit = value === null ? null : noteLiteral(value);
  if (value !== null && lit === null) return { error: "A nota não pode ter três aspas simples seguidas (''') quando tem várias linhas." };
  const decl = text.slice(span.from, span.to);
  const body = bodyNote(decl);
  let changes: TextChange[];
  if (body) {
    if (lit === null) {
      let to = span.from + body.to;
      if (text[to] === "\r") to++;
      if (text[to] === "\n") to++;
      changes = [{ from: span.from + body.from, to, insert: "" }];
    } else changes = [{ from: span.from + body.litFrom, to: span.from + body.litTo, insert: lit }];
  } else if (table.note !== undefined) {
    changes = svc.tableSettingEdits(text, idOf(table), "note", lit);
  } else if (lit === null) {
    return { error: "Nada a alterar." };
  } else {
    const close = decl.lastIndexOf("}");
    if (close < 0) return { error: "Não foi possível achar o fim da tabela no texto." };
    const ls = decl.lastIndexOf("\n", close) + 1;
    const alone = decl.slice(ls, close).trim() === "";
    changes = alone ? [{ from: span.from + ls, to: span.from + ls, insert: `  Note: ${lit}\n` }] : [{ from: span.from + close, to: span.from + close, insert: `\n  Note: ${lit}\n` }];
  }
  const r = finish(svc, d, text, changes);
  if ("error" in r) return r;
  const bad = checkNote(text, r.changes, (nd) => nd.tables.find((t) => t.id === table.id)?.note, value, svc);
  return bad ? { error: bad } : r;
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
