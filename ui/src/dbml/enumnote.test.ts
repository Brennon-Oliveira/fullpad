// @vitest-environment jsdom
// `Note` no corpo do enum: o @dbml/parse 11.0.0 recusava; `ui/patches/@dbml__parse.patch` (pnpm
// patchedDependencies) a aceita. Estes testes protegem o patch: que ele continua aplicado nos dois
// bundles (o app carrega o .mjs; o Node dos testes carrega o .js), que faz o que deve e que não
// afrouxou nenhuma outra regra do parser.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as dagre from "@dagrejs/dagre";
import { describe, expect, it } from "vitest";
import { type DagreLike, layoutDiagram } from "./layout";
import { parseDbml } from "./model";
import { renderDiagram } from "./render";
import { interpret, service } from "./test-util";

const erros = (texto: string) => service.diagnostics(texto).filter((d) => d.type === "error").map((d) => d.text);
const enumDe = (texto: string) => parseDbml(interpret, texto).diagram!.enums[0];

describe("o patch está aplicado no pacote instalado", () => {
  const dist = dirname(createRequire(import.meta.url).resolve("@dbml/parse"));
  const lerDist = (arquivo: string) => readFileSync(join(dist, arquivo), "utf8");

  it("nos dois bundles (ESM do app e CJS dos testes)", () => {
    // se um `pnpm install` perder o patch, ou a lib for atualizada sem refazê-lo, isto avisa
    expect(lerDist("dbml-parse.mjs")).toContain("r.Project, r.Dep, r.Enum)) ? [new E(T.INVALID_NOTE_CONTEXT");
    expect(lerDist("dbml-parse.mjs")).toContain("FULLPAD: Note no corpo do enum");
    expect(lerDist("dbml-parse.js")).toContain("r.Project,r.Dep,r.Enum))?[new E(T.INVALID_NOTE_CONTEXT");
    expect(lerDist("dbml-parse.js")).toContain("subElements");
  });
});

describe("Note no corpo do enum", () => {
  it("aceita `Note: '…'` e `Note { '…' }` sem diagnóstico", () => {
    expect(erros("enum e {\n  a\n  Note: 'estado'\n}\n")).toEqual([]);
    expect(erros("enum e {\n  a\n  Note { 'estado' }\n}\n")).toEqual([]);
  });

  it("guarda a nota no modelo e mantém os valores e as notas deles", () => {
    const e = enumDe("enum e {\n  a [note: 'valor a']\n  b\n  Note: 'do enum'\n}\n");
    expect(e.note).toBe("do enum");
    expect(e.values.map((v) => v.name)).toEqual(["a", "b"]); // a nota não vira valor
    expect(e.values[0].note).toBe("valor a");
    expect(e.values[1].note).toBeUndefined();
  });

  it("vale em qualquer posição do corpo", () => {
    expect(enumDe("enum e {\n  Note: 'antes'\n  a\n  b\n}").note).toBe("antes");
    expect(enumDe("enum e {\n  a\n  Note: 'meio'\n  b\n}").values.map((v) => v.name)).toEqual(["a", "b"]);
  });

  it("entende nota de várias linhas, acento e enum com esquema", () => {
    expect(enumDe("enum e {\n  a\n  Note: '''linha 1\nlinha 2'''\n}").note).toBe("linha 1\nlinha 2");
    expect(enumDe("enum e {\n  a\n  Note: 'situação à vista'\n}").note).toBe("situação à vista");
    const e = enumDe("enum loja.e {\n  a\n  Note: 'x'\n}\nTable loja.t { c loja.e }");
    expect([e.schema, e.name, e.note]).toEqual(["loja", "e", "x"]);
  });

  it("com duas notas vale a última, sem derrubar o diagrama", () => {
    const r = parseDbml(interpret, "enum e {\n  a\n  Note: 'primeira'\n  Note: 'segunda'\n}");
    expect(r.error).toBeUndefined();
    expect(r.diagram!.enums[0].note).toBe("segunda");
  });

  it("enum sem nota segue sem nota (o campo não aparece)", () => {
    expect(enumDe("enum e {\n  a\n  b [note: 'só do valor']\n}").note).toBeUndefined();
  });

  it("nota malformada vira diagnóstico, nunca exceção", () => {
    const casos: [string, RegExp][] = [
      ["enum e {\n  a\n  Note { }\n}", /Note must have a content/],
      ["enum e {\n  a\n  Note: 42\n}", /quoted string/],
      ["enum e {\n  a\n  Note:\n}", /quoted string|operand/],
    ];
    for (const [texto, esperado] of casos) {
      expect(erros(texto).join(" | ")).toMatch(esperado);
      expect(() => parseDbml(interpret, texto)).not.toThrow();
      expect(parseDbml(interpret, texto).error).toBeDefined(); // o painel mostra o erro em vez de quebrar
    }
  });

  it("enum só com a nota continua inválido (precisa de ao menos um valor)", () => {
    expect(erros("enum e {\n  Note: 'só nota'\n}")).toEqual(["An Enum must have at least one element"]);
  });

  it("outros sub-elementos no enum continuam recusados, sem exceção", () => {
    expect(erros("enum e {\n  a\n  indexes { a }\n}").join()).toMatch(/Indexes can only appear inside a Table/);
    expect(erros("enum e {\n  a\n  checks { `x` }\n}").join()).toMatch(/Checks can only appear inside a Table/);
    expect(() => parseDbml(interpret, "enum e {\n  a\n  indexes { a }\n}")).not.toThrow();
  });
});

