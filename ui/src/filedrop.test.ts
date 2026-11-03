// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createFileDrop, dropMessage } from "./filedrop";

describe("aviso de arrastar arquivos", () => {
  it("diz quantos arquivos serão abertos", () => {
    expect(dropMessage(0)).toBe("Solte para abrir");
    expect(dropMessage(1)).toBe("Solte para abrir o arquivo");
    expect(dropMessage(3)).toBe("Solte para abrir 3 arquivos");
  });

  it("nasce escondido, aparece ao arrastar e some ao soltar ou sair", () => {
    const host = document.createElement("div");
    const drop = createFileDrop(host);
    const el = host.querySelector<HTMLElement>(".filedrop")!;
    expect(el.hidden).toBe(true);
    drop.show(2);
    expect(el.hidden).toBe(false);
    expect(el.textContent).toContain("Solte para abrir 2 arquivos");
    drop.hide();
    expect(el.hidden).toBe(true);
  });
});
