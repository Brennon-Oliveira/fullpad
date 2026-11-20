import { type Box, HEADER_H, type Layout, ROW_H, enumKey, groupKey, groupMembers } from "./layout";
import { type DEnum, type DGroup, type DRef, type DTable, type Diagram, type Endpoint, type Span, enumOf } from "./model";

/** Altura da faixa do título do grupo que serve de alça para movê-lo. */
const GROUP_HANDLE_H = 26;

/** Largura aproximada de um caractere do tipo (monoespaçado 12px): onde termina o texto à direita da linha. */
const TYPE_CHAR_W = 7.2;

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

/** Ícone de documento que marca uma nota; o chamador põe o tooltip e o clique (`data-note` = onde a declaração começa; sem ele o ícone só mostra a nota, como no enum). */
function noteIcon(kind: "table" | "column" | "enum", decl: number | undefined, note: string, x: number, y: number): SVGGElement {
  const g = el("g", { class: "dbml-noteicon", "data-note-kind": kind, "data-note-text": note, transform: `translate(${x} ${y})` });
  if (decl !== undefined) g.setAttribute("data-note", String(decl));
  g.append(
    el("rect", { class: "dbml-noteicon-hit", x: -2, y: -2, width: 16, height: 18 }),
    el("path", { d: "M2.5,0.5 H7.5 L10.5,3.5 V12.5 H2.5 Z M7.5,0.5 V3.5 H10.5 M4.5,6.5 H8.5 M4.5,9 H8.5" }),
  );
  return g;
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

/** Alfinete à esquerda do título: fixar a tabela (e as que se ligam a ela) em destaque. O clique é tratado pelo painel (`.dbml-pin`). */
function pinIcon(ink: string | null): SVGGElement {
  const g = el("g", { class: "dbml-pin", transform: "translate(5 8) scale(.58)" });
  g.append(
    el("rect", { class: "dbml-pin-hit", x: -8, y: -12, width: 40, height: 44 }),
    el("path", { d: "M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" }),
  );
  if (ink) g.setAttribute("style", `color:${ink}`);
  g.append(el("title", {}, "Fixar em destaque"));
  return g;
}

function tableNode(t: DTable, x: number, y: number, w: number, h: number): SVGGElement {
  const g = el("g", { class: "dbml-table", "data-t": t.id, transform: `translate(${x} ${y})` });
  if (t.span) g.setAttribute("data-pick", String(t.span.from)); // clique: leva o código até aqui
  g.append(el("rect", { class: "dbml-box", width: w, height: h, rx: 6 }));
  const head = el("path", { class: "dbml-head", d: `M0,${HEADER_H} V6 a6,6 0 0 1 6,-6 H${w - 6} a6,6 0 0 1 6,6 V${HEADER_H} Z` });
  const ink = t.color ? contrastOn(t.color) : null;
  if (t.color && ink) head.setAttribute("style", `fill:${t.color}`);
  g.append(head);
  const title = el("text", { class: "dbml-title", x: 10 + PIN_W, y: HEADER_H / 2 + 5 }, t.schema ? `${t.schema}.${t.name}` : t.name);
  if (t.span) title.setAttribute("data-off", String(t.span.from)); // duplo clique: renomear (onde a declaração começa)
  if (ink) title.setAttribute("style", `fill:${ink}`);
  g.append(title);
  g.append(pinIcon(ink));
  if (t.note) g.append(noteIcon("table", t.span?.from, t.note, w - 24, (HEADER_H - 13) / 2));
  if (t.external) {
    // há relações com tabelas que ficaram fora do escopo: a marca diz quantas e o texto de ajuda, com quem
    const who = t.external.targets.map((x) => (x.file ? `${x.id} (${x.file})` : x.id)).join(", ");
    const badge = el("text", { class: "dbml-ext", x: w - (t.note ? 30 : 10), y: HEADER_H / 2 + 4, "text-anchor": "end" }, `↗ ${t.external.count} ext.`);
    badge.append(el("title", {}, `${t.external.count} ${t.external.count === 1 ? "relação" : "relações"} com tabelas externas (fora do que está sendo visto): ${who}`));
    g.append(badge);
  }
  t.columns.forEach((c, i) => {
    const cy = HEADER_H + i * ROW_H + ROW_H / 2 + 4;
    const row = el("rect", { class: "dbml-row", "data-k": colKey(t.id, c.name), x: 1, y: HEADER_H + i * ROW_H, width: w - 2, height: ROW_H });
    if (c.span) row.setAttribute("data-col", String(c.span.from)); // botão direito: menu da coluna
    if (c.span) row.setAttribute("data-pick", String(c.span.from));
    g.append(row);
    const rk = colKey(t.id, c.name); // o texto e o ícone da linha ficam por cima do retângulo: `data-r` os liga a ela (hover da coluna inteira)
    const colName = el("text", { class: c.pk ? "dbml-col dbml-pk" : "dbml-col", x: 10, y: cy, "data-r": rk }, c.name);
    if (c.span) colName.setAttribute("data-off", String(c.span.from));
    g.append(colName);
    g.append(el("text", { class: "dbml-type", x: w - 10, y: cy, "text-anchor": "end", "data-r": rk }, c.type));
    if (c.note) {
      const ni = noteIcon("column", c.span?.from, c.note, w - 10 - c.type.length * TYPE_CHAR_W - 20, HEADER_H + i * ROW_H + (ROW_H - 13) / 2);
      ni.setAttribute("data-r", rk);
      g.append(ni);
    }
  });
  return g;
}

function enumNode(e: DEnum, x: number, y: number, w: number, h: number): SVGGElement {
  const g = el("g", { class: "dbml-enum", "data-e": enumKey(e.id), transform: `translate(${x} ${y})` });
  if (e.span) g.setAttribute("data-pick", String(e.span.from));
  g.append(el("rect", { class: "dbml-box", width: w, height: h, rx: 6 }));
  g.append(el("path", { class: "dbml-head dbml-enum-head", d: `M0,${HEADER_H} V6 a6,6 0 0 1 6,-6 H${w - 6} a6,6 0 0 1 6,6 V${HEADER_H} Z` }));
  const enumTitle = el("text", { class: "dbml-title", x: 10 + PIN_W, y: HEADER_H / 2 + 5 }, `enum ${e.schema ? `${e.schema}.` : ""}${e.name}`);
  if (e.span) enumTitle.setAttribute("data-off", String(e.span.from));
  g.append(enumTitle);
  g.append(pinIcon(null));
  if (e.note) g.append(noteIcon("enum", undefined, e.note, w - 24, (HEADER_H - 13) / 2)); // só leitura: editar a nota do enum pelo diagrama ainda não existe
  e.values.forEach((v, i) => {
    g.append(el("rect", { class: "dbml-vrow", "data-v": colKey(enumKey(e.id), v.name), x: 1, y: HEADER_H + i * ROW_H, width: w - 2, height: ROW_H, ...(v.span ? { "data-pick": v.span.from } : {}) }));
    const valName = el("text", { class: "dbml-col", x: 10, y: HEADER_H + i * ROW_H + ROW_H / 2 + 4 }, v.name);
    if (v.span) valName.setAttribute("data-off", String(v.span.from));
    g.append(withNote(valName, v.note));
  });
  return g;
}

function groupFrame(grp: DGroup, b: { x: number; y: number; w: number; h: number }): SVGGElement {
  const g = el("g", { class: "dbml-group", "data-grp": grp.name });
  if (grp.span) g.setAttribute("data-pick", String(grp.span.from));
  const color = grp.color && contrastOn(grp.color) ? grp.color : null;
  const rect = el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 10 });
  if (color) rect.setAttribute("style", `fill:${color}1f;stroke:${color}`);
  g.append(rect, el("text", { x: b.x + 12, y: b.y + 17 }, grp.name));
  // alças: a faixa do título move o grupo (e as tabelas dele); o canto de baixo à direita aumenta a moldura
  g.append(
    el("rect", { class: "dbml-group-move", x: b.x, y: b.y, width: b.w, height: GROUP_HANDLE_H, ...(grp.span ? { "data-off": grp.span.from } : {}) }),
    el("path", { class: "dbml-group-resize", d: `M${b.x + b.w - 2},${b.y + b.h - 16} L${b.x + b.w - 2},${b.y + b.h - 2} L${b.x + b.w - 16},${b.y + b.h - 2} Z` }),
  );
  return g;
}

