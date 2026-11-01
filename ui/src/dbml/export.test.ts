// @vitest-environment jsdom
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import * as dagre from "@dagrejs/dagre";
import { bounds, buildSvg } from "./export";
import { type DagreLike, layoutDiagram } from "./layout";
import { type CompilerLike, parseDbml } from "./model";
import { renderDiagram } from "./render";

const { Compiler } = createRequire(import.meta.url)("@dbml/parse") as { Compiler: new () => CompilerLike };

function setup() {
  const d = parseDbml(Compiler, "Table users { id int [pk] }\nTable posts { id int [pk]\n uid int [ref: > users.id] }").diagram!;
  const layout = layoutDiagram(d, dagre as unknown as DagreLike);
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("transform", "translate(10 20) scale(0.5)");
  renderDiagram(d, layout, g);
  return { layout, g };
}

describe("exportação", () => {
  it("o retângulo de exportação envolve todas as caixas com folga", () => {
    const { layout } = setup();
    const b = bounds(layout);
    for (const box of layout.boxes.values()) {
      expect(box.x).toBeGreaterThan(b.x);
      expect(box.x + box.w).toBeLessThan(b.x + b.w);
      expect(box.y).toBeGreaterThan(b.y);
      expect(box.y + box.h).toBeLessThan(b.y + b.h);
    }
  });

  it("gera um SVG autônomo, sem pan/zoom nem áreas de interação", () => {
    const { layout, g } = setup();
    const { svg, width, height } = buildSvg(g, layout, "rgb(30, 31, 34)");
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`width="${width}" height="${height}"`);
    expect(svg).toContain('fill="rgb(30, 31, 34)"'); // fundo sólido
    expect(svg).toContain("users");
    expect(svg).not.toContain("translate(10 20)"); // pan/zoom do app não vai junto
    expect(svg).not.toContain("dbml-row");
    expect(svg).not.toContain("dbml-hit");
    expect(g.querySelector(".dbml-row")).not.toBeNull(); // o diagrama vivo não foi alterado
  });
});
