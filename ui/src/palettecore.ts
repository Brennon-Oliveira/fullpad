/**
 * Lógica pura da paleta (Ctrl+P): o prefixo do que foi digitado decide o modo, a busca aproximada
 * ordena os resultados e os "símbolos" (`@`) saem do texto ou da árvore do arquivo. Sem DOM.
 */
import type { JNode } from "./json/tree";
import { pathOf } from "./json/tree";

export type Mode = "files" | "line" | "symbols" | "commands";

export interface Parsed {
  mode: Mode;
  /** O que filtra a lista (sem o prefixo e sem o `:linha` do fim). */
  text: string;
  /** Linha pedida (1 = primeira), em `:` e em `arquivo:linha`. */
  line?: number;
  col?: number;
}

/** `>` comandos, `:` linha, `@` símbolos; senão arquivos, com `:linha[:coluna]` opcional no fim. */
export function parseQuery(q: string): Parsed {
  if (q.startsWith(">")) return { mode: "commands", text: q.slice(1).trim() };
  if (q.startsWith("@")) return { mode: "symbols", text: q.slice(1).trim() };
  if (q.startsWith(":")) {
    const m = /^:\s*(\d+)?(?:\s*:\s*(\d+))?/.exec(q)!;
    return { mode: "line", text: "", line: m[1] ? Number(m[1]) : undefined, col: m[2] ? Number(m[2]) : undefined };
  }
  const m = /^(.*?):(\d+)(?::(\d+))?\s*$/.exec(q);
  if (m && !/^[A-Za-z]$/.test(m[1])) return { mode: "files", text: m[1].trim(), line: Number(m[2]), col: m[3] ? Number(m[3]) : undefined };
  return { mode: "files", text: q.trim() };
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const SEP = /[\s/\\._\-:>›$[\]]/;

/** Pontuação de `q` como subsequência de `s` (maior é melhor), ou `null` se não casa. Sem acento nem maiúscula. */
export function fuzzyScore(q: string, s: string): number | null {
  const query = fold(q).replace(/\s+/g, "");
  if (!query) return 0;
  const t = fold(s);
  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of query) {
    const at = t.indexOf(ch, from);
    if (at < 0) return null;
    score += 1;
    if (at === prev + 1) score += 3; // seguidas
    if (at === 0 || SEP.test(t[at - 1])) score += 4; // começo de palavra
    score -= Math.min(at - from, 10) * 0.1;
    prev = at;
    from = at + 1;
  }
  const sub = t.indexOf(query);
  if (sub >= 0) score += 6 + (sub === 0 ? 4 : 0); // trecho inteiro vale mais
  return score - t.length * 0.01;
}

/** Melhor pontuação entre vários campos (o primeiro, o nome, pesa mais). */
export function bestScore(q: string, fields: string[]): number | null {
  let best: number | null = null;
  fields.forEach((f, i) => {
    const s = fuzzyScore(q, f);
    if (s === null) return;
    const v = i === 0 ? s + 5 : s;
    if (best === null || v > best) best = v;
  });
  return best;
}

/** Filtra e ordena (estável: a ordem original desempata). Sem texto, devolve tudo como veio. */
export function rank<T>(items: T[], q: string, fields: (x: T) => string[]): T[] {
  if (!q.trim()) return items;
  const scored: { x: T; s: number; i: number }[] = [];
  items.forEach((x, i) => {
    const s = bestScore(q, fields(x));
    if (s !== null) scored.push({ x, s, i });
  });
  return scored.sort((a, b) => b.s - a.s || a.i - b.i).map((r) => r.x);
}

export interface Symbol {
  label: string;
  /** Posição (UTF-16) onde o cursor vai. */
  pos: number;
  /** Texto à direita (nível, tipo). */
  meta?: string;
  /** Recuo na lista (nível do título). */
  depth?: number;
}

/** Títulos ATX do markdown, ignorando blocos de código cercados. */
export function markdownSymbols(text: string): Symbol[] {
  const out: Symbol[] = [];
  let fence: string | null = null;
  let pos = 0;
  for (const line of text.split("\n")) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    } else if (fence === null) {
      const h = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*\r?$/.exec(line);
      if (h) out.push({ label: h[2], pos, meta: `H${h[1].length}`, depth: h[1].length - 1 });
    }
    pos += line.length + 1;
  }
  return out;
}

/** Tabelas, enums e grupos do DBML. */
export function dbmlSymbols(text: string): Symbol[] {
  const out: Symbol[] = [];
  const re = /^[ \t]*(Table|TableGroup|Enum|Project)[ \t]+("[^"]+"|[\w.]+)/gim;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ label: m[2].replace(/^"|"$/g, ""), pos: m.index + m[0].indexOf(m[1]), meta: m[1] });
  }
  return out;
}

const MAX_SYMBOLS = 5000;

/** Nós da árvore (JSON/YAML/TOML) pelo caminho; só os que têm chave ou lugar numa lista, até um teto. */
export function treeSymbols(nodes: JNode[]): Symbol[] {
  const out: Symbol[] = [];
  for (let i = 1; i < nodes.length && out.length < MAX_SYMBOLS; i++) {
    const n = nodes[i];
    out.push({ label: pathOf(nodes, i), pos: n.kfrom ?? n.from, meta: n.kind });
  }
  return out;
}

/** Recentes: o caminho vai para o começo, sem repetir, limitado. */
export function pushRecent(list: string[], path: string, max = 50): string[] {
  const key = (p: string) => p.toLowerCase().replace(/\\/g, "/");
  return [path, ...list.filter((p) => key(p) !== key(path))].slice(0, max);
}
