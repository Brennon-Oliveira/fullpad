import { describe, expect, it } from "vitest";
import { detectLanguage } from "./language";

describe("detectLanguage", () => {
  it("usa a extensão quando é conhecida", () => {
    expect(detectLanguage("", "C:\\notas\\a.md")).toBe("markdown");
    expect(detectLanguage("# titulo\n- a\n- b\n- c", "a.txt")).toBe("plain");
  });
  it("reconhece DBML só pela extensão", () => {
    expect(detectLanguage("Table a { id int }", "esquema.dbml")).toBe("dbml");
    expect(detectLanguage("", "C:\\x\\esquema.DBMLX")).toBe("dbml");
    expect(detectLanguage("Table a { id int }", null)).toBe("plain");
  });
  it("reconhece CSV e TSV só pela extensão", () => {
    expect(detectLanguage("a,b\n1,2", "dados.csv")).toBe("csv");
    expect(detectLanguage("a\tb", "C:\\x\\DADOS.TSV")).toBe("csv");
    expect(detectLanguage("a,b\n1,2\n3,4", null)).toBe("plain");
  });
  it("reconhece YAML e TOML só pela extensão", () => {
    expect(detectLanguage("a: 1", "config.yaml")).toBe("yaml");
    expect(detectLanguage("a: 1", "C:\\x\\ci.YML")).toBe("yaml");
    expect(detectLanguage("a = 1", "Cargo.toml")).toBe("toml");
    expect(detectLanguage("a: 1\nb: 2", null)).toBe("plain");
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
