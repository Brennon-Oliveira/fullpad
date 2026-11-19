// @vitest-environment jsdom
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { beforeEach, describe, expect, it, vi } from "vitest";

const imageRead = vi.fn();
vi.mock("./api", () => ({ api: { imageRead: (...a: unknown[]) => imageRead(...a), imageSave: vi.fn() } }));

const menus: { label?: string; disabled?: boolean }[][] = [];
vi.mock("./popup", () => ({ showMenuAt: (_x: number, _y: number, items: never[]) => menus.push(items) }));

import { clearImageCache, removeImageAt } from "./imagepreview";
import { livePreview } from "./livepreview";
import { registerImageHost } from "./mdimage";

Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const flush = () => new Promise((r) => setTimeout(r, 20));

function make(doc: string, cursor: number, fixed = false, base: string | null = "/notas") {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: "", extensions: [markdown({ base: markdownLanguage }), livePreview({ fixed })] }),
  });
  registerImageHost(view, { tabId: () => null, base: () => base, notify: () => {} }); // como o main.ts: logo depois de criar o editor
  view.dispatch({ changes: { from: 0, insert: doc }, selection: { anchor: cursor } });
  ensureSyntaxTree(view.state, doc.length, 5000);
  view.dispatch({ selection: { anchor: cursor } });
  return view;
}

