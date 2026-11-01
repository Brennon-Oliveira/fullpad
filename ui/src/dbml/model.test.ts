import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import * as dagre from "@dagrejs/dagre";
import { layoutDiagram, type DagreLike } from "./layout";
import { type CompilerLike, parseDbml } from "./model";

// O pacote ESM importa lodash de um jeito que o Node puro não aceita; o CJS funciona igual.
const { Compiler } = createRequire(import.meta.url)("@dbml/parse") as { Compiler: new () => CompilerLike };

const SRC = `Table users as U {
  id int [pk, not null]
  name varchar(80) [unique]
}
Table core.posts {
  id int [pk]
  uid int [ref: > U.id]
}
Table tags { id int [pk] }
Table post_tags {
  post int
  tag int
}
Ref: post_tags.tag > tags.id
Ref: post_tags.post > core.posts.id
`;

describe("parseDbml", () => {
  it("converte tabelas, colunas e atributos", () => {
    const r = parseDbml(Compiler, SRC);
    expect(r.error).toBeUndefined();
    const d = r.diagram!;
    expect(d.tables.map((t) => t.id)).toEqual(["users", "core.posts", "tags", "post_tags"]);
    expect(d.tables[0].columns[0]).toMatchObject({ name: "id", type: "int", pk: true, notNull: true });
    expect(d.tables[0].columns[1]).toMatchObject({ type: "varchar(80)", unique: true });
  });

  it("resolve refs inline (com alias) e refs de bloco", () => {
    const d = parseDbml(Compiler, SRC).diagram!;
    expect(d.refs).toHaveLength(3);
    const side = (r: (typeof d.refs)[number], table: string) => [r.from, r.to].find((e) => e.table === table)!;
    const inline = d.refs.find((r) => [r.from, r.to].some((e) => e.table === "core.posts" && e.column === "uid"))!;
    expect(side(inline, "users")).toEqual({ table: "users", column: "id", card: "1" });
    expect(side(inline, "core.posts").card).toBe("*");
    const block = d.refs.find((r) => [r.from, r.to].some((e) => e.table === "tags"))!;
    expect(side(block, "post_tags")).toMatchObject({ column: "tag", card: "*" });
    expect(side(block, "tags").card).toBe("1");
  });

  it("devolve erro com linha e coluna quando o texto é inválido", () => {
    const r = parseDbml(Compiler, "Table a { id int }\nTable b { id int [pk }");
    expect(r.diagram).toBeUndefined();
    expect(r.error!.line).toBe(2);
    expect(r.error!.message).not.toBe("");
  });

  it("texto vazio gera diagrama vazio", () => {
    const r = parseDbml(Compiler, "");
    expect(r.diagram).toEqual({ tables: [], refs: [] });
  });
});

describe("layoutDiagram", () => {
  it("posiciona todas as tabelas sem sobreposição", () => {
    const d = parseDbml(Compiler, SRC).diagram!;
    const l = layoutDiagram(d, dagre as unknown as DagreLike);
    expect(l.boxes.size).toBe(4);
    const boxes = [...l.boxes.values()];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
  });
});
