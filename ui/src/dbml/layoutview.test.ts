import { describe, expect, it } from "vitest";
import { changedRange } from "./layoutview";

const apply = (old: string, text: string) => {
  const r = changedRange(old, text);
  return old.slice(0, r.from) + r.insert + old.slice(r.to);
};

describe("changedRange", () => {
  it("troca só o trecho que mudou", () => {
    expect(changedRange('{"x": 10, "y": 5}', '{"x": 99, "y": 5}')).toEqual({ from: 6, to: 8, insert: "99" });
  });
  it("sem diferença não troca nada", () => {
    expect(changedRange("igual", "igual")).toEqual({ from: 5, to: 5, insert: "" });
  });
  it("inserção, remoção e prefixo/sufixo repetidos", () => {
    for (const [a, b] of [["abc", "abXc"], ["abXc", "abc"], ["aaaa", "aaa"], ["aaa", "aaaa"], ["", "novo"], ["velho", ""], ["x\ny", "x\nzz\ny"]]) {
      expect(apply(a, b)).toBe(b);
    }
  });
});
