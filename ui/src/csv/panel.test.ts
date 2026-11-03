// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CsvInfo, CsvRowOut } from "../api";

const api = vi.hoisted(() => ({
  csvLoad: vi.fn(),
  csvView: vi.fn(),
  csvRows: vi.fn(),
  csvStats: vi.fn(),
  csvLocate: vi.fn(),
  csvCell: vi.fn(),
  csvEdit: vi.fn(),
  csvStructure: vi.fn(),
}));
vi.mock("../api", () => ({ api }));

import { createCsvPanel, fmtNumber, letters, parseClipboard, statsText } from "./panel";

const CFG = { delimiter: ",", header: true, decimal: "." };
const NAMES = ["Ana", "Bia", "Caio", "Dani", "Edu"];

const row = (index: number, vals: string[]): CsvRowOut => ({
  index,
  from: 0,
  to: 0,
  cells: vals.map((value, i) => ({ from: i * 4, to: i * 4 + value.length, value, quoted: false })),
});

const info = (over: Partial<CsvInfo> = {}): CsvInfo => ({
  rows: NAMES.length,
  total: NAMES.length,
  cols: 2,
  delimiter: ",",
  unterminated: false,
  types: ["text", "number"],
  header: row(0, ["nome", "idade"]),
  ...over,
});

const flush = async (ms = 400) => {
  await vi.advanceTimersByTimeAsync(ms);
};

let host: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (f: () => void) => setTimeout(f, 0));
  host = document.createElement("div");
  document.body.append(host);
  for (const f of Object.values(api)) f.mockReset();
  api.csvLoad.mockImplementation(async () => info());
  api.csvView.mockImplementation(async () => info());
  api.csvRows.mockImplementation(async (_t: string, from: number, count: number) =>
    NAMES.slice(from, from + count).map((n, i) => row(from + i + 1, [n, String(20 + from + i)])),
  );
  api.csvStats.mockImplementation(async () => ({ count: 5, numeric: 5, skipped: 0, sum: 110, avg: 22, min: 20, max: 24 }));
  api.csvLocate.mockResolvedValue(null);
  api.csvCell.mockResolvedValue({ from: 7, to: 9, value: "x", quoted: false });
  api.csvEdit.mockResolvedValue([{ from: 0, to: 3, insert: "Novo" }]);
  api.csvStructure.mockResolvedValue([{ from: 0, to: 0, insert: "," }]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); // solta os ouvintes de popovers esquecidos
  host.remove();
  document.querySelectorAll(".menu, .csv-pop").forEach((e) => e.remove());
});

const cellTexts = () => [...host.querySelectorAll(".csv-row")].map((r) => [...r.querySelectorAll(".csv-cell")].map((c) => c.textContent));
const click = (el: Element, init: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, ...init }));

describe("auxiliares", () => {
  it("letras de coluna como numa planilha", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(letters)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
  });
  it("texto das estatísticas", () => {
    expect(statsText(null)).toBe("");
    expect(statsText({ count: 0, numeric: 0, skipped: 0, sum: 0, avg: null, min: null, max: null })).toBe("");
    expect(statsText({ count: 4, numeric: 3, skipped: 1, sum: 1234.5, avg: 411.5, min: 1, max: 1000 })).toBe(
      `Soma ${fmtNumber(1234.5)} · Média ${fmtNumber(411.5)} · Mín ${fmtNumber(1)} · Máx ${fmtNumber(1000)} · Contagem 4 · 1 fora da conta`,
    );
    expect(statsText({ count: 2, numeric: 0, skipped: 2, sum: 0, avg: null, min: null, max: null })).toBe("Contagem 2 · sem números");
  });
});

