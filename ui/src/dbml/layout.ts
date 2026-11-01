import type { Diagram } from "./model";

export const HEADER_H = 30;
export const ROW_H = 22;
const CHAR_W = 7.4;
const PAD_X = 24;
const MIN_W = 170;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  boxes: Map<string, Box>;
  width: number;
  height: number;
}

/** Subconjunto do @dagrejs/dagre que usamos (injetado: o módulo só carrega sob demanda). */
export interface DagreLike {
  graphlib: { Graph: new () => GraphLike };
  layout(g: GraphLike): void;
}
interface GraphLike {
  setGraph(o: object): void;
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

export function layoutDiagram(d: Diagram, dagre: DagreLike): Layout {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 110, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  const sizes = new Map<string, { w: number; h: number }>();
  for (const t of d.tables) {
    const s = tableSize(t);
    sizes.set(t.id, s);
    g.setNode(t.id, { width: s.w, height: s.h });
  }
  for (const r of d.refs) if (r.from.table !== r.to.table) g.setEdge(r.from.table, r.to.table);
  dagre.layout(g);

  const boxes = new Map<string, Box>();
  for (const t of d.tables) {
    const n = g.node(t.id);
    const s = sizes.get(t.id)!;
    boxes.set(t.id, { x: Math.round(n.x - s.w / 2), y: Math.round(n.y - s.h / 2), w: s.w, h: s.h });
  }
  const gr = g.graph();
  return { boxes, width: gr.width ?? 0, height: gr.height ?? 0 };
}
