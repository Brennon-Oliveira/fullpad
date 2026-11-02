import { describe, expect, it } from "vitest";
import { groupsOf, leaf, normalize, removeLeaf, resizeSizes, splitLeaf, zoneAt, type Split } from "./grid";

describe("grid", () => {
  it("divide um painel em duas colunas e depois a coluna da direita em duas linhas", () => {
    let r = splitLeaf(leaf(0), 0, "right", 1);
    expect(r).toMatchObject({ t: "split", dir: "row", kids: [{ g: 0 }, { g: 1 }] });
    r = splitLeaf(r, 1, "bottom", 2);
    const s = r as Split;
    expect(s.kids[1]).toMatchObject({ t: "split", dir: "col", kids: [{ g: 1 }, { g: 2 }] });
    expect(groupsOf(r)).toEqual([0, 1, 2]);
  });

  it("dividir na mesma direção acrescenta ao lado, sem aninhar, e reparte o peso", () => {
    let r = splitLeaf(leaf(0), 0, "right", 1);
    r = splitLeaf(r, 1, "right", 2);
    const s = r as Split;
    expect(s.kids.map((k) => (k as { g: number }).g)).toEqual([0, 1, 2]);
    expect(s.sizes).toEqual([1, 0.5, 0.5]);
  });

  it("dividir para a esquerda coloca o novo antes", () => {
    const r = splitLeaf(leaf(0), 0, "left", 1) as Split;
    expect(groupsOf(r)).toEqual([1, 0]);
  });

  it("remover um painel devolve o espaço e desfaz divisões com um filho só", () => {
    let r = splitLeaf(leaf(0), 0, "right", 1);
    r = splitLeaf(r, 1, "bottom", 2);
    const r2 = removeLeaf(r, 1)!;
    expect(groupsOf(r2)).toEqual([0, 2]);
    expect(removeLeaf(r2, 2)).toEqual(leaf(0));
    expect(removeLeaf(leaf(0), 0)).toBeNull();
  });

  it("remover absorve uma divisão da mesma direção", () => {
    // [0 | (1 / 2)]  →  tirando o 0 sobra (1 / 2)
    let r = splitLeaf(leaf(0), 0, "right", 1);
    r = splitLeaf(r, 1, "bottom", 2);
    expect(removeLeaf(r, 0)).toMatchObject({ t: "split", dir: "col" });
  });

  it("normalize aceita lixo e sempre devolve uma grade que bate com os grupos", () => {
    expect(normalize(null, [0]).root).toEqual(leaf(0));
    expect(normalize(undefined, []).root).toEqual(leaf(0));
    const bad = { root: { t: "split", dir: "diagonal", kids: [] }, focus: 9 } as never;
    const n = normalize(bad, [3, 4]);
    expect(groupsOf(n.root).sort()).toEqual([3, 4]);
    expect(n.focus).toBe(3);
  });

  it("normalize tira painéis de grupos que não existem mais e repõe os que faltam", () => {
    const l = { root: splitLeaf(leaf(0), 0, "right", 1), focus: 1 };
    const n = normalize(l, [0, 5]);
    expect(groupsOf(n.root).sort()).toEqual([0, 5]);
    expect(n.focus).toBe(0);
  });

  it("normalize conserta pesos inválidos e painel repetido", () => {
    const dup = { root: { t: "split", dir: "row", sizes: [1, -1], kids: [leaf(0), leaf(0)] }, focus: 0 } as never;
    expect(normalize(dup, [0]).root).toEqual(leaf(0));
    const neg = { root: { t: "split", dir: "row", sizes: [1, -1], kids: [leaf(0), leaf(1)] }, focus: 0 } as never;
    expect((normalize(neg, [0, 1]).root as Split).sizes).toEqual([1, 1]);
  });

  it("resizeSizes passa peso de um vizinho ao outro e respeita o mínimo", () => {
    expect(resizeSizes([1, 1], 0, 0.25)).toEqual([1.5, 0.5]);
    const r = resizeSizes([1, 1], 0, 5);
    expect(r[0] + r[1]).toBeCloseTo(2);
    expect(r[1]).toBeCloseTo(0.16);
  });

  it("zoneAt separa bordas e centro", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(zoneAt(rect, 50, 50)).toBe("center");
    expect(zoneAt(rect, 5, 50)).toBe("left");
    expect(zoneAt(rect, 95, 50)).toBe("right");
    expect(zoneAt(rect, 50, 5)).toBe("top");
    expect(zoneAt(rect, 50, 95)).toBe("bottom");
  });
});
