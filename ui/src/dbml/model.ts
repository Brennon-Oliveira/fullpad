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
  note?: string;
}

export interface DTable {
  id: string;
  schema: string | null;
  name: string;
  columns: Column[];
  note?: string;
  /** Cor do cabeçalho (`headercolor:`), como veio no texto. */
  color?: string;
}

export interface DEnum {
  id: string;
  schema: string | null;
  name: string;
  values: { name: string; note?: string }[];
}

export interface DGroup {
  name: string;
  color?: string;
  tables: string[]; // ids de tabela
}

export type Card = "1" | "*";

export interface Endpoint {
  table: string; // id da tabela
  column: string;
  card: Card;
  /** Texto na ponta da aresta: "1", "n", "0..1", "0..n", "1..n"... */
  label: string;
}

export interface DRef {
  from: Endpoint;
  to: Endpoint;
}

export interface Diagram {
  tables: DTable[];
  refs: DRef[];
  enums: DEnum[];
  groups: DGroup[];
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
  note?: { value?: string };
}
interface RawTable {
  name: string;
  schemaName?: string | null;
  fields?: RawField[];
  note?: { value?: string };
  headerColor?: string;
}
interface RawEnum {
  name: string;
  schemaName?: string | null;
  values?: { name: string; note?: { value?: string } }[];
}
interface RawGroup {
  name: string;
  color?: string;
  tables?: { name: string; schemaName?: string | null }[];
}
export interface RawDb {
  tables?: RawTable[];
  refs?: { endpoints?: RawEndpoint[] }[];
  enums?: RawEnum[];
  tableGroups?: RawGroup[];
  aliases?: { name: string; kind: string; value: { tableName: string; schemaName?: string | null } }[];
}

/** Resultado de interpretar um arquivo no @dbml/parse (só o que usamos). */
export interface Report {
  getValue(): RawDb | undefined;
  getErrors(): { diagnostic: string; nodeOrToken?: { startPos?: { line: number; column: number } } }[];
}
/** Interpreta um texto DBML. Quem chama monta isso com o `Compiler` do parser (carregado sob demanda). */
export type Interpreter = (text: string) => Report;

export const tableId = (schema: string | null | undefined, name: string) => (schema ? `${schema}.${name}` : name);

/**
 * Cardinalidade do parser: "1", "*", "0..1", "0..*", "1..*"... Devolve o lado (um/muitos) e o rótulo.
 * Os operadores opcionais (`?>`, `<?`, `?-?`) chegam como mínimo 0.
 */
export function cardinality(rel: string): { card: Card; label: string } {
  const [min, max] = rel.includes("..") ? rel.split("..") : [rel === "*" ? "" : rel, rel];
  const many = max === "*" || Number(max) > 1;
  const top = many ? "n" : max;
  return { card: many ? "*" : "1", label: min === "" || min === max ? top : `${min}..${top}` };
}

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
      note: f.note?.value,
    })),
    note: t.note?.value,
    color: t.headerColor,
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
  const push = (a: RawEndpoint, b: RawEndpoint) => {
    const ta = resolve(a);
    const tb = resolve(b);
    const colA = a.fieldNames?.[0];
    const colB = b.fieldNames?.[0];
    if (!ta || !tb || !colA || !colB) return;
    refs.push({ from: { table: ta, column: colA, ...cardinality(a.relation) }, to: { table: tb, column: colB, ...cardinality(b.relation) } });
  };

  for (const r of raw.refs ?? []) {
    const [a, b] = r.endpoints ?? [];
    if (a && b) push(a, b);
  }
  const enums: DEnum[] = (raw.enums ?? []).map((e) => ({
    id: tableId(e.schemaName, e.name),
    schema: e.schemaName ?? null,
    name: e.name,
    values: (e.values ?? []).map((v) => ({ name: v.name, note: v.note?.value })),
  }));
  const groups: DGroup[] = (raw.tableGroups ?? []).map((g) => ({
    name: g.name,
    color: g.color,
    tables: (g.tables ?? [])
      .map((t) => resolve({ schemaName: t.schemaName || null, tableName: t.name, relation: "" }))
      .filter((id): id is string => id !== null),
  }));
  return { tables, refs, enums, groups };
}

/** Parseia o texto. Erros de sintaxe voltam como `error` (o chamador mantém o último diagrama válido). */
export function parseDbml(interpret: Interpreter, text: string): ParseResult {
  const rep = interpret(text);
  const errors = rep.getErrors();
  if (errors.length > 0) {
    const e = errors[0];
    const pos = e.nodeOrToken?.startPos;
    return { error: { message: e.diagnostic, line: (pos?.line ?? 0) + 1, column: (pos?.column ?? 0) + 1 } };
  }
  const raw = rep.getValue();
  if (!raw) return { error: { message: "Não foi possível interpretar o DBML.", line: 1, column: 1 } };
  return { diagram: buildDiagram(raw) };
}
