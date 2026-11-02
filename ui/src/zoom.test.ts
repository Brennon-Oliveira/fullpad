import { describe, expect, it } from "vitest";
import { clampZoom, stepZoom, wheelZoom } from "./zoom";

describe("zoom", () => {
  it("limita entre 25% e 500%", () => {
    expect(clampZoom(1)).toBe(25);
    expect(clampZoom(9999)).toBe(500);
    expect(clampZoom(NaN)).toBe(100);
  });
  it("a roda anda 5% por clique, e fração no touchpad", () => {
    expect(wheelZoom(100, -100)).toBe(105);
    expect(wheelZoom(100, 100)).toBe(95);
    expect(wheelZoom(100, -20)).toBe(101);
  });
  it("o teclado cai em múltiplos de 10", () => {
    expect(stepZoom(100, 1)).toBe(110);
    expect(stepZoom(95, 1)).toBe(100);
    expect(stepZoom(95, -1)).toBe(90);
    expect(stepZoom(100, -1)).toBe(90);
    expect(stepZoom(500, 1)).toBe(500);
  });
});
