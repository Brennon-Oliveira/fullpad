/**
 * Renomear símbolos do DBML (tabela, coluna, enum, valor de enum, grupo) **com as referências**:
 * `Ref:`, `[ref: …]` inline, `Records`, grupos, índices, tipo de coluna que usa o enum. Tudo vem do
 * texto: a tabela usa o `renameTable` da biblioteca (que entende esquema e apelido), o resto usa o
 * provider de referências dela. O resultado são trocas de texto (UTF-16) para o chamador aplicar
 * numa transação só (um passo no Ctrl+Z); aqui nada toca o editor nem o disco.
 */
import { type Diagram, type DTable, type Span, parseDbml, tableId } from "./model";
import type { DbmlService } from "./service";

export type SymbolKind = "table" | "column" | "enum" | "value" | "group";

export interface RenameTarget {
  kind: SymbolKind;
  /** Nome de agora (sem aspas). */
  name: string;
  /** Onde a declaração começa no texto. */
  decl: number;
  /** O trecho do nome na declaração. */
  from: number;
  to: number;
  table?: DTable;
}

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export interface RenameResult {
  changes: TextChange[];
  /** Tabela renomeada (ids com esquema): o layout acompanha. */
  renamedTable?: { from: string; to: string };
  renamedGroup?: { from: string; to: string };
}

const IDENT = String.raw`"(?:[^"\\\n]|\\.)*"|[^\s.\[\]{}(),:;<>"'` + "`" + String.raw`]+`;
const unquote = (s: string) => (s.startsWith('"') ? s.slice(1, -1).replace(/\\(.)/g, "$1") : s);

/** O trecho do nome na declaração que começa em `decl`. */
function nameToken(text: string, kind: SymbolKind, decl: number): { from: number; to: number; name: string } | null {
  const head = text.slice(decl, decl + 400);
  let m: RegExpExecArray | null;
  let offset: number;
  if (kind === "table") m = new RegExp(String.raw`^Table\s+(?:(?:${IDENT})\s*\.\s*)?(${IDENT})`, "i").exec(head);
  else if (kind === "enum") m = new RegExp(String.raw`^Enum\s+(?:(?:${IDENT})\s*\.\s*)?(${IDENT})`, "i").exec(head);
  else if (kind === "group") m = new RegExp(String.raw`^TableGroup\s+(?:(?:${IDENT})\s*\.\s*)?(${IDENT})`, "i").exec(head);
  else m = new RegExp(String.raw`^(${IDENT})`).exec(head); // coluna e valor: o nome abre a linha
  if (!m) return null;
  offset = m[0].length - m[1].length;
  return { from: decl + offset, to: decl + offset + m[1].length, name: unquote(m[1]) };
}

/** O alvo cuja declaração começa em `decl`, ou `null`. */
export function targetForDecl(d: Diagram, text: string, decl: number): RenameTarget | null {
  const make = (kind: SymbolKind, span: Span | undefined, table?: DTable): RenameTarget | null => {
    if (!span || span.from !== decl) return null;
    const tok = nameToken(text, kind, decl);
    return tok ? { kind, decl, from: tok.from, to: tok.to, name: tok.name, table } : null;
  };
  for (const t of d.tables) {
    const hit = make("table", t.span, t);
    if (hit) return hit;
    for (const c of t.columns) {
      const col = make("column", c.span, t);
      if (col) return col;
    }
  }
  for (const e of d.enums) {
    const hit = make("enum", e.span);
    if (hit) return hit;
    for (const v of e.values) {
      const val = make("value", v.span);
      if (val) return val;
    }
  }
  for (const g of d.groups) {
    const hit = make("group", g.span);
    if (hit) return hit;
  }
  return null;
}

