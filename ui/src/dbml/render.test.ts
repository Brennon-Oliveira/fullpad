// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as dagre from "@dagrejs/dagre";
import { type DagreLike, layoutDiagram } from "./layout";
import { parseDbml } from "./model";
import { interpret } from "./test-util";
import { renderDiagram } from "./render";


describe("renderDiagram", () => {
  it("desenha uma tabela por tabela e uma aresta por ref", () => {
    const d = parseDbml(
      interpret,
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

  it("desenha enums, grupos e a cor do cabeçalho", () => {
    const d = parseDbml(
      interpret,
      "Table users [headercolor: #ffd700, note: 'gente'] { id int [pk]\n role papel }\nTable posts { id int [pk] }\nEnum papel { admin\n user [note: 'comum'] }\nTableGroup blog [color: #E67E22] { users\n posts }",
    ).diagram!;
    const l = layoutDiagram(d, dagre as unknown as DagreLike);
    expect(l.boxes.has("group:blog")).toBe(true);
    expect(l.boxes.has("enum:papel")).toBe(true);
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    renderDiagram(d, l, g);
    expect(g.querySelectorAll(".dbml-enum")).toHaveLength(1);
    expect(g.querySelectorAll(".dbml-group")).toHaveLength(1);
    expect(g.querySelector(".dbml-head")?.getAttribute("style")).toContain("#ffd700");
    expect(g.querySelector(".dbml-title")?.getAttribute("style")).toContain("#111"); // amarelo → texto escuro
    expect(g.querySelector("title")?.textContent).toBe("gente");
    const inGroup = l.boxes.get("group:blog")!;
    for (const id of ["users", "posts"]) {
      const b = l.boxes.get(id)!;
      expect(b.x).toBeGreaterThanOrEqual(inGroup.x);
      expect(b.x + b.w).toBeLessThanOrEqual(inGroup.x + inGroup.w);
      expect(b.y).toBeGreaterThanOrEqual(inGroup.y);
      expect(b.y + b.h).toBeLessThanOrEqual(inGroup.y + inGroup.h);
    }
  });

  it("hover numa coluna destaca a aresta e a coluna do outro lado", () => {
    const d = parseDbml(
      interpret,
      "Table users { id int [pk] }\nTable posts { id int [pk]\n uid int [ref: > users.id] }\nTable tags { id int [pk] }\nTable pt { tag int [ref: > tags.id] }",
    ).diagram!;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    renderDiagram(d, layoutDiagram(d, dagre as unknown as DagreLike), g);
    const row = (t: string, c: string) => g.querySelector(`.dbml-row[data-k="${t}\u001f${c}"]`)!;
    row("posts", "uid").dispatchEvent(new MouseEvent("mouseenter"));
    expect(g.classList.contains("hovering")).toBe(true);
    expect(row("users", "id").classList.contains("hl")).toBe(true);
    expect(row("tags", "id").classList.contains("hl")).toBe(false);
    expect(g.querySelectorAll(".dbml-edge.hl")).toHaveLength(1);
    row("posts", "uid").dispatchEvent(new MouseEvent("mouseleave"));
    expect(g.classList.contains("hovering")).toBe(false);
    expect(g.querySelectorAll(".hl")).toHaveLength(0);
  });

  it("liga a coluna ao enum com uma linha tracejada", () => {
    const d = parseDbml(
      interpret,
      "Table posts { id int [pk]\n status post_status }\nTable tags { id int }\nEnum post_status { draft\n published }",
    ).diagram!;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    renderDiagram(d, layoutDiagram(d, dagre as unknown as DagreLike), g);
    const links = g.querySelectorAll(".dbml-enumlink");
    expect(links).toHaveLength(1); // só a coluna `status` usa o enum
    expect(links[0].getAttribute("data-b")).toBe("enum:post_status");
    expect(links[0].querySelector("path")?.getAttribute("d")).toMatch(/^M[\d.-]+,[\d.-]+ H/);
  });
});
