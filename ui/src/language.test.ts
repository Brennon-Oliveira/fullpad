import { describe, expect, it } from "vitest";
import { detectLanguage } from "./language";

describe("detectLanguage", () => {
  it("usa a extensão quando é conhecida", () => {
    expect(detectLanguage("", "C:\\notas\\a.md")).toBe("markdown");
    expect(detectLanguage("# titulo\n- a\n- b\n- c", "a.txt")).toBe("plain");
  });
  it("detecta markdown em nota avulsa", () => {
    expect(detectLanguage("# Título\ntexto", null)).toBe("markdown");
    expect(detectLanguage("- [ ] a\n- [x] b", null)).toBe("markdown");
    expect(detectLanguage("```js\nlet a\n```", null)).toBe("markdown");
  });
  it("deixa texto comum como plain", () => {
    expect(detectLanguage("", null)).toBe("plain");
    expect(detectLanguage("comprar leite\nligar pro João", null)).toBe("plain");
    expect(detectLanguage("#hashtag solto e texto", null)).toBe("plain");
  });
});
