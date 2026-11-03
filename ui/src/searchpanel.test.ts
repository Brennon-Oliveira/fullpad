import { SearchQuery } from "@codemirror/search";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { countLabel, countMatches } from "./searchpanel";

const state = (doc: string, from = 0, to = from) => EditorState.create({ doc, selection: EditorSelection.single(from, to) });

describe("contador da busca", () => {
  it("conta os resultados e acha o selecionado", () => {
    const q = new SearchQuery({ search: "ab" });
    const c = countMatches(q, state("ab ab ab", 3, 5));
    expect(c).toEqual({ total: 3, index: 2, truncated: false });
    expect(countLabel(q, c)).toEqual({ text: "2 de 3", kind: "ok" });
  });

  it("seleção que não é resultado não tem posição", () => {
    const q = new SearchQuery({ search: "ab" });
    const c = countMatches(q, state("ab ab", 1, 1));
    expect(countLabel(q, c).text).toBe("2 resultados");
  });

  it("respeita maiúsculas e palavra inteira", () => {
    const doc = "Casa casa casaco";
    expect(countMatches(new SearchQuery({ search: "casa" }), state(doc)).total).toBe(3);
    expect(countMatches(new SearchQuery({ search: "casa", caseSensitive: true }), state(doc)).total).toBe(2);
    expect(countMatches(new SearchQuery({ search: "casa", wholeWord: true }), state(doc)).total).toBe(2);
  });

  it("estados vazio, sem resultado e regex inválida", () => {
    expect(countLabel(new SearchQuery({ search: "" }), countMatches(new SearchQuery({ search: "" }), state("x"))).kind).toBe("idle");
    const none = new SearchQuery({ search: "zzz" });
    expect(countLabel(none, countMatches(none, state("x")))).toEqual({ text: "Nenhum resultado", kind: "none" });
    const bad = new SearchQuery({ search: "(", regexp: true });
    expect(countLabel(bad, countMatches(bad, state("x(")))).toEqual({ text: "Expressão inválida", kind: "error" });
  });

  it("passando do teto mostra N+", () => {
    const q = new SearchQuery({ search: "a" });
    const c = countMatches(q, state("a".repeat(50)), 10);
    expect(c).toMatchObject({ total: 10, truncated: true });
    expect(countLabel(q, c).text).toBe("10+ resultados");
  });
});
