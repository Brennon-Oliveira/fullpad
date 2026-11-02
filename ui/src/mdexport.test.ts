import { describe, expect, it } from "vitest";
import { escapeHtml, markdownToHtml } from "./mdexport";

describe("mdexport", () => {
  it("gera um documento completo e autônomo", async () => {
    const html = await markdownToHtml("# Oi\n\n- [x] feito\n\n| a | b |\n|---|---|\n| 1 | 2 |\n", "Minha <nota>");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>Minha &lt;nota&gt;</title>");
    expect(html).toContain("<h1>Oi</h1>");
    expect(html).toContain("<table>");
    expect(html).toContain("<style>");
    expect(html).not.toContain("<link");
  });

  it("escapa o título", () => {
    expect(escapeHtml('a & "b" <c>')).toBe("a &amp; &quot;b&quot; &lt;c&gt;");
  });
});

describe("markdownToHtml para impressão", () => {
  it("zera a margem da página (some o cabeçalho do navegador) e põe o nome do app no rodapé", async () => {
    const { markdownToHtml } = await import("./mdexport");
    const print = await markdownToHtml("# Oi", "t", true);
    expect(print).toContain("@page { margin: 0; }");
    expect(print).toContain('class="pg-foot">Fullpad<');
    const plain = await markdownToHtml("# Oi", "t");
    expect(plain).not.toContain("pg-foot");
  });
});