describe("o patch não afrouxou o resto", () => {
  it("Note continua valendo em tabela, grupo e na coluna", () => {
    const texto = "Table t {\n  id int [note: 'coluna']\n  Note: 'tabela'\n}\nTableGroup g {\n  t\n  Note: 'grupo'\n}\n";
    expect(erros(texto)).toEqual([]);
    const d = parseDbml(interpret, texto).diagram!;
    expect(d.tables[0].note).toBe("tabela");
    expect(d.tables[0].columns[0].note).toBe("coluna");
    // o modelo do app não guarda a nota do grupo; o que importa aqui é a lib ainda entregá-la
    expect((interpret(texto).getValue()!.tableGroups![0] as { note?: { value?: string } }).note?.value).toBe("grupo");
  });

  it("Note continua recusada onde não cabe (Ref, dentro de coluna) e a avulsa segue valendo", () => {
    expect(erros("Table a { id int }\nRef r {\n  Note: 'x'\n}").join()).toMatch(/A Note can only appear inside a Table, a TableGroup, a TablePartial or a Project/);
    expect(erros("Note avulsa {\n  'cartaz'\n}\n")).toEqual([]); // nota solta no escopo global
  });

  it("a mensagem de contexto continua a da lib (quem a lê vê o que o parser aceita)", () => {
    const msg = erros("Table a { id int }\nRef r { Note: 'x' }").join();
    expect(msg).toContain("A Note can only appear inside a Table");
  });

  it("enum dentro de tabela continua recusado", () => {
    expect(erros("Table t {\n  id int\n  enum e { a }\n}").join()).toMatch(/Enum can only appear top-level/);
  });
});

describe("a nota do enum no diagrama", () => {
  const desenhar = (texto: string) => {
    const d = parseDbml(interpret, texto).diagram!;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    renderDiagram(d, layoutDiagram(d, dagre as unknown as DagreLike), g);
    return g;
  };

  it("vira tooltip no título do enum, sem mudar o texto do título", () => {
    const g = desenhar("enum status {\n  ativo\n  Note: 'Ciclo de vida'\n}\nTable t { s status }");
    const titulo = g.querySelector(".dbml-enum .dbml-title")!;
    expect(titulo.firstChild?.textContent).toBe("enum status");
    expect(titulo.querySelector("title")?.textContent).toBe("Ciclo de vida");
  });

  it("enum sem nota não ganha tooltip", () => {
    const g = desenhar("enum status {\n  ativo\n}\nTable t { s status }");
    expect(g.querySelector(".dbml-enum .dbml-title title")).toBeNull();
  });

  it("não aparece o ícone de nota editável (só tabela e coluna editam)", () => {
    const g = desenhar("enum status {\n  ativo\n  Note: 'x'\n}\nTable t { s status }");
    expect(g.querySelectorAll(".dbml-enum .dbml-noteicon")).toHaveLength(0);
  });

  it("a nota de valor continua com o próprio tooltip", () => {
    const g = desenhar("enum status {\n  ativo [note: 'ligado']\n  Note: 'enum'\n}\nTable t { s status }");
    const tooltips = [...g.querySelectorAll(".dbml-enum title")].map((t) => t.textContent);
    expect(tooltips.sort()).toEqual(["enum", "ligado"]);
  });
});
