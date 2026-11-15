import { describe, expect, it } from "vitest";
import { type ColumnRef, bodyNote, columnAt, quoteString, setFlag, setNote, setTableNote, setType, settingsBracket } from "./edit";
import { parseDbml } from "./model";
import { applyChanges } from "./rename";
import { service } from "./test-util";

const SRC = `Table users {
  id int [pk]
  nome varchar(80)
  mail varchar [unique, note: 'a]b']
  idade int [not null, default: 3] // idade em anos
  "data de nascimento" date
}
Table core.t {
  a int
}
`;
const d = () => parseDbml(service.interpret, SRC).diagram!;
const col = (name: string, table = "users"): ColumnRef => {
  const t = d().tables.find((x) => x.name === table)!;
  return columnAt(d(), t.columns.find((c) => c.name === name)!.span!.from)!;
};
const run = (r: { changes: { from: number; to: number; insert: string }[] } | { error: string }) => {
  if ("error" in r) throw new Error(r.error);
  return applyChanges(SRC, r.changes);
};
const line = (text: string, n: number) => text.split("\n")[n];

describe("settingsBracket", () => {
  it("acha as configurações no fim, ignorando colchetes dentro de textos", () => {
    const s = "mail varchar [unique, note: 'a]b']";
    expect(settingsBracket(s)).toEqual({ open: 13, close: s.length - 1 });
    expect(settingsBracket("nome varchar(80)")).toBeNull();
    expect(settingsBracket("a int [pk] // comentário")).toBeNull(); // o comentário não faz parte do trecho da coluna
  });
});

describe("flags", () => {
  it("liga em coluna sem configurações abrindo [..] no fim da linha", () => {
    expect(line(run(setFlag(service, d(), SRC, col("nome"), "pk", true)), 2)).toBe("  nome varchar(80) [pk]");
  });
  it("liga em coluna que já tem configurações acrescentando no fim da lista", () => {
    expect(line(run(setFlag(service, d(), SRC, col("mail"), "not null", true)), 3)).toBe("  mail varchar [unique, note: 'a]b', not null]");
    expect(line(run(setFlag(service, d(), SRC, col("idade"), "pk", true)), 4)).toBe("  idade int [not null, default: 3, pk] // idade em anos");
  });
  it("desliga e some com os colchetes quando era o último", () => {
    expect(line(run(setFlag(service, d(), SRC, col("id"), "pk", false)), 1)).toBe("  id int");
    expect(line(run(setFlag(service, d(), SRC, col("mail"), "unique", false)), 3)).toBe("  mail varchar [note: 'a]b']");
  });
  it("vale em coluna entre aspas e em tabela com esquema", () => {
    expect(line(run(setFlag(service, d(), SRC, col("data de nascimento"), "not null", true)), 5)).toBe('  "data de nascimento" date [not null]');
    const t = run(setFlag(service, d(), SRC, col("a", "t"), "unique", true));
    expect(t).toContain("  a int [unique]");
  });
  it("o diagrama volta a ler o que foi ligado", () => {
    const text = run(setFlag(service, d(), SRC, col("nome"), "not null", true));
    const c = parseDbml(service.interpret, text).diagram!.tables[0].columns[1];
    expect(c.notNull).toBe(true);
  });
});

describe("nota", () => {
  it("põe, troca e tira", () => {
    expect(line(run(setNote(service, d(), SRC, col("nome"), "texto novo")), 2)).toBe("  nome varchar(80) [note: 'texto novo']");
    expect(line(run(setNote(service, d(), SRC, col("mail"), "outra")), 3)).toBe("  mail varchar [unique, note: 'outra']");
    expect(line(run(setNote(service, d(), SRC, col("mail"), "")), 3)).toBe("  mail varchar [unique]");
  });
  it("escapa aspas e recusa três aspas seguidas em nota de várias linhas", () => {
    expect(quoteString("it's")).toBe("'it\\'s'");
    expect(line(run(setNote(service, d(), SRC, col("nome"), "it's")), 2)).toBe("  nome varchar(80) [note: 'it\\'s']");
    expect(setNote(service, d(), SRC, col("nome"), "a\n'''b")).toMatchObject({ error: expect.stringContaining("três aspas") });
  });
});

