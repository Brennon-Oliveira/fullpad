import { describe, expect, it } from "vitest";
import { dbmlSymbols, fuzzyScore, markdownSymbols, parseQuery, pushRecent, rank, treeSymbols } from "./palettecore";

describe("parseQuery", () => {
  it("reconhece os prefixos", () => {
    expect(parseQuery(">forma")).toEqual({ mode: "commands", text: "forma" });
    expect(parseQuery("@ intro")).toEqual({ mode: "symbols", text: "intro" });
    expect(parseQuery(":")).toEqual({ mode: "line", text: "", line: undefined, col: undefined });
    expect(parseQuery(":42")).toMatchObject({ mode: "line", line: 42 });
    expect(parseQuery(":42:7")).toMatchObject({ mode: "line", line: 42, col: 7 });
  });
  it("arquivo com linha no fim", () => {
    expect(parseQuery("main:120")).toEqual({ mode: "files", text: "main", line: 120, col: undefined });
    expect(parseQuery("main:120:3")).toMatchObject({ text: "main", line: 120, col: 3 });
    expect(parseQuery("main")).toEqual({ mode: "files", text: "main" });
    expect(parseQuery("main:")).toEqual({ mode: "files", text: "main:" });
  });
  it("letra de unidade não é linha", () => {
    expect(parseQuery("c:12")).toEqual({ mode: "files", text: "c:12" });
  });
});

describe("fuzzy", () => {
  it("ignora acento e maiúscula e exige a ordem", () => {
    expect(fuzzyScore("ação", "Acao.md")).not.toBeNull();
    expect(fuzzyScore("ba", "ab")).toBeNull();
  });
  it("prefere começo de palavra e trechos inteiros", () => {
    const a = fuzzyScore("nota", "nota-versao.md")!;
    const b = fuzzyScore("nota", "nuvem ou tarde.md")!;
    expect(a).toBeGreaterThan(b);
  });
  it("rank ordena e filtra, e sem texto mantém a ordem", () => {
    const items = ["zeta.md", "readme.md", "notes/README.md"];
    expect(rank(items, "", (x) => [x])).toEqual(items);
    expect(rank(items, "read", (x) => [x])[0]).toBe("readme.md");
    expect(rank(items, "xyz", (x) => [x])).toEqual([]);
  });
});

describe("símbolos", () => {
  it("títulos do markdown, sem os de dentro de código", () => {
    const md = "# Um\ntexto\n```\n# nao\n```\n## Dois ##\n";
    const s = markdownSymbols(md);
    expect(s.map((x) => x.label)).toEqual(["Um", "Dois"]);
    expect(s[1].pos).toBe(md.indexOf("## Dois"));
    expect(s[1].depth).toBe(1);
  });
  it("tabelas do DBML", () => {
    const s = dbmlSymbols('Table users {\n id int\n}\nEnum "tipo x" { a }\n');
    expect(s.map((x) => x.label)).toEqual(["users", "tipo x"]);
  });
  it("caminhos da árvore", () => {
    const nodes = [
      { parent: -1, kind: "object", from: 0, to: 20, end: 3, len: 1 },
      { parent: 0, kind: "object", key: "a", kfrom: 2, from: 5, to: 18, end: 3, len: 1 },
      { parent: 1, kind: "number", key: "b", kfrom: 7, from: 10, to: 12, end: 3, len: 0 },
    ] as never;
    expect(treeSymbols(nodes).map((x) => [x.label, x.pos])).toEqual([["$.a", 2], ["$.a.b", 7]]);
  });
});

describe("recentes", () => {
  it("sobe o repetido e limita", () => {
    expect(pushRecent(["a", "B"], "b")).toEqual(["b", "a"]);
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
});
