import { describe, expect, it } from "vitest";
import { parseRoots, topRoot, withRoot } from "./roots";

describe("raiz de um módulo dbmlx", () => {
  it("lê só o que é válido", () => {
    expect(parseRoots('{"/a/m.dbmlx":"/a/r.dbmlx","/b":"","/c":3}')).toEqual({ "/a/m.dbmlx": "/a/r.dbmlx" });
    expect(parseRoots("lixo")).toEqual({});
    expect(parseRoots("[1]")).toEqual({});
  });
  it("troca sem mexer no original e não faz de um arquivo a raiz de si mesmo", () => {
    const a = { "/m": "/r" };
    const b = withRoot(a, "/n", "/r");
    expect(a).toEqual({ "/m": "/r" });
    expect(Object.keys(withRoot(b, "/m", "/r2"))).toEqual(["/n", "/m"]);
    expect(withRoot(a, "/m", "/m")).toEqual({});
  });
  it("a raiz mais alta, sem laço", () => {
    expect(topRoot({ "/c": "/b", "/b": "/a" }, "/c")).toBe("/a");
    expect(topRoot({}, "/x")).toBe("/x");
    expect(topRoot({ "/a": "/b", "/b": "/a" }, "/a")).toBeTruthy();
  });
  it("guarda as 200 mais recentes", () => {
    let m: Record<string, string> = {};
    for (let i = 0; i < 230; i++) m = withRoot(m, `/f${i}`, "/r");
    expect(Object.keys(m)).toHaveLength(200);
    expect(m["/f0"]).toBeUndefined();
  });
});
