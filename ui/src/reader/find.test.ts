import { describe, expect, it } from "vitest";
import { MAX_HITS, fold, findOffsets, normalizeQuery, searchUnits, snippetAt } from "./find";

describe("comparação", () => {
  it("ignora maiúsculas e acentos sem mudar o comprimento", () => {
    for (const s of ["Ação, CORAÇÃO, é, À, ü, ñ, ç", "Naïve café", "ÀÉÎÕÜ", "normal", "😀 emoji", "tab\tnova\nlinha"]) expect(fold(s).length, s).toBe(s.length);
    expect(fold("Ação")).toBe("acao");
    expect(fold("CORAÇÃO")).toBe("coracao");
    expect(fold("a\tb\nc  d")).toBe("a b c  d");
  });

  it("acha com ou sem acento e maiúscula, e devolve posições do texto original", () => {
    const text = "A Ação do coração é a AÇÃO que importa.";
    expect(findOffsets(text, "acao")).toEqual([2, 13, 22]); // "Ação", "cor[ação]" e "AÇÃO"
    expect(findOffsets(text, "AÇÃO")).toEqual([2, 13, 22]);
    expect(findOffsets(text, "coracao")).toEqual([10]);
    expect(text.slice(2, 6)).toBe("Ação");
  });

  it("não sobrepõe ocorrências e respeita o limite", () => {
    expect(findOffsets("aaaa", "aa")).toEqual([0, 2]);
    expect(findOffsets("ab ".repeat(100), "ab", 5)).toHaveLength(5);
  });

  it("consulta curta demais não procura, e espaços da consulta são normalizados", () => {
    expect(findOffsets("a b c", "a")).toEqual([]);
    expect(findOffsets("a b c", "  ")).toEqual([]);
    expect(normalizeQuery("  Olá   MUNDO ")).toBe("ola mundo");
    expect(findOffsets("diz olá  mundo", "olá mundo")).toEqual([]); // dois espaços no texto ≠ um na consulta
    expect(findOffsets("diz olá mundo", "  OLÁ   mundo ")).toEqual([4]);
    expect(findOffsets("linha um\nlinha dois", "um linha")).toEqual([6]); // quebra de linha vale como espaço
  });

  it("trecho em volta, em uma linha, com reticências", () => {
    const text = "x".repeat(100) + " alvo " + "y\n\ny".repeat(30);
    const s = snippetAt(text, 101, 4, 10);
    expect(s.startsWith("…") && s.endsWith("…")).toBe(true);
    expect(s).toContain("alvo");
    expect(s).not.toContain("\n");
    expect(snippetAt("curto alvo fim", 6, 4, 50)).toBe("curto alvo fim");
  });
});

describe("varredura por unidades", () => {
  const pages = ["Primeira página sem nada.", "Aqui tem coração e outro CORAÇÃO.", "", "Fim com Coração."];
  const src = { units: pages.length, textOf: async (u: number) => pages[u] };

  it("junta os resultados em ordem, com a ocorrência de cada unidade", async () => {
    const r = await searchUnits(src, "coracao", () => false);
    expect(r.hits.map((h) => [h.unit, h.nth])).toEqual([[1, 0], [1, 1], [3, 0]]);
    expect(r.hits[0].snippet).toContain("coração");
    expect(r.truncated || r.cancelled).toBe(false);
  });

  it("uma unidade que falha não derruba a busca", async () => {
    const r = await searchUnits({ units: 3, textOf: async (u) => (u === 1 ? Promise.reject(new Error("x")) : "tem alvo aqui") }, "alvo", () => false);
    expect(r.hits.map((h) => h.unit)).toEqual([0, 2]);
  });

  it("para ao cancelar e informa o progresso", async () => {
    let cancelled = false;
    const seen: [number, number][] = [];
    const r = await searchUnits(src, "pagina", () => cancelled, (done, _total, hits) => {
      seen.push([done, hits.length]);
      if (done === 1) cancelled = true;
    });
    expect(r.cancelled).toBe(true);
    expect(seen).toEqual([[1, 1]]); // já informa os resultados que achou até ali
  });

  it("para no limite de resultados", async () => {
    const r = await searchUnits({ units: 2, textOf: async () => "ab ".repeat(400) }, "ab", () => false);
    expect(r.hits).toHaveLength(MAX_HITS);
    expect(r.truncated).toBe(true);
  });

  it("consulta curta ou enorme devolve nada", async () => {
    expect((await searchUnits(src, "a", () => false)).hits).toEqual([]);
    expect((await searchUnits(src, "x".repeat(101), () => false)).hits).toEqual([]);
  });
});
