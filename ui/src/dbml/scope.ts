/**
 * Escopo do diagrama: ver só um arquivo (de um `!include`) ou só um grupo de tabelas. O que fica de fora não é
 * desenhado; as tabelas que ficam e têm relação com o que saiu ganham a marca de "externos" (`DTable.external`).
 * Puro: filtra um `Diagram` já montado, sem DOM e sem o parser.
 */
import { type Diagram, type DTable, enumOf } from "./model";

export type DiagramScope = { kind: "all" } | { kind: "file"; file: string | null } | { kind: "group"; name: string };

export const ALL_SCOPE: DiagramScope = { kind: "all" };

export const sameScope = (a: DiagramScope, b: DiagramScope) => JSON.stringify(a) === JSON.stringify(b);

/** O que se pode escolher para ver, a partir do diagrama completo. `files` não inclui o próprio arquivo (`null`). */
export function scopeChoices(d: Diagram): { files: string[]; groups: string[] } {
  const files = new Set<string>();
  for (const t of d.tables) if (t.file) files.add(t.file);
  for (const e of d.enums) if (e.file) files.add(e.file);
  return { files: [...files], groups: d.groups.map((g) => g.name) };
}

/** Lê um escopo guardado: o que não existe mais no diagrama (arquivo ou grupo que sumiu) volta a "tudo". */
export function validScope(s: DiagramScope, d: Diagram): DiagramScope {
  const c = scopeChoices(d);
  if (s.kind === "file") return s.file === null || c.files.includes(s.file) ? s : ALL_SCOPE;
  if (s.kind === "group") return c.groups.includes(s.name) ? s : ALL_SCOPE;
  return ALL_SCOPE;
}

/** O diagrama só com o escopo. As relações com o que ficou de fora viram `external` na tabela que fica. */
export function scopeDiagram(d: Diagram, scope: DiagramScope): Diagram {
  if (scope.kind === "all") return d;
  const inGroup = scope.kind === "group" ? new Set(d.groups.find((g) => g.name === scope.name)?.tables ?? []) : null;
  const keep = (t: DTable) => (scope.kind === "file" ? (t.file ?? null) === scope.file : inGroup!.has(t.id));
  const kept = d.tables.filter(keep);
  const ids = new Set(kept.map((t) => t.id));
  const external = new Map<string, { count: number; targets: Map<string, string | undefined> }>();
  const note = (mine: string, other: string) => {
    const e = external.get(mine) ?? { count: 0, targets: new Map() };
    e.count++;
    e.targets.set(other, d.tables.find((t) => t.id === other)?.file);
    external.set(mine, e);
  };
  const refs = d.refs.filter((r) => {
    const a = ids.has(r.from.table);
    const b = ids.has(r.to.table);
    if (a && !b) note(r.from.table, r.to.table);
    else if (b && !a) note(r.to.table, r.from.table);
    return a && b;
  });
  const tables = kept.map((t) => {
    const e = external.get(t.id);
    return e ? { ...t, external: { count: e.count, targets: [...e.targets].map(([id, file]) => ({ id, file })) } } : t;
  });
  // enum: o do arquivo escolhido; num grupo, os que as tabelas do grupo usam
  const used = new Set(kept.flatMap((t) => t.columns.map((c) => enumOf(d.enums, c.type)?.id).filter((x): x is string => !!x)));
  const enums = d.enums.filter((e) => (scope.kind === "file" ? (e.file ?? null) === scope.file : used.has(e.id)));
  const groups = d.groups
    .filter((g) => scope.kind !== "group" || g.name === scope.name)
    .map((g) => ({ ...g, tables: g.tables.filter((id) => ids.has(id)) }))
    .filter((g) => g.tables.length > 0);
  return { tables, refs, enums, groups };
}

/** Texto do botão e dos itens. `own` é o nome do arquivo da aba. */
export function scopeLabel(s: DiagramScope, own: string): string {
  if (s.kind === "all") return "Tudo";
  if (s.kind === "file") return s.file ?? own;
  return `Grupo ${s.name}`;
}
