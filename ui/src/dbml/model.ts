/**
 * Modelo mínimo do diagrama, derivado do `rawDb()` do @dbml/parse. Sem dependência de DOM.
 * `rawDb().refs` já traz também os refs inline (`[ref: > t.c]`), então só ele é lido.
 */

export interface Column {
  name: string;
  type: string;
  pk: boolean;
  notNull: boolean;
  unique: boolean;
}

export interface DTable {
  id: string;
  schema: string | null;
  name: string;
  columns: Column[];
}

export type Card = "1" | "*";

export interface Endpoint {
  table: string; // id da tabela
  column: string;
  card: Card;
}

export interface DRef {
  from: Endpoint;
  to: Endpoint;
}

export interface Diagram {
  tables: DTable[];
  refs: DRef[];
}

export interface ParseError {
  message: string;
  line: number; // 1-based
  column: number; // 1-based
}

export type ParseResult = { diagram: Diagram; error?: undefined } | { diagram?: undefined; error: ParseError };

// ---- formato bruto do parser (só o que usamos) ----

interface RawEndpoint {
  schemaName?: string | null;
  tableName: string;
  fieldNames?: string[];
  relation: string;
}
interface RawField {
  name: string;
  type?: { type_name?: string };
  pk?: boolean;
  not_null?: boolean;
  unique?: boolean;
}
interface RawTable {
  name: string;
  schemaName?: string | null;
  fields?: RawField[];
}
export interface RawDb {
  tables?: RawTable[];
  refs?: { endpoints?: RawEndpoint[] }[];
  aliases?: { name: string; kind: string; value: { tableName: string; schemaName?: string | null } }[];
}

/** Mínimo do `Compiler` do @dbml/parse que precisamos (facilita testar e carregar sob demanda). */
export interface CompilerLike {
  setSource(src: string): void;
  parse: {
    rawDb(): RawDb | undefined;
    errors(): { diagnostic: string; nodeOrToken?: { startPos?: { line: number; column: number } } }[];
  };
}

export const tableId = (schema: string | null | undefined, name: string) => (schema ? `${schema}.${name}` : name);

const asCard = (r: string): Card => (r === "*" ? "*" : "1");

export function buildDiagram(raw: RawDb): Diagram {
  const tables: DTable[] = (raw.tables ?? []).map((t) => ({
    id: tableId(t.schemaName, t.name),
    schema: t.schemaName ?? null,
    name: t.name,
    columns: (t.fields ?? []).map((f) => ({
      name: f.name,
      type: f.type?.type_name ?? "", // já inclui os argumentos, ex.: varchar(80)
      pk: !!f.pk,
      notNull: !!f.not_null,
      unique: !!f.unique,
    })),
  }));
  const ids = new Set(tables.map((t) => t.id));
  const aliases = new Map<string, string>();
  for (const a of raw.aliases ?? []) {
    if (a.kind === "table") aliases.set(a.name, tableId(a.value.schemaName, a.value.tableName));
  }
  const resolve = (e: RawEndpoint): string | null => {
    const direct = tableId(e.schemaName, e.tableName);
    if (ids.has(direct)) return direct;
    const viaAlias = !e.schemaName ? aliases.get(e.tableName) : undefined;
    return viaAlias && ids.has(viaAlias) ? viaAlias : null;
  };

  const refs: DRef[] = [];
  const push = (a: RawEndpoint, ca: Card, b: RawEndpoint, cb: Card) => {
    const ta = resolve(a);
    const tb = resolve(b);
    const colA = a.fieldNames?.[0];
    const colB = b.fieldNames?.[0];
    if (!ta || !tb || !colA || !colB) return;
    refs.push({ from: { table: ta, column: colA, card: ca }, to: { table: tb, column: colB, card: cb } });
  };

  for (const r of raw.refs ?? []) {
    const [a, b] = r.endpoints ?? [];
    if (a && b) push(a, asCard(a.relation), b, asCard(b.relation));
  }
  return { tables, refs };
}

/** Parseia o texto. Erros de sintaxe voltam como `error` (o chamador mantém o último diagrama válido). */
export function parseDbml(Compiler: new () => CompilerLike, text: string): ParseResult {
  const c = new Compiler();
  c.setSource(text);
  const errors = c.parse.errors();
  if (errors.length > 0) {
    const e = errors[0];
    const pos = e.nodeOrToken?.startPos;
    return { error: { message: e.diagnostic, line: (pos?.line ?? 0) + 1, column: (pos?.column ?? 0) + 1 } };
  }
  const raw = c.parse.rawDb();
  if (!raw) return { error: { message: "Não foi possível interpretar o DBML.", line: 1, column: 1 } };
  return { diagram: buildDiagram(raw) };
}
