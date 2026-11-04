import { StringStream } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { mermaidParser } from "./mermaidlang";

type Tok = [string, string];

function tokens(src: string): Tok[] {
  const state = mermaidParser.startState!(2);
  const out: Tok[] = [];
  for (const line of src.split("\n")) {
    const stream = new StringStream(line, 4, 2);
    if (stream.sol()) mermaidParser.blankLine?.(state, 2);
    while (!stream.eol()) {
      const t = mermaidParser.token(stream, state);
      if (t) out.push([stream.current(), t]);
      stream.start = stream.pos;
    }
  }
  return out;
}
const kinds = (src: string, kind: string) => tokens(src).filter(([, t]) => t === kind).map(([s]) => s);

describe("destaque do Mermaid", () => {
  it("tipo do diagrama, direção e nomes", () => {
    expect(kinds("flowchart LR\n  A --> B", "typeName")).toEqual(["flowchart"]);
    expect(kinds("flowchart LR\n  A --> B", "atom")).toEqual(["LR"]);
    expect(kinds("flowchart LR\n  A --> B", "variableName")).toEqual(["A"]);
  });

  it("setas de vários tipos", () => {
    const arrows = ["-->", "---", "==>", "-.->", "->>", "-->>", "--x", "<-->"];
    for (const a of arrows) expect(kinds(`  A ${a} B`, "operator"), a).toEqual([a]);
  });

  it("comentário, texto entre aspas e palavras de estrutura", () => {
    expect(kinds("%% um comentário\nflowchart TD", "comment")).toEqual(["%% um comentário"]);
    expect(kinds('  A["texto com --> dentro"] --> B', "string")).toEqual(['"texto com --> dentro"']);
    expect(kinds("subgraph g1\n  A\nend", "keyword")).toEqual(["subgraph", "end"]);
    expect(kinds("sequenceDiagram\n  participant A as Pessoa", "keyword")).toEqual(["participant", "as"]);
  });

  it("a seta dentro de uma string não conta como seta", () => {
    expect(kinds('  A["a --> b"]', "operator")).toEqual([]);
  });
});
