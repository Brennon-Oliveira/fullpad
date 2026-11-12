import { describe, expect, it } from "vitest";
import { type RenameResult, applyChanges, checkName, lineChanges, quoteName, renameChanges, targetAt, targetForDecl } from "./rename";
import { parseDbml } from "./model";
import { service } from "./test-util";

const SRC = `Table users as U {
  id int [pk]
  "full name" varchar
  status st
}
Table core.posts {
  id int [pk]
  uid int [ref: > U.id]
  obs text
}
Enum st {
  ativo
  inativo
}
Table core.comentarios {
  id int [pk]
  autor int
  post int
}
Ref: core.comentarios.autor > users.id
Ref: core.comentarios.post > core.posts.id
TableGroup grupo { users
  core.posts }
Records users(id, "full name") { 1, 'x' }
`;
const diagram = (text = SRC) => {
  const r = parseDbml(service.interpret, text);
  if (!r.diagram) throw new Error(`DBML do teste inválido: ${r.error?.message} (linha ${r.error?.line})`);
  return r.diagram;
};
const at = (needle: string, nth = 0, delta = 1) => {
  let i = -1;
  for (let k = 0; k <= nth; k++) i = SRC.indexOf(needle, i + 1);
  return i + delta;
};
const target = (offset: number) => targetAt(service, diagram(), SRC, offset);
const rename = (offset: number, name: string): (RenameResult & { text: string }) | { error: string } => {
  const t = target(offset);
  if (!t) return { error: "sem alvo" };
  const r = renameChanges(service, diagram(), SRC, t, name);
  return "error" in r ? r : { ...r, text: applyChanges(SRC, r.changes) };
};

describe("achar o que renomear", () => {
  it("na declaração da tabela, da coluna, do enum e do grupo", () => {
    expect(target(at("users as"))).toMatchObject({ kind: "table", name: "users" });
    expect(target(at("status st", 0, 2))).toMatchObject({ kind: "column", name: "status" });
    expect(target(at("Enum st", 0, 6))).toMatchObject({ kind: "enum", name: "st" });
    expect(target(at("ativo", 0, 2))).toMatchObject({ kind: "value", name: "ativo" });
    expect(target(at("TableGroup grupo", 0, 13))).toMatchObject({ kind: "group", name: "grupo" });
    expect(target(at('"full name" varchar', 0, 3))).toMatchObject({ kind: "column", name: "full name" });
  });

  it("num uso: Ref, Records, grupo e tipo de coluna", () => {
    expect(target(at("> users.id", 0, 4))).toMatchObject({ kind: "table", name: "users" });
    expect(target(at("users.id", 0, 7))).toMatchObject({ kind: "column", name: "id" });
    expect(target(at("{ users", 0, 4))).toMatchObject({ kind: "table", name: "users" });
    expect(target(at("status st", 0, 8))).toMatchObject({ kind: "enum", name: "st" });
  });

  it("fora de um nome não há o que renomear (tipo, configuração, apelido)", () => {
    expect(target(at("int [pk]", 0, 1))).toBeNull();
    expect(target(at("[pk]", 0, 2))).toBeNull();
    expect(target(at("U.id", 0, 0))).toBeNull(); // o apelido não é o nome da tabela
  });

  it("targetForDecl acha pela posição da declaração", () => {
    const d = diagram();
    expect(targetForDecl(d, SRC, SRC.indexOf("Table users"))).toMatchObject({ kind: "table", name: "users" });
    expect(targetForDecl(d, SRC, 5)).toBeNull();
  });
});

