// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ epubOpen: vi.fn(), epubChapter: vi.fn(), openUrl: vi.fn(async () => {}) }));
vi.mock("../api", () => ({ api }));

import { openEpubView } from "./epubview";

const info = {
  title: "Livro de Teste",
  author: "Autora",
  chapters: ["Um", "Dois", "Três"],
  toc: [
    { label: "Um", spine: 0, fragment: null, depth: 0 },
    { label: "Seção do um", spine: 0, fragment: "s", depth: 1 },
    { label: "Fora do livro", spine: null, fragment: null, depth: 0 },
    { label: "Três", spine: 2, fragment: null, depth: 0 },
  ],
};

const hooks = { onPosition: vi.fn(), onFatal: vi.fn(), onView: vi.fn() };
let host: HTMLElement;
const frame = () => host.querySelector<HTMLIFrameElement>("iframe")!;
const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};
/** Faz de conta que o iframe terminou de carregar o capítulo. */
const loaded = async () => {
  await settle();
  frame().dispatchEvent(new Event("load"));
  await settle();
};
const clickInFrame = (href: string) => {
  const d = frame().contentDocument!;
  d.body.innerHTML = `<a id="l" href="${href}">x</a>`;
  d.getElementById("l")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.replaceChildren(host);
  for (const m of [api.epubOpen, api.epubChapter, api.openUrl, hooks.onPosition, hooks.onFatal, hooks.onView]) m.mockClear();
  api.epubOpen.mockResolvedValue(info);
  api.epubChapter.mockImplementation(async (_id: string, i: number) => ({ html: `<p>texto do capítulo ${i}</p>`, css: "p{color:red;}" }));
});

