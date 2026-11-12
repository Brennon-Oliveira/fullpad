// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as dagre from "@dagrejs/dagre";
import { type DagreLike, frameGroups, layoutDiagram } from "./layout";
import { parseDbml } from "./model";
import { interpret } from "./test-util";
import { attachTableDrag } from "./tabledrag";

const D = dagre as unknown as DagreLike;
const SRC = `Table users { id int [pk] }
Table posts { id int [pk]
  uid int [ref: > users.id] }
Table tags { id int [pk] }
TableGroup blog { users
  posts }`;
const diagram = () => parseDbml(interpret, SRC).diagram!;

describe("layoutDiagram com posições salvas", () => {
  it("usa a posição salva e deixa o dagre cuidar das outras", () => {
    const d = diagram();
    const auto = layoutDiagram(d, D);
    const l = layoutDiagram(d, D, { users: { x: 500, y: -40 } });
    expect(l.boxes.get("users")).toMatchObject({ x: 500, y: -40 });
    expect(l.boxes.get("posts")).toEqual(auto.boxes.get("posts"));
    expect(l.boxes.get("tags")).toEqual(auto.boxes.get("tags"));
  });

  it("a moldura do grupo acompanha as tabelas e a área do desenho cobre posições negativas", () => {
    const d = diagram();
    const l = layoutDiagram(d, D, { users: { x: -300, y: -200 } });
    const u = l.boxes.get("users")!;
    const grp = l.boxes.get("group:blog")!;
    expect(grp.x).toBeLessThan(u.x);
    expect(grp.y).toBeLessThan(u.y);
    expect(l.x0!).toBeLessThanOrEqual(u.x - 24);
    expect(l.y0!).toBeLessThanOrEqual(u.y - 24);
    expect(l.x0! + l.width).toBeGreaterThanOrEqual(Math.max(...[...l.boxes.values()].map((b) => b.x + b.w)));
  });

  it("ignora posição de tabela que não existe, valor que não é número e chave herdada", () => {
    const d = diagram();
    const auto = layoutDiagram(d, D);
    const l = layoutDiagram(d, D, { fantasma: { x: 1, y: 1 }, users: { x: Number.NaN, y: 0 }, constructor: { x: 9, y: 9 } } as never);
    expect(l.boxes.get("users")).toEqual(auto.boxes.get("users"));
    expect(l.boxes.has("fantasma")).toBe(false);
  });

  it("sem posições nada muda no desenho automático", () => {
    const d = diagram();
    const l = layoutDiagram(d, D);
    expect(l.x0).toBeUndefined();
    const copy = new Map(l.boxes);
    frameGroups(d, copy);
    expect(copy.get("group:blog")).toBeDefined();
  });
});

describe("arrastar tabela", () => {
  function setup(enabled = true) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g") as SVGGElement;
    g.innerHTML = `<g class="dbml-table" data-t="users"><path class="dbml-head"/><text class="dbml-title"/><rect class="dbml-row"/></g>`;
    svg.append(g);
    document.body.append(svg);
    (svg as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
    const log: string[] = [];
    let box = { x: 100, y: 50, w: 170, h: 52 };
    attachTableDrag(svg, g, {
      scale: () => 2,
      enabled: () => enabled,
      box: (id) => (id === "users" ? box : null),
      move: (id, x, y) => {
        box = { ...box, x, y };
        log.push(`move ${id} ${x},${y}`);
      },
      end: (id, x, y) => log.push(`end ${id} ${x},${y}`),
    });
    // jsdom não tem PointerEvent em todas as versões: MouseEvent com o `type` de ponteiro serve
    const pe = (type: string, target: Element, x: number, y: number) => {
      const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
      Object.defineProperty(e, "pointerId", { value: 1 });
      target.dispatchEvent(e);
    };
    return { svg, g, log, pe };
  }

  it("move pela escala do zoom e solta na posição final", () => {
    const { svg, g, log, pe } = setup();
    pe("pointerdown", g.querySelector(".dbml-head")!, 10, 10);
    pe("pointermove", svg, 30, 10); // 20 px na tela = 10 unidades com zoom 2
    pe("pointermove", svg, 50, 30);
    pe("pointerup", svg, 50, 30);
    expect(log).toEqual(["move users 110,50", "move users 120,60", "end users 120,60"]);
  });

  it("um clique sem mover não é arrasto", () => {
    const { svg, g, log, pe } = setup();
    pe("pointerdown", g.querySelector(".dbml-title")!, 10, 10);
    pe("pointermove", svg, 11, 11);
    pe("pointerup", svg, 11, 11);
    expect(log).toEqual([]);
  });

  it("só o cabeçalho arrasta, e só quando está habilitado; o evento não chega ao pan", () => {
    const off = setup(false);
    let panned = false;
    off.svg.addEventListener("pointerdown", () => (panned = true));
    off.pe("pointerdown", off.g.querySelector(".dbml-head")!, 0, 0);
    expect(panned).toBe(true);
    off.pe("pointermove", off.svg, 50, 50);
    expect(off.log).toEqual([]);

    const on = setup();
    let panned2 = false;
    on.svg.addEventListener("pointerdown", () => (panned2 = true));
    on.pe("pointerdown", on.g.querySelector(".dbml-row")!, 0, 0); // corpo: não arrasta
    expect(panned2).toBe(true);
    panned2 = false;
    on.pe("pointerdown", on.g.querySelector(".dbml-head")!, 0, 0);
    expect(panned2).toBe(false);
  });

  it("cancelar devolve a tabela ao lugar", () => {
    const { svg, g, log, pe } = setup();
    pe("pointerdown", g.querySelector(".dbml-head")!, 0, 0);
    pe("pointermove", svg, 20, 0);
    pe("pointercancel", svg, 20, 0);
    expect(log).toEqual(["move users 110,50", "move users 100,50"]);
  });
});
