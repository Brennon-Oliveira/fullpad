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
