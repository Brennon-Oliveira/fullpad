/** Lógica pura do sumário lateral: itens da árvore de JSON/YAML/TOML e o item "atual" pela posição. Sem DOM. */
import type { JNode } from "./json/tree";
import { isContainer } from "./json/tree";

export interface OutlineItem {
  label: string;
  /** Posição (UTF-16) onde o cursor vai. */
  pos: number;
  /** Nível: 0 é o mais externo. */
  depth: number;
}

const MAX_ITEMS = 400;
const MAX_DEPTH = 3;

/** Objetos e listas da árvore até 3 níveis (sem a raiz), com o nome da chave ou `[n]` na lista. */
export function treeOutline(nodes: JNode[]): OutlineItem[] {
  const out: OutlineItem[] = [];
  const depth: number[] = new Array(nodes.length).fill(0);
  const counters: number[] = new Array(nodes.length).fill(0);
  for (let i = 1; i < nodes.length && out.length < MAX_ITEMS; i++) {
    const n = nodes[i];
    depth[i] = depth[n.parent] + 1;
    const idx = counters[n.parent]++;
    if (!isContainer(n) || depth[i] > MAX_DEPTH) continue;
    const label = nodes[n.parent].kind === "array" ? `[${idx}]` : (n.key ?? "");
    out.push({ label, pos: n.kfrom ?? n.from, depth: depth[i] - 1 });
  }
  return out;
}

/** Índice do item "atual": o último que começa na posição do topo da tela ou antes (o primeiro, se ainda não chegou a nenhum). */
export function activeIndex(items: readonly { pos: number }[], topPos: number): number {
  let lo = 0;
  let hi = items.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].pos <= topPos) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Itens da faixa de barrinhas: no máximo `max`; sendo mais, só os do nível mais externo que houver. */
export function railItems<T extends { depth: number }>(items: readonly T[], max = 40): T[] {
  if (items.length <= max) return [...items];
  const shallow = Math.min(...items.map((i) => i.depth));
  return items.filter((i) => i.depth === shallow).slice(0, max);
}
