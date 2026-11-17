// A janela de lotes dentro do CodeMirror. O documento do editor é a concatenação de alguns lotes
// seguidos do arquivo; este campo guarda onde cada um começa (`bounds`), onde estão os `\n` virtuais
// (`vbreaks`) e qual é a linha do arquivo em que o documento começa (`startLine`). Tudo acompanha as
// edições pelo mapeamento de posições do CodeMirror, então digitar, apagar e colar nas divisas dos
// lotes mantêm as contas certas.
import { Annotation, EditorState, type Extension, MapMode, Prec, StateEffect, StateField, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

export interface WindowState {
  /** Índice (no arquivo) do primeiro lote carregado. */
  first: number;
  /** Linha do arquivo (a partir de 0) em que a primeira linha do documento está. */
  startLine: number;
  /** Onde cada lote começa no documento (n + 1 posições: a última é o fim do documento). */
  bounds: number[];
  /** Onde estão os `\n` virtuais (cortes de linha gigante), em ordem. */
  vbreaks: number[];
  /** Por lote: tem bytes inválidos (só leitura). */
  lossy: boolean[];
}

export const emptyWindow = (): WindowState => ({ first: 0, startLine: 0, bounds: [0], vbreaks: [], lossy: [] });

/** Marca as transações que montam a janela (carregar, deslizar): não são edição da pessoa. */
export const windowLoad = Annotation.define<boolean>();

export const resetWindow = StateEffect.define<WindowState>();
export const appendBatch = StateEffect.define<{ length: number; breaks: number[]; lossy: boolean }>();
export const prependBatch = StateEffect.define<{ length: number; breaks: number[]; lossy: boolean; lines: number }>();
export const dropFirst = StateEffect.define<{ lines: number }>();
export const dropLast = StateEffect.define<null>();

/** Uma transação que monta a janela: sem entrar no histórico do desfazer. */
export const loadSpec = [windowLoad.of(true), Transaction.addToHistory.of(false)];

const lowerBound = (xs: readonly number[], v: number) => {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

export const largeField = StateField.define<WindowState>({
  create: emptyWindow,
  update(w, tr) {
    let { first, startLine, bounds, vbreaks, lossy } = w;
    if (tr.docChanged) {
      const loading = tr.annotation(windowLoad) === true;
      const last = bounds.length - 1;
      // digitar no começo de um lote fica nele (a divisa fica antes do texto novo); o fim do documento
      // vai junto com o texto digitado nele, mas não com o lote que a janela acrescenta
      bounds = bounds.map((b, i) => tr.changes.mapPos(b, i === last && !loading ? 1 : -1));
      vbreaks = vbreaks.flatMap((p) => {
        const m = tr.changes.mapPos(p, 1, MapMode.TrackAfter);
        return m === null ? [] : [m];
      });
    }
    for (const e of tr.effects) {
      if (e.is(resetWindow)) {
        ({ first, startLine, bounds, vbreaks, lossy } = e.value);
      } else if (e.is(appendBatch)) {
        const at = bounds[bounds.length - 1];
        bounds = [...bounds, at + e.value.length];
        vbreaks = [...vbreaks, ...e.value.breaks.map((b) => at + b)];
        lossy = [...lossy, e.value.lossy];
      } else if (e.is(prependBatch)) {
        // o texto novo entrou em [0, length): o resto já foi empurrado pelo mapeamento
        bounds = [bounds[0], e.value.length, ...bounds.slice(1)];
        vbreaks = [...e.value.breaks, ...vbreaks];
        lossy = [e.value.lossy, ...lossy];
        first -= 1;
        startLine -= e.value.lines;
      } else if (e.is(dropFirst)) {
        bounds = bounds.slice(1);
        lossy = lossy.slice(1);
        first += 1;
        startLine += e.value.lines;
      } else if (e.is(dropLast)) {
        bounds = bounds.slice(0, -1);
        lossy = lossy.slice(0, -1);
      }
    }
    return bounds === w.bounds && vbreaks === w.vbreaks && lossy === w.lossy && first === w.first && startLine === w.startLine ? w : { first, startLine, bounds, vbreaks, lossy };
  },
});

/** Número de linha da margem: o da linha **do arquivo** (o editor só conhece a janela). Um corte virtual mostra "↳". */
export function lineNumberFormat(n: number, state: EditorState): string {
  const w = state.field(largeField, false);
  if (!w) return String(n);
  // o CodeMirror também chama isto para medir a largura da margem, com números além das linhas do documento
  if (n > state.doc.lines) return String(w.startLine + n);
  const from = state.doc.line(n).from;
  if (from > 0) {
    const i = lowerBound(w.vbreaks, from - 1);
    if (w.vbreaks[i] === from - 1) return "↳";
  }
  return String(w.startLine + n);
}

/**
 * Posição no texto do **arquivo** da janela (sem os `\n` virtuais dos cortes de linha gigante) → posição no documento do
 * editor. É o que traduz uma troca pedida pela tabela, que vê o texto sem os cortes. `end`: a posição é o fim de um
 * trecho, então um corte virtual logo ali não entra (um trecho que o atravessa por dentro, sim).
 */
export function docPos(w: Pick<WindowState, "vbreaks">, file: number, end = false): number {
  let d = file;
  for (const vb of w.vbreaks) {
    if (end ? vb < d : vb <= d) d++;
    else break;
  }
  return d;
}

/** O inverso de `docPos`: posição no documento → posição no texto do arquivo. */
export function filePos(w: Pick<WindowState, "vbreaks">, doc: number): number {
  return doc - lowerBound(w.vbreaks, doc);
}

/** A linha do arquivo (a partir de 0) em que está a posição `pos` do documento. */
export function fileLineAt(state: EditorState, pos: number): number {
  const w = state.field(largeField);
  return w.startLine + state.doc.lineAt(Math.min(pos, state.doc.length)).number - 1;
}

/** Deixa a edição passar só se ela não toca num lote com bytes inválidos (regravaria `U+FFFD`). */
const protectLossy = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(windowLoad)) return tr;
  const w = tr.startState.field(largeField, false);
  if (!w || !w.lossy.some(Boolean)) return tr;
  let blocked = false;
  tr.changes.iterChangedRanges((fromA, toA) => {
    for (let i = 0; i < w.lossy.length; i++) {
      if (!w.lossy[i]) continue;
      const [a, b] = [w.bounds[i], w.bounds[i + 1]];
      if (fromA < b && toA > a) blocked = true; // apaga ou troca
      else if (fromA === toA && fromA >= a && fromA < b) blocked = true; // insere dentro
    }
  });
  return blocked ? [] : tr;
});

/**
 * Atalhos que, numa aba grande, o app trata no lugar do CodeMirror: o painel de busca dele só
 * enxergaria os lotes carregados. O app troca estas funções ao iniciar.
 */
export const largeKeys: { find: () => void; replace: () => void } = { find() {}, replace() {} };

/** O que uma aba grande acrescenta ao editor. */
export const largeExtensions: Extension = [
  Prec.highest(
    keymap.of([
      { key: "Mod-f", run: () => (largeKeys.find(), true) },
      { key: "Mod-h", run: () => (largeKeys.replace(), true) },
    ]),
  ),
  // o arquivo só quebra linha em `\n`: um `\r` solto é um caractere (como no índice do Rust)
  EditorState.lineSeparator.of("\n"),
  // colar texto do Windows traz `\r\n`: vira `\n`, senão o arquivo ganharia um `\r` a mais
  EditorView.clipboardInputFilter.of((text) => text.replace(/\r\n?/g, "\n")),
  largeField,
  protectLossy,
];
