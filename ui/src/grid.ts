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

/** Caminho (índices dos filhos, da raiz até lá) do painel `g`; `null` se não existir. */
export function pathTo(root: Node, g: number): number[] | null {
  if (root.t === "leaf") return root.g === g ? [] : null;
  for (let i = 0; i < root.kids.length; i++) {
    const p = pathTo(root.kids[i], g);
    if (p) return [i, ...p];
  }
  return null;
}

export function nodeAt(root: Node, path: number[]): Node | null {
  let n: Node = root;
  for (const i of path) {
    if (n.t !== "split" || !n.kids[i]) return null;
    n = n.kids[i];
  }
  return n;
}

/**
 * Nós que, ao dividir do lado `side`, podem receber o painel novo ao lado de **todo o bloco**: o
 * próprio painel `g` e, subindo, cada pilha (divisão na direção perpendicular ao lado) que o contém e
 * cuja borda desse lado é a mesma. Do menor para o maior; cada um vem como caminho.
 * Ex.: duas abas empilhadas e `side = right`: [painel de cima] e [a pilha inteira].
 */
export function wrapCandidates(root: Node, g: number, side: Side): number[][] {
  const path = pathTo(root, g);
  if (!path) return [];
  const dir = dirOf(side);
  const out: number[][] = [path];
  for (let depth = path.length - 1; depth >= 0; depth--) {
    const p = nodeAt(root, path.slice(0, depth));
    if (!p || p.t !== "split") break;
    if (p.dir !== dir) out.push(path.slice(0, depth)); // pilha: todos os filhos dividem esta borda
    else if (path[depth] !== (after(side) ? p.kids.length - 1 : 0)) break; // na mesma direção só o filho da ponta chega à borda
  }
  return out;
}

/** Põe o painel novo `neu` do lado `side` do nó em `path` (um painel ou um bloco inteiro). */
export function splitPath(root: Node, path: number[], side: Side, neu: number): Node {
  const dir = dirOf(side);
  const tree = clone(root);
  const parent = path.length > 0 ? (nodeAt(tree, path.slice(0, -1)) as Split) : null;
  const target = nodeAt(tree, path);
  if (!target) return tree;
  if (parent && parent.dir === dir) {
    // mesma direção do pai: o novo painel entra ao lado, dividindo o peso do que foi dividido
    const i = path[path.length - 1];
    const half = parent.sizes[i] / 2;
    parent.sizes[i] = half;
    parent.kids.splice(after(side) ? i + 1 : i, 0, leaf(neu));
    parent.sizes.splice(after(side) ? i + 1 : i, 0, half);
    return tree;
  }
  const wrapped: Split = { t: "split", dir, sizes: [1, 1], kids: after(side) ? [target, leaf(neu)] : [leaf(neu), target] };
  if (!parent) return wrapped;
  parent.kids[path[path.length - 1]] = wrapped;
  return tree;
}

/** Divide o painel `g`: o grupo novo `neu` aparece do lado `side` dele, com metade do espaço. */
export function splitLeaf(root: Node, g: number, side: Side, neu: number): Node {
  const path = pathTo(root, g);
  return path ? splitPath(root, path, side, neu) : clone(root);
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
  const x = n as { t?: string; g?: unknown; dir?: unknown; kids?: unknown };
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

/** Troca de lugar os filhos `i` e `i+1` de uma divisão (cada um leva o próprio tamanho). Altera `n`. */
export function swapAdjacent(n: Split, i: number): void {
  if (i < 0 || i + 1 >= n.kids.length) return;
  [n.kids[i], n.kids[i + 1]] = [n.kids[i + 1], n.kids[i]];
  [n.sizes[i], n.sizes[i + 1]] = [n.sizes[i + 1], n.sizes[i]];
}
