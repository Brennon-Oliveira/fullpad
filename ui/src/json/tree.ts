/**
 * Árvore do JSON, sem DOM: o Rust (`crates/core/src/json.rs`) devolve os nós em pré-ordem e aqui só
 * se decide o que está visível, o caminho de cada nó e qual nó está sob uma posição do texto.
 */

export type Kind = "object" | "array" | "string" | "number" | "bool" | "null";
export type Hint = "url" | "mail" | "image" | "image-data" | "image-local" | "color";

export interface JNode {
  /** Índice do pai (-1 na raiz). */
  parent: number;
  kind: Kind;
  /** Nome do membro, quando o pai é objeto. */
  key?: string;
  /** Início da chave (UTF-16). */
  kfrom?: number;
  from: number;
  to: number;
  /** Índice logo depois do último descendente. */
  end: number;
  /** Filhos diretos. */
  len: number;
  text?: string;
  cut?: boolean;
  hint?: Hint;
}

export interface JsonError {
  message: string;
  line: number;
  col: number;
  from: number;
  to: number;
}

export interface JsonDoc {
  nodes: JNode[];
  too_big: boolean;
  total: number;
}

export interface Analysis {
  doc: JsonDoc | null;
  error: JsonError | null;
}

export interface Row {
  id: number;
  depth: number;
  /** Posição entre os irmãos (índice do item numa lista). */
  idx: number;
}

export const isContainer = (n: JNode) => n.kind === "object" || n.kind === "array";

/** Linhas visíveis, em ordem, dado o conjunto de contêineres abertos. Iterativo (aninhamento fundo). */
export function visibleRows(nodes: JNode[], expanded: ReadonlySet<number>): Row[] {
  const rows: Row[] = [];
  if (nodes.length === 0) return rows;
  const stack: Row[] = [{ id: 0, depth: 0, idx: 0 }];
  while (stack.length) {
    const r = stack.pop()!;
    rows.push(r);
    const n = nodes[r.id];
    if (!isContainer(n) || n.len === 0 || !expanded.has(r.id)) continue;
    // empilha os filhos de trás para frente: o primeiro sai antes
    const kids: number[] = [];
    for (let c = r.id + 1; c < n.end; c = nodes[c].end) kids.push(c);
    for (let k = kids.length - 1; k >= 0; k--) stack.push({ id: kids[k], depth: r.depth + 1, idx: k });
  }
  return rows;
}

/** Contêineres não vazios até `levels` níveis de profundidade (a raiz é o nível 0). */
export function defaultExpanded(nodes: JNode[], levels = 2): Set<number> {
  const out = new Set<number>();
  if (nodes.length === 0) return out;
  const stack: [number, number][] = [[0, 0]];
  while (stack.length) {
    const [id, depth] = stack.pop()!;
    const n = nodes[id];
    if (!isContainer(n) || n.len === 0 || depth >= levels) continue;
    out.add(id);
    for (let c = id + 1; c < n.end; c = nodes[c].end) stack.push([c, depth + 1]);
  }
  return out;
}

/** Todos os contêineres não vazios de `id` para baixo (inclusive). */
export function subtreeContainers(nodes: JNode[], id: number): number[] {
  const out: number[] = [];
  for (let i = id; i < nodes[id].end; i++) if (isContainer(nodes[i]) && nodes[i].len > 0) out.push(i);
  return out;
}

/** Os pais de `id`, do mais próximo da raiz ao mais próximo do nó (sem o próprio nó). */
export function ancestors(nodes: JNode[], id: number): number[] {
  const out: number[] = [];
  for (let p = nodes[id].parent; p >= 0; p = nodes[p].parent) out.push(p);
  return out.reverse();
}

/** Posição do nó entre os irmãos. */
export function indexInParent(nodes: JNode[], id: number): number {
  const p = nodes[id].parent;
  if (p < 0) return 0;
  let idx = 0;
  for (let c = p + 1; c < id; c = nodes[c].end) idx++;
  return idx;
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** Caminho no estilo JSONPath: `$.lista[0].tags[1]` e `$["chave com espaço"]`. */
export function pathOf(nodes: JNode[], id: number): string {
  const parts: string[] = [];
  for (let i = id; i >= 0 && nodes[i].parent >= 0; i = nodes[i].parent) {
    const n = nodes[i];
    if (nodes[n.parent].kind === "array") parts.push(`[${indexInParent(nodes, i)}]`);
    else parts.push(n.key !== undefined && IDENT.test(n.key) ? `.${n.key}` : `[${JSON.stringify(n.key ?? "")}]`);
  }
  return "$" + parts.reverse().join("");
}

/** Trecho do texto que o nó ocupa, com a chave quando há (é o que se destaca no código). */
export function spanOf(n: JNode): { from: number; to: number } {
  return { from: n.kfrom ?? n.from, to: n.to };
}

/** O nó mais fundo cujo trecho contém `pos`, ou -1 (cursor antes do valor raiz ou depois dele). */
export function nodeAt(nodes: JNode[], pos: number): number {
  if (nodes.length === 0) return -1;
  const start = (i: number) => nodes[i].kfrom ?? nodes[i].from;
  let lo = 0;
  let hi = nodes.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (start(mid) <= pos) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  let i = found;
  while (i >= 0 && pos > nodes[i].to) i = nodes[i].parent;
  return i;
}

/** Chave de cada nó para reencontrá-lo depois de uma edição (caminho com índices de lista). */
export function pathKeys(nodes: JNode[]): string[] {
  const keys: string[] = new Array(nodes.length);
  const counters: number[] = new Array(nodes.length).fill(0);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.parent < 0) {
      keys[i] = "";
      continue;
    }
    const seg = nodes[n.parent].kind === "array" ? `[${counters[n.parent]}]` : `.${JSON.stringify(n.key ?? "")}#${counters[n.parent]}`;
    counters[n.parent]++;
    keys[i] = keys[n.parent] + seg;
  }
  return keys;
}

/** Texto curto do valor para a linha (strings com aspas; coleções resumidas). */
export function valueLabel(n: JNode): string {
  switch (n.kind) {
    case "object":
      return n.len === 0 ? "{}" : `{${n.len}}`;
    case "array":
      return n.len === 0 ? "[]" : `[${n.len}]`;
    case "string":
      return `"${n.text ?? ""}"${n.cut ? "…" : ""}`;
    default:
      return n.text ?? "";
  }
}
