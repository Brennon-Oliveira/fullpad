// Posição de leitura e contas de layout do leitor. Sem DOM: testado em pos.test.ts.

/**
 * Onde o usuário parou. Vai para a sessão (`TabState.reader`), que é opaca para o Rust; por isso
 * tudo que vem de lá passa por `normalizePos`: nunca confiamos no que veio do disco.
 */
export interface ReaderPos {
  /** Página (a partir de 1). */
  page: number;
  /** Quanto da página já passou pelo topo da tela, de 0 a 1. */
  frac: number;
  /** Escala fixa, ou `null` para ajustar à largura do painel. */
  zoom: number | null;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;

/** Cada Ctrl+= / Ctrl+- (e cada botão +/−) muda o zoom do documento em 15%. */
export const ZOOM_KEY_FACTOR = 1.15;

/** Fator de zoom de uma volta da roda: um clique (100) vale 10%; o touchpad anda em fração. */
export const wheelFactor = (deltaY: number) => Math.pow(1.1, -deltaY / 100);

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function normalizePos(raw: unknown): ReaderPos {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const page = num(o.page);
  const frac = num(o.frac);
  const zoom = num(o.zoom);
  return {
    page: page === null ? 1 : Math.max(1, Math.floor(page)),
    frac: frac === null ? 0 : clamp(frac, 0, 1),
    zoom: zoom === null ? null : clamp(zoom, MIN_ZOOM, MAX_ZOOM),
  };
}

/**
 * Índice (a partir de 0) da página que contém a posição `y`, por busca binária. `topOf(i)` dá o
 * topo da página `i`, em ordem crescente. Antes da primeira devolve 0; depois da última, a última.
 */
export function pageIndexAt(count: number, topOf: (i: number) => number, y: number): number {
  if (count <= 0) return 0;
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (topOf(mid) <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Faixa de páginas (índices, inclusive) que tocam `[from, to]`. */
export function visibleRange(count: number, topOf: (i: number) => number, heightOf: (i: number) => number, from: number, to: number) {
  const first = pageIndexAt(count, topOf, from);
  let last = pageIndexAt(count, topOf, to);
  while (last < count - 1 && topOf(last) + heightOf(last) < to) last++;
  return { first, last: Math.max(first, last) };
}

/**
 * Escala que deixa a página `pageWidth` (a 100%) ocupando a largura `avail`, sem passar dos limites.
 * Uma página absurdamente larga (ou largura nula) não gera escala zero nem infinita.
 */
export function fitScale(avail: number, pageWidth: number): number {
  if (!(avail > 0) || !(pageWidth > 0)) return 1;
  return clamp(avail / pageWidth, MIN_ZOOM, MAX_ZOOM);
}

/**
 * Resolução extra do canvas (pixels por pixel de tela) que cabe no limite de memória: o canvas
 * de uma página gigante não pode pedir gigabytes. Nunca passa de `dpr` nem de 2.
 */
export function canvasRatio(cssW: number, cssH: number, dpr: number, maxPixels: number): number {
  const want = clamp(dpr || 1, 1, 2);
  if (!(cssW > 0) || !(cssH > 0)) return want;
  return Math.min(want, Math.sqrt(maxPixels / (cssW * cssH)));
}

/** Só `http`, `https` e `mailto` abrem fora do app (a mesma regra do `open_url`). */
export const isSafeLink = (url: string) => /^(https?:|mailto:)/i.test(url.trim());

const nf = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${nf.format(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${nf.format(n / 1024 / 1024)} MB`;
  return `${nf.format(n / 1024 / 1024 / 1024)} GB`;
}
