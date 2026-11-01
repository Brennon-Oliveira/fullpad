import { type Box, HEADER_H, type Layout, ROW_H, enumKey, groupKey } from "./layout";
import { type DEnum, type DGroup, type DRef, type DTable, type Diagram, type Endpoint, type Span, enumOf } from "./model";

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

/** Texto escuro ou claro por cima de uma cor de cabeçalho (#rgb / #rrggbb); `null` se não for hex. */
export function contrastOn(color: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111" : "#fff";
}

function withNote<T extends SVGElement>(e: T, note?: string): T {
  if (note) e.append(el("title", {}, note)); // tooltip nativo
  return e;
}

const colKey = (table: string, column: string) => `${table}\u001f${column}`;

function rowY(t: DTable, y: number, column: string): number {
  const i = Math.max(0, t.columns.findIndex((c) => c.name === column));
  return y + HEADER_H + i * ROW_H + ROW_H / 2;
}

interface Route {
  d: string;
  xa: number;
  xb: number;
  /** Sentido em cada ponta (+1 = a aresta sai/entra pela direita). */
  da: 1 | -1;
  db: 1 | -1;
}

/** Caminho ortogonal entre dois pontos de duas caixas, escolhendo o lado conforme a posição relativa. */
function route(a: Box, ya: number, b: Box, yb: number, same: boolean): Route {
  if (same) {
    const x = a.x + a.w;
    return { d: `M${x},${ya} H${x + 30} V${yb} H${x}`, xa: x, xb: x, da: 1, db: 1 };
  }
  if (a.x + a.w <= b.x) {
    const xa = a.x + a.w, xb = b.x, mid = Math.round((xa + xb) / 2);
    return { d: `M${xa},${ya} H${mid} V${yb} H${xb}`, xa, xb, da: 1, db: -1 };
  }
  if (b.x + b.w <= a.x) {
    const xa = a.x, xb = b.x + b.w, mid = Math.round((xa + xb) / 2);
    return { d: `M${xa},${ya} H${mid} V${yb} H${xb}`, xa, xb, da: -1, db: 1 };
  }
  const xa = a.x + a.w, xb = b.x + b.w, out = Math.max(xa, xb) + 30;
  return { d: `M${xa},${ya} H${out} V${yb} H${xb}`, xa, xb, da: 1, db: 1 };
}

/** Ligação tracejada da coluna que usa um enum até a caixa do enum. */
function enumLink(t: DTable, col: string, ya: number, a: Box, enumId: string, b: Box): SVGGElement {
  const { d } = route(a, ya, b, b.y + HEADER_H / 2, false);
  const g = el("g", { class: "dbml-edge dbml-enumlink", "data-a": colKey(t.id, col), "data-b": enumKey(enumId) });
  g.append(el("path", { d }), el("path", { d, class: "dbml-hit" }));
  return g;
}

function edge(ref: DRef, byId: Map<string, DTable>, layout: Layout): SVGGElement | null {
  const ta = byId.get(ref.from.table);
  const tb = byId.get(ref.to.table);
  const a = layout.boxes.get(ref.from.table);
  const b = layout.boxes.get(ref.to.table);
  if (!ta || !tb || !a || !b) return null;
  const ya = rowY(ta, a.y, ref.from.column);
  const yb = rowY(tb, b.y, ref.to.column);
  const { d, xa, xb, da, db } = route(a, ya, b, yb, ref.from.table === ref.to.table);

  const g = el("g", { class: "dbml-edge", "data-a": colKey(ref.from.table, ref.from.column), "data-b": colKey(ref.to.table, ref.to.column) });
  g.append(el("path", { d }), el("path", { d, class: "dbml-hit" })); // o 2º é uma área de hover mais larga
  const label = (e: Endpoint, x: number, y: number, dir: 1 | -1) =>
    el("text", { x: x + dir * 6, y: y - 4, "text-anchor": dir === 1 ? "start" : "end" }, e.label);
  g.append(label(ref.from, xa, ya, da), label(ref.to, xb, yb, db));
  return g;
}

