// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { FIND_ALL, FIND_CURRENT, applyHighlights, clearHighlights, textRanges } from "./highlight";

const root = (html: string) => {
  const d = document.createElement("div");
  d.innerHTML = html;
  document.body.append(d);
  return d;
};
const texts = (rs: Range[]) => rs.map((r) => r.toString());

describe("textRanges", () => {
  it("um Range por ocorrência, sem acento nem maiúscula", () => {
    const rs = textRanges(root("<p>A Ação e a AÇÃO.</p>"), "acao");
    expect(texts(rs)).toEqual(["Ação", "AÇÃO"]);
  });

  it("acha a ocorrência que atravessa elementos (negrito no meio da palavra)", () => {
    const rs = textRanges(root("<p>um cora<b>ção</b> grande</p>"), "coração");
    expect(texts(rs)).toEqual(["coração"]);
  });

  it("acha através de vários spans, como a camada de texto do PDF", () => {
    const rs = textRanges(root("<div><span>o livro </span><span>de teste</span></div>"), "livro de");
    expect(texts(rs)).toEqual(["livro de"]);
  });

  it("ignora script e style e devolve vazio sem ocorrência", () => {
    expect(textRanges(root("<p>nada</p><script>alvo</script><style>alvo{}</style>"), "alvo")).toEqual([]);
    expect(textRanges(root("<p>nada aqui</p>"), "xyz")).toEqual([]);
    expect(textRanges(root("<p>a</p>"), "a")).toEqual([]); // curta demais
  });

  it("espaços repetidos na consulta não quebram o tamanho do trecho", () => {
    expect(texts(textRanges(root("<p>o livro de teste</p>"), "livro   de"))).toEqual(["livro de"]);
  });

  it("varias ocorrencias na mesma linha", () => {
    expect(texts(textRanges(root("<p>ab ab ab</p>"), "ab"))).toEqual(["ab", "ab", "ab"]);
  });
});

describe("destaque", () => {
  it("sem suporte do navegador não faz nada nem quebra", () => {
    const w = { } as unknown as Window;
    expect(() => applyHighlights(w, [], null)).not.toThrow();
    expect(() => clearHighlights(w)).not.toThrow();
  });

  it("registra todas as ocorrências e, por cima, a atual; limpar remove os dois", () => {
    const map = new Map<string, { ranges: Range[]; priority: number }>();
    class Highlight {
      ranges: Range[];
      priority = 0;
      constructor(...r: Range[]) {
        this.ranges = r;
      }
    }
    const w = { CSS: { highlights: map }, Highlight } as unknown as Window;
    const rs = textRanges(root("<p>ab ab</p>"), "ab");
    applyHighlights(w, rs, rs[1]);
    expect(map.get(FIND_ALL)!.ranges).toHaveLength(2);
    expect(map.get(FIND_CURRENT)!.ranges).toEqual([rs[1]]);
    expect(map.get(FIND_CURRENT)!.priority).toBeGreaterThan(map.get(FIND_ALL)!.priority);
    applyHighlights(w, rs, null);
    expect(map.has(FIND_CURRENT)).toBe(false);
    clearHighlights(w);
    expect(map.size).toBe(0);
  });
});
