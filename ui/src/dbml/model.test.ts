import { describe, expect, it } from "vitest";
import * as dagre from "@dagrejs/dagre";
import { layoutDiagram, type DagreLike } from "./layout";
import { cardinality, parseDbml } from "./model";
import { interpret } from "./test-util";

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
    const r = parseDbml(interpret, SRC);
    expect(r.error).toBeUndefined();
    const d = r.diagram!;
    expect(d.tables.map((t) => t.id)).toEqual(["users", "core.posts", "tags", "post_tags"]);
    expect(d.tables[0].columns[0]).toMatchObject({ name: "id", type: "int", pk: true, notNull: true });
    expect(d.tables[0].columns[1]).toMatchObject({ type: "varchar(80)", unique: true });
  });

  it("resolve refs inline (com alias) e refs de bloco", () => {
    const d = parseDbml(interpret, SRC).diagram!;
    expect(d.refs).toHaveLength(3);
    const side = (r: (typeof d.refs)[number], table: string) => [r.from, r.to].find((e) => e.table === table)!;
    const inline = d.refs.find((r) => [r.from, r.to].some((e) => e.table === "core.posts" && e.column === "uid"))!;
    expect(side(inline, "users")).toEqual({ table: "users", column: "id", card: "1", label: "1" });
    expect(side(inline, "core.posts").card).toBe("*");
    const block = d.refs.find((r) => [r.from, r.to].some((e) => e.table === "tags"))!;
    expect(side(block, "post_tags")).toMatchObject({ column: "tag", card: "*" });
    expect(side(block, "tags").card).toBe("1");
  });

  it("devolve erro com linha e coluna quando o texto é inválido", () => {
    const r = parseDbml(interpret, "Table a { id int }\nTable b { id int [pk }");
    expect(r.diagram).toBeUndefined();
    expect(r.error!.line).toBe(2);
    expect(r.error!.message).not.toBe("");
  });

  it("texto vazio gera diagrama vazio", () => {
    const r = parseDbml(interpret, "");
    expect(r.diagram).toEqual({ tables: [], refs: [], enums: [], groups: [] });
  });
});

describe("layoutDiagram", () => {
  it("posiciona todas as tabelas sem sobreposição", () => {
    const d = parseDbml(interpret, SRC).diagram!;
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

describe("sintaxe nova do DBML", () => {
  // Esquema real que o usuário colou: relações opcionais e blocos Records.
  const NOVO = `Table follows {
  following_user_id integer [not null]
  followed_user_id integer [not null]
}
Table users {
  id integer [primary key]
  username varchar
}
Table posts {
  id integer [primary key]
  user_id integer [not null]
}
Ref user_posts: posts.user_id ?> users.id // many-to-one
Ref: users.id <? follows.following_user_id
Ref: users.id <? follows.followed_user_id
Records users(id, username) {
  0, 'Alice'
  1, 'Bob'
}
Records posts(id, user_id) {
  0, 0
}`;

  it("aceita ?> e <? e blocos Records sem erro", () => {
    const r = parseDbml(interpret, NOVO);
    expect(r.error).toBeUndefined();
    expect(r.diagram!.tables.map((t) => t.id)).toEqual(["follows", "users", "posts"]);
    expect(r.diagram!.refs).toHaveLength(3);
  });

  it("mostra a cardinalidade opcional nas pontas", () => {
    const d = parseDbml(interpret, NOVO).diagram!;
    const posts = d.refs.find((r) => [r.from, r.to].some((e) => e.table === "posts"))!;
    const side = (t: string) => [posts.from, posts.to].find((e) => e.table === t)!;
    expect(side("posts")).toMatchObject({ card: "*", label: "0..n" });
    expect(side("users")).toMatchObject({ card: "1", label: "1" });
  });

  it("cardinality() cobre os formatos do parser", () => {
    expect(cardinality("1")).toEqual({ card: "1", label: "1" });
    expect(cardinality("*")).toEqual({ card: "*", label: "n" });
    expect(cardinality("0..1")).toEqual({ card: "1", label: "0..1" });
    expect(cardinality("0..*")).toEqual({ card: "*", label: "0..n" });
    expect(cardinality("1..*")).toEqual({ card: "*", label: "1..n" });
  });
});