describe("painel da tabela CSV", () => {
  it("pede o texto ao Rust e desenha cabeçalho e linhas", async () => {
    const p = createCsvPanel(host);
    p.show("t1", "nome,idade\nAna,20\n", CFG, 1);
    await flush();
    expect(api.csvLoad).toHaveBeenCalledWith("t1", "nome,idade\nAna,20\n", ",", true, ".", null, null);
    expect([...host.querySelectorAll(".csv-hlabel")].map((e) => e.textContent)).toEqual(["nome", "idade"]);
    expect(cellTexts()[0]).toEqual(["Ana", "20"]);
    expect(cellTexts()).toHaveLength(5);
    expect(host.querySelector(".csv-count")?.textContent).toBe("5 linhas");
    expect(host.classList.contains("on")).toBe(true);
  });

  it("sem cabeçalho nomeia as colunas A, B, ...", async () => {
    api.csvLoad.mockImplementation(async () => info({ header: null }));
    const p = createCsvPanel(host);
    p.show("t1", "x", { ...CFG, header: false }, 1);
    await flush();
    expect([...host.querySelectorAll(".csv-hlabel")].map((e) => e.textContent)).toEqual(["A", "B"]);
  });

  it("coluna numérica fica alinhada à direita", async () => {
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    const cells = host.querySelectorAll(".csv-row")[0].querySelectorAll(".csv-cell");
    expect(cells[0].classList.contains("num")).toBe(false);
    expect(cells[1].classList.contains("num")).toBe(true);
  });

  it("mostrar de novo com o mesmo texto e configuração não recarrega", async () => {
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    p.show("t1", "x", CFG, 2);
    await flush();
    expect(api.csvLoad).toHaveBeenCalledTimes(1);
    p.show("t1", "x", { ...CFG, delimiter: ";" }, 3);
    await flush();
    expect(api.csvLoad).toHaveBeenCalledTimes(2);
    expect(api.csvLoad.mock.calls[1][2]).toBe(";");
  });

  it("editar o texto recarrega só depois de um instante", async () => {
    const p = createCsvPanel(host);
    p.show("t1", "a", CFG, 1);
    await flush();
    p.update("ab", 2);
    p.update("abc", 3);
    await flush(100);
    expect(api.csvLoad).toHaveBeenCalledTimes(1);
    await flush(300);
    expect(api.csvLoad).toHaveBeenCalledTimes(2);
    expect(api.csvLoad.mock.calls[1][1]).toBe("abc");
  });

  it("clicar no cabeçalho ordena: crescente, decrescente, sem ordem", async () => {
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    const h = () => host.querySelectorAll(".csv-hcell")[1];
    click(h());
    await flush();
    expect(api.csvView).toHaveBeenLastCalledWith("t1", true, ".", { col: 1, desc: false }, null);
    expect(h().textContent).toContain("▲");
    click(h());
    await flush();
    expect(api.csvView).toHaveBeenLastCalledWith("t1", true, ".", { col: 1, desc: true }, null);
    expect(h().textContent).toContain("▼");
    click(h());
    await flush();
    expect(api.csvView).toHaveBeenLastCalledWith("t1", true, ".", null, null);
  });

  it("o filtro vai para o Rust (com a coluna escolhida) e mostra 'N de M'", async () => {
    api.csvView.mockImplementation(async () => info({ rows: 2, total: 5 }));
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    const input = host.querySelector<HTMLInputElement>(".csv-filter")!;
    const sel = host.querySelector<HTMLSelectElement>(".csv-colsel")!;
    expect([...sel.options].map((o) => o.textContent)).toEqual(["Todas as colunas", "nome", "idade"]);
    sel.value = "0";
    input.value = "an";
    input.dispatchEvent(new Event("input"));
    await flush();
    expect(api.csvView).toHaveBeenLastCalledWith("t1", true, ".", null, { col: 0, text: "an" });
    expect(host.querySelector(".csv-count")?.textContent).toBe("2 de 5 linhas");
  });

  it("ordem e filtro voltam ao voltar para a aba", async () => {
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    click(host.querySelectorAll(".csv-hcell")[0]);
    await flush();
    p.show("t2", "y", CFG, 2);
    await flush();
    expect(api.csvLoad).toHaveBeenLastCalledWith("t2", "y", ",", true, ".", null, null);
    p.show("t1", "x", CFG, 3);
    await flush();
    expect(api.csvLoad).toHaveBeenLastCalledWith("t1", "x", ",", true, ".", { col: 0, desc: false }, null);
  });

  it("uma célula selecionada mostra as estatísticas da coluna; uma faixa, as da seleção", async () => {
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    click(host.querySelectorAll(".csv-cell")[1], { clientX: 56 + 150, clientY: 28 + 2 });
    await flush();
    expect(api.csvStats).toHaveBeenLastCalledWith("t1", 0, 5, 1, 2, ".");
    expect(host.querySelector(".csv-where")?.textContent).toBe("Coluna idade");
    expect(host.querySelector(".csv-stats")?.textContent).toContain("Soma");
    // shift+clique estende: linhas 0..2, colunas 0..1
    click(host.querySelectorAll(".csv-cell")[0], { clientX: 56 + 150, clientY: 28 + 24 * 2 + 2, shiftKey: true });
    await flush();
    expect(api.csvStats).toHaveBeenLastCalledWith("t1", 0, 3, 1, 2, ".");
    expect(host.querySelector(".csv-where")?.textContent).toBe("Seleção: 3 × 1");
  });

  it("clicar numa célula leva o cursor do código até ela", async () => {
    const onSelect = vi.fn();
    const p = createCsvPanel(host, { onSelect });
    p.show("t1", "x", CFG, 7);
    await flush();
    click(host.querySelectorAll(".csv-cell")[0], { clientX: 60, clientY: 30 });
    await flush();
    expect(api.csvCell).toHaveBeenCalledWith("t1", 1, 0);
    expect(onSelect).toHaveBeenCalledWith(7, 7);
  });

  it("o cursor do código destaca a célula, mas só se for a mesma versão do texto", async () => {
    api.csvLocate.mockResolvedValue({ row: 2, col: 1, view: 1 });
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 4);
    await flush();
    p.setCursor(10, 3); // outra versão: ignora
    await flush();
    expect(api.csvLocate).not.toHaveBeenCalled();
    p.setCursor(10, 4);
    await flush();
    expect(api.csvLocate).toHaveBeenCalledWith("t1", 10);
    const cur = host.querySelectorAll(".csv-cell.cur");
    expect(cur).toHaveLength(1);
    expect(cur[0].textContent).toBe("21");
  });

  it("célula fora da visão (filtrada) não destaca nada", async () => {
    api.csvLocate.mockResolvedValue({ row: 2, col: 1, view: null });
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    p.setCursor(5, 1);
    await flush();
    expect(host.querySelectorAll(".csv-cell.cur")).toHaveLength(0);
  });

  it("erro do Rust aparece na tela, sem derrubar o painel", async () => {
    api.csvLoad.mockRejectedValueOnce("falhou");
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    expect(host.querySelector<HTMLElement>(".csv-msg")?.hidden).toBe(false);
    expect(host.querySelector(".csv-msg")?.textContent).toContain("falhou");
  });

  it("esconder tira o painel da tela", async () => {
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    p.hide();
    expect(host.classList.contains("on")).toBe(false);
  });
});