describe("visão do EPUB", () => {
  it("o iframe não tem scripts: só allow-same-origin, e o documento tem a CSP", async () => {
    const v = await openEpubView(host, "e1", { page: 1, frac: 0, zoom: null }, hooks);
    await settle();
    expect(frame().getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frame().getAttribute("sandbox")).not.toContain("allow-scripts");
    expect(frame().srcdoc).toContain("Content-Security-Policy");
    expect(frame().srcdoc).toContain("texto do capítulo 0");
    expect(frame().srcdoc.toLowerCase()).not.toContain("<script");
    await v.dispose();
  });

  it("abre no capítulo da posição guardada e mostra o sumário", async () => {
    const v = await openEpubView(host, "e1", { page: 3, frac: 0.4, zoom: 1.2 }, hooks);
    await loaded();
    expect(api.epubChapter).toHaveBeenCalledWith("e1", 2);
    expect(v.pages).toBe(3);
    expect(v.position().page).toBe(3);
    expect(v.position().zoom).toBe(1.2);
    const items = [...host.querySelectorAll<HTMLButtonElement>(".rd-toc-item")];
    expect(items.map((b) => b.textContent)).toEqual(["Um", "Seção do um", "Fora do livro", "Três"]);
    expect(items[2].disabled).toBe(true); // não aponta para nenhum capítulo do livro
    expect(items.map((b) => b.getAttribute("aria-current"))).toEqual(["false", "false", "false", "true"]);
    expect(host.querySelector(".rd-epub-title")!.textContent).toBe("Três");
    await v.dispose();
  });

  it("posição fora do livro cai no último capítulo; lixo vira o primeiro", async () => {
    const a = await openEpubView(host, "e1", { page: 99, frac: 0, zoom: null }, hooks);
    await settle();
    expect(api.epubChapter).toHaveBeenLastCalledWith("e1", 2);
    await a.dispose();
    const b = await openEpubView(host, "e1", { page: 1, frac: 0, zoom: null }, hooks);
    await settle();
    expect(api.epubChapter).toHaveBeenLastCalledWith("e1", 0);
    await b.dispose();
  });

  it("clicar no sumário abre o capítulo e o fragmento", async () => {
    const v = await openEpubView(host, "e1", { page: 1, frac: 0, zoom: null }, hooks);
    await loaded();
    host.querySelectorAll<HTMLButtonElement>(".rd-toc-item")[3].click();
    await settle();
    expect(api.epubChapter).toHaveBeenLastCalledWith("e1", 2);
    await v.dispose();
  });

  it("links do capítulo: outro capítulo abre, externo vai ao navegador, o resto não faz nada", async () => {
    const v = await openEpubView(host, "e1", { page: 1, frac: 0, zoom: null }, hooks);
    await loaded();
    clickInFrame("epub:1#fim");
    await settle();
    expect(api.epubChapter).toHaveBeenLastCalledWith("e1", 1);
    await loaded();
    clickInFrame("https://example.com/x");
    expect(api.openUrl).toHaveBeenCalledWith("https://example.com/x");
    api.openUrl.mockClear();
    api.epubChapter.mockClear();
    clickInFrame("javascript:alert(1)");
    clickInFrame("file:///etc/passwd");
    clickInFrame("epub:999"); // fora do livro: não abre nada
    await settle();
    expect(api.openUrl).not.toHaveBeenCalled();
    expect(api.epubChapter).not.toHaveBeenCalled();
    await v.dispose();
  });

  /** Seleciona o conteúdo de `html` dentro do documento do iframe. */
  const selectIn = (html: string) => {
    const d = frame().contentDocument!;
    d.body.innerHTML = html;
    const range = d.createRange();
    range.selectNodeContents(d.body);
    const sel = d.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  };

  it("entrega a seleção para citar: texto com parágrafos, nome da obra e capítulo", async () => {
    const v = await openEpubView(host, "e1", { page: 3, frac: 0, zoom: null }, hooks);
    await loaded();
    expect(v.selection!()).toBeNull(); // nada selecionado
    selectIn("<p>primeiro parágrafo</p><p>segundo</p>");
    expect(v.selection!()).toEqual({ text: "primeiro parágrafo\n\nsegundo", source: "Livro de Teste", where: "cap. 3 (Três)" });
    await v.dispose();
  });

  it("Ctrl+Shift+C dentro do livro pede a citação ao painel, e o botão direito pede o menu com a posição da janela", async () => {
    const onQuote = vi.fn();
    const onContextMenu = vi.fn();
    const v = await openEpubView(host, "e1", { page: 1, frac: 0, zoom: null }, { ...hooks, onQuote, onContextMenu });
    await loaded();
    const d = frame().contentDocument!;
    const key = new KeyboardEvent("keydown", { code: "KeyC", key: "C", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    d.dispatchEvent(key);
    expect(onQuote).toHaveBeenCalledTimes(1);
    expect(key.defaultPrevented).toBe(true);
    d.body.innerHTML = "<p id='p'>x</p>";
    d.getElementById("p")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 50 }));
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    const [x, y] = onContextMenu.mock.calls[0];
    expect([typeof x, typeof y]).toEqual(["number", "number"]);
    await v.dispose();
  });

  it("capítulo que falha mostra o erro no próprio documento, sem derrubar o leitor", async () => {
    api.epubChapter.mockRejectedValueOnce("Um arquivo do EPUB é grande demais (40 MB; o limite é 8 MB).");
    const v = await openEpubView(host, "e1", { page: 1, frac: 0, zoom: null }, hooks);
    await settle();
    expect(frame().srcdoc).toContain("grande demais");
    expect(hooks.onFatal).not.toHaveBeenCalled();
    await v.dispose();
  });

  it("zoom muda o tamanho do texto sem recarregar o capítulo, dentro dos limites", async () => {
    const v = await openEpubView(host, "e1", { page: 1, frac: 0, zoom: null }, hooks);
    await loaded();
    const d = frame().contentDocument!;
    d.head.innerHTML = '<style id="fp-app">velho</style>';
    api.epubChapter.mockClear();
    v.zoomBy(1.5);
    expect(d.getElementById("fp-app")!.textContent).toContain("27.00px");
    v.setZoom(99);
    expect(v.position().zoom).toBe(3);
    v.setZoom(0.01);
    expect(v.position().zoom).toBe(0.6);
    v.setZoom(null);
    expect(v.position().zoom).toBeNull();
    expect(api.epubChapter).not.toHaveBeenCalled();
    await v.dispose();
  });

  it("goTo vai para o capítulo e a posição é informada depois de parar", async () => {
    vi.useFakeTimers();
    try {
      const v = await openEpubView(host, "e1", { page: 1, frac: 0, zoom: null }, hooks);
      await vi.advanceTimersByTimeAsync(10);
      v.goTo(2);
      await vi.advanceTimersByTimeAsync(10);
      expect(api.epubChapter).toHaveBeenLastCalledWith("e1", 1);
      await vi.advanceTimersByTimeAsync(400);
      expect(hooks.onPosition).toHaveBeenLastCalledWith({ page: 2, frac: 0, zoom: null });
      expect(hooks.onView).toHaveBeenCalledWith(2, 3, 1, false);
      await v.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("um EPUB que não abre devolve o erro do Rust, sem montar a tela", async () => {
    api.epubOpen.mockRejectedValueOnce("O EPUB tem proteção (DRM) e não pode ser aberto.");
    await expect(openEpubView(host, "e1", { page: 1, frac: 0, zoom: null }, hooks)).rejects.toBe("O EPUB tem proteção (DRM) e não pode ser aberto.");
    expect(host.querySelector("iframe")).toBeNull();
  });

  it("dispose esvazia o iframe e a tela", async () => {
    const v = await openEpubView(host, "e1", { page: 1, frac: 0, zoom: null }, hooks);
    await settle();
    await v.dispose();
    expect(host.childElementCount).toBe(0);
  });
});
