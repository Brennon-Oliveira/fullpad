// @vitest-environment jsdom
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { beforeEach, describe, expect, it, vi } from "vitest";

const imageSave = vi.fn();
vi.mock("./api", () => ({ api: { imageSave: (...a: unknown[]) => imageSave(...a), imageRead: vi.fn() } }));

import { acceptsImages, clipboardImage, imageMarkdown, imagePaste, insertImage, isRemoteSrc, localSrc, mimeOfSrc, registerImageHost, savedMessage, toDataUri } from "./mdimage";

// o jsdom não mede texto: o CodeMirror precisa disto só para medir
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const flush = () => new Promise((r) => setTimeout(r, 10));

function dt(items: { type: string; kind?: string; file?: File }[]): DataTransfer {
  return {
    items: items.map((i) => ({ kind: i.kind ?? "file", type: i.type, getAsFile: () => i.file ?? null })),
    files: items.filter((i) => i.file).map((i) => i.file),
    getData: () => "",
  } as unknown as DataTransfer;
}

describe("partes puras", () => {
  it("escreve a imagem em markdown", () => {
    expect(imageMarkdown("imagens/a/x.png")).toBe("![](imagens/a/x.png)");
    expect(imageMarkdown("x.png", "foto")).toBe("![foto](x.png)");
  });

  it("separa o que é local do que é rede", () => {
    expect(isRemoteSrc("https://x.com/a.png")).toBe(true);
    expect(isRemoteSrc("data:image/png;base64,AAAA")).toBe(true);
    expect(isRemoteSrc("imagens/a.png")).toBe(false);
    expect(isRemoteSrc("file:///home/u/a.png")).toBe(false);
    expect(isRemoteSrc("C:/Users/u/a.png")).toBe(false);
    expect(isRemoteSrc("C:\\Users\\u\\a.png")).toBe(false);
  });

  it("desfaz o %XX do destino (menos o file://, que o Rust decodifica)", () => {
    expect(localSrc("imagens/minhas%20notas/a.png")).toBe("imagens/minhas notas/a.png");
    expect(localSrc("<imagens/a b/x.png>")).toBe("imagens/a b/x.png");
    expect(localSrc("file:///C:/Z%C3%A9/a.png")).toBe("file:///C:/Z%C3%A9/a.png");
    expect(localSrc("100%/a.png")).toBe("100%/a.png"); // `%` que não é escape
  });

  it("acha o tipo pela extensão", () => {
    expect(mimeOfSrc("a/b.PNG")).toBe("image/png");
    expect(mimeOfSrc("a.jpeg")).toBe("image/jpeg");
    expect(mimeOfSrc("a.webp")).toBe("image/webp");
    expect(mimeOfSrc("a.txt")).toBe("application/octet-stream");
  });

  it("monta o data: em base64", () => {
    const b = new Uint8Array([104, 105]).buffer; // "hi"
    expect(toDataUri(b, "image/png")).toBe("data:image/png;base64,aGk=");
    expect(toDataUri(new Uint8Array(100_000).buffer, "image/png").length).toBeGreaterThan(100_000);
  });

  it("pega a imagem da área de transferência", () => {
    const png = new File([new Uint8Array([1])], "x.png", { type: "image/png" });
    expect(clipboardImage(dt([{ type: "text/plain", kind: "string" }, { type: "image/png", file: png }]))).toBe(png);
    expect(clipboardImage(dt([{ type: "text/plain", kind: "string" }]))).toBeNull();
    expect(clipboardImage(null)).toBeNull();
  });

  it("aba de texto tem o kind ausente e aceita imagem; leitor, nota de versão e arquivo grande não", () => {
    expect(acceptsImages({})).toBe(true);
    expect(acceptsImages({ kind: "text" })).toBe(true);
    expect(acceptsImages({ kind: "pdf" })).toBe(false);
    expect(acceptsImages({ kind: "unknown" })).toBe(false);
    expect(acceptsImages({ large: true })).toBe(false);
    expect(acceptsImages({ release_notes: true })).toBe(false);
    expect(acceptsImages(undefined)).toBe(false);
  });

  it("avisa se reaproveitou ou guardou", () => {
    expect(savedMessage({ name: "a.png", reused: true, size: 10 })).toContain("reaproveitada");
    expect(savedMessage({ name: "a.png", reused: false, size: 2048 })).toContain("2 KB");
  });
});

