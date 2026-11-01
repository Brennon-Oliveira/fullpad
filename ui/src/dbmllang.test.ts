import { StringStream } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { dbmlParser } from "./dbmllang";

type Tok = [string, string | null];

/** Tokeniza um texto (várias linhas) e devolve só os tokens que têm tipo. */
function tokens(src: string): Tok[] {
  const state = dbmlParser.startState!(2);
  const out: Tok[] = [];
  for (const line of src.split("\n")) {
    const stream = new StringStream(line, 4, 2);
    while (!stream.eol()) {
      const t = dbmlParser.token(stream, state);
      if (t) out.push([stream.current(), t]);
      stream.start = stream.pos;
    }
  }
  return out;
}
const kinds = (src: string, kind: string) => tokens(src).filter(([, t]) => t === kind).map(([s]) => s);

describe("destaque do DBML", () => {
  it("palavra-chave, nome da tabela, coluna e tipo", () => {
    expect(tokens("Table users {\n  id integer\n}")).toEqual([
      ["Table", "keyword"],
      ["users", "def"],
      ["{", "bracket"],
      ["id", "variable"],
      ["integer", "type"],
      ["}", "bracket"],
    ]);
  });

  it("nome com schema e alias", () => {
    const t = tokens("Table core.posts as P {");
    expect(t.slice(0, 4)).toEqual([
      ["Table", "keyword"],
      ["core.posts", "def"],
      ["as", "keyword"],
      ["P", "def"],
    ]);
  });

  it("configurações entre colchetes", () => {
    const t = tokens("Table a {\n  id int [pk, not null, note: 'chave', default: 0]\n}");
    expect(kinds("Table a {\n  id int [pk, not null, note: 'chave', default: 0]\n}", "keyword")).toEqual(["Table", "pk", "not", "null"]);
    expect(t.filter(([, k]) => k === "property").map(([s]) => s)).toEqual(["note", "default"]);
    expect(t.find(([s]) => s === "'chave'")![1]).toBe("string");
    expect(t.find(([s]) => s === "0")![1]).toBe("number");
  });

  it("relações, inclusive as opcionais, são operadores", () => {
    expect(kinds("Ref: a.id > b.id", "operator")).toEqual([">"]);
    expect(kinds("Ref user_posts: posts.user_id ?> users.id", "operator")).toEqual(["?>"]);
    expect(kinds("Ref: users.id <? follows.x", "operator")).toEqual(["<?"]);
    expect(kinds("Ref: a.id <> b.id", "operator")).toEqual(["<>"]);
    expect(kinds("Ref user_posts: a.id > b.id", "def")).toEqual(["user_posts"]);
  });

  it("comentários de linha e de bloco (várias linhas)", () => {
    expect(tokens("// oi\nTable a {}")[0]).toEqual(["// oi", "comment"]);
    const t = tokens("/* um\ndois */ Table a {}");
    expect(t.slice(0, 3)).toEqual([["/* um", "comment"], ["dois */", "comment"], ["Table", "keyword"]]);
  });

  it("strings, aspas triplas e expressões", () => {
    expect(kinds("Note: 'texto'", "string")).toEqual(["'texto'"]);
    expect(kinds("Note: '''a\nb'''\nTable x {}", "string")).toEqual(["'''a", "b'''"]);
    expect(kinds("x int [default: `now()`]", "string-2")).toEqual(["`now()`"]);
    expect(tokens('Table "minha tabela" {')[1]).toEqual(['"minha tabela"', "def"]);
  });

  it("cores e números", () => {
    expect(kinds("Table a [headercolor: #3498DB] {", "atom")).toEqual(["#3498DB"]);
    expect(kinds("x decimal(10, 2)", "number")).toEqual(["10", "2"]);
  });

  it("valores de enum", () => {
    expect(kinds("Enum e {\n  draft\n  private [note: 'x']\n}", "atom")).toEqual(["draft", "private"]);
  });

  it("coluna chamada note/ref não vira palavra-chave", () => {
    const t = tokens("Table a {\n  note text\n  ref int\n}");
    expect(t.filter(([, k]) => k === "keyword").map(([s]) => s)).toEqual(["Table"]);
    expect(t.filter(([, k]) => k === "type").map(([s]) => s)).toEqual(["text", "int"]);
  });

  it("Indexes e Note dentro da tabela são palavras-chave", () => {
    const k = kinds("Table a {\n  id int\n  Note: 'x'\n  Indexes {\n    id [pk]\n  }\n}", "keyword");
    expect(k).toEqual(["Table", "Note", "Indexes", "pk"]);
  });

  it("não quebra com o esquema novo (Records, ?>)", () => {
    const src = "Records users(id, username) {\n  0, 'Alice'\n}\nRef: users.id <? follows.a";
    expect(kinds(src, "keyword")).toEqual(["Records", "Ref"]);
    expect(kinds(src, "def")).toEqual(["users"]);
  });
});
