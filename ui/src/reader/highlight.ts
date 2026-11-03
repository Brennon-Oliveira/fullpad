// Realce dos resultados da busca com a API de destaque do navegador (`CSS.highlights`): nada é
// inserido no documento, então o texto, a seleção e a citação continuam como estavam.

import { findOffsets } from "./find";

/** Um `Range` para cada ocorrência da consulta no texto de `root` (os nós de texto, em ordem). */
export function textRanges(root: Node, query: string, doc: Document = root.ownerDocument ?? document): Range[] {
  const chunks: { node: Text; start: number }[] = [];
  let full = "";
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = (n as Text).parentElement;
    if (parent?.closest("script,style")) continue;
    const t = n as Text;
    chunks.push({ node: t, start: full.length });
    full += t.data;
  }
  const ranges: Range[] = [];
  const qlen = queryLength(query);
  for (const at of findOffsets(full, query)) {
    const end = at + qlen;
    const a = locate(chunks, at, false);
    const b = locate(chunks, end, true);
    if (!a || !b) continue;
    const r = doc.createRange();
    r.setStart(a.node, at - a.start);
    r.setEnd(b.node, end - b.start);
    ranges.push(r);
  }
  return ranges;
}

/** Comprimento da consulta como é pesquisada (espaços repetidos reduzidos a um). */
function queryLength(query: string): number {
  return query.replace(/\s+/g, " ").trim().length;
}

/** O pedaço que contém a posição `pos` (no fim de uma ocorrência, o que termina nela). */
function locate(chunks: { node: Text; start: number }[], pos: number, isEnd: boolean) {
  for (let i = chunks.length - 1; i >= 0; i--) {
    const c = chunks[i];
    const end = c.start + c.node.data.length;
    if (isEnd ? pos > c.start && pos <= end : pos >= c.start && pos < end) return c;
  }
  return null;
}

type HighlightWindow = Window & { CSS?: { highlights?: Map<string, unknown> }; Highlight?: new (...ranges: Range[]) => { priority: number } };

export const FIND_ALL = "fp-find";
export const FIND_CURRENT = "fp-find-current";

/** Marca todas as ocorrências e, mais forte, a atual. Sem suporte do navegador, não faz nada. */
export function applyHighlights(win: Window, all: Range[], current: Range | null) {
  const w = win as HighlightWindow;
  const reg = w.CSS?.highlights;
  if (!reg || typeof w.Highlight !== "function") return;
  const base = new w.Highlight(...all);
  reg.set(FIND_ALL, base);
  if (current) {
    const cur = new w.Highlight(current);
    cur.priority = 1; // por cima das demais
    reg.set(FIND_CURRENT, cur);
  } else reg.delete(FIND_CURRENT);
}

export function clearHighlights(win: Window) {
  const reg = (win as HighlightWindow).CSS?.highlights;
  reg?.delete(FIND_ALL);
  reg?.delete(FIND_CURRENT);
}

/** Leva a ocorrência para o meio da tela. */
export function revealRange(r: Range) {
  const el = r.startContainer.nodeType === 1 ? (r.startContainer as Element) : r.startContainer.parentElement;
  el?.scrollIntoView({ block: "center", inline: "nearest" });
}
