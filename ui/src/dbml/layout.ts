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
  /** Tamanho da área do desenho, a partir de (`x0`, `y0`) (0, 0 se ninguém foi posto fora do dagre). */
  width: number;
  height: number;
  x0?: number;
  y0?: number;
}

/** Posição salva de uma tabela (canto de cima à esquerda), por id de tabela. */
export type SavedPositions = Record<string, { x: number; y: number }>;

/** Moldura guardada de um grupo (por nome), em coordenadas do diagrama. */
export type SavedGroups = Record<string, { x: number; y: number; width: number; height: number }>;

const MARGIN = 24;

/** Tabelas de cada grupo, por nome (uma tabela em vários grupos fica só no primeiro). */
export function groupMembers(d: Diagram, boxes: Map<string, Box>): Map<string, string[]> {
  const grouped = new Set<string>();
  const out = new Map<string, string[]>();
  for (const grp of d.groups) {
    const members = grp.tables.filter((id) => !grouped.has(id) && boxes.has(id));
    for (const id of grp.tables) grouped.add(id);
    if (members.length > 0) out.set(grp.name, members);
  }
  return out;
}

const validRect = (r: SavedGroups[string] | undefined): r is SavedGroups[string] =>
  !!r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;

/**
 * Recalcula as molduras dos grupos pelas caixas das tabelas. Uma moldura guardada só **aumenta** a
 * calculada (a união das duas): o grupo nunca fica menor que as tabelas que tem dentro.
 */
export function frameGroups(d: Diagram, boxes: Map<string, Box>, saved: SavedGroups = {}): void {
  for (const [name, members] of groupMembers(d, boxes)) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of members) {
      const b = boxes.get(id)!;
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w);
      y1 = Math.max(y1, b.y + b.h);
    }
    x0 -= GROUP_PAD;
    y0 -= GROUP_PAD + GROUP_LABEL_H;
    x1 += GROUP_PAD;
    y1 += GROUP_PAD;
    const r = Object.hasOwn(saved, name) ? saved[name] : undefined;
    if (validRect(r)) {
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.width);
      y1 = Math.max(y1, r.y + r.height);
    }
    boxes.set(groupKey(name), { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) });
  }
}

/** Ajusta `width`/`height`/`x0`/`y0` para caber todas as caixas (depois de mover tabelas). */
export function fitExtent(layout: Layout): void {
  let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
  for (const b of layout.boxes.values()) {
    x0 = Math.min(x0, b.x - MARGIN);
    y0 = Math.min(y0, b.y - MARGIN);
    x1 = Math.max(x1, b.x + b.w + MARGIN);
    y1 = Math.max(y1, b.y + b.h + MARGIN);
  }
  layout.x0 = x0;
  layout.y0 = y0;
  layout.width = x1 - x0;
  layout.height = y1 - y0;
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
  let chars = t.name.length + (t.schema ? t.schema.length + 1 : 0) + (t.note ? 3 : 0); // o ícone da nota ocupa o fim do cabeçalho
  for (const c of t.columns) chars = Math.max(chars, c.name.length + c.type.length + 4 + (c.note ? 3 : 0));
  return { w: Math.max(MIN_W, Math.ceil(chars * CHAR_W) + PAD_X), h: HEADER_H + Math.max(1, t.columns.length) * ROW_H };
}

export function enumSize(e: Diagram["enums"][number]): { w: number; h: number } {
  let chars = e.name.length + 5;
  for (const v of e.values) chars = Math.max(chars, v.name.length + 2);
  return { w: Math.max(MIN_W - 40, Math.ceil(chars * CHAR_W) + PAD_X), h: HEADER_H + Math.max(1, e.values.length) * ROW_H };
}

export function layoutDiagram(d: Diagram, dagre: DagreLike, saved: SavedPositions = {}, savedGroups: SavedGroups = {}): Layout {
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
  const layout: Layout = { boxes, width: gr.width ?? 0, height: gr.height ?? 0 };
  // posições salvas valem sobre o dagre: só as tabelas que têm posição (as outras ficam onde o dagre pôs)
  let moved = false;
  for (const t of d.tables) {
    const p = Object.hasOwn(saved, t.id) ? saved[t.id] : undefined;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const b = boxes.get(t.id)!;
    boxes.set(t.id, { ...b, x: Math.round(p.x), y: Math.round(p.y) });
    moved = true;
  }
  if (moved || Object.values(savedGroups).some(validRect)) {
    frameGroups(d, boxes, savedGroups);
    fitExtent(layout);
  }
  return layout;
}
