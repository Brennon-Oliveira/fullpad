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

describe("ligação com o código", () => {
  const SRC = "Table users {\n  id int [pk]\n  name text\n}\nTable posts {\n  id int [pk]\n  uid int [ref: > users.id]\n}\nEnum st {\n  a\n  b\n}\n";
  function setup() {
    const d = parseDbml(interpret, SRC).diagram!;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const hovered: (unknown[] | null)[] = [];
    const r = renderDiagram(d, layoutDiagram(d, dagre as unknown as DagreLike), g, { onHover: (s) => hovered.push(s) });
    return { g, r, hovered };
  }
  const at = (needle: string, extra = 0) => SRC.indexOf(needle) + extra;

  it("cursor numa coluna destaca a linha e as relações dela", () => {
    const { g, r } = setup();
    expect(r.focusAt(at("name text", 2))).not.toBeNull();
    const hl = [...g.querySelectorAll(".dbml-row.fc")].map((e) => e.getAttribute("data-k"));
    expect(hl).toEqual(["users\u001fname"]); // sem relação: só a própria linha
    expect(g.classList.contains("focusing")).toBe(true);

    r.focusAt(at("id int [pk]", 2)); // users.id tem relação com posts.uid
    expect([...g.querySelectorAll(".dbml-row.fc")].map((e) => e.getAttribute("data-k")).sort()).toEqual(["posts\u001fuid", "users\u001fid"]);
    expect(g.querySelectorAll(".dbml-edge.fc")).toHaveLength(1);
  });

  it("cursor na relação inline destaca a aresta e as duas pontas", () => {
    const { g, r } = setup();
    r.focusAt(at("ref: > users.id", 3));
    expect(g.querySelectorAll(".dbml-edge.fc")).toHaveLength(1);
    expect(g.querySelectorAll(".dbml-row.fc")).toHaveLength(2);
  });

  it("cursor no cabeçalho da tabela destaca a tabela; fora de tudo limpa", () => {
    const { g, r } = setup();
    r.focusAt(at("Table posts", 2));
    expect(g.querySelector(".dbml-table.fc")?.getAttribute("data-t")).toBe("posts");
    r.focusAt(at("Enum st", 2));
    expect(g.querySelector(".dbml-enum.fc")).not.toBeNull();
    expect(g.querySelector(".dbml-table.fc")).toBeNull();
    expect(r.focusAt(null)).toBeNull();
    expect(g.classList.contains("focusing")).toBe(false);
    expect(g.querySelector(".fc")).toBeNull();
  });

  it("mouse sobre coluna, aresta e cabeçalho informa o trecho do texto", () => {
    const { g, hovered } = setup();
    const fire = (el: Element | null) => el!.dispatchEvent(new Event("mouseenter"));
    const text = (s: unknown) => SRC.slice((s as { from: number }).from, (s as { to: number }).to);

    fire(g.querySelector('.dbml-row[data-k="users\u001fname"]'));
    expect(text(hovered.at(-1)![0])).toBe("name text");
    fire(g.querySelector(".dbml-edge:not(.dbml-enumlink)"));
    expect(text(hovered.at(-1)![0])).toContain("ref: > users.id");
    fire(g.querySelector('.dbml-table[data-t="users"] .dbml-head'));
    const head = hovered.at(-1)![0] as { from: number; to: number };
    expect(head.from).toBe(0); // só o início do bloco: o editor pinta a linha da declaração
    expect(head.to).toBe(0);
    g.querySelector('.dbml-row[data-k="users\u001fname"]')!.dispatchEvent(new Event("mouseleave"));
    expect(hovered.at(-1)).toBeNull();
  });
});
