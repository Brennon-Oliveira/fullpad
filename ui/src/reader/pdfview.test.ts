// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// O pdf.js é trocado por um de mentira: aqui só se confere a lógica de desenho do leitor
// (troca dupla ao dar zoom e redesenho depois de um zoom no meio do desenho).
const fake = vi.hoisted(() => {
  class RenderingCancelledException extends Error {}
  const state = { hold: false, gate: null as null | (() => void), renders: 0, scales: [] as number[] };
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale, convertToViewportPoint: (x: number, y: number) => [x, y] }),
    render: () => {
      state.renders++;
      let reject!: (e: unknown) => void;
      const promise = new Promise<void>((res, rej) => {
        reject = rej;
        if (state.hold) state.gate = res;
        else res();
      });
      return { promise, cancel: () => reject(new RenderingCancelledException("cancelado")) };
    },
    streamTextContent: () => ({}),
    getTextContent: async () => ({ items: [{ str: "Olá ", hasEOL: false }, { str: "mundo", hasEOL: true }, { str: "Fim" }, { type: "beginMarkedContent" }] }),
    getAnnotations: async () => [],
    cleanup: () => {},
  };
  class TextLayer {
    constructor(private o: { container: HTMLElement }) {}
    async render() {
      this.o.container.textContent = "texto da página";
    }
  }
  return { RenderingCancelledException, state, page, TextLayer };
});

vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, TextLayer: fake.TextLayer, RenderingCancelledException: fake.RenderingCancelledException }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));
vi.mock("pdfjs-dist/web/pdf_viewer.css", () => ({}));
vi.mock("../api", () => ({ api: { readerRead: vi.fn(), openUrl: vi.fn() } }));
vi.mock("./source", () => ({
  openPdfTask: async () => ({
    task: { promise: Promise.resolve({ numPages: 1, getPage: async () => fake.page }), destroy: async () => {} },
    failure: new Promise(() => {}),
  }),
}));

import { openPdfView } from "./pdfview";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hooks = { onPosition: vi.fn(), onFatal: vi.fn(), onView: vi.fn() };
let host: HTMLElement;
const stages = () => [...host.querySelectorAll<HTMLElement>(".rd-stage")];

beforeEach(() => {
  host = document.createElement("div");
  document.body.replaceChildren(host);
  fake.state.hold = false;
  fake.state.gate = null;
  fake.state.renders = 0;
  for (const h of Object.values(hooks)) h.mockClear();
});

describe("desenho das páginas", () => {
  it("desenha a página com canvas e texto, já visível", async () => {
    const view = await openPdfView(host, "t", 1000, { page: 1, frac: 0, zoom: 1 }, hooks);
    await wait(60);
    expect(stages()).toHaveLength(1);
    expect(stages()[0].style.visibility).toBe("");
    expect(stages()[0].querySelector(".textLayer")?.textContent).toBe("texto da página");
    expect(stages()[0].querySelector("canvas")!.style.width).toBe("100px");
    await view.dispose();
  });

  it("ao dar zoom, a página antiga fica na tela (esticada) até a nova ficar pronta: nada pisca", async () => {
    const view = await openPdfView(host, "t", 1000, { page: 1, frac: 0, zoom: 1 }, hooks);
    await wait(60);
    const before = stages()[0];

    fake.state.hold = true; // o desenho novo demora
    view.setZoom(2);
    expect(stages()).toHaveLength(1);
    expect(stages()[0]).toBe(before); // continua lá
    expect(before.classList.contains("stale")).toBe(true);
    expect(before.style.visibility).toBe(""); // e visível

    await wait(200); // o zoom assentou: o desenho novo começou, escondido, ao lado do antigo
    expect(stages()).toHaveLength(2);
    expect(stages()[1].style.visibility).toBe("hidden");
    expect(before.isConnected).toBe(true);

    fake.state.gate!(); // fica pronto: troca de uma vez
    await wait(60);
    expect(stages()).toHaveLength(1);
    expect(stages()[0]).not.toBe(before);
    expect(stages()[0].style.visibility).toBe("");
    expect(stages()[0].classList.contains("stale")).toBe(false);
    expect(stages()[0].querySelector("canvas")!.style.width).toBe("200px");
    expect(stages()[0].querySelector(".textLayer")?.textContent).toBe("texto da página");
    await view.dispose();
  });

  it("zoom no meio de um desenho: a página é desenhada de novo e o texto não some", async () => {
    fake.state.hold = true;
    const view = await openPdfView(host, "t", 1000, { page: 1, frac: 0, zoom: 1 }, hooks);
    await wait(60); // primeiro desenho preso no render
    expect(fake.state.renders).toBe(1);

    view.setZoom(1.5); // zoom com o desenho em andamento: o antigo é cancelado
    fake.state.hold = false;
    await wait(250);
    expect(fake.state.renders).toBeGreaterThanOrEqual(2);
    expect(stages()).toHaveLength(1);
    expect(stages()[0].style.visibility).toBe("");
    expect(stages()[0].querySelector("canvas")!.style.width).toBe("150px");
    expect(stages()[0].querySelector(".textLayer")?.textContent).toBe("texto da página");
    expect(hooks.onFatal).not.toHaveBeenCalled();
    await view.dispose();
  });

  it("o texto de uma página para a busca junta os itens do PDF (fim de linha vira espaço)", async () => {
    const view = await openPdfView(host, "t", 1000, { page: 1, frac: 0, zoom: 1 }, hooks);
    expect(view.find!.units).toBe(1);
    expect(await view.find!.textOf(0)).toBe("Olá mundo Fim");
    await view.dispose();
  });

  it("reveal e clear da busca não quebram, com ou sem a página desenhada", async () => {
    const view = await openPdfView(host, "t", 1000, { page: 1, frac: 0, zoom: 1 }, hooks);
    await wait(60);
    expect(() => view.find!.reveal({ unit: 0, nth: 0, snippet: "x" }, "mundo")).not.toThrow();
    expect(() => view.find!.reveal(null, "outra")).not.toThrow();
    expect(() => view.find!.clear()).not.toThrow();
    await view.dispose();
  });

  it("vários passos de zoom seguidos redesenham uma vez só, no fim", async () => {
    const view = await openPdfView(host, "t", 1000, { page: 1, frac: 0, zoom: 1 }, hooks);
    await wait(60);
    const base = fake.state.renders;
    for (const z of [1.1, 1.2, 1.3, 1.4, 1.5]) view.setZoom(z);
    await wait(60);
    expect(fake.state.renders).toBe(base); // ainda esperando o zoom parar
    await wait(200);
    expect(fake.state.renders).toBe(base + 1);
    expect(stages()[0].querySelector("canvas")!.style.width).toBe("150px");
    await view.dispose();
  });
});
