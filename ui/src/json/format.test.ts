import { describe, expect, it } from "vitest";
import { mapCursor } from "./format";

describe("mapCursor", () => {
  const old = '{"a":[1,2],"b":"x y"}';
  const next = '{\n  "a": [\n    1,\n    2\n  ],\n  "b": "x y"\n}';
  it("mantém o cursor no mesmo caractere depois de formatar", () => {
    for (const probe of ["1", "2", '"b"', "y"]) {
      const at = old.indexOf(probe);
      const to = mapCursor(old, at, next);
      expect(next.slice(to).replace(/^\s+/, "")[0]).toBe(old[at]);
    }
  });
  it("início e fim", () => {
    expect(mapCursor(old, 0, next)).toBe(0);
    expect(mapCursor(old, old.length, next)).toBe(next.length);
  });
  it("ida e volta (minificar) preserva a posição", () => {
    const at = next.indexOf("2");
    expect(mapCursor(next, at, old)).toBe(old.indexOf("2"));
  });
});
