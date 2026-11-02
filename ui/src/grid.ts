/**
 * Grade de painéis de uma janela, como no VS Code: uma árvore em que cada nó é um painel (`leaf`,
 * com um grupo de abas) ou uma divisão (`split`) em linha ou coluna, com o peso de cada filho.
 * Este módulo é só a lógica da árvore (sem DOM), para poder testar.
 */

export type Dir = "row" | "col";
export type Side = "left" | "right" | "top" | "bottom";

export interface Leaf {
  t: "leaf";
  g: number;
}
export interface Split {
  t: "split";
  dir: Dir;
  /** Peso de cada filho (a soma não importa, só a proporção). */
  sizes: number[];
  kids: Node[];
}
export type Node = Leaf | Split;

export interface Layout {
  root: Node;
  /** Grupo com o foco quando a janela foi gravada. */
  focus: number;
}

export const leaf = (g: number): Leaf => ({ t: "leaf", g });

export function groupsOf(n: Node): number[] {
  return n.t === "leaf" ? [n.g] : n.kids.flatMap(groupsOf);
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export const dirOf = (side: Side): Dir => (side === "left" || side === "right" ? "row" : "col");
const after = (side: Side) => side === "right" || side === "bottom";

/** Divide o painel `g`: o grupo novo `neu` aparece do lado `side` dele, com metade do espaço. */
export function splitLeaf(root: Node, g: number, side: Side, neu: number): Node {
  const dir = dirOf(side);
  const go = (n: Node): Node => {
    if (n.t === "leaf") {
      if (n.g !== g) return n;
      const kids = after(side) ? [leaf(g), leaf(neu)] : [leaf(neu), leaf(g)];
      return { t: "split", dir, sizes: [1, 1], kids };
    }
    const i = n.kids.findIndex((k) => k.t === "leaf" && k.g === g);
    if (i >= 0 && n.dir === dir) {
      // mesma direção: o novo painel entra ao lado, dividindo o peso do que foi dividido
      const kids = [...n.kids];
      const sizes = [...n.sizes];
      const half = sizes[i] / 2;
      sizes[i] = half;
      kids.splice(after(side) ? i + 1 : i, 0, leaf(neu));
      sizes.splice(after(side) ? i + 1 : i, 0, half);
      return { ...n, kids, sizes };
    }
    return { ...n, kids: n.kids.map(go) };
  };
  return go(clone(root));
}

/** Tira o painel `g`; os vizinhos ocupam o espaço dele. `null` se não sobrar nenhum. */
export function removeLeaf(root: Node, g: number): Node | null {
  const go = (n: Node): Node | null => {
    if (n.t === "leaf") return n.g === g ? null : n;
    const kids: Node[] = [];
    const sizes: number[] = [];
    n.kids.forEach((k, i) => {
      const r = go(k);
      if (r) {
        kids.push(r);
        sizes.push(n.sizes[i]);
      }
    });
    if (kids.length === 0) return null;
    if (kids.length === 1) return kids[0];
    // um filho que virou divisão na mesma direção do pai é absorvido
    const flat: Node[] = [];
    const flatSizes: number[] = [];
    kids.forEach((k, i) => {
      if (k.t === "split" && k.dir === n.dir) {
        const total = k.sizes.reduce((a, b) => a + b, 0) || 1;
        k.kids.forEach((kk, j) => {
          flat.push(kk);
          flatSizes.push((sizes[i] * k.sizes[j]) / total);
        });
      } else {
        flat.push(k);
        flatSizes.push(sizes[i]);
      }
    });
    return { ...n, kids: flat, sizes: flatSizes };
  };
  return go(clone(root));
}

/**
 * Deixa a grade coerente com os grupos que existem: tira painéis sem grupo, põe os grupos que
 * faltam ao lado do primeiro painel e descarta pesos inválidos. Sempre devolve uma grade válida.
 */
export function normalize(layout: Layout | null | undefined, groups: number[]): Layout {
  const valid = new Set(groups);
  let root: Node | null = layout && isNode(layout.root) ? clone(layout.root) : null;
  if (root) {
    for (const g of groupsOf(root)) if (!valid.has(g)) root = root && removeLeaf(root, g);
  }
  if (root) {
    const seen = new Set<number>();
    const dup = groupsOf(root).filter((g) => (seen.has(g) ? true : (seen.add(g), false)));
    for (const g of dup) root = root && removeLeaf(root, g); // painel repetido: sobra só um
  }
  const present = new Set(root ? groupsOf(root) : []);
  for (const g of groups) {
    if (present.has(g)) continue;
    root = root ? splitLeaf(root, groupsOf(root)[0], "right", g) : leaf(g);
  }
  root ??= leaf(groups[0] ?? 0);
  fixSizes(root);
  const focus = layout && groupsOf(root).includes(layout.focus) ? layout.focus : groupsOf(root)[0];
  return { root, focus };
}

function isNode(n: unknown): n is Node {
  if (!n || typeof n !== "object") return false;
  const x = n as Partial<Split> & { t?: string; g?: unknown };
  if (x.t === "leaf") return typeof x.g === "number";
  return x.t === "split" && (x.dir === "row" || x.dir === "col") && Array.isArray(x.kids) && x.kids.length > 0 && x.kids.every(isNode);
}

function fixSizes(n: Node) {
  if (n.t === "leaf") return;
  const ok = Array.isArray(n.sizes) && n.sizes.length === n.kids.length && n.sizes.every((s) => Number.isFinite(s) && s > 0);
  if (!ok) n.sizes = n.kids.map(() => 1);
  n.kids.forEach(fixSizes);
}

/** Arrastou o divisor entre os filhos `i` e `i+1`: passa `delta` (fração do total) de um para o outro. */
export function resizeSizes(sizes: number[], i: number, deltaFraction: number, min = 0.08): number[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  const out = [...sizes];
  const floor = min * total;
  const pair = out[i] + out[i + 1];
  const a = Math.max(floor, Math.min(pair - floor, out[i] + deltaFraction * total));
  out[i] = a;
  out[i + 1] = pair - a;
  return out;
}

export type Zone = Side | "center";

/** Em que parte de um painel (retângulo) o ponteiro está: as bordas dividem, o meio só move. */
export function zoneAt(rect: { left: number; top: number; width: number; height: number }, x: number, y: number): Zone {
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  const edge = 0.28;
  const dx = Math.min(fx, 1 - fx);
  const dy = Math.min(fy, 1 - fy);
  if (Math.min(dx, dy) > edge) return "center";
  if (dx <= dy) return fx < 0.5 ? "left" : "right";
  return fy < 0.5 ? "top" : "bottom";
}
