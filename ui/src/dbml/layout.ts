import { type Diagram, enumOf } from "./model";

export const HEADER_H = 30;
export const ROW_H = 22;
const CHAR_W = 7.4;
const PAD_X = 24;
const PIN_W = 16; // espaço do alfinete antes do título da tabela (igual a `PIN_W` de render.ts)
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
  const title = t.name.length + (t.schema ? t.schema.length + 1 : 0) + (t.note ? 3 : 0) + (t.external ? 9 : 0); // o ícone da nota e a marca de externos ocupam o fim do cabeçalho
  let w = title * CHAR_W + PIN_W; // o alfinete fica antes do título
  for (const c of t.columns) w = Math.max(w, (c.name.length + c.type.length + 4 + (c.note ? 3 : 0)) * CHAR_W);
  return { w: Math.max(MIN_W, Math.ceil(w) + PAD_X), h: HEADER_H + Math.max(1, t.columns.length) * ROW_H };
}

export function enumSize(e: Diagram["enums"][number]): { w: number; h: number } {
  let chars = e.name.length + 5;
  for (const v of e.values) chars = Math.max(chars, v.name.length + 2);
  return { w: Math.max(MIN_W - 40, Math.ceil(chars * CHAR_W) + PAD_X), h: HEADER_H + Math.max(1, e.values.length) * ROW_H };
}

/** Proporção largura/altura que o desenho automático procura (tela larga, não um quadrado exato). */
const TARGET_ASPECT = 1.5;
/** Um bloco mais alto que largo (largura/altura abaixo disto) deixa o dagre e vira grade. */
const MIN_BLOCK_ASPECT = 0.9;
const NODE_GAP = 40;
const BLOCK_GAP = 56;

interface Item {
  key: string;
  w: number;
  h: number;
}
/** Um conjunto de caixas que anda junto: um grupo, uma família de tabelas ligadas ou as soltas. */
interface Block {
  items: Item[];
  pos: Map<string, { x: number; y: number }>; // canto de cima à esquerda, dentro do bloco
  w: number;
  h: number;
  grouped: boolean;
}

const aspectScore = (w: number, h: number) => Math.abs(Math.log(w / h / TARGET_ASPECT));

/** Põe os itens em fileiras (cada uma com a sua largura), na ordem dada, com `cols` por fileira. */
function shelfRows(items: Item[], cols: number): { pos: Map<string, { x: number; y: number }>; w: number; h: number } {
  const pos = new Map<string, { x: number; y: number }>();
  let y = 0, w = 0;
  for (let i = 0; i < items.length; i += cols) {
    const row = items.slice(i, i + cols);
    let x = 0, rh = 0;
    for (const it of row) {
      pos.set(it.key, { x, y });
      x += it.w + NODE_GAP;
      rh = Math.max(rh, it.h);
    }
    w = Math.max(w, x - NODE_GAP);
    y += rh + NODE_GAP;
  }
  return { pos, w, h: Math.max(0, y - NODE_GAP) };
}

/** Grade com o número de colunas que deixa o bloco mais perto da proporção desejada. */
function gridLayout(items: Item[]): { pos: Map<string, { x: number; y: number }>; w: number; h: number } {
  let best = shelfRows(items, 1);
  let bestScore = best.w > 0 && best.h > 0 ? aspectScore(best.w, best.h) : Infinity;
  for (let c = 2; c <= items.length; c++) {
    const r = shelfRows(items, c);
    const sc = r.w > 0 && r.h > 0 ? aspectScore(r.w, r.h) : Infinity;
    if (sc < bestScore) {
      best = r;
      bestScore = sc;
    }
  }
  return best;
}

