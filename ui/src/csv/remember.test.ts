import { describe, expect, it } from "vitest";
import { parseDelims, withDelim, withoutDelim } from "./remember";

describe("separador lembrado por arquivo", () => {
  it("lê só o que é válido", () => {
    expect(parseDelims('{"/a.csv":";","/b.csv":"xx","/c.csv":"\\""}')).toEqual({ "/a.csv": ";" });
    expect(parseDelims("lixo")).toEqual({});
    expect(parseDelims("[1]")).toEqual({});
    expect(parseDelims(null)).toEqual({});
  });
  it("troca e remove sem mexer no original", () => {
    const a = { "/a": ";" };
    const b = withDelim(a, "/b", "|");
    expect(a).toEqual({ "/a": ";" });
    expect(Object.keys(withDelim(b, "/a", ","))).toEqual(["/b", "/a"]);
    expect(withoutDelim(b, "/a")).toEqual({ "/b": "|" });
  });
  it("guarda as 200 mais recentes", () => {
    let m: Record<string, string> = {};
    for (let i = 0; i < 230; i++) m = withDelim(m, `/f${i}`, ";");
    expect(Object.keys(m)).toHaveLength(200);
    expect(m["/f0"]).toBeUndefined();
    expect(m["/f229"]).toBe(";");
  });
});
