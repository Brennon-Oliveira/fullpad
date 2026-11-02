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