const menuLabels = () => [...document.querySelectorAll(".menu .menu-label")].map((e) => e.textContent);
const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>(".menu .menu-item")].find((e) => e.textContent?.includes(label))!;
const rightClick = (el: Element, init: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, ...init }));

describe("menu do cabeçalho", () => {
  it("o botão direito só abre o menu: não ordena", async () => {
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    const h = host.querySelectorAll(".csv-hcell")[1];
    h.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 2 }));
    rightClick(h);
    await flush();
    expect(api.csvView).not.toHaveBeenCalled();
    expect(menuLabels()).toContain("Ordenar");
  });

  it("Ordenar > Crescente / Decrescente / Limpar ordenação", async () => {
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    const h = () => host.querySelectorAll(".csv-hcell")[1];
    rightClick(h());
    menuItem("Ordenar").dispatchEvent(new MouseEvent("mouseenter"));
    expect(menuLabels()).toEqual(expect.arrayContaining(["Crescente", "Decrescente", "Limpar ordenação"]));
    expect(menuItem("Limpar ordenação").classList.contains("disabled")).toBe(true);
    menuItem("Decrescente").click();
    await flush();
    expect(api.csvView).toHaveBeenLastCalledWith("t1", true, ".", { col: 1, desc: true }, null);
    // ordenado: agora dá para limpar
    rightClick(h());
    menuItem("Ordenar").dispatchEvent(new MouseEvent("mouseenter"));
    expect(menuItem("Limpar ordenação").classList.contains("disabled")).toBe(false);
    menuItem("Limpar ordenação").click();
    await flush();
    expect(api.csvView).toHaveBeenLastCalledWith("t1", true, ".", null, null);
    expect(host.querySelector(".csv-sort")?.textContent).toBe("");
  });

  it("ordenar por outra coluna troca a ordem; o clique esquerdo continua alternando", async () => {
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    rightClick(host.querySelectorAll(".csv-hcell")[0]);
    menuItem("Ordenar").dispatchEvent(new MouseEvent("mouseenter"));
    menuItem("Crescente").click();
    await flush();
    expect(api.csvView).toHaveBeenLastCalledWith("t1", true, ".", { col: 0, desc: false }, null);
    click(host.querySelectorAll(".csv-hcell")[1]);
    await flush();
    expect(api.csvView).toHaveBeenLastCalledWith("t1", true, ".", { col: 1, desc: false }, null);
  });
});

