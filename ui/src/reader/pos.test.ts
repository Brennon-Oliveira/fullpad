import { describe, expect, it } from "vitest";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_KEY_FACTOR, canvasRatio, fitScale, formatBytes, isSafeLink, normalizePos, pageIndexAt, visibleRange, wheelFactor } from "./pos";

describe("normalizePos", () => {
  it("usa os padrões quando não há nada ou veio lixo do disco", () => {
    const def = { page: 1, frac: 0, zoom: null };
    for (const raw of [undefined, null, 5, "x", [], {}, { page: "3" }, { page: NaN, frac: Infinity, zoom: "a" }]) {
      expect(normalizePos(raw)).toEqual(def);
    }
  });
  it("mantém valores válidos e limita os absurdos", () => {
    expect(normalizePos({ page: 42, frac: 0.25, zoom: 1.5 })).toEqual({ page: 42, frac: 0.25, zoom: 1.5 });
    expect(normalizePos({ page: -7, frac: 9, zoom: 0 })).toEqual({ page: 1, frac: 1, zoom: MIN_ZOOM });
    expect(normalizePos({ page: 3.9, frac: -1, zoom: 999 })).toEqual({ page: 3, frac: 0, zoom: MAX_ZOOM });
  });
});

describe("páginas visíveis", () => {
  // 10 páginas de 100 de altura, com 10 de espaço
  const topOf = (i: number) => i * 110;
  const heightOf = () => 100;

  it("acha a página sob uma posição", () => {
    expect(pageIndexAt(10, topOf, -50)).toBe(0);
    expect(pageIndexAt(10, topOf, 0)).toBe(0);
    expect(pageIndexAt(10, topOf, 109)).toBe(0);
    expect(pageIndexAt(10, topOf, 110)).toBe(1);
    expect(pageIndexAt(10, topOf, 555)).toBe(5);
    expect(pageIndexAt(10, topOf, 99999)).toBe(9);
    expect(pageIndexAt(0, topOf, 10)).toBe(0);
  });
  it("devolve a faixa que toca a janela", () => {
    expect(visibleRange(10, topOf, heightOf, 0, 50)).toEqual({ first: 0, last: 0 });
    expect(visibleRange(10, topOf, heightOf, 90, 230)).toEqual({ first: 0, last: 2 });
    expect(visibleRange(10, topOf, heightOf, 5000, 6000)).toEqual({ first: 9, last: 9 });
  });
});

describe("escala e memória", () => {
  it("ajusta à largura sem escala zero nem infinita", () => {
    expect(fitScale(600, 300)).toBe(2);
    expect(fitScale(0, 300)).toBe(1);
    expect(fitScale(600, 0)).toBe(1);
    expect(fitScale(600, 200_000)).toBe(MIN_ZOOM);
    expect(fitScale(600, 1)).toBe(MAX_ZOOM);
  });
  it("a resolução do canvas cai em página gigante, mas nunca passa do dpr", () => {
    const max = 16 * 1024 * 1024;
    expect(canvasRatio(800, 1000, 1, max)).toBe(1);
    expect(canvasRatio(800, 1000, 3, max)).toBe(2);
    const giant = canvasRatio(100_000, 100_000, 2, max);
    expect(giant).toBeLessThan(0.1);
    expect(100_000 * giant * 100_000 * giant).toBeLessThanOrEqual(max * 1.0001);
  });
});

describe("links do PDF", () => {
  it("só http, https e mailto", () => {
    for (const ok of ["http://a.b", "HTTPS://a.b/x?y=1", " mailto:a@b.c"]) expect(isSafeLink(ok), ok).toBe(true);
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "calc.exe", "//a.b", "ftp://a.b", ""]) expect(isSafeLink(bad), bad).toBe(false);
  });
});

describe("formatBytes", () => {
  it("usa a unidade certa", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2,5 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3 GB");
  });
});

describe("zoom do documento", () => {
  it("a roda anda 10% por clique, para os dois lados, e o touchpad em fração", () => {
    expect(wheelFactor(-100)).toBeCloseTo(1.1);
    expect(wheelFactor(100)).toBeCloseTo(1 / 1.1);
    expect(wheelFactor(0)).toBe(1);
    expect(wheelFactor(-10)).toBeGreaterThan(1);
    expect(wheelFactor(-10)).toBeLessThan(1.02);
  });
  it("o teclado e os botões andam 15%", () => {
    expect(ZOOM_KEY_FACTOR).toBe(1.15);
  });
});
