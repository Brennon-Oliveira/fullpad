import { LanguageDescription } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { NO_CODE_LANG, codeLanguageFor, codeLanguages, pickableLanguages } from "./codelangs";

const find = (name: string) => LanguageDescription.matchLanguageName(codeLanguages, name, true);

describe("linguagens dos blocos de código", () => {
  it.each([
    ["js", "JavaScript"],
    ["javascript", "JavaScript"],
    ["TS", "TypeScript"],
    ["tsx", "TypeScript"],
    ["json", "JSON"],
    ["sql", "SQL"],
    ["py", "Python"],
    ["python", "Python"],
    ["css", "CSS"],
    ["html", "HTML"],
    ["rust", "Rust"],
    ["rs", "Rust"],
    ["yml", "YAML"],
    ["bash", "Shell"],
    ["sh", "Shell"],
    ["cs", "C#"],
    ["csharp", "C#"],
    ["dbml", "DBML"],
  ])("```%s → %s", (alias, name) => {
    expect(find(alias)?.name).toBe(name);
  });

  it("linguagem desconhecida não casa (o bloco fica só em monoespaçado)", () => {
    expect(find("klingon")).toBeNull();
  });

  it("cada linguagem carrega de verdade", async () => {
    for (const d of codeLanguages) {
      const support = await d.load();
      expect(support.language, d.name).toBeDefined();
    }
  });

  it("o markdown usa a linguagem do bloco ao interpretar o código", async () => {
    await find("json")!.load(); // garante que está carregada, como o editor faz ao ver o bloco
    const state = EditorState.create({
      doc: '# Título\n\n```json\n{"a": 1}\n```\n',
      extensions: [markdown({ base: markdownLanguage, codeLanguages })],
    });
    const { ensureSyntaxTree } = await import("@codemirror/language");
    const tree = ensureSyntaxTree(state, state.doc.length, 5000)!;
    // `resolveInner` entra no parse aninhado do bloco; sem a linguagem do bloco seria só `CodeText`
    const inside = tree.resolveInner(state.doc.toString().indexOf('"a"') + 1, 1);
    expect(inside.name).toBe("PropertyName");
  });

  it.each([
    ["/x/example.py", "Python"],
    ["C:\\x\\example.rs", "Rust"],
    ["/x/example.ts", "TypeScript"],
    ["/x/example.cs", "C#"],
    ["/x/example.sh", "Shell"],
    ["/x/example.sql", "SQL"],
    ["/x/example.yaml", "YAML"],
    ["/x/example.css", "CSS"],
    ["/x/example.html", "HTML"],
    ["/x/main.go", "Go"],
    ["/x/Cargo.toml", "TOML"],
    ["/x/Dockerfile", "Dockerfile"],
    ["/x/app.cpp", "C++"],
  ])("a extensão de %s dá %s", (path, name) => {
    expect(codeLanguageFor(path)?.name).toBe(name);
  });

  it("sem arquivo, extensão desconhecida ou texto puro não há destaque", () => {
    expect(codeLanguageFor(null)).toBeNull();
    expect(codeLanguageFor("/x/notas.txt")).toBeNull();
    expect(codeLanguageFor("/x/notas.zzz")).toBeNull();
  });

  it("a escolha manual vale mais que a extensão; 'none' desliga o destaque", () => {
    expect(codeLanguageFor("/x/notas.txt", "Python")?.name).toBe("Python");
    expect(codeLanguageFor("/x/example.py", NO_CODE_LANG)).toBeNull();
    expect(codeLanguageFor("/x/example.py", "Inventada")).toBeNull();
  });

  it("DBML e JSON têm tipo próprio e ficam fora do seletor", () => {
    const names = pickableLanguages.map((l) => l.name);
    expect(names).not.toContain("DBML");
    expect(names).not.toContain("JSON");
    expect(names).toContain("Python");
  });
});
