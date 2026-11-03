// Busca no documento (PDF e EPUB): comparação sem diferenciar maiúsculas nem acentos, e a varredura
// por "unidades" (páginas ou capítulos). Sem DOM: testado em find.test.ts.

export const MIN_QUERY = 2;
export const MAX_QUERY = 100;
export const MAX_HITS = 500;

/** Letra sem acento e minúscula, com o MESMO comprimento (as posições do texto original valem no dobrado). */
export function foldChar(ch: string): string {
  let c = ch.normalize("NFD")[0] ?? ch; // letra base, sem o acento
  if (c.length !== ch.length) c = ch;
  const lower = c.toLowerCase();
  return lower.length === ch.length ? lower : c;
}

/** Texto dobrado: sem maiúsculas, acentos e com todo espaço em branco virando " ". Mesmo comprimento do original. */
export function fold(s: string): string {
  let out = "";
  for (const ch of s) out += /\s/.test(ch) ? " ".repeat(ch.length) : foldChar(ch);
  return out;
}

/** A consulta como é pesquisada: dobrada, com espaços repetidos reduzidos a um e sem as pontas. */
export const normalizeQuery = (q: string) => fold(q).replace(/ +/g, " ").trim();

/** Posições (no texto original) de cada ocorrência da consulta, sem sobrepor. */
export function findOffsets(text: string, query: string, max = 5000): number[] {
  const q = normalizeQuery(query);
  if (q.length < MIN_QUERY) return [];
  const hay = fold(text);
  const out: number[] = [];
  let at = 0;
  while (out.length < max) {
    const i = hay.indexOf(q, at);
    if (i < 0) break;
    out.push(i);
    at = i + q.length;
  }
  return out;
}

/** Um trecho em volta da ocorrência, em uma linha só, com reticências nas pontas cortadas. */
export function snippetAt(text: string, at: number, len: number, radius = 36): string {
  const from = Math.max(0, at - radius);
  const to = Math.min(text.length, at + len + radius);
  const body = text.slice(from, to).replace(/\s+/g, " ").trim();
  return `${from > 0 ? "…" : ""}${body}${to < text.length ? "…" : ""}`;
}

export interface Hit {
  /** Página (PDF) ou capítulo (EPUB), a partir de 0. */
  unit: number;
  /** Qual ocorrência dentro da unidade (a n-ésima, a partir de 0). */
  nth: number;
  snippet: string;
}

export interface Searchable {
  /** Quantas unidades há (páginas ou capítulos). */
  units: number;
  /** Texto de uma unidade. Uma que falha vale como vazia: a busca segue. */
  textOf(unit: number): Promise<string>;
}

export interface SearchResult {
  hits: Hit[];
  /** Parou no limite de resultados. */
  truncated: boolean;
  /** Foi cancelada antes de varrer tudo. */
  cancelled: boolean;
}

/**
 * Varre as unidades em ordem, uma de cada vez (a tela continua respondendo entre elas), e para ao
 * chegar em `MAX_HITS` ou quando `isCancelled()` diz que a consulta já não vale.
 */
export async function searchUnits(src: Searchable, query: string, isCancelled: () => boolean, onProgress?: (done: number, total: number, hits: Hit[]) => void): Promise<SearchResult> {
  const q = normalizeQuery(query);
  const hits: Hit[] = [];
  if (q.length < MIN_QUERY || q.length > MAX_QUERY) return { hits, truncated: false, cancelled: false };
  for (let u = 0; u < src.units; u++) {
    if (isCancelled()) return { hits, truncated: false, cancelled: true };
    let text = "";
    try {
      text = await src.textOf(u);
    } catch {
      /* unidade ilegível: segue */
    }
    const offsets = findOffsets(text, q);
    for (let n = 0; n < offsets.length; n++) {
      hits.push({ unit: u, nth: n, snippet: snippetAt(text, offsets[n], q.length) });
      if (hits.length >= MAX_HITS) return { hits, truncated: true, cancelled: false };
    }
    onProgress?.(u + 1, src.units, hits);
  }
  return { hits, truncated: false, cancelled: isCancelled() };
}