describe("copiar e texto completo", () => {
  let write: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    write = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText: write } });
  });

  it("botão direito numa célula: copiar", async () => {
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    rightClick(host.querySelectorAll(".csv-cell")[0], { clientX: 60, clientY: 30 });
    expect(menuLabels()).toEqual(expect.arrayContaining(["Copiar", "Ver o texto completo", "Selecionar tudo"]));
    menuItem("Copiar").click();
    await flush();
    expect(write).toHaveBeenCalledWith("Ana");
    expect(host.querySelector(".csv-toast")?.textContent).toBe("Copiado: 1 × 1 células");
  });

  it("copiar uma faixa dá texto separado por tab e linhas", async () => {
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    click(host.querySelectorAll(".csv-cell")[0], { clientX: 60, clientY: 30 });
    click(host.querySelectorAll(".csv-cell")[0], { clientX: 56 + 150, clientY: 28 + 24 + 2, shiftKey: true });
    rightClick(host.querySelectorAll(".csv-cell")[0], { clientX: 60, clientY: 30 });
    expect(menuLabels()).toContain("Copiar só esta célula");
    menuItem("Copiar seleção").click();
    await flush();
    expect(write).toHaveBeenCalledWith("Ana\t20\nBia\t21");
  });

  it("célula com texto cortado ganha o '…' e clicar nele abre o texto completo com Copiar", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    const more = host.querySelectorAll(".csv-more");
    expect(more.length).toBeGreaterThan(0);
    click(more[0]);
    await flush();
    const pop = document.querySelector(".csv-pop")!;
    expect(pop.querySelector(".csv-pop-text")?.textContent).toBe("Ana");
    (pop.querySelector(".csv-pop-copy") as HTMLElement).click();
    await flush();
    expect(write).toHaveBeenCalledWith("Ana");
    // mouse longe da célula e do popover: fecha
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 900, clientY: 900, bubbles: true }));
    expect(document.querySelector(".csv-pop")).toBeNull();
    vi.restoreAllMocks();
  });

  it("texto muito longo (cortado pelo Rust) é buscado inteiro", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
    api.csvRows.mockImplementation(async () => [{ index: 1, from: 0, to: 0, cells: [{ from: 0, to: 5000, value: "x".repeat(2000), cut: true, quoted: false }] }]);
    api.csvCell.mockResolvedValue({ from: 0, to: 5000, value: "x".repeat(5000), quoted: false });
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    click(host.querySelectorAll(".csv-more")[0]);
    await flush();
    expect(api.csvCell).toHaveBeenCalledWith("t1", 1, 0);
    expect(document.querySelector(".csv-pop-text")?.textContent).toHaveLength(5000);
    vi.restoreAllMocks();
  });

  it("Tab numa célula selecionada com '…' abre o popover; Enter copia e fecha; Tab de novo fecha sem copiar", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    click(host.querySelectorAll(".csv-cell")[0], { clientX: 60, clientY: 30 });
    const scroller = host.querySelector(".csv-scroll")!;
    const key = (k: string) => scroller.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    key("Tab");
    await flush();
    expect(document.querySelector(".csv-pop")).not.toBeNull();
    expect(document.querySelector(".csv-pop-copy")?.classList.contains("kbd")).toBe(true);
    write.mockClear();
    key("Enter");
    await flush();
    expect(write).toHaveBeenCalledWith("Ana");
    expect(document.querySelector(".csv-pop")).toBeNull();
    key("Tab");
    await flush();
    expect(document.querySelector(".csv-pop")).not.toBeNull();
    write.mockClear();
    key("Tab");
    await flush();
    expect(document.querySelector(".csv-pop")).toBeNull();
    expect(write).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("Esc fecha o popover", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    click(host.querySelectorAll(".csv-more")[0]);
    await flush();
    expect(document.querySelector(".csv-pop")).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".csv-pop")).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("seleção, destaque no código e altura das linhas", () => {
  const rowsEl = () => host.querySelector(".csv-rows")!;
  const selected = () => host.querySelectorAll(".csv-cell.sel").length;

  it("clicar fora das células (no vazio) tira a seleção, da tabela e do código", async () => {
    const onSelection = vi.fn();
    const p = createCsvPanel(host, { onSelection });
    p.show("t1", "x", CFG, 3);
    await flush();
    click(host.querySelectorAll(".csv-cell")[0], { clientX: 60, clientY: 30 });
    await flush();
    expect(selected()).toBe(1);
    expect(onSelection).toHaveBeenLastCalledWith([{ from: 0, to: 3 }], 3);
    click(host.querySelector(".csv-scroll")!); // área vazia: o próprio contêiner
    await flush();
    expect(selected()).toBe(0);
    expect(onSelection).toHaveBeenLastCalledWith(null, 3);
  });

  it("Esc tira a seleção", async () => {
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    click(host.querySelectorAll(".csv-cell")[0], { clientX: 60, clientY: 30 });
    await flush();
    host.querySelector(".csv-scroll")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush();
    expect(selected()).toBe(0);
  });

  it("uma faixa selecionada manda o trecho de cada célula para o código", async () => {
    const onSelection = vi.fn();
    const p = createCsvPanel(host, { onSelection });
    p.show("t1", "x", CFG, 5);
    await flush();
    click(host.querySelectorAll(".csv-cell")[0], { clientX: 60, clientY: 30 });
    click(host.querySelectorAll(".csv-cell")[0], { clientX: 56 + 150, clientY: 28 + 24 + 2, shiftKey: true });
    await flush();
    const spans = onSelection.mock.calls.at(-1)![0];
    // linhas 0 e 1 × colunas 0 e 1: "Ana"(0-3) "20"(4-6), "Bia"(0-3) "21"(4-6)
    expect(spans).toEqual([{ from: 0, to: 3 }, { from: 4, to: 6 }, { from: 0, to: 3 }, { from: 4, to: 6 }]);
    expect(onSelection.mock.calls.at(-1)![1]).toBe(5);
  });

  it("o mouse sobre uma célula destaca o trecho dela no código; sair apaga", async () => {
    const onHover = vi.fn();
    const p = createCsvPanel(host, { onHover });
    p.show("t1", "x", CFG, 2);
    await flush();
    rowsEl().dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 60, clientY: 30 }));
    await flush(100);
    expect(onHover).toHaveBeenLastCalledWith([{ from: 0, to: 3 }], 2);
    rowsEl().dispatchEvent(new MouseEvent("mouseleave"));
    expect(onHover).toHaveBeenLastCalledWith(null, 2);
  });

  it("esconder a tabela apaga o destaque do mouse", async () => {
    const onHover = vi.fn();
    const p = createCsvPanel(host, { onHover });
    p.show("t1", "x", CFG, 2);
    await flush();
    p.hide();
    expect(onHover).toHaveBeenLastCalledWith(null, 2);
  });

  const rowEls = () => [...host.querySelectorAll<HTMLElement>(".csv-row")];

  it("arrastar a borda do número da linha muda só aquela linha; linha alta quebra o texto", async () => {
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    expect(rowEls().every((r) => r.style.getPropertyValue("--csv-row-h") === "")).toBe(true);
    const grip = rowEls()[1].querySelector(".csv-rgrip")!;
    grip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientY: 100 }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientY: 140 }));
    expect(rowEls()[1].style.getPropertyValue("--csv-row-h")).toBe("64px");
    expect(rowEls()[1].classList.contains("wrap")).toBe(true);
    expect(rowEls()[0].style.getPropertyValue("--csv-row-h")).toBe("");
    expect(rowEls()[2].style.getPropertyValue("--csv-row-h")).toBe("");
    expect(rowEls()[0].classList.contains("wrap")).toBe(false);
    // o limite mínimo e o máximo
    document.dispatchEvent(new MouseEvent("mousemove", { clientY: -900 }));
    expect(rowEls()[1].style.getPropertyValue("--csv-row-h")).toBe("20px");
    document.dispatchEvent(new MouseEvent("mousemove", { clientY: 5000 }));
    expect(rowEls()[1].style.getPropertyValue("--csv-row-h")).toBe("400px");
    document.dispatchEvent(new MouseEvent("mouseup"));
  });

  it("a linha mudada empurra as de baixo; clicar mira a linha certa", async () => {
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    const grip = rowEls()[0].querySelector(".csv-rgrip")!;
    grip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientY: 0 }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientY: 30 })); // linha 0 com 54 px
    document.dispatchEvent(new MouseEvent("mouseup"));
    expect((host.querySelector(".csv-spacer") as HTMLElement | null)?.style.height ?? "").toBe(`${24 * 4 + 54}px`);
    // y = 28 (cabeçalho) + 40: ainda dentro da linha 0 (0..54); y = 28 + 60: linha 1
    click(host.querySelectorAll(".csv-cell")[0], { clientX: 60, clientY: 28 + 40 });
    expect(host.querySelector(".csv-row[data-i='0'] .csv-cell.sel")).not.toBeNull();
    click(host.querySelectorAll(".csv-cell")[0], { clientX: 60, clientY: 28 + 60 });
    expect(host.querySelector(".csv-row[data-i='1'] .csv-cell.sel")).not.toBeNull();
  });

  it("duplo clique na borda volta a linha ao padrão, e a altura é lembrada por aba", async () => {
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    const grip = () => rowEls()[0].querySelector(".csv-rgrip")!;
    grip().dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientY: 0 }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientY: 30 }));
    document.dispatchEvent(new MouseEvent("mouseup"));
    expect(rowEls()[0].style.getPropertyValue("--csv-row-h")).toBe("54px");
    p.show("t2", "y", CFG, 2);
    await flush();
    expect(rowEls()[0].style.getPropertyValue("--csv-row-h")).toBe("");
    p.show("t1", "x", CFG, 3);
    await flush();
    expect(rowEls()[0].style.getPropertyValue("--csv-row-h")).toBe("54px");
    grip().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(rowEls()[0].style.getPropertyValue("--csv-row-h")).toBe("");
  });

  it("clicar fora também tira o contorno da célula do cursor", async () => {
    api.csvLocate.mockResolvedValue({ row: 2, col: 1, view: 1 });
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 4);
    await flush();
    p.setCursor(10, 4);
    await flush();
    expect(host.querySelectorAll(".csv-cell.cur")).toHaveLength(1);
    click(host.querySelector(".csv-scroll")!);
    await flush();
    expect(host.querySelectorAll(".csv-cell.cur")).toHaveLength(0);
  });

  it("selecionar não refaz as linhas (só troca as classes) e o destaque no código sai na hora", async () => {
    const onSelection = vi.fn();
    const p = createCsvPanel(host, { onSelection });
    p.show("t1", "x", CFG, 1);
    await flush();
    const before = host.querySelector(".csv-row");
    click(host.querySelectorAll(".csv-cell")[0], { clientX: 60, clientY: 30 });
    expect(host.querySelector(".csv-row")).toBe(before);
    expect(host.querySelectorAll(".csv-cell.sel")).toHaveLength(1);
    expect(onSelection).toHaveBeenCalledWith([{ from: 0, to: 3 }], 1); // sem esperar timer
  });

  it("o destaque do mouse não espera o mouse parar", async () => {
    const onHover = vi.fn();
    const p = createCsvPanel(host, { onHover });
    p.show("t1", "x", CFG, 1);
    await flush();
    rowsEl().dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 60, clientY: 30 }));
    await vi.advanceTimersByTimeAsync(1); // um quadro
    expect(onHover).toHaveBeenLastCalledWith([{ from: 0, to: 3 }], 1);
    rowsEl().dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 56 + 150, clientY: 30 }));
    await vi.advanceTimersByTimeAsync(1);
    expect(onHover).toHaveBeenLastCalledWith([{ from: 4, to: 6 }], 1);
  });
});

