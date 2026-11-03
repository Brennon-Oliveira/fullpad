import { StringStream } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { COLORS, csvParser } from "./lang";

type Tok = [string, string];

function tokens(src: string, delim = ","): Tok[] {
  const p = csvParser(delim);
  const state = p.startState!(2);
  const out: Tok[] = [];
  for (const line of src.split("\n")) {
    const stream = new StringStream(line, 4, 2);
    while (!stream.eol()) {
      const t = p.token(stream, state);
      expect(stream.pos, "o tokenizador precisa avançar").toBeGreaterThan(stream.start);
      if (t) out.push([stream.current(), t]);
      stream.start = stream.pos;
    }
  }
  return out;
}

describe("colunas coloridas do CSV", () => {
  it("cada coluna uma cor, separador à parte, e a cor reinicia na linha seguinte", () => {
    expect(tokens("a,bb,c\nd,e")).toEqual([
      ["a", "c0"], [",", "delim"], ["bb", "c1"], [",", "delim"], ["c", "c2"],
      ["d", "c0"], [",", "delim"], ["e", "c1"],
    ]);
  });

  it("as cores se repetem depois de COLORS colunas", () => {
    const toks = tokens(Array.from({ length: COLORS + 1 }, (_, i) => `x${i}`).join(","));
    const cols = toks.filter(([, t]) => t !== "delim");
    expect(cols[0][1]).toBe("c0");
    expect(cols[COLORS][1]).toBe("c0");
  });

  it("separador dentro de aspas não troca de coluna", () => {
    const t = tokens('1,"a, b",3');
    expect(t.filter(([, k]) => k !== "delim").map(([, k]) => k)).toEqual(["c0", "c1", "c2"]);
    expect(t[2]).toEqual(['"a, b"', "c1"]);
  });

  it("aspa duplicada dentro de aspas não fecha o campo", () => {
    const t = tokens('"diz ""oi""",x');
    expect(t.filter(([, k]) => k !== "delim").map(([, k]) => k)).toEqual(["c0", "c1"]);
  });

  it("aspas que continuam na linha seguinte mantêm a coluna", () => {
    const t = tokens('a,"x\ny,z",b\nc');
    expect(t.filter(([, k]) => k !== "delim")).toEqual([
      ["a", "c0"], ['"x', "c1"], ['y,z"', "c1"], ["b", "c2"], ["c", "c0"],
    ]);
  });

  it("aspa no meio de um campo sem aspas é texto", () => {
    const t = tokens('ab"cd,e');
    expect(t.filter(([, k]) => k !== "delim").map(([, k]) => k)).toEqual(["c0", "c1"]);
  });

  it("depois da aspa que fecha, o resto vai até o separador", () => {
    const t = tokens('"a"b,c');
    expect(t.filter(([, k]) => k !== "delim").map(([, k]) => k)).toEqual(["c0", "c0", "c1"]);
  });

  it("campos vazios e outros separadores", () => {
    expect(tokens("a,,c").map(([, k]) => k)).toEqual(["c0", "delim", "delim", "c2"]);
    expect(tokens("a;b,c;d", ";").filter(([, k]) => k !== "delim")).toEqual([["a", "c0"], ["b,c", "c1"], ["d", "c2"]]);
    expect(tokens("a\tb", "\t").map(([, k]) => k)).toEqual(["c0", "delim", "c1"]);
  });
});