describe("imagens no live preview", () => {
  beforeEach(() => {
    imageRead.mockReset();
    clearImageCache();
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:fake";
  });
  const DOC = "Antes\n\n![uma foto](imagens/n/a%20b.png)\n\nDepois\n";

  it("desenha a imagem local, pedindo ao Rust o caminho já decodificado e a pasta da nota", async () => {
    imageRead.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    const view = make(DOC, DOC.length);
    expect(view.dom.querySelectorAll(".cm-md-img").length).toBe(1);
    expect(view.dom.textContent).not.toContain("![uma foto]");
    await flush();
    expect(imageRead).toHaveBeenCalledWith("imagens/n/a b.png", "/notas");
    const img = view.dom.querySelector(".cm-md-img img") as HTMLImageElement;
    expect(img.alt).toBe("uma foto");
    expect(img.src).toBe("blob:fake");
    expect(view.state.doc.toString()).toBe(DOC); // o texto nunca muda
    view.destroy();
  });

  it("com o cursor tocando a imagem aparece o código", () => {
    imageRead.mockResolvedValue(new Uint8Array([1]).buffer);
    const view = make(DOC, DOC.indexOf("uma foto"));
    expect(view.dom.querySelectorAll(".cm-md-img").length).toBe(0);
    expect(view.dom.textContent).toContain("![uma foto](imagens/n/a%20b.png)");
    view.destroy();
  });

  it("no painel renderizado (fixed) fica sempre desenhada", () => {
    imageRead.mockResolvedValue(new Uint8Array([1]).buffer);
    const view = make(DOC, DOC.indexOf("uma foto"), true);
    expect(view.dom.querySelectorAll(".cm-md-img").length).toBe(1);
    view.destroy();
  });

  it("arquivo que não carrega mostra o aviso com o motivo, sem quebrar a linha", async () => {
    imageRead.mockRejectedValue("imagem grande demais para a miniatura");
    const view = make(DOC, DOC.length);
    await flush();
    const el = view.dom.querySelector(".cm-md-img.err") as HTMLElement;
    expect(el.textContent).toContain("uma foto");
    expect(el.title).toContain("grande demais");
    view.destroy();
  });

  it("imagem de rede e data: ficam como texto (o app não usa rede)", () => {
    const doc = "![a](https://x.com/a.png)\n\n![b](data:image/png;base64,AAAA)\n\nfim\n";
    const view = make(doc, doc.length);
    expect(view.dom.querySelectorAll(".cm-md-img").length).toBe(0);
    expect(imageRead).not.toHaveBeenCalled();
    view.destroy();
  });

  it("a mesma imagem só é lida uma vez (cache)", async () => {
    imageRead.mockResolvedValue(new Uint8Array([1]).buffer);
    const doc = "![](a.png)\n\n![](a.png)\n\nfim\n";
    const view = make(doc, doc.length);
    await flush();
    expect(imageRead).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  describe("carregando, copiar e remover", () => {
    it("mostra um giro no lugar da imagem enquanto ela carrega", async () => {
      let done: (b: ArrayBuffer) => void = () => {};
      imageRead.mockReturnValue(new Promise<ArrayBuffer>((r) => (done = r)));
      const view = make(DOC, DOC.length);
      expect(view.dom.querySelector(".cm-md-img.loading .cm-md-spin")).not.toBeNull();
      expect(view.dom.querySelector(".cm-md-img img")).toBeNull();
      done(new Uint8Array([1]).buffer);
      await flush();
      expect(view.dom.querySelector(".cm-md-spin")).toBeNull();
      expect(view.dom.querySelector(".cm-md-img img")).not.toBeNull();
      view.destroy();
    });

    it("ao carregar, traz os botões de copiar e remover", async () => {
      imageRead.mockResolvedValue(new Uint8Array([1]).buffer);
      const view = make(DOC, DOC.length);
      await flush();
      const btns = [...view.dom.querySelectorAll<HTMLElement>(".cm-md-img-tools button")].map((b) => b.title);
      expect(btns).toEqual(["Copiar imagem", "Remover imagem do texto"]);
      view.destroy();
    });

    it("o × tira a imagem sozinha na linha, com a quebra, e é um passo só", async () => {
      imageRead.mockResolvedValue(new Uint8Array([1]).buffer);
      const view = make(DOC, DOC.length);
      await flush();
      (view.dom.querySelector(".cm-md-img-btn.danger") as HTMLElement).click();
      expect(view.state.doc.toString()).toBe("Antes\n\n\nDepois\n");
      view.destroy();
    });

    it("no painel só de leitura não há o ×, mas há copiar", async () => {
      imageRead.mockResolvedValue(new Uint8Array([1]).buffer);
      const parent = document.body.appendChild(document.createElement("div"));
      const view = new EditorView({
        parent,
        state: EditorState.create({ doc: "", extensions: [markdown({ base: markdownLanguage }), livePreview({ fixed: true }), EditorState.readOnly.of(true)] }),
      });
      registerImageHost(view, { tabId: () => null, base: () => "/n", notify: () => {} });
      view.dispatch({ changes: { from: 0, insert: DOC } });
      await flush();
      const btns = [...view.dom.querySelectorAll<HTMLElement>(".cm-md-img-tools button")].map((b) => b.title);
      expect(btns).toEqual(["Copiar imagem"]);
      view.destroy();
    });

    it("o botão direito abre o menu com copiar e remover, sem abrir o do painel", async () => {
      imageRead.mockResolvedValue(new Uint8Array([1]).buffer);
      const view = make(DOC, DOC.length);
      await flush();
      menus.length = 0;
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      const outer = vi.fn();
      view.dom.parentElement!.addEventListener("contextmenu", outer);
      view.dom.querySelector(".cm-md-img img")!.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
      expect(outer).not.toHaveBeenCalled();
      expect(menus[0]!.filter((i) => typeof i === "object").map((i) => i.label)).toEqual(["Copiar imagem", "Remover imagem do texto"]);
      view.destroy();
    });

    it("remover confere que ali ainda há uma imagem e junta com a linha vizinha na última linha", () => {
      imageRead.mockResolvedValue(new Uint8Array([1]).buffer);
      const doc = "texto\n![a](x.png)";
      const view = make(doc, 0);
      expect(removeImageAt(view, doc.indexOf("!["), "![a](x.png)".length)).toBe(true);
      expect(view.state.doc.toString()).toBe("texto");
      expect(removeImageAt(view, 0, 5)).toBe(false); // não é imagem
      expect(view.state.doc.toString()).toBe("texto");
      view.destroy();
    });

    it("imagem no meio do texto: só ela sai", () => {
      imageRead.mockResolvedValue(new Uint8Array([1]).buffer);
      const doc = "antes ![a](x.png) depois";
      const view = make(doc, 0);
      removeImageAt(view, 6, "![a](x.png)".length);
      expect(view.state.doc.toString()).toBe("antes  depois");
      view.destroy();
    });
  });
});