describe("editar célula", () => {
  const rowsEl = () => host.querySelector(".csv-rows")!;
  const scroll = () => host.querySelector(".csv-scroll")!;
  const editor = () => host.querySelector<HTMLTextAreaElement>(".csv-edit");
  const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  const dbl = (x = 60, y = 30) => rowsEl().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: x, clientY: y }));
  const setup = async (hooks = {}) => {
    const onEdit = vi.fn(() => true);
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const p = createCsvPanel(host, { onEdit, onUndo, onRedo, ...hooks });
    p.show("t1", "x", CFG, 3);
    await flush();
    return { p, onEdit, onUndo, onRedo };
  };

  it("duplo clique abre o campo com o valor; Enter grava, refaz a tabela e desce", async () => {
    const { onEdit } = await setup();
    dbl();
    await flush(10);
    expect(editor()?.value).toBe("Ana");
    editor()!.value = "Novo";
    key(editor()!, "Enter");
    await flush();
    expect(api.csvEdit).toHaveBeenCalledWith("t1", [{ row: 1, col: 0, value: "Novo" }]);
    expect(onEdit).toHaveBeenCalledWith([{ from: 0, to: 3, insert: "Novo" }], 3);
    expect(api.csvLoad).toHaveBeenCalledTimes(2); // índice refeito na hora
    expect(editor()).toBeNull();
    expect(host.querySelectorAll(".csv-cell.sel")).toHaveLength(1); // desceu para a linha de baixo
    expect(host.querySelector(".csv-row:nth-child(2) .csv-cell.sel")).not.toBeNull();
  });

  it("sem mudar o valor, ou com Esc, nada é gravado", async () => {
    await setup();
    dbl();
    await flush(10);
    key(editor()!, "Enter");
    await flush();
    expect(api.csvEdit).not.toHaveBeenCalled();
    dbl();
    await flush(10);
    editor()!.value = "outra coisa";
    key(editor()!, "Escape");
    await flush();
    expect(api.csvEdit).not.toHaveBeenCalled();
    expect(editor()).toBeNull();
  });

  it("digitar numa célula selecionada começa a edição trocando o conteúdo; F2 mantém", async () => {
    await setup();
    click(host.querySelectorAll(".csv-cell")[0], { clientX: 60, clientY: 30 });
    key(scroll(), "x");
    await flush(10);
    expect(editor()?.value).toBe("x");
    key(editor()!, "Escape");
    await flush();
    key(scroll(), "F2");
    await flush(10);
    expect(editor()?.value).toBe("Ana");
  });

  it("Tab grava e anda para a célula ao lado", async () => {
    await setup();
    dbl();
    await flush(10);
    editor()!.value = "Z";
    key(editor()!, "Tab");
    await flush();
    expect(api.csvEdit).toHaveBeenCalled();
    expect(host.querySelector(".csv-row .csv-cell.sel")?.textContent).toBe("20");
  });

  it("clicar em outro lugar grava o que foi digitado", async () => {
    await setup();
    dbl();
    await flush(10);
    editor()!.value = "Mudou";
    click(host.querySelector(".csv-scroll")!);
    await flush();
    expect(api.csvEdit).toHaveBeenCalledWith("t1", [{ row: 1, col: 0, value: "Mudou" }]);
  });

  it("se o texto mudou no meio do caminho, nada é aplicado e a tabela avisa", async () => {
    const { onEdit } = await setup({ onEdit: vi.fn(() => false) });
    void onEdit;
    dbl();
    await flush(10);
    editor()!.value = "Novo";
    key(editor()!, "Enter");
    await flush();
    expect(host.querySelector(".csv-toast")?.textContent).toContain("O texto mudou");
    expect(api.csvLoad).toHaveBeenCalledTimes(1);
  });

  it("enquanto a tabela se atualiza depois de uma edição no código, não deixa editar", async () => {
    const { p } = await setup();
    p.update("texto novo", 9);
    dbl();
    await flush(10);
    expect(editor()).toBeNull();
    expect(host.querySelector(".csv-toast")?.textContent).toContain("atualizando");
  });

  it("Delete esvazia a seleção numa transação só", async () => {
    await setup();
    click(host.querySelectorAll(".csv-cell")[0], { clientX: 60, clientY: 30 });
    click(host.querySelectorAll(".csv-cell")[0], { clientX: 56 + 150, clientY: 28 + 24 + 2, shiftKey: true });
    key(scroll(), "Delete");
    await flush();
    expect(api.csvEdit).toHaveBeenCalledTimes(1);
    expect(api.csvEdit).toHaveBeenCalledWith("t1", [
      { row: 1, col: 0, value: "" },
      { row: 1, col: 1, value: "" },
      { row: 2, col: 0, value: "" },
      { row: 2, col: 1, value: "" },
    ]);
    expect(host.querySelector(".csv-toast")?.textContent).toBe("4 células apagadas");
  });

  it("Ctrl+Z e Ctrl+Y da tabela usam o histórico do editor", async () => {
    const { onUndo, onRedo } = await setup();
    key(scroll(), "z", { ctrlKey: true });
    key(scroll(), "y", { ctrlKey: true });
    key(scroll(), "Z", { ctrlKey: true, shiftKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(2);
  });

  it("esconder a tabela descarta a edição em andamento", async () => {
    const { p } = await setup();
    dbl();
    await flush(10);
    p.hide();
    await flush();
    expect(editor()).toBeNull();
    expect(api.csvEdit).not.toHaveBeenCalled();
  });
});

