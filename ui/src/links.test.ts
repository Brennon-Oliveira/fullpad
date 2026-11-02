import { describe, expect, it } from "vitest";
import { urlInLine } from "./links";

describe("urlInLine", () => {
  const t = "veja (https://a.com/x_(y)) e https://b.org/p?q=1, ok.";
  it("acha a URL sob a posição", () => {
    expect(urlInLine(t, t.indexOf("a.com"))?.url).toBe("https://a.com/x_(y)");
    expect(urlInLine(t, t.indexOf("b.org"))?.url).toBe("https://b.org/p?q=1");
  });
  it("fora da URL não acha", () => {
    expect(urlInLine(t, 1)).toBeNull();
    expect(urlInLine(t, t.length - 1)).toBeNull();
  });
  it("aceita mailto", () => {
    expect(urlInLine("mailto:a@b.com.", 3)?.url).toBe("mailto:a@b.com");
  });
});