const WORD = /[^\s.\[\]{}(),:;<>'`]/;
/** A palavra (ou texto entre aspas) sob `offset`. */
function wordAt(text: string, offset: number): string | null {
  let a = offset;
  let b = offset;
  while (a > 0 && WORD.test(text[a - 1])) a--;
  while (b < text.length && WORD.test(text[b])) b++;
  return a < b ? unquote(text.slice(a, b)) : null;
}

/**
 * O que renomear com o cursor em `offset`: um uso (`Ref`, `Records`, tipo de coluna, grupo…) ou o
 * nome numa declaração. Fora disso (um tipo, uma configuração, um apelido) devolve `null`.
 */
export function targetAt(svc: DbmlService, d: Diagram, text: string, offset: number): RenameTarget | null {
  const def = svc.definition(text, offset);
  if (def !== null) {
    const t = targetForDecl(d, text, def);
    // um apelido (`U.id`) também leva à tabela, mas o que está sob o cursor não é o nome dela
    return t && wordAt(text, offset) === t.name ? t : null;
  }
  // sem definição: o cursor está numa declaração; vale se ele toca o nome
  const inside = (s: Span | undefined) => !!s && offset >= s.from && offset <= s.to;
  let best: RenameTarget | null = null;
  const consider = (t: RenameTarget | null) => {
    if (t && offset >= t.from && offset <= t.to && (!best || t.to - t.from <= best.to - best.from)) best = t;
  };
  for (const t of d.tables) {
    if (!inside(t.span)) continue;
    consider(targetForDecl(d, text, t.span!.from));
    for (const c of t.columns) if (inside(c.span)) consider(targetForDecl(d, text, c.span!.from));
  }
  for (const e of d.enums) {
    if (!inside(e.span)) continue;
    consider(targetForDecl(d, text, e.span!.from));
    for (const v of e.values) if (inside(v.span)) consider(targetForDecl(d, text, v.span!.from));
  }
  for (const g of d.groups) if (inside(g.span)) consider(targetForDecl(d, text, g.span!.from));
  return best;
}

/** `null` se o nome serve; senão o motivo. */
export function checkName(name: string): string | null {
  if (name.trim() === "") return "O nome não pode ficar vazio.";
  if (/[\r\n\t]/.test(name)) return "O nome não pode ter quebra de linha nem tab.";
  return null;
}

/** Como o nome entra no texto: sem aspas quando é um identificador simples. */
export const quoteName = (name: string) => (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name) ? name : `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);

/** Trocas linha a linha entre dois textos de mesmo número de linhas (o que um renome produz). */
export function lineChanges(old: string, next: string): TextChange[] {
  const a = old.split("\n");
  const b = next.split("\n");
  if (a.length !== b.length) {
    let from = 0;
    const max = Math.min(old.length, next.length);
    while (from < max && old[from] === next[from]) from++;
    let tail = 0;
    while (tail < max - from && old[old.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
    return from === old.length - tail && from === next.length - tail ? [] : [{ from, to: old.length - tail, insert: next.slice(from, next.length - tail) }];
  }
  const out: TextChange[] = [];
  let pos = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      const x = a[i];
      const y = b[i];
      let p = 0;
      const max = Math.min(x.length, y.length);
      while (p < max && x[p] === y[p]) p++;
      let q = 0;
      while (q < max - p && x[x.length - 1 - q] === y[y.length - 1 - q]) q++;
      out.push({ from: pos + p, to: pos + x.length - q, insert: y.slice(p, y.length - q) });
    }
    pos += a[i].length + 1;
  }
  return out;
}

export function applyChanges(text: string, changes: TextChange[]): string {
  let out = "";
  let at = 0;
  for (const c of [...changes].sort((x, y) => x.from - y.from)) {
    out += text.slice(at, c.from) + c.insert;
    at = c.to;
  }
  return out + text.slice(at);
}

/** As trocas que renomeiam `target` para `newName`, ou o motivo de não dar. */
export function renameChanges(svc: DbmlService, d: Diagram, text: string, target: RenameTarget, newName: string): RenameResult | { error: string } {
  const bad = checkName(newName);
  if (bad) return { error: bad };
  const t = target.table;
  let result: RenameResult;

  if (target.kind === "table") {
    if (!t) return { error: "Tabela não encontrada." };
    // o campo mostra o nome completo (`esquema.tabela`): escrever outro esquema também o troca
    // (só o nome, sem ponto, mantém o esquema de agora)
    const fromSchema = t.schema ?? undefined;
    const parts = new RegExp(String.raw`^(${IDENT})\s*\.\s*(${IDENT})$`).exec(newName.trim());
    if (!parts && newName.includes(".") && !newName.trim().startsWith('"')) return { error: "Nome inválido: use `tabela` ou `esquema.tabela`." };
    const toSchema = parts ? unquote(parts[1]) : fromSchema;
    const toTable = parts ? unquote(parts[2]) : unquote(newName.trim());
    if (toSchema === fromSchema && toTable === t.name) return { error: "O nome é o mesmo." };
    if (d.tables.some((x) => x !== t && x.id === tableId(toSchema, toTable))) return { error: `Já existe a tabela "${newName.trim()}".` };
    const next = svc.renameTable(text, { schema: fromSchema, table: t.name }, { schema: toSchema, table: toTable });
    if (next === null) return { error: "Não foi possível renomear a tabela." };
    result = { changes: lineChanges(text, next), renamedTable: { from: t.id, to: tableId(toSchema, toTable) } };
  } else {
    if (newName === target.name) return { error: "O nome é o mesmo." };
    if (target.kind === "column" && t?.columns.some((c) => c.name === newName)) return { error: `Já existe a coluna "${newName}" nesta tabela.` };
    if (target.kind === "enum" && d.enums.some((e) => e.name === newName)) return { error: `Já existe o enum "${newName}".` };
    if (target.kind === "value") {
      const owner = d.enums.find((e) => e.values.some((v) => v.span?.from === target.decl));
      if (owner?.values.some((v) => v.name === newName)) return { error: `Já existe o valor "${newName}" neste enum.` };
    }
    if (target.kind === "group" && d.groups.some((g) => g.name === newName)) return { error: `Já existe o grupo "${newName}".` };
    const sites = new Map<number, number>([[target.from, target.to]]);
    // o provider, sem usos do símbolo, às vezes devolve os do elemento que o contém: só vale o trecho que é o nome
    for (const r of svc.references(text, target.from + 1)) if (r.to > r.from && unquote(text.slice(r.from, r.to)) === target.name) sites.set(r.from, r.to);
    const insert = quoteName(newName);
    result = { changes: [...sites].map(([from, to]) => ({ from, to, insert })) };
    if (target.kind === "group") result.renamedGroup = { from: target.name, to: newName };
  }

  const bad2 = verifyChanges(svc, d, text, result.changes);
  if (bad2) return { error: bad2 };
  return result;
}

/**
 * Rede de segurança de toda edição pelo diagrama ou pelo renome: o texto novo tem de continuar um DBML
 * válido, com as mesmas tabelas, colunas, enums, grupos e relações. Devolve o motivo, ou `null` se serve.
 */
export function verifyChanges(svc: DbmlService, d: Diagram, text: string, changes: TextChange[]): string | null {
  const parsed = parseDbml(svc.interpret, applyChanges(text, changes));
  if (!parsed.diagram) return "A alteração deixaria o DBML inválido; nada foi alterado.";
  const n = (x: Diagram) => [x.tables.length, x.tables.reduce((s, y) => s + y.columns.length, 0), x.enums.length, x.groups.length, x.refs.length].join(",");
  if (n(parsed.diagram) !== n(d)) return "A alteração mudaria a estrutura do esquema; nada foi alterado.";
  return null;
}