describe("estrutura: linhas e colunas", () => {
  const rowsEl = () => host.querySelector(".csv-rows")!;
  const setup = async () => {
    const onEdit = vi.fn(() => true);
    const p = createCsvPanel(host, { onEdit });
    p.show("t1", "x", CFG, 3);
    await flush();
    return { p, onEdit };
  };

  it("menu do cabeçalho: inserir coluna à direita, mover e apagar", async () => {
    const { onEdit } = await setup();
    const h = host.querySelectorAll(".csv-hcell")[0];
    rightClick(h);
    menuItem("Inserir coluna à direita").click();
    await flush();
    expect(api.csvStructure).toHaveBeenCalledWith("t1", { op: "insertCol", at: 1 });
    expect(onEdit).toHaveBeenCalledWith([{ from: 0, to: 0, insert: "," }], 3);
    expect(api.csvLoad).toHaveBeenCalledTimes(2);
    rightClick(host.querySelectorAll(".csv-hcell")[0]);
    menuItem("Mover para a direita").click();
    await flush();
    expect(api.csvStructure).toHaveBeenCalledWith("t1", { op: "moveCol", from: 0, to: 1 });
    rightClick(host.querySelectorAll(".csv-hcell")[1]);
    menuItem("Apagar coluna").click();
    await flush();
    expect(api.csvStructure).toHaveBeenCalledWith("t1", { op: "deleteCols", cols: [1] });
  });

  it("ordenar o arquivo manda a coluna, o sentido e as escolhas de cabeçalho/decimal", async () => {
    await setup();
    rightClick(host.querySelectorAll(".csv-hcell")[1]);
    menuItem("Ordenar o arquivo por esta coluna").dispatchEvent(new MouseEvent("mouseenter"));
    menuItem("Decrescente").click();
    await flush();
    expect(api.csvStructure).toHaveBeenCalledWith("t1", { op: "sortFile", col: 1, desc: true, header: true, decimal: "." });
  });

  it("menu da célula: inserir linha acima/abaixo e apagar as linhas selecionadas", async () => {
    await setup();
    const cell = host.querySelectorAll(".csv-cell")[0];
    rightClick(cell, { clientX: 60, clientY: 30 });
    menuItem("Inserir linha abaixo").click();
    await flush();
    expect(api.csvStructure).toHaveBeenCalledWith("t1", { op: "insertRows", pos: 0, after: true, count: 1 });
    rightClick(host.querySelectorAll(".csv-cell")[0], { clientX: 60, clientY: 30 });
    menuItem("Apagar linha").click();
    await flush();
    expect(api.csvStructure).toHaveBeenLastCalledWith("t1", { op: "deleteRows", from: 0, to: 0 });
  });

  it("sem mudança no texto avisa e não toca no editor", async () => {
    api.csvStructure.mockResolvedValueOnce([]);
    const { onEdit } = await setup();
    rightClick(host.querySelectorAll(".csv-hcell")[0]);
    menuItem("Mover para a esquerda");
    rightClick(host.querySelectorAll(".csv-hcell")[0]);
    menuItem("Inserir coluna à esquerda").click();
    await flush();
    expect(onEdit).not.toHaveBeenCalled();
    expect(rowsEl()).toBeTruthy();
  });
});

