import { StreamLanguage, type StreamParser } from "@codemirror/language";

/**
 * Destaque de sintaxe do DBML/DBMLX para o editor (tokenizador por linha, sem dependências extras).
 * Fica fora de `dbml/` de propósito: é pequeno e o editor precisa dele na abertura, ao contrário
 * do parser e do dagre, que só carregam sob demanda.
 */

interface State {
  block: boolean; // dentro de /* ... */
  multi: boolean; // dentro de '''...'''
  bracket: number; // profundidade de [ ... ] (configurações)
  stack: string[]; // blocos { } abertos: "table", "enum", "indexes"...
  pending: string | null; // bloco que será aberto no próximo `{`
  expect: "name" | "refname" | null;
  word: number; // índice da palavra na linha
}

const BLOCKS = new Set(["table", "tablegroup", "enum", "ref", "project", "note", "indexes", "records", "tablepartial", "diagramview", "checks"]);
const NAMED = new Set(["table", "tablegroup", "enum", "tablepartial", "project", "diagramview", "records"]);
const FLAGS = new Set(["pk", "primary", "key", "not", "null", "unique", "increment"]);
const ACTIONS = new Set(["cascade", "restrict", "set", "no", "action", "default"]);
const ATOMS = new Set(["true", "false", "null"]);
const COLUMN_BLOCKS = new Set(["table", "tablepartial"]);

const WORD = /^[A-Za-z_][\w$]*/;

/** Lê o resto de uma string entre aspas; `true` se fechou na linha. */
function skipQuoted(stream: { next(): string | void; eol(): boolean }, quote: string): boolean {
  let ch: string | void;
  while ((ch = stream.next()) !== undefined) {
    if (ch === "\\") stream.next();
    else if (ch === quote) return true;
  }
  return false;
}

export const dbmlParser: StreamParser<State> = {
  name: "dbml",
  startState: () => ({ block: false, multi: false, bracket: 0, stack: [], pending: null, expect: null, word: 0 }),
  copyState: (s) => ({ ...s, stack: [...s.stack] }),

  token(stream, state) {
    if (stream.sol()) {
      state.word = 0;
      state.expect = null;
      state.pending = null;
    }
    if (state.block) {
      if (stream.skipTo("*/")) {
        stream.match("*/");
        state.block = false;
      } else stream.skipToEnd();
      return "comment";
    }
    if (state.multi) {
      if (stream.skipTo("'''")) {
        stream.match("'''");
        state.multi = false;
      } else stream.skipToEnd();
      return "string";
    }
    if (stream.eatSpace()) return null;

    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      state.block = true;
      if (stream.skipTo("*/")) {
        stream.match("*/");
        state.block = false;
      } else stream.skipToEnd();
      return "comment";
    }
    if (stream.match("'''")) {
      state.multi = true;
      if (stream.skipTo("'''")) {
        stream.match("'''");
        state.multi = false;
      } else stream.skipToEnd();
      return "string";
    }

    const ch = stream.peek();
    if (ch === "'" || ch === '"') {
      stream.next();
      skipQuoted(stream, ch);
      if (state.expect === "name") {
        state.expect = null;
        return "def"; // nome entre aspas: Table "minha tabela"
      }
      return "string";
    }
    if (ch === "`") {
      stream.next();
      skipQuoted(stream, "`");
      return "string-2"; // expressão
    }
    if (stream.match(/^#[0-9a-fA-F]{3,8}\b/)) return "atom"; // cor
    if (stream.match(/^-?\d+(\.\d+)?/)) return "number";
    if (stream.match(/^\??(<>|<|>|-)\??/)) return "operator";

    const inTable = COLUMN_BLOCKS.has(state.stack[state.stack.length - 1] ?? "");

    if (stream.match(WORD)) {
      const lower = stream.current().toLowerCase();
      const idx = state.word++;
      const followedByColon = !!stream.match(/^\s*:/, false);
      const followedByBlock = !!stream.match(/^\s*[:{]/, false);

      if (state.expect === "name") {
        while (stream.match(/^\.[\w$]+/)); // schema.nome
        state.expect = null;
        return "def";
      }
      if (state.expect === "refname" && followedByColon) {
        state.expect = null;
        return "def";
      }
      if (state.bracket > 0) {
        if (followedByColon) return "property";
        if (FLAGS.has(lower)) return "keyword";
        if (ACTIONS.has(lower) || ATOMS.has(lower)) return "atom";
        return "variable";
      }
      // Dentro de uma tabela, `note`/`ref`... só é palavra-chave se abrir bloco ou tiver `:`
      // (senão é o nome de uma coluna).
      if (BLOCKS.has(lower) && (!inTable || followedByBlock)) {
        state.pending = lower;
        if (NAMED.has(lower)) state.expect = "name";
        else if (lower === "ref") state.expect = "refname";
        return "keyword";
      }
      if (lower === "as" && !inTable && idx > 0) {
        state.expect = "name";
        return "keyword";
      }
      if (inTable && idx === 0) return "variable";
      if (inTable && idx === 1) return "type";
      if (state.stack[state.stack.length - 1] === "enum" && idx === 0) return "atom";
      if (ATOMS.has(lower)) return "atom";
      if (followedByColon) return "property";
      return "variable";
    }

    stream.next();
    switch (ch) {
      case "[":
        state.bracket++;
        return "bracket";
      case "]":
        state.bracket = Math.max(0, state.bracket - 1);
        return "bracket";
      case "{":
        state.stack.push(state.pending ?? "");
        state.pending = null;
        return "bracket";
      case "}":
        state.stack.pop();
        return "bracket";
      case ":":
        state.expect = null;
        return "punctuation";
      case "(":
      case ")":
      case ",":
      case ".":
      case ";":
      case "*":
        return "punctuation";
      default:
        return null;
    }
  },

  languageData: { commentTokens: { line: "//", block: { open: "/*", close: "*/" } } },
};

export const dbmlLanguage = StreamLanguage.define(dbmlParser);