/** Layout interno: o dagre mantém quem se liga perto; se sair uma coluna alta demais, vira grade na mesma ordem. */
function layoutBlock(items: Item[], edges: [string, string][], dagre: DagreLike): { pos: Map<string, { x: number; y: number }>; w: number; h: number } {
  if (items.length === 1) return { pos: new Map([[items[0].key, { x: 0, y: 0 }]]), w: items[0].w, h: items[0].h };
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: NODE_GAP, ranksep: 110, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const it of items) g.setNode(it.key, { width: it.w, height: it.h });
  for (const [a, b] of edges) g.setEdge(a, b);
  dagre.layout(g);
  const pos = new Map<string, { x: number; y: number }>();
  let x1 = 0, y1 = 0;
  const centers = new Map<string, { x: number; y: number }>();
  for (const it of items) {
    const n = g.node(it.key);
    const p = { x: Math.round(n.x - it.w / 2), y: Math.round(n.y - it.h / 2) };
    pos.set(it.key, p);
    centers.set(it.key, n);
    x1 = Math.max(x1, p.x + it.w);
    y1 = Math.max(y1, p.y + it.h);
  }
  if (x1 / y1 >= MIN_BLOCK_ASPECT) return { pos, w: x1, h: y1 };
  // ordem do dagre (nível, depois posição no nível): vizinhos continuam perto na grade
  const ordered = [...items].sort((a, b) => centers.get(a.key)!.x - centers.get(b.key)!.x || centers.get(a.key)!.y - centers.get(b.key)!.y);
  return gridLayout(ordered);
}

/** Empacota os blocos em fileiras, escolhendo a largura que deixa o todo mais perto da proporção e com menos buraco. */
function packBlocks(blocks: Block[], order: number[]): { x: number; y: number }[] {
  const place = (width: number) => {
    const at: { x: number; y: number }[] = new Array(blocks.length);
    let x = 0, y = 0, rh = 0, usedW = 0;
    for (const i of order) {
      const b = blocks[i];
      if (x > 0 && x + b.w > width) {
        y += rh + BLOCK_GAP;
        x = 0;
        rh = 0;
      }
      at[i] = { x, y };
      x += b.w + BLOCK_GAP;
      rh = Math.max(rh, b.h);
      usedW = Math.max(usedW, x - BLOCK_GAP);
    }
    return { at, w: usedW, h: y + rh };
  };
  const area = blocks.reduce((a, b) => a + b.w * b.h, 0);
  const maxW = Math.max(...blocks.map((b) => b.w));
  const base = Math.sqrt(area * TARGET_ASPECT);
  let best: { at: { x: number; y: number }[]; score: number } | undefined;
  for (let f = 0.5; f <= 2.01; f += 0.1) {
    const r = place(Math.max(maxW, base * f));
    if (r.w <= 0 || r.h <= 0) continue;
    const score = aspectScore(r.w, r.h) + 1.5 * (1 - area / (r.w * r.h));
    if (!best || score < best.score) best = { at: r.at, score };
  }
  return best ? best.at : place(maxW).at;
}