/** Espaço do alfinete no cabeçalho (o título começa depois dele). */
export const PIN_W = 16;

export interface RenderHooks {
  /** Tabelas fixadas em destaque (ids). O chamador guarda o conjunto para valer depois de redesenhar; sem ele, vale só neste desenho. */
  pins?: Set<string>;
  /** O conjunto de fixadas mudou (clique no alfinete). */
  onPins?(pins: Set<string>): void;
  /** Mouse sobre um elemento: trechos do texto que ele representa (`null` ao sair). */
  onHover?(spans: Span[] | null): void;
  /** Mouse sobre o ícone de uma nota (`null` ao sair): o texto e o retângulo do ícone na tela. */
  onNoteHover?(note: { text: string; rect: DOMRect; editable: boolean } | null): void;
}

export interface Rendered {
  /**
   * Destaca o elemento que corresponde a `offset` (o cursor do editor); `null` limpa.
   * Devolve a caixa dele (coordenadas do layout) para quem quiser trazê-lo à vista.
   */
  focusAt(offset: number | null): Box | null;
  /** Fixa ou solta uma tabela (clique no alfinete). */
  togglePin(id: string): void;
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
  into.classList.remove("hovering", "focusing", "tblhover");
  const pins = hooks.pins ?? new Set<string>();
  const known = new Set([...d.tables.map((t) => t.id), ...d.enums.map((e) => enumKey(e.id))]);
  for (const id of [...pins]) if (!known.has(id)) pins.delete(id); // tabela ou enum que saiu do diagrama não fica fixado

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
  /**
   * Destaque por tabela: **em foco** é a que está sob o mouse e as fixadas (borda forte); **relacionada** é quem
   * se liga a uma delas (borda leve); o resto esmaece. Só as ligações das tabelas em foco acendem.
   */
  let hovered: SVGElement | null = null;
  /** Coluna sob o mouse (em qualquer ponto da linha): só ela e as ligações dela acendem; a tabela dela fica em foco, sem esmaecer nada. */
  let rowHover: string | null = null;
  const applyFocus = () => {
    const focus = new Set<SVGElement>();
    for (const id of pins) {
      const e = tableEl.get(id);
      if (e) focus.add(e);
    }
    if (hovered) focus.add(hovered);
    const byTable = new Set(edgeEls.filter((e) => ends(e).some((k) => {
      const o = ownerOf(k);
      return !!o && focus.has(o);
    })));
    const related = new Set<SVGElement>();
    for (const e of byTable) for (const k of ends(e)) {
      const o = ownerOf(k);
      if (o && !focus.has(o)) related.add(o);
    }
    const on = new Set(byTable);
    const keys = new Set([...byTable].flatMap(ends));
    // coluna sob o mouse: a tabela dela e a da outra ponta de cada ligação dela ficam em foco, o resto esmaece
    const rowTables = new Set<SVGElement>();
    if (rowHover) {
      keys.add(rowHover);
      const own = ownerOf(rowHover);
      if (own) rowTables.add(own);
      for (const e of edgeEls) if (ends(e).includes(rowHover)) {
        on.add(e);
        for (const k of ends(e)) {
          keys.add(k);
          const o = ownerOf(k);
          if (o) rowTables.add(o);
        }
      }
    }
    mark("hl", keys, on);
    for (const [id, t] of tableEl) {
      t.classList.toggle("foc", focus.has(t) || rowTables.has(t));
      t.classList.toggle("rel", related.has(t));
      t.classList.toggle("pinned", pins.has(id));
    }
    // uma tabela sem relação, só com o mouse em cima, não esmaece nada; fixada, sempre
    into.classList.toggle("tblhover", (focus.size > 0 && (pins.size > 0 || related.size > 0)) || rowTables.size > 1);
  };
  const clearHover = () => {
    hovered = null;
    rowHover = null;
    applyFocus();
    hover(null);
  };
  for (const [k, row] of rowByKey) {
    const pieces: Element[] = [row, ...[...(row.parentElement?.querySelectorAll("[data-r]") ?? [])].filter((x) => x.getAttribute("data-r") === k)];
    for (const piece of pieces) {
      piece.addEventListener("mouseenter", () => {
        if (rowHover === k) return;
        rowHover = k;
        applyFocus();
        const sp = spanOfKey.get(k);
        hover(sp ? [sp] : null);
      });
      piece.addEventListener("mouseleave", (ev) => {
        const to = (ev as MouseEvent).relatedTarget as Element | null;
        if (to && pieces.some((x) => x.contains(to))) return; // passou do retângulo para o texto da mesma linha
        rowHover = null;
        applyFocus();
        hover(null);
      });
    }
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

  // o destaque das relações vale para toda tabela e enum, também as de arquivo incluído (que não têm `span` no texto da aba)
  for (const el of tableEl.values()) {
    for (const t of el.querySelectorAll(".dbml-head, .dbml-title, .dbml-pin")) {
      t.addEventListener("mouseenter", () => {
        hovered = el;
        applyFocus();
      });
      t.addEventListener("mouseleave", () => {
        hovered = null;
        applyFocus();
      });
    }
  }
  applyFocus(); // o que estava fixado antes de redesenhar volta aceso

  for (const icon of into.querySelectorAll<SVGElement>(".dbml-noteicon")) {
    icon.addEventListener("mouseenter", () => hooks.onNoteHover?.({ text: icon.getAttribute("data-note-text") ?? "", rect: icon.getBoundingClientRect(), editable: icon.hasAttribute("data-note") }));
    icon.addEventListener("mouseleave", () => hooks.onNoteHover?.(null));
  }

  // ---- cursor do editor → diagrama ----
  let lastFocus: Entry | null = null;
  return {
    togglePin(id) {
      if (!tableEl.has(id)) return;
      if (!pins.delete(id)) pins.add(id);
      applyFocus();
      hooks.onPins?.(pins);
    },
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
        for (const el of tableEl.values()) el.classList.remove("fc", "gm");
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
      // grupo selecionado: as tabelas dele ficam em destaque de referência (sem a borda forte) e as ligações entre elas acendem
      let members: SVGElement[] = [];
      if (best.kind === "group") {
        const ids = groupMembers(d, layout.boxes).get(best.el.getAttribute("data-grp") ?? "") ?? [];
        members = ids.flatMap((id) => tableEl.get(id) ?? []);
        const inside = new Set(members);
        on = new Set(edgeEls.filter((e) => ends(e).every((k) => {
          const o = ownerOf(k);
          return !!o && inside.has(o);
        })));
      }
      const extra = best.kind === "table" || best.kind === "enum" ? [best.el] : best.kind === "group" ? [best.el, ...members] : [];
      mark("fc", keys, on, extra);
      for (const el of tableEl.values()) {
        el.classList.toggle("fc", best.kind !== "group" && el === best.el);
        el.classList.toggle("gm", members.includes(el));
      }
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
