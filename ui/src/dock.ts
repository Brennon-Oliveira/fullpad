/**
 * Alvos visíveis para soltar uma aba arrastada (sem DOM; testado em `dock.test.ts`). Cada painel
 * mostra, enquanto se arrasta:
 *  - um retângulo no meio de cada borda (divide só aquele painel);
 *  - barras finas na borda externa de cada bloco a que ele pertence (pilhas de painéis): dividem o
 *    bloco inteiro; a mais de fora é o maior bloco;
 *  - um retângulo no centro (move a aba para aquele painel), quando permitido.
 * Os cantos ficam vazios, para nenhum alvo encostar no outro.
 */
import type { Side } from "./grid";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DockGroup {
  g: number;
  /** Área do painel sem a barra de abas. */
  body: Rect;
  /** Por borda: o próprio painel e os blocos maiores que dividem a mesma borda (`wrapCandidates`), com o retângulo de cada um. */
  cands: Record<Side, { path: number[]; rect: Rect }[]>;
  /** Mostrar os alvos que dividem só este painel. */
  edges: boolean;
  /** Mostrar o alvo do centro. */
  center: boolean;
}

export interface DockTile {
  kind: "edge" | "block" | "center";
  g: number;
  side?: Side;
  path?: number[];
  rect: Rect;
}

export const SIDES: Side[] = ["left", "right", "top", "bottom"];
const BAR = 18; // espessura da barra de um bloco
const GAP = 4;
const BAR_MARGIN = 36; // nas pontas da barra (deixa os cantos livres)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Retângulo de espessura `thick` colado na borda `side` de `r`, afastado `off`, de `from` a `to` ao longo dela. */
function band(r: Rect, side: Side, off: number, thick: number, from: number, to: number): Rect {
  if (side === "left") return { left: r.left + off, top: from, width: thick, height: to - from };
  if (side === "right") return { left: r.left + r.width - off - thick, top: from, width: thick, height: to - from };
  if (side === "top") return { left: from, top: r.top + off, width: to - from, height: thick };
  return { left: from, top: r.top + r.height - off - thick, width: to - from, height: thick };
}

export function dockTiles(groups: DockGroup[], stripH: number): DockTile[] {
  const out: DockTile[] = [];
  const seen = new Set<string>();
  for (const dg of groups) {
    const b = dg.body;
    for (const side of SIDES) {
      const cands = dg.cands[side] ?? [];
      const nb = Math.max(0, cands.length - 1);
      const vertical = side === "left" || side === "right"; // a barra corre na vertical
      // barras dos blocos: k = 1 é o menor bloco (mais para dentro), o último é o maior (colado à borda)
      for (let k = 1; k < cands.length; k++) {
        const c = cands[k];
        const key = `${side}:${c.path.join(".")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // a barra de abas fica livre: o bloco "começa" logo abaixo dela
        const r = { ...c.rect, top: c.rect.top + stripH, height: c.rect.height - stripH };
        const len = vertical ? r.height : r.width;
        const m = Math.min(BAR_MARGIN, len / 4);
        const start = (vertical ? r.top : r.left) + m;
        const end = (vertical ? r.top + r.height : r.left + r.width) - m;
        if (end - start < 16) continue;
        out.push({ kind: "block", g: dg.g, side, path: c.path, rect: band(r, side, GAP + (nb - k) * (BAR + GAP), BAR, start, end) });
      }
      if (!dg.edges || cands.length === 0) continue;
      const inset = GAP + nb * (BAR + GAP);
      const dim = vertical ? b.width : b.height;
      const thick = Math.min(clamp(Math.round(dim * 0.16), 28, 72), dim / 2 - inset - 8);
      if (thick < 14) continue;
      const len = vertical ? b.height : b.width;
      const base = vertical ? b.top : b.left;
      out.push({ kind: "edge", g: dg.g, side, path: cands[0].path, rect: band(b, side, inset, thick, base + len * 0.22, base + len * 0.78) });
    }
    if (dg.center) {
      const w = clamp(b.width * 0.3, 48, 160);
      const h = clamp(b.height * 0.3, 40, 120);
      if (w < b.width && h < b.height) out.push({ kind: "center", g: dg.g, rect: { left: b.left + (b.width - w) / 2, top: b.top + (b.height - h) / 2, width: w, height: h } });
    }
  }
  return out;
}

/** O alvo sob o ponto (com uma folga de `slop` px em volta de cada um, o mais próximo ganha). */
export function tileAt(tiles: DockTile[], x: number, y: number, slop = 4): DockTile | null {
  let best: DockTile | null = null;
  let bestD = Infinity;
  for (const t of tiles) {
    const r = t.rect;
    const dx = Math.max(r.left - x, 0, x - (r.left + r.width));
    const dy = Math.max(r.top - y, 0, y - (r.top + r.height));
    const d = Math.hypot(dx, dy);
    if (d <= slop && d < bestD) (best = t), (bestD = d);
  }
  return best;
}