describe("tipo", () => {
  it("troca o tipo mantendo configurações e comentário", () => {
    expect(line(run(setType(service, d(), SRC, col("nome"), "text")), 2)).toBe("  nome text");
    expect(line(run(setType(service, d(), SRC, col("mail"), "varchar(200)")), 3)).toBe("  mail varchar(200) [unique, note: 'a]b']");
    expect(line(run(setType(service, d(), SRC, col("idade"), "smallint")), 4)).toBe("  idade smallint [not null, default: 3] // idade em anos");
    expect(line(run(setType(service, d(), SRC, col("data de nascimento"), "timestamp")), 5)).toBe('  "data de nascimento" timestamp');
  });
  it("recusa vazio, igual e colchetes", () => {
    expect(setType(service, d(), SRC, col("nome"), "  ")).toMatchObject({ error: "O tipo não pode ficar vazio." });
    expect(setType(service, d(), SRC, col("nome"), "varchar(80)")).toMatchObject({ error: "O tipo é o mesmo." });
    expect(setType(service, d(), SRC, col("nome"), "text [pk]")).toMatchObject({ error: expect.stringContaining("colchetes") });
  });
});

describe("notas de tabela e de várias linhas", () => {
  const SRC2 = `Table a {
  id int [pk]
  note_col text
  Note: 'antiga'
}
Table b [note: 'no cabeçalho'] {
  id int
}
Table c {
  id int [note: 'x']
}
Table d {
  Note: '''
    linha 1
    linha 2
  '''
  id int
}
`;
  const dd = () => parseDbml(service.interpret, SRC2).diagram!;
  const tb = (n: string) => dd().tables.find((t) => t.name === n)!;
  const go = (r: { changes: { from: number; to: number; insert: string }[] } | { error: string }) => {
    if ("error" in r) throw new Error(r.error);
    return applyChanges(SRC2, r.changes);
  };
  it("troca a nota do corpo", () => {
    const out = go(setTableNote(service, dd(), SRC2, tb("a"), "nova"));
    expect(out).toContain("  Note: 'nova'\n");
    expect(parseDbml(service.interpret, out).diagram!.tables[0].note).toBe("nova");
  });
  it("troca a do cabeçalho, cria no corpo e tira", () => {
    expect(parseDbml(service.interpret, go(setTableNote(service, dd(), SRC2, tb("b"), "x"))).diagram!.tables[1].note).toBe("x");
    const created = go(setTableNote(service, dd(), SRC2, tb("c"), "criada"));
    expect(parseDbml(service.interpret, created).diagram!.tables[2].note).toBe("criada");
    const removed = go(setTableNote(service, dd(), SRC2, tb("a"), ""));
    expect(removed).not.toContain("antiga");
    expect(parseDbml(service.interpret, removed).diagram!.tables[0].note).toBeUndefined();
  });
  it("aceita várias linhas, na tabela e na coluna", () => {
    const out = go(setTableNote(service, dd(), SRC2, tb("d"), "um\ndois"));
    expect(parseDbml(service.interpret, out).diagram!.tables[3].note?.replace(/\s+/g, " ").trim()).toBe("um dois");
    const col2 = columnAt(dd(), tb("c").columns[0].span!.from)!;
    const out2 = go(setNote(service, dd(), SRC2, col2, "a\nb"));
    expect(parseDbml(service.interpret, out2).diagram!.tables[2].columns[0].note?.replace(/\s+/g, " ").trim()).toBe("a b");
  });
  it("não confunde coluna chamada note_col com a nota", () => {
    expect(bodyNote(SRC2.slice(0, SRC2.indexOf("}") + 1))?.litFrom).toBeGreaterThan(0);
  });
});
