import { StreamLanguage, type StreamParser } from "@codemirror/language";

/**
 * Destaque de sintaxe do Mermaid (`.mmd`/`.mermaid` e blocos ` ```mermaid ` no markdown). Colore o que é
 * comum a todos os tipos de diagrama (tipo do diagrama, palavras de estrutura, setas, textos entre aspas
 * e comentários `%%`); não tenta entender a gramática de cada tipo. Pequeno, então fica no bundle.
 */

interface State {
  first: boolean; // ainda não leu nenhuma palavra na linha
  typed: boolean; // já passou o tipo do diagrama (`flowchart`, `sequenceDiagram`…)
}

const TYPES = new Set([
  "graph", "flowchart", "sequencediagram", "classdiagram", "statediagram", "statediagram-v2", "erdiagram", "journey",
  "gantt", "pie", "quadrantchart", "requirementdiagram", "gitgraph", "mindmap", "timeline", "sankey-beta", "xychart-beta",
  "block-beta", "packet-beta", "architecture-beta", "kanban", "c4context", "c4container", "c4component", "c4dynamic",
]);
const KEYWORDS = new Set([
  "subgraph", "end", "direction", "participant", "actor", "as", "loop", "alt", "else", "opt", "par", "and", "critical",
  "option", "break", "rect", "note", "over", "of", "left", "right", "title", "activate", "deactivate", "autonumber",
  "class", "classdef", "style", "linkstyle", "click", "state", "section", "dateformat", "axisformat", "excludes",
  "todaymarker", "accdescr", "acctitle", "namespace", "interface", "enum", "link", "links", "callback", "call", "href",
  "showdata", "default", "init",
]);
const DIRECTIONS = new Set(["tb", "td", "bt", "rl", "lr"]);

export const mermaidParser: StreamParser<State> = {
  name: "mermaid",
  startState: () => ({ first: true, typed: false }),
  token(stream, state) {
    if (stream.sol()) state.first = true;
    if (stream.eatSpace()) return null;
    if (stream.match(/^%%.*/)) return "comment";
    if (stream.match(/^"[^"]*"?/) || stream.match(/^`[^`]*`?/)) return "string";
    if (stream.match(/^(?:<\|?|[ox])?(?:-{2,}|={2,}|-\.+-|\.{2,})[>xo|)]*/) || stream.match(/^-{1,2}[>)x]{1,2}/) || stream.match(/^[<|]?\|[>]?/)) {
      state.first = false;
      return "operator";
    }
    if (stream.match(/^-?\d+(?:\.\d+)?%?/)) {
      state.first = false;
      return "number";
    }
    const word = stream.match(/^[A-Za-z_][\w-]*/) as RegExpMatchArray | null;
    if (word) {
      const w = word[0].toLowerCase();
      const wasFirst = state.first;
      state.first = false;
      if (wasFirst && TYPES.has(w)) {
        state.typed = true;
        return "typeName";
      }
      if (DIRECTIONS.has(w) && state.typed) return "atom";
      if (KEYWORDS.has(w)) return "keyword";
      return wasFirst ? "variableName" : null;
    }
    stream.next();
    state.first = false;
    return /[[\](){}]/.test(stream.current()) ? "bracket" : "punctuation";
  },
  languageData: { commentTokens: { line: "%%" } },
};

export const mermaidLanguage = StreamLanguage.define(mermaidParser);
