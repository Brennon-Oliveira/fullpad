import { beforeEach, describe, expect, it } from "vitest";
import { parseDbml } from "./model";
import { applyChanges, renameChanges, targetForDecl } from "./rename";
import { service } from "./test-util";

const MAIN = `Project academus {
  database_type: 'PostgreSQL'
}

!include "foundation.dbmlx"
!include "calendar.dbmlx"

// relações entre módulos
Ref: public.events.school_id > public.schools.id [delete: cascade]
Ref: public.events.old_id > public.legacy.id [drop]

Table public.audit [add] {
  id int [pk, add]
  nome varchar [modify: name="name", type="text"]
}

DiagramView escola {
  Tables { schools, events }
}
`;
const FOUNDATION = `Table public.schools {
  id int [pk]
  nome varchar [not null, add]
}
`;
const CALENDAR = `!include "sub/extra.dbmlx"
Table public.events {
  id int [pk]
  school_id int
  old_id int [drop ref: > public.legacy.id]
}
`;
const EXTRA = "Table public.extra { id int [pk] }\n";

const project = {
  parts: [
    { file: "foundation.dbmlx", line: 5, text: FOUNDATION },
    { file: "calendar.dbmlx", line: 6, text: CALENDAR },
    { file: "sub/extra.dbmlx", line: 6, text: EXTRA },
  ],
  issues: [],
};

beforeEach(() => service.setProject(null));

describe("dbmlx com !include", () => {
  it("sem os incluídos dá erro; com eles o esquema fecha", () => {
    service.setProject(null);
    expect(service.diagnostics(MAIN).some((d) => d.type === "error")).toBe(true);
    expect(service.setProject(project)).toBe(true);
    const errs = service.diagnostics(MAIN).filter((d) => d.type === "error");
    expect(errs).toEqual([]);
  });

  it("o diagrama junta as tabelas dos arquivos e liga as relações entre eles", () => {
    service.setProject(project);
    const r = parseDbml(service.interpret, MAIN, service.explain);
    expect(r.error).toBeUndefined();
    const d = r.diagram!;
    expect(d.tables.map((t) => t.id).sort()).toEqual(["audit", "events", "extra", "schools"]);
    expect(d.refs.length).toBe(1); // a relação com [drop] não existe depois da migração
    // só a tabela do próprio arquivo tem lugar no texto
    expect(d.tables.find((t) => t.id === "audit")!.span).toBeDefined();
    expect(d.tables.find((t) => t.id === "schools")!.span).toBeUndefined();
    expect(d.tables.find((t) => t.id === "audit")!.columns.map((c) => c.name)).toEqual(["id", "nome"]);
  });

  it("erro dentro de um arquivo incluído aponta o arquivo e a linha", () => {
    service.setProject({ ...project, parts: [{ ...project.parts[0], text: "Table public.schools {\n  id int [pk\n}\n" }, ...project.parts.slice(1)] });
    const r = parseDbml(service.interpret, MAIN, service.explain);
    expect(r.error?.file).toBe("foundation.dbmlx");
    const d = service.diagnostics(MAIN).find((x) => x.text.startsWith("Em foundation.dbmlx"));
    expect(d?.startRow).toBe(5); // na linha do !include
  });

  it("problema ao incluir vira erro na linha do !include", () => {
    service.setProject({ parts: project.parts, issues: [{ line: 5, message: "arquivo incluído não encontrado: x.dbmlx" }] });
    const d = service.diagnostics(MAIN).find((x) => x.text.includes("não encontrado"));
    expect(d?.startRow).toBe(5);
  });

  it("renomear no próprio arquivo mantém as anotações do dbmlx", () => {
    service.setProject(project);
    const d = parseDbml(service.interpret, MAIN, service.explain).diagram!;
    const t = d.tables.find((x) => x.id === "audit")!;
    const target = targetForDecl(d, MAIN, t.span!.from)!;
    const r = renameChanges(service, d, MAIN, target, "auditoria");
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    const out = applyChanges(MAIN, r.changes);
    expect(out).toContain("Table auditoria [add] {");
    expect(out).toContain("[modify: name=\"name\", type=\"text\"]");
    expect(out).toContain("[drop]");
    expect(out).toContain("DiagramView escola");
    expect(out).toContain('!include "foundation.dbmlx"');
  });

  it("recusa renomear o que também é usado em arquivo incluído", () => {
    service.setProject(project);
    const text = `${MAIN}\nTable public.x {\n  id int\n}\n`;
    const d = parseDbml(service.interpret, text, service.explain).diagram!;
    const events = d.tables.find((t) => t.id === "events")!;
    expect(events.span).toBeUndefined(); // é de outro arquivo: sem lugar aqui, não há o que renomear
  });

  it("a sintaxe da referência do dbmlx abre sem erro", () => {
    service.setProject(null);
    const t = `Table users [headercolor: #4f86c6] {
  id int [pk, increment]
  tenant_id int
  name varchar(100) [not null, unique]
  customer_id int [modify: name="customer", type="varchar(100)"]
  user_id int [pk, not null, modify: name="uid", pk=false, not_null=false]
  score float [before: default="0.0", unique=true]
  ref_id int [add ref: > tenants.id]
  old_ref_id int [drop ref: > legacy.id]
}
Table tenants [add] {
  id int [pk]
  Indexes {
    (id, id) [pk, drop]
    id [pk, add]
  }
}
Table orders [drop] {
  id int
  user_id int
  tenant_id int
}
Ref ref_name: orders.user_id > users.id
Ref: orders.(user_id, tenant_id) > users.(id, tenant_id) [add]
Ref: orders.id > users.id [drop]
TableGroup auth { users }
DiagramView auth_context {
  Tables { users, sessions }
  TableGroups { auth }
  Schemas { public }
}
DiagramView todas {
  Tables { * }
}
`;
    const errs = service.diagnostics(t).filter((d) => d.type === "error");
    expect(errs.map((e) => `${e.startRow}: ${e.text}`)).toEqual([]);
    const r = parseDbml(service.interpret, t, service.explain);
    expect(r.error).toBeUndefined();
  });
});
