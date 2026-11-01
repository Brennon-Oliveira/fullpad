import { describe, expect, it } from "vitest";
import { insertionIndex } from "./tabdrag";

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