function tableNode(t: DTable, x: number, y: number, w: number, h: number): SVGGElement {
  const g = el("g", { class: "dbml-table", "data-t": t.id, transform: `translate(${x} ${y})` });
  g.append(el("rect", { class: "dbml-box", width: w, height: h, rx: 6 }));
  const head = el("path", { class: "dbml-head", d: `M0,${HEADER_H} V6 a6,6 0 0 1 6,-6 H${w - 6} a6,6 0 0 1 6,6 V${HEADER_H} Z` });
  const ink = t.color ? contrastOn(t.color) : null;
  if (t.color && ink) head.setAttribute("style", `fill:${t.color}`);
  g.append(head);
  const title = el("text", { class: "dbml-title", x: 10, y: HEADER_H / 2 + 5 }, t.schema ? `${t.schema}.${t.name}` : t.name);
  if (ink) title.setAttribute("style", `fill:${ink}`);
  g.append(withNote(title, t.note));
  t.columns.forEach((c, i) => {
    const cy = HEADER_H + i * ROW_H + ROW_H / 2 + 4;
    g.append(el("rect", { class: "dbml-row", "data-k": colKey(t.id, c.name), x: 1, y: HEADER_H + i * ROW_H, width: w - 2, height: ROW_H }));
    g.append(withNote(el("text", { class: c.pk ? "dbml-col dbml-pk" : "dbml-col", x: 10, y: cy }, c.name), c.note));
    g.append(el("text", { class: "dbml-type", x: w - 10, y: cy, "text-anchor": "end" }, c.type));
  });
  return g;
}

function enumNode(e: DEnum, x: number, y: number, w: number, h: number): SVGGElement {
  const g = el("g", { class: "dbml-enum", "data-e": enumKey(e.id), transform: `translate(${x} ${y})` });
  g.append(el("rect", { class: "dbml-box", width: w, height: h, rx: 6 }));
  g.append(el("path", { class: "dbml-head dbml-enum-head", d: `M0,${HEADER_H} V6 a6,6 0 0 1 6,-6 H${w - 6} a6,6 0 0 1 6,6 V${HEADER_H} Z` }));
  g.append(el("text", { class: "dbml-title", x: 10, y: HEADER_H / 2 + 5 }, `enum ${e.schema ? `${e.schema}.` : ""}${e.name}`));
  e.values.forEach((v, i) => {
    g.append(el("rect", { class: "dbml-vrow", "data-v": colKey(enumKey(e.id), v.name), x: 1, y: HEADER_H + i * ROW_H, width: w - 2, height: ROW_H }));
    g.append(withNote(el("text", { class: "dbml-col", x: 10, y: HEADER_H + i * ROW_H + ROW_H / 2 + 4 }, v.name), v.note));
  });
  return g;
}

function groupFrame(grp: DGroup, b: { x: number; y: number; w: number; h: number }): SVGGElement {
  const g = el("g", { class: "dbml-group" });
  const color = grp.color && contrastOn(grp.color) ? grp.color : null;
  const rect = el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 10 });
  if (color) rect.setAttribute("style", `fill:${color}1f;stroke:${color}`);
  g.append(rect, el("text", { x: b.x + 12, y: b.y + 17 }, grp.name));
  return g;
}

export interface RenderHooks {
  /** Mouse sobre um elemento: trechos do texto que ele representa (`null` ao sair). */
  onHover?(spans: Span[] | null): void;
}

export interface Rendered {
  /**
   * Destaca o elemento que corresponde a `offset` (o cursor do editor); `null` limpa.
   * Devolve a caixa dele (coordenadas do layout) para quem quiser trazê-lo à vista.
   */
  focusAt(offset: number | null): Box | null;
}

type Kind = "row" | "edge" | "table" | "enum" | "value" | "group";
interface Entry {
  kind: Kind;
  el: SVGElement;
  span: Span;
  box: Box;
  /** Chaves de coluna ligadas ao elemento (linha: ela mesma; aresta: as duas pontas). */
  keys: string[];
}

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/** Só a 1ª linha de um bloco (`Table x {`): é o que o hover aponta no código, sem pintar o bloco todo. */
const head = (s: Span): Span => ({ from: s.from, to: s.from });

