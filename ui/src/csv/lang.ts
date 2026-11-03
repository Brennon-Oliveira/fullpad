import { HighlightStyle, StreamLanguage, type StreamParser, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { Tag } from "@lezer/highlight";

/**
 * Cada coluna do CSV numa cor, que se repete a cada `COLORS`. É só apresentação: o parser de
 * verdade (células, posições, edição) é o do Rust (`crates/core/src/csv.rs`); este tokenizador
 * segue o mesmo dialeto, só o que importa para pintar: um campo só é "entre aspas" se abre com `"`
 * logo depois do separador ou do começo da linha, `""` dentro de aspas é uma aspa, e a aspa aberta
 * continua nas linhas seguintes.
 */
export const COLORS = 6;

interface State {
  col: number;
  inQuote: boolean;
  atStart: boolean;
}

/** Consome o que falta de um campo entre aspas; `inQuote` fica ligado se a linha acabou antes do fim. */
function quoted(stream: { next(): string | void; peek(): string | void; eol(): boolean }, state: State) {
  while (!stream.eol()) {
    const ch = stream.next();
    if (ch !== '"') continue;
    if (stream.peek() === '"') stream.next();
    else {
      state.inQuote = false;
      return;
    }
  }
}

export function csvParser(delim: string): StreamParser<State> {
  return {
    name: "csv",
    startState: () => ({ col: 0, inQuote: false, atStart: true }),
    copyState: (s) => ({ ...s }),
    token(stream, state) {
      if (stream.sol() && !state.inQuote) {
        state.col = 0;
        state.atStart = true;
      }
      const color = () => `c${state.col % COLORS}`;
      if (state.inQuote) {
        quoted(stream, state);
        return color();
      }
      const ch = stream.peek();
      if (ch === delim) {
        stream.next();
        state.col++;
        state.atStart = true;
        return "delim";
      }
      if (ch === '"' && state.atStart) {
        stream.next();
        state.atStart = false;
        state.inQuote = true;
        quoted(stream, state);
        return color();
      }
      state.atStart = false;
      while (!stream.eol() && stream.peek() !== delim) stream.next();
      return color();
    },
  };
}

const colorTags = Array.from({ length: COLORS }, () => Tag.define());
const delimTag = Tag.define();
const tokenTable: Record<string, Tag> = { delim: delimTag };
colorTags.forEach((t, i) => (tokenTable[`c${i}`] = t));

// Reaproveita as cores de sintaxe do tema (claro/escuro) em vez de definir outras.
const VARS = ["--syn-def", "--syn-string", "--syn-number", "--syn-keyword", "--syn-type", "--syn-prop"];
const style = HighlightStyle.define([
  ...colorTags.map((tag, i) => ({ tag, color: `var(${VARS[i]})` })),
  { tag: delimTag, color: "var(--muted)" },
]);

const cache = new Map<string, Extension>();

/** Linguagem do editor (colunas coloridas) para um separador. Uma por separador, guardada. */
export function csvSupport(delim: string): Extension {
  let ext = cache.get(delim);
  if (!ext) {
    ext = [StreamLanguage.define({ ...csvParser(delim), tokenTable }), syntaxHighlighting(style)];
    cache.set(delim, ext);
  }
  return ext;
}
