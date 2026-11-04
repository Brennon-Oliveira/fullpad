import { describe, expect, it } from "vitest";
import { activeIndex, railItems, treeOutline } from "./outlinecore";

describe("activeIndex", () => {
  const items = [{ pos: 10 }, { pos: 50 }, { pos: 90 }];
  it("é o último item que já começou", () => {
    expect(activeIndex(items, 0)).toBe(0);
    expect(activeIndex(items, 10)).toBe(0);
    expect(activeIndex(items, 49)).toBe(0);
    expect(activeIndex(items, 50)).toBe(1);
    expect(activeIndex(items, 1000)).toBe(2);
    expect(activeIndex([], 5)).toBe(0);
  });
});

describe("railItems", () => {
  it("poucos itens passam inteiros; muitos ficam só com o nível externo", () => {
    const few = [{ depth: 0 }, { depth: 1 }];
    expect(railItems(few)).toEqual(few);
    const many = Array.from({ length: 60 }, (_, i) => ({ depth: i % 2, i }));
    const r = railItems(many, 10);
    expect(r.length).toBe(10);
    expect(r.every((x) => x.depth === 0)).toBe(true);
  });
});

describe("treeOutline", () => {
  it("só objetos e listas, com o nome da chave ou o índice", () => {
    const nodes = [
      { parent: -1, kind: "object", from: 0, to: 90, end: 7, len: 2 },
      { parent: 0, kind: "object", key: "a", kfrom: 2, from: 5, to: 40, end: 4, len: 1 },
      { parent: 1, kind: "number", key: "n", kfrom: 8, from: 10, to: 12, end: 3, len: 0 },
      { parent: 1, kind: "array", key: "l", kfrom: 14, from: 17, to: 30, end: 4, len: 0 },
      { parent: 0, kind: "array", key: "b", kfrom: 45, from: 48, to: 80, end: 7, len: 2 },
      { parent: 4, kind: "object", from: 50, to: 60, end: 6, len: 0 },
      { parent: 4, kind: "object", from: 62, to: 70, end: 7, len: 0 },
    ] as never;
    expect(treeOutline(nodes).map((x) => [x.label, x.depth])).toEqual([["a", 0], ["l", 1], ["b", 0], ["[0]", 1], ["[1]", 1]]);
  });
});