/** Desenha o diagrama dentro de um `<g>` (o chamador aplica pan/zoom nele). */
export function renderDiagram(d: Diagram, layout: Layout, into: SVGGElement, hooks: RenderHooks = {}): Rendered {
  const byId = new Map(d.tables.map((t) => [t.id, t]));
  const edges = d.refs.map((r) => ({ r, g: edge(r, byId, layout) })).filter((e): e is { r: DRef; g: SVGGElement } => e.g !== null);
  const links = d.tables.flatMap((t) => {
    const tb = layout.boxes.get(t.id)!;
    return t.columns.flatMap((c) => {
      const en = enumOf(d.enums, c.type);
      const eb = en && layout.boxes.get(enumKey(en.id));
      return en && eb ? [enumLink(t, c.name, rowY(t, tb.y, c.name), tb, en.id, eb)] : [];
    });
  });
  const tables = d.tables.map((t) => {
    const b = layout.boxes.get(t.id)!;
    return tableNode(t, b.x, b.y, b.w, b.h);
  });
  const enums = d.enums.map((e) => {
    const b = layout.boxes.get(enumKey(e.id))!;
    return enumNode(e, b.x, b.y, b.w, b.h);
  });
  const groups = d.groups.flatMap((grp) => {
    const b = layout.boxes.get(groupKey(grp.name));
    return b ? [{ grp, b, g: groupFrame(grp, b) }] : [];
  });
  into.replaceChildren(...groups.map((x) => x.g), ...links, ...edges.map((e) => e.g), ...tables, ...enums); // molduras no fundo, arestas sob as tabelas
  into.classList.remove("hovering", "focusing");

  // ---- onde cada elemento está no texto ----
  const entries: Entry[] = [];
  const rowByKey = new Map<string, SVGElement>();
  for (const row of into.querySelectorAll<SVGElement>(".dbml-row")) rowByKey.set(row.getAttribute("data-k")!, row);
  const tableEl = new Map<string, SVGElement>();
  for (const g of into.querySelectorAll<SVGElement>(".dbml-table, .dbml-enum")) tableEl.set(g.getAttribute("data-t") ?? g.getAttribute("data-e")!, g);
  const spanOfKey = new Map<string, Span>();
  const boxOfKey = new Map<string, Box>();

  for (const t of d.tables) {
    const b = layout.boxes.get(t.id)!;
    if (t.span) entries.push({ kind: "table", el: tableEl.get(t.id)!, span: t.span, box: b, keys: [] });
    t.columns.forEach((c, i) => {
      const k = colKey(t.id, c.name);
      const rb = { x: b.x, y: b.y + HEADER_H + i * ROW_H, w: b.w, h: ROW_H };
      boxOfKey.set(k, rb);
      if (!c.span) return;
      spanOfKey.set(k, c.span);
      entries.push({ kind: "row", el: rowByKey.get(k)!, span: c.span, box: rb, keys: [k] });
    });
  }
  for (const e of d.enums) {
    const id = enumKey(e.id);
    const b = layout.boxes.get(id)!;
    if (e.span) entries.push({ kind: "enum", el: tableEl.get(id)!, span: e.span, box: b, keys: [] });
    e.values.forEach((v, i) => {
      const el = into.querySelector<SVGElement>(`[data-v="${colKey(id, v.name)}"]`);
      if (v.span && el) entries.push({ kind: "value", el, span: v.span, box: { x: b.x, y: b.y + HEADER_H + i * ROW_H, w: b.w, h: ROW_H }, keys: [] });
    });
  }
  for (const { r, g } of edges) {
    if (!r.span) continue;
    const ka = colKey(r.from.table, r.from.column), kb = colKey(r.to.table, r.to.column);
    const ba = boxOfKey.get(ka), bb = boxOfKey.get(kb);
    if (ba && bb) entries.push({ kind: "edge", el: g, span: r.span, box: union(ba, bb), keys: [ka, kb] });
  }
  for (const { grp, b, g } of groups) if (grp.span) entries.push({ kind: "group", el: g, span: grp.span, box: b, keys: [] });

  const ends = (e: SVGElement) => [e.getAttribute("data-a")!, e.getAttribute("data-b")!];
  const edgeEls = [...into.querySelectorAll<SVGElement>(".dbml-edge")];
  const ownerOf = (k: string): SVGElement | undefined => (k.startsWith("enum:") ? tableEl.get(k) : (rowByKey.get(k)?.parentElement as SVGElement | null) ?? undefined);

  /** Liga/desliga uma marcação (`hl` = mouse, `fc` = cursor do editor) sobre colunas e arestas. */
  const mark = (mode: "hl" | "fc", keys: Set<string>, on: Set<SVGElement>, extra: SVGElement[] = []) => {
    const rootCls = mode === "hl" ? "hovering" : "focusing";
    for (const [k, row] of rowByKey) row.classList.toggle(mode, keys.has(k));
    for (const e of edgeEls) e.classList.toggle(mode, on.has(e));
    if (mode === "fc") {
      const keep = new Set<SVGElement>(extra);
      for (const k of keys) {
        const o = ownerOf(k);
        if (o) keep.add(o);
      }
      for (const el of tableEl.values()) el.classList.toggle("kp", keep.has(el));
      for (const e of [...into.querySelectorAll(".dbml-group")]) e.classList.toggle("fc", extra.includes(e as SVGElement));
      for (const el of into.querySelectorAll(".dbml-vrow")) el.classList.remove("fc");
    }
    into.classList.toggle(rootCls, keys.size > 0 || on.size > 0 || extra.length > 0);
  };

  // ---- mouse → código ----
  const hover = (spans: Span[] | null) => hooks.onHover?.(spans);
  const clearHover = () => {
    mark("hl", new Set(), new Set());
    hover(null);
  };
  for (const [k, row] of rowByKey) {
    row.addEventListener("mouseenter", () => {
      const on = new Set(edgeEls.filter((e) => ends(e).includes(k)));
      mark("hl", new Set([k, ...[...on].flatMap(ends)]), on);
      const sp = spanOfKey.get(k);
      hover(sp ? [sp] : null);
    });
    row.addEventListener("mouseleave", clearHover);
  }
  for (const { r, g } of edges) {
    g.addEventListener("mouseenter", () => {
      mark("hl", new Set(ends(g)), new Set([g]));
      hover(r.span ? [r.span] : null);
    });
    g.addEventListener("mouseleave", clearHover);
  }
  for (const e of edgeEls) {
    if (edges.some((x) => x.g === e)) continue; // ligações de enum: sem trecho próprio
    e.addEventListener("mouseenter", () => mark("hl", new Set(ends(e)), new Set([e])));
    e.addEventListener("mouseleave", clearHover);
  }
  for (const en of entries.filter((x) => x.kind === "table" || x.kind === "enum" || x.kind === "group" || x.kind === "value")) {
    const target = en.kind === "table" || en.kind === "enum" ? en.el.querySelectorAll(".dbml-head, .dbml-title") : [en.el];
    for (const t of target) {
      t.addEventListener("mouseenter", () => hover([en.kind === "value" ? en.span : head(en.span)]));
      t.addEventListener("mouseleave", () => hover(null));
    }
  }

  // ---- cursor do editor → diagrama ----
  let lastFocus: Entry | null = null;
  return {
    focusAt(offset) {
      let best: Entry | null = null;
      if (offset !== null) {
        for (const en of entries) {
          if (offset < en.span.from || offset > en.span.to) continue;
          if (!best || en.span.to - en.span.from < best.span.to - best.span.from) best = en;
        }
      }
      if (best === lastFocus && (best !== null || !into.classList.contains("focusing"))) return best?.box ?? null;
      lastFocus = best;
      if (!best) {
        mark("fc", new Set(), new Set());
        for (const el of tableEl.values()) el.classList.remove("fc");
        return null;
      }
      const keys = new Set(best.keys);
      let on = new Set<SVGElement>();
      if (best.kind === "row") {
        on = new Set(edgeEls.filter((e) => ends(e).includes(best.keys[0])));
        for (const k of [...on].flatMap(ends)) keys.add(k);
      } else if (best.kind === "edge") {
        on = new Set([best.el]);
      }
      const extra = best.kind === "table" || best.kind === "enum" || best.kind === "group" ? [best.el] : [];
      mark("fc", keys, on, extra);
      for (const el of tableEl.values()) el.classList.toggle("fc", best.kind !== "group" && el === best.el);
      if (best.kind === "value") {
        best.el.classList.add("fc");
        const o = best.el.parentElement;
        if (o) o.classList.add("kp");
        into.classList.add("focusing");
      }
      return best.box;
    },
  };
}
