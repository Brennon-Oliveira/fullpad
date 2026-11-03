// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TabState } from "../api";

const api = vi.hoisted(() => ({ readerInfo: vi.fn(), readerRead: vi.fn(), readerRelocate: vi.fn(), openUrl: vi.fn() }));
vi.mock("../api", () => ({ api }));
const dialog = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: dialog.open }));

const view = vi.hoisted(() => ({
  open: vi.fn(),
  dispose: vi.fn(async () => {}),
  position: vi.fn(() => ({ page: 7, frac: 0.5, zoom: null })),
  zoomBy: vi.fn(),
  setZoom: vi.fn(),
}));
vi.mock("./pdfview", () => ({
  openPdfView: view.open,
}));

import { createReaderPanel } from "./panel";

const tab = (id: string, extra: Partial<TabState> = {}): TabState =>
  ({ id, title: "livro.pdf", path: "C:/livros/livro.pdf", kind: "pdf", cursor: 0, scroll: 0, mode: "source", language: "auto", eol: "lf", encoding: "utf8", dirty: false, window: "main", detached: false, group: 0, ...extra }) as TabState;

const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

let root: HTMLElement;
const host = { onPosition: vi.fn(), onRelocated: vi.fn(), onInfo: vi.fn() };
const buttons = () => [...root.querySelectorAll("button")].map((b) => b.textContent);
const click = (label: string) => [...root.querySelectorAll("button")].find((b) => b.textContent === label)!.click();

beforeEach(() => {
  root = document.createElement("div");
  document.body.replaceChildren(root);
  for (const m of [view.zoomBy, view.setZoom, api.readerInfo, api.readerRead, api.readerRelocate, dialog.open, view.open, view.dispose, host.onPosition, host.onRelocated, host.onInfo]) m.mockClear();
  api.readerInfo.mockResolvedValue({ status: "ok", size: 2_500_000, mtime: 111 });
  view.open.mockImplementation(async () => ({ pages: 10, position: view.position, dispose: view.dispose, zoomBy: view.zoomBy, setZoom: view.setZoom, goTo() {}, resize() {} }));
});