export function layoutDiagram(d: Diagram, dagre: DagreLike, saved: SavedPositions = {}, savedGroups: SavedGroups = {}): Layout {
  const sizes = new Map<string, { w: number; h: number }>();
  for (const t of d.tables) sizes.set(t.id, tableSize(t));
  for (const e of d.enums) sizes.set(enumKey(e.id), enumSize(e));
  const item = (key: string): Item => ({ key, ...sizes.get(key)! });

  // 1. blocos: cada grupo (uma tabela em vários grupos fica só no primeiro), as famílias de tabelas
  // soltas que se ligam entre si e, juntas num bloco só, as que sobram isoladas
  const blockOf = new Map<string, number>();
  const members: string[][] = [];
  const isGroup: boolean[] = [];
  const known = new Set(d.tables.map((t) => t.id));
  for (const grp of d.groups) {
    const ids = grp.tables.filter((id) => known.has(id) && !blockOf.has(id));
    if (ids.length === 0) continue;
    for (const id of ids) blockOf.set(id, members.length);
    members.push(ids);
    isGroup.push(true);
  }
  const loose = d.tables.filter((t) => !blockOf.has(t.id)).map((t) => t.id);
  const parent = new Map(loose.map((id) => [id, id]));
  const find = (a: string): string => {
    while (parent.get(a) !== a) {
      parent.set(a, parent.get(parent.get(a)!)!);
      a = parent.get(a)!;
    }
    return a;
  };
  for (const r of d.refs) if (parent.has(r.from.table) && parent.has(r.to.table)) parent.set(find(r.from.table), find(r.to.table));
  const families = new Map<string, string[]>();
  for (const id of loose) families.set(find(id), [...(families.get(find(id)) ?? []), id]);
  const singles: string[] = [];
  for (const fam of families.values()) {
    if (fam.length === 1) {
      singles.push(fam[0]);
      continue;
    }
    for (const id of fam) blockOf.set(id, members.length);
    members.push(fam);
    isGroup.push(false);
  }
  // o enum vai para o bloco da primeira tabela que o usa; sem uso, para as isoladas
  const enumBlock = new Map<string, number>();
  const orphanEnums: string[] = [];
  for (const e of d.enums) {
    const user = d.tables.find((t) => t.columns.some((c) => enumOf(d.enums, c.type) === e));
    if (user && blockOf.has(user.id)) enumBlock.set(enumKey(e.id), blockOf.get(user.id)!);
    else orphanEnums.push(enumKey(e.id));
  }
  for (const id of singles) blockOf.set(id, members.length);
  const rest = [...singles, ...orphanEnums];
  const restIdx = rest.length > 0 ? members.length : -1;
  if (rest.length > 0) {
    members.push(rest);
    isGroup.push(false);
  }
  for (const k of orphanEnums) enumBlock.set(k, restIdx);
  for (const [k, b] of enumBlock) if (!members[b].includes(k)) members[b].push(k);

  // 2. layout interno de cada bloco
  const blocks: Block[] = members.map((keys, bi) => {
    const set = new Set(keys);
    const edges: [string, string][] = [];
    for (const r of d.refs) if (r.from.table !== r.to.table && set.has(r.from.table) && set.has(r.to.table)) edges.push([r.from.table, r.to.table]);
    for (const e of d.enums) {
      const k = enumKey(e.id);
      if (!set.has(k)) continue;
      for (const t of d.tables) if (set.has(t.id) && t.columns.some((c) => enumOf(d.enums, c.type) === e)) edges.push([t.id, k]);
    }
    const items = keys.map(item);
    // o bloco das isoladas não tem ligações: é sempre uma grade
    const inner = bi === restIdx ? gridLayout(items) : layoutBlock(items, edges, dagre);
    const grouped = isGroup[bi];
    const padX = grouped ? GROUP_PAD : 0;
    const padTop = grouped ? GROUP_PAD + GROUP_LABEL_H : 0;
    const padBottom = grouped ? GROUP_PAD : 0;
    const pos = new Map([...inner.pos].map(([k, p]) => [k, { x: p.x + padX, y: p.y + padTop }]));
    return { items, pos, w: inner.w + padX * 2, h: inner.h + padTop + padBottom, grouped };
  });

  // 3. ordem: começa pelo maior e segue sempre pelo que mais se liga aos já postos
  const weight = new Map<string, number>();
  const bump = (a: number, b: number) => {
    if (a === b) return;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    weight.set(k, (weight.get(k) ?? 0) + 1);
  };
  const blockIndex = (key: string) => (blockOf.has(key) ? blockOf.get(key)! : enumBlock.get(key));
  for (const r of d.refs) {
    const a = blockIndex(r.from.table), b = blockIndex(r.to.table);
    if (a !== undefined && b !== undefined) bump(a, b);
  }
  const link = (a: number, b: number) => weight.get(a < b ? `${a}|${b}` : `${b}|${a}`) ?? 0;
  const order: number[] = [];
  const left = new Set(blocks.map((_, i) => i));
  while (left.size > 0) {
    let pick = -1, pickScore = -1, pickArea = -1;
    for (const i of left) {
      const score = order.reduce((a, j) => a + link(i, j), 0);
      const area = blocks[i].w * blocks[i].h;
      if (score > pickScore || (score === pickScore && area > pickArea)) {
        pick = i;
        pickScore = score;
        pickArea = area;
      }
    }
    order.push(pick);
    left.delete(pick);
  }

  // 4. empacota e traduz para caixas
  const boxes = new Map<string, Box>();
  const origin = blocks.length > 0 ? packBlocks(blocks, order) : [];
  blocks.forEach((b, i) => {
    for (const it of b.items) {
      const p = b.pos.get(it.key)!;
      boxes.set(it.key, { x: MARGIN + origin[i].x + p.x, y: MARGIN + origin[i].y + p.y, w: it.w, h: it.h });
    }
  });
  const layout: Layout = { boxes, width: 0, height: 0 };
  let right = 0, bottom = 0;
  for (const b of boxes.values()) {
    right = Math.max(right, b.x + b.w);
    bottom = Math.max(bottom, b.y + b.h);
  }
  layout.width = boxes.size > 0 ? right + MARGIN : 0;
  layout.height = boxes.size > 0 ? bottom + MARGIN : 0;
  frameGroups(d, boxes);

  // posições salvas valem sobre o automático: só as tabelas que têm posição (as outras ficam onde estão)
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