describe("colar imagem no editor", () => {
  const notes: string[] = [];
  let tab: string | null = "aba-1";
  const make = (doc = "antes depois") => {
    const view = new EditorView({
      parent: document.body.appendChild(document.createElement("div")),
      state: EditorState.create({ doc, selection: { anchor: Math.min(5, doc.length) }, extensions: [markdown({ base: markdownLanguage }), imagePaste] }),
    });
    registerImageHost(view, { tabId: () => tab, base: () => null, notify: (t) => notes.push(t) });
    return view;
  };
  const paste = (view: EditorView, data: DataTransfer) => {
    const e = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: DataTransfer };
    e.clipboardData = data;
    view.contentDOM.dispatchEvent(e);
    return e;
  };
  const png = () => new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });

  beforeEach(() => {
    imageSave.mockReset();
    notes.length = 0;
    tab = "aba-1";
  });

  it("guarda a imagem e escreve ![](destino) no cursor, numa transação (um passo no Ctrl+Z)", async () => {
    imageSave.mockResolvedValue({ target: "imagens/n/9f.png", name: "9f.png", folder: "/x", reused: false, size: 3 });
    const view = make();
    const e = paste(view, dt([{ type: "image/png", file: png() }]));
    expect(e.defaultPrevented).toBe(true);
    await flush();
    expect(imageSave).toHaveBeenCalledWith("aba-1", expect.any(Uint8Array));
    expect(view.state.doc.toString()).toBe("antes![](imagens/n/9f.png) depois");
    expect(view.state.selection.main.head).toBe("antes![](imagens/n/9f.png)".length);
    expect(notes[0]).toContain("Imagem guardada");
    view.destroy();
  });

  it("avisa quando reaproveita uma imagem igual", async () => {
    imageSave.mockResolvedValue({ target: "x.png", name: "x.png", folder: "/x", reused: true, size: 3 });
    const view = make();
    paste(view, dt([{ type: "image/png", file: png() }]));
    await flush();
    expect(notes[0]).toContain("reaproveitada");
    view.destroy();
  });

  it("erro do Rust vira aviso e não mexe no texto", async () => {
    imageSave.mockRejectedValue("imagem grande demais");
    const view = make();
    paste(view, dt([{ type: "image/png", file: png() }]));
    await flush();
    expect(view.state.doc.toString()).toBe("antes depois");
    expect(notes[0]).toContain("Não foi possível colar a imagem: imagem grande demais");
    view.destroy();
  });

  it("não age sem imagem, sem aba que aceite ou em leitura (o resto do colar segue com o CodeMirror)", async () => {
    const view = make();
    paste(view, dt([{ type: "text/plain", kind: "string" }]));
    tab = null;
    paste(view, dt([{ type: "image/png", file: png() }]));
    const ro = new EditorView({
      parent: document.body.appendChild(document.createElement("div")),
      state: EditorState.create({ doc: "x", extensions: [imagePaste, EditorState.readOnly.of(true)] }),
    });
    registerImageHost(ro, { tabId: () => "a", base: () => null, notify: () => {} });
    paste(ro, dt([{ type: "image/png", file: png() }]));
    await flush();
    expect(imageSave).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe("antes depois");
    expect(ro.state.doc.toString()).toBe("x");
    view.destroy();
    ro.destroy();
  });

  it("insertImage troca a seleção e desfaz de uma vez", () => {
    const view = make("abc");
    insertImage(view, "x.png", { from: 1, to: 2 });
    expect(view.state.doc.toString()).toBe("a![](x.png)c");
    view.destroy();
  });
});