describe("painel do leitor", () => {
  it("abrir a aba só mostra o botão: nada do arquivo é lido nem processado", async () => {
    const p = createReaderPanel(root, host);
    p.show(tab("a1"));
    await settle();
    expect(buttons()).toContain("Carregar PDF");
    expect(root.textContent).toContain("livro.pdf");
    expect(root.textContent).toContain("2,4 MB"); // tamanho, só dos metadados
    expect(api.readerInfo).toHaveBeenCalledTimes(1);
    expect(api.readerRead).not.toHaveBeenCalled();
    expect(view.open).not.toHaveBeenCalled(); // o pdf.js nem foi importado
  });

  it("Carregar abre o documento na posição de leitura guardada", async () => {
    const p = createReaderPanel(root, host);
    p.show(tab("b1", { reader: { page: 12, frac: 0.25, zoom: 1.5 } }));
    await settle();
    click("Carregar PDF");
    await settle();
    expect(view.open).toHaveBeenCalledTimes(1);
    const [, id, size, pos] = view.open.mock.calls[0];
    expect([id, size, pos]).toEqual(["b1", 2_500_000, { page: 12, frac: 0.25, zoom: 1.5 }]);
  });

  it("posição de leitura inválida na sessão não quebra: abre na página 1", async () => {
    const p = createReaderPanel(root, host);
    p.show(tab("b2", { reader: "lixo" }));
    await settle();
    click("Carregar PDF");
    await settle();
    expect(view.open.mock.calls[0][3]).toEqual({ page: 1, frac: 0, zoom: null });
  });

  it("voltar a uma aba já carregada carrega sozinho; ao sair, grava a posição e solta o documento", async () => {
    const p = createReaderPanel(root, host);
    p.show(tab("c1"));
    await settle();
    click("Carregar PDF");
    await settle();
    p.show(tab("c2")); // outra aba de leitura no mesmo painel
    await settle();
    expect(host.onPosition).toHaveBeenCalledWith("c1", { page: 7, frac: 0.5, zoom: null });
    expect(view.dispose).toHaveBeenCalled();
    expect(buttons()).toContain("Carregar PDF"); // a nova ainda não foi carregada
    p.show(tab("c1"));
    await settle();
    expect(view.open).toHaveBeenCalledTimes(2); // c1 carregou de novo sem pedir
  });

  it("show da mesma aba é idempotente", async () => {
    const p = createReaderPanel(root, host);
    p.show(tab("d1"));
    await settle();
    p.show(tab("d1"));
    p.show(tab("d1"));
    await settle();
    expect(api.readerInfo).toHaveBeenCalledTimes(1);
  });

  it("arquivo ausente: o aviso abre o seletor e a aba aponta para o novo arquivo", async () => {
    api.readerInfo.mockResolvedValueOnce({ status: "missing" });
    const p = createReaderPanel(root, host);
    p.show(tab("e1"));
    await settle();
    expect(root.textContent).toContain("Arquivo não encontrado");
    expect(buttons()).toContain("Localizar arquivo…");
    expect(buttons()).not.toContain("Carregar PDF");

    dialog.open.mockResolvedValue("D:/novo/livro.pdf");
    api.readerRelocate.mockResolvedValue(tab("e1", { title: "livro.pdf", path: "D:/novo/livro.pdf" }));
    click("Localizar arquivo…");
    await settle();
    expect(dialog.open.mock.calls[0][0].filters[0].extensions).toEqual(["pdf"]);
    expect(api.readerRelocate).toHaveBeenCalledWith("e1", "D:/novo/livro.pdf");
    expect(host.onRelocated).toHaveBeenCalledWith(expect.objectContaining({ path: "D:/novo/livro.pdf" }));
    expect(view.open).toHaveBeenCalledTimes(1); // achou o arquivo: carrega
  });

  it("cancelar o seletor não muda nada", async () => {
    api.readerInfo.mockResolvedValueOnce({ status: "missing" });
    const p = createReaderPanel(root, host);
    p.show(tab("e2"));
    await settle();
    dialog.open.mockResolvedValue(null);
    click("Localizar arquivo…");
    await settle();
    expect(api.readerRelocate).not.toHaveBeenCalled();
    expect(root.textContent).toContain("Arquivo não encontrado");
  });

  it("falha ao abrir mostra o erro e deixa tentar de novo", async () => {
    view.open.mockRejectedValueOnce(new Error("Invalid PDF structure."));
    const p = createReaderPanel(root, host);
    p.show(tab("f1"));
    await settle();
    click("Carregar PDF");
    await settle();
    expect(root.textContent).toContain("Não foi possível abrir o PDF");
    expect(root.textContent).toContain("Invalid PDF structure.");
    click("Tentar de novo");
    await settle();
    expect(view.open).toHaveBeenCalledTimes(2);
  });

  it("tipo desconhecido (de uma versão mais nova): não lê nada e não oferece carregar", async () => {
    const p = createReaderPanel(root, host);
    p.show(tab("g1", { kind: "unknown" }));
    await settle();
    expect(root.textContent).toContain("não abre nesta versão");
    expect(buttons()).toEqual([]);
    expect(api.readerInfo).not.toHaveBeenCalled();
  });

  it("o zoom do documento só responde com um PDF carregado (senão o atalho cai no zoom do app)", async () => {
    const p = createReaderPanel(root, host);
    p.show(tab("z1"));
    await settle();
    expect([p.zoomStep(1), p.zoomFit(), p.zoomWheel(-100)]).toEqual([false, false, false]); // ainda no botão
    expect(view.zoomBy).not.toHaveBeenCalled();

    click("Carregar PDF");
    await settle();
    expect(p.zoomStep(1)).toBe(true);
    expect(view.zoomBy).toHaveBeenLastCalledWith(1.15);
    expect(p.zoomStep(-1)).toBe(true);
    expect(view.zoomBy.mock.calls.at(-1)![0]).toBeCloseTo(1 / 1.15);
    expect(p.zoomWheel(-100)).toBe(true);
    expect(view.zoomBy.mock.calls.at(-1)![0]).toBeCloseTo(1.1);
    expect(p.zoomFit()).toBe(true);
    expect(view.setZoom).toHaveBeenCalledWith(null);
  });

  it("hide solta o documento e esvazia o painel", async () => {
    const p = createReaderPanel(root, host);
    p.show(tab("h1"));
    await settle();
    click("Carregar PDF");
    await settle();
    p.hide();
    await settle();
    expect(host.onPosition).toHaveBeenCalledWith("h1", expect.anything());
    expect(view.dispose).toHaveBeenCalled();
    expect(root.childElementCount).toBe(0);
  });
});
