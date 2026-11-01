import { HEADER_H, type Layout, ROW_H } from "./layout";
import type { DRef, DTable, Diagram, Endpoint } from "./model";

const NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  text?: string,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

function rowY(t: DTable, y: number, column: string): number {
  const i = Math.max(0, t.columns.findIndex((c) => c.name === column));
  return y + HEADER_H + i * ROW_H + ROW_H / 2;
}

function edge(ref: DRef, byId: Map<string, DTable>, layout: Layout): SVGGElement | null {
  const ta = byId.get(ref.from.table);
  const tb = byId.get(ref.to.table);
  const a = layout.boxes.get(ref.from.table);
  const b = layout.boxes.get(ref.to.table);
  if (!ta || !tb || !a || !b) return null;
  const ya = rowY(ta, a.y, ref.from.column);
  const yb = rowY(tb, b.y, ref.to.column);

  // lado de saída/entrada e o sentido (+1 = direita) em cada ponta
  let xa: number, xb: number, da: 1 | -1, db: 1 | -1, d: string;
  if (ref.from.table === ref.to.table) {
    xa = xb = a.x + a.w;
    da = db = 1;
    d = `M${xa},${ya} H${xa + 30} V${yb} H${xb}`;
  } else if (a.x + a.w <= b.x) {
    xa = a.x + a.w;
    xb = b.x;
    da = 1;
    db = -1;
    const mid = Math.round((xa + xb) / 2);
    d = `M${xa},${ya} H${mid} V${yb} H${xb}`;
  } else if (b.x + b.w <= a.x) {
    xa = a.x;
    xb = b.x + b.w;
    da = -1;
    db = 1;
    const mid = Math.round((xa + xb) / 2);
    d = `M${xa},${ya} H${mid} V${yb} H${xb}`;
  } else {
    xa = a.x + a.w;
    xb = b.x + b.w;
    da = db = 1;
    const out = Math.max(xa, xb) + 30;
    d = `M${xa},${ya} H${out} V${yb} H${xb}`;
  }

  const g = el("g", { class: "dbml-edge" });
  g.append(el("path", { d }));
  const label = (e: Endpoint, x: number, y: number, dir: 1 | -1) =>
    el("text", { x: x + dir * 6, y: y - 4, "text-anchor": dir === 1 ? "start" : "end" }, e.card === "*" ? "n" : "1");
  g.append(label(ref.from, xa, ya, da), label(ref.to, xb, yb, db));
  return g;
}

function tableNode(t: DTable, x: number, y: number, w: number, h: number): SVGGElement {
  const g = el("g", { class: "dbml-table", transform: `translate(${x} ${y})` });
  g.append(el("rect", { class: "dbml-box", width: w, height: h, rx: 6 }));
  g.append(el("path", { class: "dbml-head", d: `M0,${HEADER_H} V6 a6,6 0 0 1 6,-6 H${w - 6} a6,6 0 0 1 6,6 V${HEADER_H} Z` }));
  g.append(el("text", { class: "dbml-title", x: 10, y: HEADER_H / 2 + 5 }, t.schema ? `${t.schema}.${t.name}` : t.name));
  t.columns.forEach((c, i) => {
    const cy = HEADER_H + i * ROW_H + ROW_H / 2 + 4;
    g.append(el("text", { class: c.pk ? "dbml-col dbml-pk" : "dbml-col", x: 10, y: cy }, c.name));
    g.append(el("text", { class: "dbml-type", x: w - 10, y: cy, "text-anchor": "end" }, c.type));
  });
  return g;
}

/** Desenha o diagrama dentro de um `<g>` (o chamador aplica pan/zoom nele). */
export function renderDiagram(d: Diagram, layout: Layout, into: SVGGElement) {
  const byId = new Map(d.tables.map((t) => [t.id, t]));
  const edges = d.refs.map((r) => edge(r, byId, layout)).filter((e): e is SVGGElement => e !== null);
  const tables = d.tables.map((t) => {
    const b = layout.boxes.get(t.id)!;
    return tableNode(t, b.x, b.y, b.w, b.h);
  });
  into.replaceChildren(...edges, ...tables); // arestas por baixo das tabelas
}
