import { describe, expect, it } from "vitest";
import { dropIndex, insertionIndex, slideOffsets } from "./tabdrag";

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

describe("dropIndex", () => {
  // abas de 60, 300 e 100 px, coladas
  const lefts = [0, 60, 360];
  const widths = [60, 300, 100];
  it("a aba larga troca com a pequena assim que sua borda passa do centro dela", () => {
    expect(dropIndex(lefts, widths, 1, 60)).toBe(1); // parada
    expect(dropIndex(lefts, widths, 1, 40)).toBe(1); // ainda não passou do centro (30)
    expect(dropIndex(lefts, widths, 1, 20)).toBe(0); // passou
  });
  it("para a direita vale a borda direita", () => {
    expect(dropIndex(lefts, widths, 1, 100)).toBe(1); // direita em 400 < centro de 410
    expect(dropIndex(lefts, widths, 1, 120)).toBe(2);
  });
});
