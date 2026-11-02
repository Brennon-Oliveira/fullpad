import { describe, expect, it } from "vitest";
import { insertionIndex, slideOffsets } from "./tabdrag";

describe("insertionIndex", () => {
  const centers = [50, 150, 250];
  it("insere antes da primeira aba cujo centro está à frente do ponteiro", () => {
    expect(insertionIndex(centers, 10)).toBe(0);
    expect(insertionIndex(centers, 100)).toBe(1);
    expect(insertionIndex(centers, 200)).toBe(2);
  });
  it("passou de todas: vai para o fim", () => {
    expect(insertionIndex(centers, 999)).toBe(3);
    expect(insertionIndex([], 5)).toBe(0);
  });
});

describe("slideOffsets", () => {
  const w = [100, 80, 60, 40];
  it("arrastar para a direita: as que ficam no caminho recuam a largura da aba", () => {
    expect(slideOffsets(w, 0, 2)).toEqual([0, -100, -100, 0]);
  });
  it("arrastar para a esquerda: as que ficam no caminho avançam a largura da aba", () => {
    expect(slideOffsets(w, 3, 1)).toEqual([0, 40, 40, 0]);
  });
  it("sem mudança de lugar, ninguém se mexe", () => {
    expect(slideOffsets(w, 2, 2)).toEqual([0, 0, 0, 0]);
  });
});
