import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { toLintDiagnostics } from "./editor";
import { service } from "./test-util";

const lint = (text: string) => {
  const doc = EditorState.create({ doc: text }).doc;
  return { doc, diags: toLintDiagnostics(text, doc, service.diagnostics(text)) };
};

describe("diagnóstico no editor", () => {
  it("texto válido não gera diagnóstico", () => {
    expect(lint("Table a { id int }").diags).toEqual([]);
  });

  it("aponta o trecho exato de um erro semântico", () => {
    const text = "Table a { id int }\nTable b { x int }\nRef: b.x > a.nope";
    const { diags } = lint(text);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].message).toContain("nope");
    expect(text.slice(diags[0].from, diags[0].to)).toBe("nope");
  });

  it("aponta erro de sintaxe dentro da linha certa", () => {
    const text = "Table a { id int }\nTable b { id int [pk }";
    const { diags, doc } = lint(text);
    expect(diags.length).toBeGreaterThan(0);
    expect(doc.lineAt(diags[0].from).number).toBe(2);
  });

  it("nome de tabela duplicado é erro", () => {
    const { diags } = lint("Table a { id int }\nTable a { id int }");
    expect(diags.map((d) => d.message).join()).toContain("already exists");
  });

  it("o compilador compartilhado acompanha o texto que muda", () => {
    expect(lint("Table a { id int }\nTable a { x int }").diags).not.toHaveLength(0);
    expect(lint("Table a { id int }").diags).toHaveLength(0); // voltou ao válido: sem resíduo
  });

  it("nunca produz posição fora do documento", () => {
    for (const text of ["", "Table", "Table a {", "Ref: a.b >", "Table a { id int [", "}}}"]) {
      const { diags, doc } = lint(text);
      for (const d of diags) {
        expect(d.from).toBeGreaterThanOrEqual(0);
        expect(d.to).toBeLessThanOrEqual(doc.length);
        expect(d.from).toBeLessThanOrEqual(d.to);
      }
    }
  });
});

import { toCompletionOptions, toSnippetTemplate } from "./editor";

describe("autocomplete", () => {
  /** `|` marca o cursor. */
  const at = (marked: string) => {
    const offset = marked.indexOf("|");
    const text = marked.replace("|", "");
    return service.completions(text, offset).map((c) => c.label);
  };

  it("sugere tipos depois do nome da coluna", () => {
    const l = at("Table a {\n  id |\n}");
    expect(l).toEqual(expect.arrayContaining(["integer", "varchar", "text"]));
  });

  it("sugere configurações dentro dos colchetes", () => {
    const l = at("Table a { id int [|] }");
    expect(l).toEqual(expect.arrayContaining(["pk", "primary key", "not null", "unique"]));
  });

  it("sugere as colunas depois de `tabela.`", () => {
    expect(at("Table a { id int }\nTable b { x int }\nRef: b.x > a.|")).toEqual(["id"]);
  });

  it("sugere tabelas do arquivo em um Ref", () => {
    expect(at("Table a { id int }\nTable b { x int }\nRef: |")).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("sugere os blocos no topo e no corpo da tabela", () => {
    expect(at("|")).toEqual(expect.arrayContaining(["Table", "Enum", "Ref"]));
    expect(at("Table a {\n  |\n}")).toEqual(expect.arrayContaining(["Note", "indexes"]));
  });

  it("acompanha o texto que muda (sem resíduo do compilador)", () => {
    expect(at("Table a { id int }\nRef: |")).toContain("a");
    expect(at("Table z { id int }\nRef: |")).toEqual(expect.arrayContaining(["z"]));
    expect(at("Table z { id int }\nRef: |")).not.toContain("a");
  });

  it("converte os itens para o CodeMirror com o tipo certo", () => {
    const items = service.completions("Table a { id int }\nRef: ", 24);
    const opt = toCompletionOptions(items).find((o) => o.label === "a")!;
    expect(opt.type).toBe("class");
    const ty = toCompletionOptions(service.completions("Table a {\n  id \n}", 15)).find((o) => o.label === "varchar")!;
    expect(ty.type).toBe("type");
  });

  it("converte a sintaxe de snippet do Monaco", () => {
    expect(toSnippetTemplate("Table ${1:nome} {\n\t$0\n}")).toBe("Table ${1:nome} {\n\t${}\n}");
    expect(toSnippetTemplate("a $1 b $2")).toBe("a ${1} b ${2}");
  });
});
