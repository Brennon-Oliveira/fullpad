// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Analysis, JNode } from "./tree";
import { build } from "./test-util";

const api = vi.hoisted(() => ({
  jsonAnalyze: vi.fn(),
  openUrl: vi.fn(async () => {}),
  jsonPreviewImage: vi.fn(),
}));
vi.mock("../api", () => ({ api }));

import { createJsonPanel } from "./panel";

const T = '{"nome":"x","site":"https://example.com","cor":"#ff8800","lista":[{"id":1,"tags":["a","b"]},{"id":2}],"vazio":{}}';

/** Marca as dicas que o Rust daria. */
function withHints(nodes: JNode[]): JNode[] {
  for (const n of nodes) {
    if (n.kind === "string" && n.text?.startsWith("https://")) n.hint = "url";
    if (n.kind === "string" && n.text?.startsWith("#")) n.hint = "color";
  }
  return nodes;
}

const ok = (text: string): Analysis => ({ doc: { nodes: withHints(build(text)), too_big: false, total: 0 }, error: null });
const flush = async () => {
  await vi.advanceTimersByTimeAsync(300);
};

let host: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  api.jsonAnalyze.mockReset();
  api.jsonAnalyze.mockImplementation(async (text: string) => ok(text));
  api.openUrl.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  host.remove();
});

const rowTexts = () => [...host.querySelectorAll(".jt-row")].map((r) => r.textContent);

