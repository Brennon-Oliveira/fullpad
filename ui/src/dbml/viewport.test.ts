// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { attachViewport } from "./viewport";

function setup() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON() {} });
  svg.append(g);
  return attachViewport(svg, g);
}

describe("viewport.focus", () => {
  it("enquadra a caixa no centro, com folga, e limita o zoom", () => {
    const vp = setup();
    vp.focus({ x: 100, y: 200, w: 200, h: 100 }, false);
    const v = vp.get();
    expect(v.zoom).toBeCloseTo(Math.min(3, (800 - 240) / 200, (600 - 240) / 100)); // limitado pela largura: 2,8
    expect(v.x + (100 + 100) * v.zoom).toBeCloseTo(400, 0); // centro da caixa no centro da tela
    expect(v.y + (200 + 50) * v.zoom).toBeCloseTo(300, 0);
  });

  it("uma caixa minúscula não passa do zoom máximo; caixa vazia não faz nada", () => {
    const vp = setup();
    vp.focus({ x: 0, y: 0, w: 10, h: 10 }, false);
    expect(vp.get().zoom).toBe(3);
    const before = vp.get();
    vp.focus({ x: 0, y: 0, w: 0, h: 10 }, false);
    expect(vp.get()).toEqual(before);
  });
});