describe("colar e renomear coluna", () => {
  const pasteText = (text: string) => {
    const ev = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", { value: { getData: () => text } });
    host.querySelector(".csv-scroll")!.dispatchEvent(ev);
  };
  const setup = async () => {
    const onEdit = vi.fn(() => true);
    const p = createCsvPanel(host, { onEdit });
    p.show("t1", "x", CFG, 3);
    await flush();
    return { p, onEdit };
  };

  it("parseClipboard lê tab, quebras e campos entre aspas", () => {
    expect(parseClipboard("a")).toEqual([["a"]]);
    expect(parseClipboard("a\tb\r\nc\td\n")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseClipboard('"x\ty\nz"\t"q""r"\n')).toEqual([["x\ty\nz", 'q"r']]);
    expect(parseClipboard("a\t\tb")).toEqual([["a", "", "b"]]);
    expect(parseClipboard("\n\nx")).toEqual([[""], [""], ["x"]]);
  });

  it("Ctrl+V cola o bloco a partir da célula selecionada, em linhas do arquivo", async () => {
    const { onEdit } = await setup();
    click(host.querySelectorAll(".csv-cell")[0], { clientX: 60, clientY: 30 });
    pasteText("x\ty\nz\tw");
    await flush();
    expect(api.csvEdit).toHaveBeenCalledWith("t1", [
      { row: 1, col: 0, value: "x" },
      { row: 1, col: 1, value: "y" },
      { row: 2, col: 0, value: "z" },
      { row: 2, col: 1, value: "w" },
    ]);
    expect(onEdit).toHaveBeenCalled();
  });

  it("uma célula só preenche toda a seleção", async () => {
    await setup();
    click(host.querySelectorAll(".csv-cell")[0], { clientX: 60, clientY: 30 });
    click(host.querySelectorAll(".csv-cell")[0], { clientX: 56 + 150, clientY: 28 + 24 + 2, shiftKey: true });
    pasteText("0");
    await flush();
    const list = api.csvEdit.mock.calls[0][1];
    expect(list).toHaveLength(4);
    expect(list.every((e: { value: string }) => e.value === "0")).toBe(true);
  });

  it("colar passando da última linha usa índices novos depois do fim do arquivo", async () => {
    await setup();
    const cells = host.querySelectorAll(".csv-cell");
    const last = cells[cells.length - 2]; // primeira coluna da última linha
    click(last, { clientX: 60, clientY: 28 + 24 * 4 + 2 });
    pasteText("a\nb");
    await flush();
    const list = api.csvEdit.mock.calls[0][1] as { row: number }[];
    expect(list.map((e) => e.row)).toEqual([5, 6]); // cabeçalho + 5 linhas = 6 no arquivo; a última é a 5
  });

  it("Renomear coluna edita a célula do cabeçalho (linha 0 do arquivo)", async () => {
    await setup();
    rightClick(host.querySelectorAll(".csv-hcell")[1]);
    menuItem("Renomear coluna").click();
    await flush(10);
    const input = host.querySelector<HTMLInputElement>(".csv-hedit")!;
    expect(input).not.toBeNull();
    input.value = "Idade nova";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await flush();
    expect(api.csvEdit).toHaveBeenCalledWith("t1", [{ row: 0, col: 1, value: "Idade nova" }]);
    expect(host.querySelector(".csv-hedit")).toBeNull();
  });

  it("Esc no nome da coluna descarta", async () => {
    await setup();
    rightClick(host.querySelectorAll(".csv-hcell")[0]);
    menuItem("Renomear coluna").click();
    await flush(10);
    const input = host.querySelector<HTMLInputElement>(".csv-hedit")!;
    input.value = "x";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await flush();
    expect(api.csvEdit).not.toHaveBeenCalled();
  });
});

describe("coluna do número da linha", () => {
  it("cabe o maior número e dá para arrastar a borda; duplo clique volta ao automático", async () => {
    api.csvLoad.mockImplementation(async () => info({ rows: 500000, total: 500000 }));
    const p = createCsvPanel(host);
    p.show("t1", "x", CFG, 1);
    await flush();
    expect(host.style.getPropertyValue("--csv-num-w")).toBe("80px"); // 6 dígitos
    const grip = host.querySelector(".csv-hnum .csv-grip")!;
    grip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: 100 }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 140 }));
    document.dispatchEvent(new MouseEvent("mouseup"));
    expect(host.style.getPropertyValue("--csv-num-w")).toBe("120px");
    host.querySelector(".csv-hnum .csv-grip")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(host.style.getPropertyValue("--csv-num-w")).toBe("80px");
  });
});