describe("painel da árvore JSON", () => {
  it("abre dois níveis e mostra chaves, resumos e valores", async () => {
    const p = createJsonPanel(host);
    p.show(T, true, 1);
    await flush();
    const rows = rowTexts();
    expect(rows[0]).toContain("{5}");
    expect(rows.some((r) => r?.includes("nome") && r.includes('"x"'))).toBe(true);
    expect(rows.some((r) => r?.includes("lista") && r.includes("[2]"))).toBe(true);
    // o item da lista (nível 2) fica fechado
    expect(rows.some((r) => r?.includes("tags"))).toBe(false);
    expect(host.classList.contains("on")).toBe(true);
  });

  it("clicar numa coleção abre e fecha; Ctrl+clique abre tudo abaixo", async () => {
    const p = createJsonPanel(host);
    p.show(T, true, 1);
    await flush();
    const row = (label: string) => [...host.querySelectorAll<HTMLElement>(".jt-row")].find((r) => r.textContent?.includes(label))!;
    const item0 = [...host.querySelectorAll<HTMLElement>(".jt-row")].find((r) => r.querySelector(".jt-idx")?.textContent === "0" && r.textContent?.includes("{2}"))!;
    item0.click();
    expect(rowTexts().some((r) => r?.includes("tags"))).toBe(true);
    row("tags").click();
    expect(rowTexts().filter((r) => r?.includes('"a"') || r?.includes('"b"'))).toHaveLength(2);
    // fechar a lista inteira some com tudo dentro
    row("lista").click();
    expect(rowTexts().some((r) => r?.includes("tags"))).toBe(false);
    row("lista").dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    expect(rowTexts().some((r) => r?.includes('"b"'))).toBe(true);
  });

  it("o mouse sobre um nó avisa o trecho dele no código, com a versão do texto", async () => {
    const onHover = vi.fn();
    const p = createJsonPanel(host, { onHover });
    p.show(T, true, 7);
    await flush();
    const nome = [...host.querySelectorAll<HTMLElement>(".jt-row")].find((r) => r.textContent?.includes("nome"))!;
    nome.querySelector(".jt-key")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(onHover).toHaveBeenLastCalledWith([{ from: T.indexOf('"nome"'), to: T.indexOf('"x"') + 3 }], 7);
    host.querySelector(".jt-rows")!.dispatchEvent(new MouseEvent("mouseleave"));
    expect(onHover).toHaveBeenLastCalledWith(null, 7);
  });

  it("o cursor do código abre os pais do nó e o destaca; só vale para a versão em tela", async () => {
    const onPath = vi.fn();
    const p = createJsonPanel(host, { onPath });
    p.show(T, true, 3);
    await flush();
    const at = T.indexOf('"b"') + 1;
    p.setCursor(at, 2); // versão errada: ignora
    expect(host.querySelector(".fc")).toBeNull();
    p.setCursor(at, 3);
    const fc = host.querySelector(".fc")!;
    expect(fc.textContent).toContain('"b"');
    expect(onPath).toHaveBeenLastCalledWith("$.lista[0].tags[1]");
    expect(p.currentPath()).toBe("$.lista[0].tags[1]");
    p.setCursor(null, 3);
    expect(host.querySelector(".fc")).toBeNull();
    expect(p.currentPath()).toBeNull();
  });

  it("cursor posto antes da análise terminar vale quando ela chega", async () => {
    const p = createJsonPanel(host);
    p.show(T, true, 1);
    p.setCursor(T.indexOf('"a"') + 1, 1); // a árvore ainda não existe
    await flush();
    expect(host.querySelector(".fc")?.textContent).toContain('"a"');
  });

  it("erro de sintaxe mantém a última árvore e mostra a mensagem; clicar nela vai ao erro", async () => {
    const onGoto = vi.fn();
    const p = createJsonPanel(host, { onGoto });
    p.show(T, true, 1);
    await flush();
    const antes = rowTexts().length;
    api.jsonAnalyze.mockResolvedValueOnce({ doc: null, error: { message: "Esperava ','", line: 2, col: 5, from: 10, to: 11 } });
    p.update(T + "x", 2);
    await flush();
    const bar = host.querySelector<HTMLElement>(".jt-error")!;
    expect(bar.hidden).toBe(false);
    expect(bar.textContent).toBe("Linha 2, coluna 5: Esperava ','");
    expect(rowTexts()).toHaveLength(antes);
    bar.click();
    expect(onGoto).toHaveBeenCalledWith({ from: 10, to: 11 }, 2);
    // a próxima versão válida limpa o erro
    p.update(T, 3);
    await flush();
    expect(bar.hidden).toBe(true);
  });

  it("documento grande demais mostra aviso em vez da árvore", async () => {
    api.jsonAnalyze.mockResolvedValueOnce({ doc: { nodes: [], too_big: true, total: 400000 }, error: null });
    const p = createJsonPanel(host);
    p.show("[]", true, 1);
    await flush();
    expect(host.querySelector(".jt-msg")!.textContent).toContain("grande demais");
    expect(rowTexts()).toHaveLength(0);
  });

  it("links e cores: sublinhado, quadradinho e abrir no navegador", async () => {
    const p = createJsonPanel(host);
    p.show(T, true, 1);
    await flush();
    const link = host.querySelector<HTMLElement>(".jt-link")!;
    expect(link.textContent).toBe('"https://example.com"');
    link.click();
    expect(api.openUrl).toHaveBeenCalledWith("https://example.com");
    const sw = host.querySelector<HTMLElement>(".jt-sw")!;
    expect(sw.style.background).toMatch(/#ff8800|rgb\(255, 136, 0\)/);
  });

  it("depois de editar, o que estava aberto continua aberto", async () => {
    const p = createJsonPanel(host);
    p.show(T, true, 1);
    await flush();
    [...host.querySelectorAll<HTMLElement>(".jt-row")].find((r) => r.textContent?.includes("lista"))!.click(); // fecha a lista
    expect(rowTexts().some((r) => r?.includes('"id"') || r?.includes("id"))).toBe(false);
    p.update(T.replace('"x"', '"yy"'), 2);
    await flush();
    expect(rowTexts().some((r) => r?.includes('"yy"'))).toBe(true);
    expect(rowTexts().filter((r) => r?.includes("{2}"))).toHaveLength(0); // a lista continua fechada
  });

  it("expandir e recolher tudo", async () => {
    const p = createJsonPanel(host);
    p.show(T, true, 1);
    await flush();
    p.expandAll();
    expect(rowTexts().some((r) => r?.includes('"b"'))).toBe(true);
    p.collapseAll();
    expect(rowTexts()).toHaveLength(6); // raiz + 5 membros
  });
});