describe("renomear com as referências", () => {
  it("tabela: declaração, Ref, grupo e Records; o apelido fica", () => {
    const r = rename(at("users as"), "clientes");
    if ("error" in r) throw new Error(r.error);
    expect(r.text).toContain("Table clientes as U {");
    expect(r.text).toContain("Ref: core.comentarios.autor > clientes.id");
    expect(r.text).toContain("TableGroup grupo { clientes");
    expect(r.text).toContain(`Records clientes(id, "full name")`);
    expect(r.text).toContain("[ref: > U.id]");
    expect(r.renamedTable).toEqual({ from: "users", to: "clientes" });
    expect(r.changes.length).toBeGreaterThanOrEqual(4);
  });

  it("tabela com esquema mantém o esquema e dá o id novo", () => {
    const r = rename(at("core.posts {", 0, 7), "artigos");
    if ("error" in r) throw new Error(r.error);
    expect(r.text).toContain("Table core.artigos {");
    expect(r.text).toContain("Ref: core.comentarios.post > core.artigos.id");
    expect(r.renamedTable).toEqual({ from: "core.posts", to: "core.artigos" });
  });

  it("coluna: declaração, Ref e inline pelo apelido e Records", () => {
    const r = rename(at("id int [pk]"), "codigo");
    if ("error" in r) throw new Error(r.error);
    expect(r.text.split("\n")[1]).toBe("  codigo int [pk]");
    expect(r.text).toContain("[ref: > U.codigo]");
    expect(r.text).toContain("Ref: core.comentarios.autor > users.codigo");
    expect(r.text).toContain("Records users(codigo,");
    // a coluna `id` da outra tabela não muda
    expect(r.text).toContain("Table core.posts {\n  id int [pk]");
  });

  it("coluna com espaço no nome fica entre aspas, e o nome simples perde as aspas", () => {
    const r = rename(at('"full name" varchar', 0, 3), "nome_completo");
    if ("error" in r) throw new Error(r.error);
    expect(r.text).toContain("  nome_completo varchar");
    expect(r.text).toContain("Records users(id, nome_completo)");
    const r2 = rename(at("status st", 0, 2), "situação do aluno");
    if ("error" in r2) throw new Error(r2.error);
    expect(r2.text).toContain('  "situação do aluno" st');
  });

  it("coluna sem nenhum uso muda só a declaração (o provider não devolve os usos de outro símbolo)", () => {
    const r = rename(at("status st", 0, 2), "situação do aluno");
    if ("error" in r) throw new Error(r.error);
    expect(r.text).toContain('  "situação do aluno" st');
    expect(r.changes).toHaveLength(1);
  });

  it("enum: declaração e o tipo das colunas; valor do enum", () => {
    const r = rename(at("Enum st", 0, 6), "situacao");
    if ("error" in r) throw new Error(r.error);
    expect(r.text).toContain("Enum situacao {");
    expect(r.text).toContain("  status situacao");
    const v = rename(at("ativo", 0, 2), "ligado");
    if ("error" in v) throw new Error(v.error);
    expect(v.text).toContain("  ligado\n  inativo");
  });

  it("grupo", () => {
    const r = rename(at("TableGroup grupo", 0, 13), "pessoas");
    if ("error" in r) throw new Error(r.error);
    expect(r.text).toContain("TableGroup pessoas {");
    expect(r.renamedGroup).toEqual({ from: "grupo", to: "pessoas" });
  });

  it("recusa nome repetido, vazio e igual", () => {
    const dup = rename(at("uid int"), "id");
    expect(dup).toMatchObject({ error: expect.stringContaining('Já existe a coluna "id"') });
    expect(rename(at("users as"), "clientes")).not.toHaveProperty("error");
    expect(rename(at("Table core.posts", 0, 12), "posts")).toMatchObject({ error: "O nome é o mesmo." });
    expect(rename(at("users as"), "  ")).toMatchObject({ error: "O nome não pode ficar vazio." });
    expect(rename(at("users as"), "a\nb")).toMatchObject({ error: expect.stringContaining("quebra de linha") });
    expect(rename(at("Enum st", 0, 6), "st")).toMatchObject({ error: "O nome é o mesmo." });
  });

  it("recusa renomear uma tabela para o nome de outra do mesmo esquema", () => {
    const text = "Table a { id int }\nTable b { id int }\n";
    const d = parseDbml(service.interpret, text).diagram!;
    const t = targetAt(service, d, text, 7)!;
    expect(renameChanges(service, d, text, t, "b")).toMatchObject({ error: 'Já existe a tabela "b".' });
  });
});

describe("peças", () => {
  it("quoteName", () => {
    expect(quoteName("nome")).toBe("nome");
    expect(quoteName("nome completo")).toBe('"nome completo"');
    expect(quoteName('a"b')).toBe('"a\\"b"');
    expect(quoteName("1abc")).toBe('"1abc"');
  });
  it("checkName", () => {
    expect(checkName("ok")).toBeNull();
    expect(checkName("")).not.toBeNull();
  });
  it("lineChanges troca só o que mudou em cada linha", () => {
    expect(lineChanges("a b\nc d\n", "a X\nc d\n")).toEqual([{ from: 2, to: 3, insert: "X" }]);
    expect(lineChanges("igual", "igual")).toEqual([]);
    expect(applyChanges("a\nb", [])).toBe("a\nb");
  });
});
