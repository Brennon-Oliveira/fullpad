import { describe, expect, it } from "vitest";
import { dockTiles, tileAt, type DockGroup, type Rect } from "./dock";

const all = (path: number[], rect: Rect, extra: { path: number[]; rect: Rect }[] = []) => [{ path, rect }, ...extra];

describe("alvos de soltar", () => {
  it("um painel sozinho: uma borda em cada lado, cantos livres, sem centro", () => {
    const rect = { left: 0, top: 0, width: 800, height: 600 };
    const g: DockGroup = {
      g: 1, body: { left: 0, top: 30, width: 800, height: 570 }, edges: true, center: false,
      cands: { left: all([], rect), right: all([], rect), top: all([], rect), bottom: all([], rect) },
    };
    const tiles = dockTiles([g], 30);
    expect(tiles.map((t) => t.side).sort()).toEqual(["bottom", "left", "right", "top"]);
    expect(tileAt(tiles, 20, 300)?.side).toBe("left");
    expect(tileAt(tiles, 400, 590)?.side).toBe("bottom");
    expect(tileAt(tiles, 5, 35)).toBeNull(); // canto
    expect(tileAt(tiles, 400, 300)).toBeNull(); // meio
  });

  it("pilha: barra externa divide o bloco inteiro e a de dentro só o painel", () => {
    const root = { left: 0, top: 0, width: 800, height: 600 };
    const a = { left: 0, top: 0, width: 800, height: 300 };
    const b = { left: 0, top: 300, width: 800, height: 300 };
    const mk = (g: number, r: Rect, path: number[]): DockGroup => ({
      g, body: { ...r, top: r.top + 30, height: r.height - 30 }, edges: true, center: g === 2,
      cands: { left: all(path, r, [{ path: [], rect: root }]), right: all(path, r, [{ path: [], rect: root }]), top: all(path, r), bottom: all(path, r) },
    });
    const tiles = dockTiles([mk(1, a, [0]), mk(2, b, [1])], 30);
    expect(tiles.filter((t) => t.kind === "block")).toHaveLength(2); // esquerda e direita do bloco, sem repetir
    const blk = tileAt(tiles, 10, 300)!;
    expect([blk.kind, blk.path, blk.side]).toEqual(["block", [], "left"]);
    const edge = tileAt(tiles, 50, 150)!;
    expect([edge.kind, edge.g, edge.path]).toEqual(["edge", 1, [0]]);
    expect(tileAt(tiles, 400, 465)?.kind).toBe("center");
  });

  it("painel pequeno demais não ganha alvo de borda", () => {
    const r = { left: 0, top: 0, width: 40, height: 600 };
    const g: DockGroup = {
      g: 1, body: { left: 0, top: 30, width: 40, height: 570 }, edges: true, center: false,
      cands: { left: all([0], r), right: all([0], r), top: all([0], r), bottom: all([0], r) },
    };
    expect(dockTiles([g], 30).filter((t) => t.side === "left" || t.side === "right")).toHaveLength(0);
  });
});
