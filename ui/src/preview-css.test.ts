import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * O CodeMirror não conta margem vertical de linha ou de widget no mapa de alturas: o clique cai
 * numa linha diferente da que aparece sob o mouse. No preview, espaço vertical é `padding`.
 */
describe("css do preview", () => {
  it("nenhuma regra do preview usa margem vertical", () => {
    const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
    const bad: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const sel = m[1].trim();
      if (!/\.cm-md-/.test(sel)) continue;
      if (/\bmargin(-top|-bottom|-block[a-z-]*)?\s*:\s*(?!0(\s|;|$))/.test(m[2]) && !/^\.cm-md-check/.test(sel)) bad.push(sel);
      if (/margin:\s*[^;]*\s[^;]*;/.test(m[2]) && !/^\.cm-md-check/.test(sel)) bad.push(sel);
    }
    expect([...new Set(bad)]).toEqual([]);
  });
});
