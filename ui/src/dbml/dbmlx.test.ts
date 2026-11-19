import { describe, expect, it } from "vitest";
import { composeSource, stripDbmlx } from "./dbmlx";

const same = (s: string) => expect(stripDbmlx(s).length).toBe(s.length);

describe("stripDbmlx", () => {
  it("não mexe em DBML comum", () => {
    const t = "Table users [headercolor: #4f86c6] {\n  id int [pk, not null]\n  tags int[]\n}\nRef: a.x > b.y [delete: cascade]\n";
    expect(stripDbmlx(t)).toBe(t);
  });

  it("tira !include, só no começo da linha e fora de comentário e texto", () => {
    const t = '!include "a.dbmlx"\n  !include \'b.dbml\'\n// !include "c"\nNote: \'\'\'\n!include "d"\n\'\'\'\nTable t { id int }\n';
    const o = stripDbmlx(t);
    same(t);
    expect(o.split("\n")[0].trim()).toBe("");
    expect(o.split("\n")[1].trim()).toBe("");
    expect(o).toContain('// !include "c"');
    expect(o).toContain('!include "d"');
    expect(o).toContain("Table t { id int }");
  });

  it("tira DiagramView inteiro", () => {
    const t = "Table t { id int }\nDiagramView auth {\n  Tables { users, sessions }\n  TableGroups { g }\n}\nTable u { id int }\n";
    const o = stripDbmlx(t);
    same(t);
    expect(o).not.toContain("DiagramView");
    expect(o).not.toContain("Tables {");
    expect(o).toContain("Table u { id int }");
    expect(o.split("\n").length).toBe(t.split("\n").length);
  });

  it("[add] e [drop] de coluna, tabela e índice", () => {
    expect(stripDbmlx("Table t [add] {\n  id int [pk, add]\n  x int [not null, drop]\n  y int [drop]\n}")).toBe("Table t       {\n  id int [pk     ]\n  x int [not null      ]\n  y int       \n}");
    const idx = stripDbmlx("Indexes {\n  (a, b) [pk, drop]\n  a [add]\n}");
    expect(idx).toBe("Indexes {\n  (a, b) [pk      ]\n  a      \n}");
  });

  it("modify/before levam as chaves key=valor junto", () => {
    const t = 'customer_id int [modify: name="customer", type="varchar(100)"]\nuser_id int [pk, not null, modify: name="uid", pk=false, not_null=false]\nscore float [before: default="0.0", unique=true, note: \'x\']\n';
    const o = stripDbmlx(t);
    same(t);
    expect(o.split("\n")[0].trim()).toBe("customer_id int");
    expect(o.split("\n")[1]).toMatch(/^user_id int \[pk, not null\s*\]$/);
    expect(o.split("\n")[2]).toMatch(/^score float \[\s*note: 'x'\]$/);
  });

  it("add ref mantém a relação; drop ref some", () => {
    const o = stripDbmlx("user_id int [add ref: > users.id]\nold int [drop ref: > legacy.id]\nt int [add ref: > tenants.id, drop ref: > old_tenants.id]\n");
    const l = o.split("\n");
    expect(l[0].replace(/\s+/g, " ")).toBe("user_id int [ ref: > users.id]");
    expect(l[1].trim()).toBe("old int");
    expect(l[2]).toMatch(/^t int \[\s+ref: > tenants\.id\s*\]$/);
  });

  it("Ref com [drop] é removida; com [add] fica", () => {
    const t = "Ref: orders.user_id > users.id [add]\nRef: orders.legacy_id > old.id [drop]\nRef r: a.x > b.y [delete: cascade, add]\n";
    const l = stripDbmlx(t).split("\n");
    expect(l[0].trim()).toBe("Ref: orders.user_id > users.id");
    expect(l[1].trim()).toBe("");
    expect(l[2]).toMatch(/^Ref r: a\.x > b\.y \[delete: cascade\s*\]$/);
  });

  it("ignora colchetes em texto e comentário", () => {
    const t = "Table t {\n  a int [note: 'tem [add] no texto']\n  // x [drop]\n}\n";
    expect(stripDbmlx(t)).toBe(t);
  });

  it("composeSource: o principal vem primeiro, com os mesmos offsets", () => {
    const main = '!include "a"\nTable m { id int }\n';
    const c = composeSource(main, [{ text: "Table a { id int [add] }" }]);
    expect(c.mainLength).toBe(main.length);
    expect(c.source.slice(main.length + 1)).toBe("Table a { id int       }");
    expect(c.offsets).toEqual([main.length + 1]);
    expect(c.source.indexOf("Table m")).toBe(main.indexOf("Table m"));
  });
});
