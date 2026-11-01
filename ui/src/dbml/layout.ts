import { type Diagram, enumOf } from "./model";

export const HEADER_H = 30;
export const ROW_H = 22;
const CHAR_W = 7.4;
const PAD_X = 24;
const MIN_W = 170;
const GROUP_PAD = 12;
const GROUP_LABEL_H = 14;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const enumKey = (id: string) => `enum:${id}`;
export const groupKey = (name: string) => `group:${name}`;

export interface Layout {
  /** Tabelas (por id), enums (`enum:<id>`) e grupos (`group:<nome>`, a moldura que os envolve). */
  boxes: Map<string, Box>;
  width: number;
  height: number;
}

/** Subconjunto do @dagrejs/dagre que usamos (injetado: o módulo só carrega sob demanda). */
export interface DagreLike {
  graphlib: { Graph: new (opts?: { compound?: boolean }) => GraphLike };
  layout(g: GraphLike): void;
}
interface GraphLike {
  setGraph(o: object): void;
  setParent(child: string, parent: string): void;
  setDefaultEdgeLabel(f: () => object): void;
  setNode(id: string, o: { width: number; height: number }): void;
  setEdge(a: string, b: string): void;
  node(id: string): { x: number; y: number };
  graph(): { width?: number; height?: number };
}

export function tableSize(t: Diagram["tables"][number]): { w: number; h: number } {
  let chars = t.name.length + (t.schema ? t.schema.length + 1 : 0);
  for (const c of t.columns) chars = Math.max(chars, c.name.length + c.type.length + 4);
  return { w: Math.max(MIN_W, Math.ceil(chars * CHAR_W) + PAD_X), h: HEADER_H + Math.max(1, t.columns.length) * ROW_H };
}

export function enumSize(e: Diagram["enums"][number]): { w: number; h: number } {
  let chars = e.name.length + 5;
  for (const v of e.values) chars = Math.max(chars, v.name.length + 2);
  return { w: Math.max(MIN_W - 40, Math.ceil(chars * CHAR_W) + PAD_X), h: HEADER_H + Math.max(1, e.values.length) * ROW_H };
}

export function layoutDiagram(d: Diagram, dagre: DagreLike): Layout {
  const g = new dagre.graphlib.Graph({ compound: true });
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 110, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  const sizes = new Map<string, { w: number; h: number }>();
  for (const t of d.tables) {
    const s = tableSize(t);
    sizes.set(t.id, s);
    g.setNode(t.id, { width: s.w, height: s.h });
  }
  for (const r of d.refs) if (r.from.table !== r.to.table) g.setEdge(r.from.table, r.to.table);

  // enums ficam ao lado de quem os usa (a aresta só serve para o dagre posicionar)
  const enumSizes = new Map<string, { w: number; h: number }>();
  for (const e of d.enums) {
    const s = enumSize(e);
    enumSizes.set(e.id, s);
    g.setNode(enumKey(e.id), { width: s.w, height: s.h });
    for (const t of d.tables) {
      if (t.columns.some((c) => enumOf(d.enums, c.type) === e)) g.setEdge(t.id, enumKey(e.id));
    }
  }

  // grupos: clusters do dagre; uma tabela em vários grupos fica só no primeiro
  const grouped = new Set<string>();
  for (const grp of d.groups) {
    const members = grp.tables.filter((id) => !grouped.has(id));
    if (members.length === 0) continue;
    g.setNode(groupKey(grp.name), {} as { width: number; height: number });
    for (const id of members) {
      grouped.add(id);
      g.setParent(id, groupKey(grp.name));
    }
  }
  dagre.layout(g);

  const boxes = new Map<string, Box>();
  for (const t of d.tables) {
    const n = g.node(t.id);
    const s = sizes.get(t.id)!;
    boxes.set(t.id, { x: Math.round(n.x - s.w / 2), y: Math.round(n.y - s.h / 2), w: s.w, h: s.h });
  }
  for (const e of d.enums) {
    const n = g.node(enumKey(e.id));
    const s = enumSizes.get(e.id)!;
    boxes.set(enumKey(e.id), { x: Math.round(n.x - s.w / 2), y: Math.round(n.y - s.h / 2), w: s.w, h: s.h });
  }
  for (const grp of d.groups) {
    const n = g.node(groupKey(grp.name)) as { x: number; y: number; width: number; height: number } | undefined;
    if (!n || !n.width) continue;
    // folga em volta, e mais em cima para o rótulo do grupo não cobrir a primeira tabela
    boxes.set(groupKey(grp.name), {
      x: Math.round(n.x - n.width / 2) - GROUP_PAD,
      y: Math.round(n.y - n.height / 2) - GROUP_PAD - GROUP_LABEL_H,
      w: Math.round(n.width) + GROUP_PAD * 2,
      h: Math.round(n.height) + GROUP_PAD * 2 + GROUP_LABEL_H,
    });
  }
  const gr = g.graph();
  return { boxes, width: gr.width ?? 0, height: gr.height ?? 0 };
}
