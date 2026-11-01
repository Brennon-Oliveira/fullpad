// @vitest-environment jsdom
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import * as dagre from "@dagrejs/dagre";
import { type DagreLike, layoutDiagram } from "./layout";
import { type CompilerLike, parseDbml } from "./model";
import { renderDiagram } from "./render";

const { Compiler } = createRequire(import.meta.url)("@dbml/parse") as { Compiler: new () => CompilerLike };

describe("renderDiagram", () => {
  it("desenha uma tabela por tabela e uma aresta por ref", () => {
    const d = parseDbml(
      Compiler,
      "Table users { id int [pk] }\nTable posts { id int [pk]\n uid int [ref: > users.id] }\nTable notas { id int [pk]\n ref_id int }\nRef: notas.ref_id > notas.id",
    ).diagram!;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    renderDiagram(d, layoutDiagram(d, dagre as unknown as DagreLike), g);
    expect(g.querySelectorAll(".dbml-table")).toHaveLength(3);
    expect(g.querySelectorAll(".dbml-edge")).toHaveLength(2); // inclui a auto-referência
    expect(g.querySelector(".dbml-title")?.textContent).toBe("users");
    expect(g.querySelector(".dbml-pk")?.textContent).toBe("id");
    expect(g.querySelector(".dbml-edge path")?.getAttribute("d")).toMatch(/^M[\d.-]+,[\d.-]+ H/);
  });
});
