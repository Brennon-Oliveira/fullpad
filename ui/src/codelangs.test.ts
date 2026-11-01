import { LanguageDescription } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { codeLanguages } from "./codelangs";

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
});
