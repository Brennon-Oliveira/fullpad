// Visão de um PDF: páginas em <canvas> virtualizadas, camada de texto selecionável e links.
// Só é importado quando o usuário clica em "Carregar" (arrasta o pdf.js e o worker junto).

import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { api } from "../api";
import { MAX_ZOOM, MIN_ZOOM, type ReaderPos, canvasRatio, clamp, fitScale, isSafeLink, pageIndexAt, visibleRange } from "./pos";
import { ReaderError } from "./errors";
import { openPdfTask } from "./source";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Tempo máximo para abrir o documento e para processar uma página; passou disso, o arquivo é abandonado. */
const OPEN_MS = 20_000;
const PAGE_MS = 12_000;
/** Pixels máximos do canvas de uma página (acima disso a resolução cai, o tamanho na tela não). */
const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
/** Quantas telas além da visível ficam renderizadas. */
const MARGIN_SCREENS = 1;
const PAD = 16;

export interface PdfViewHooks {
  /** Página ou escala mudou (a UI grava na sessão, com atraso). */
  onPosition(pos: ReaderPos): void;
  /** O arquivo não pôde ser processado (ou demorou demais): a visão já foi desfeita. */
  onFatal(message: string): void;
  /** Página atual, total e escala em uso. */
  onView(page: number, total: number, scale: number, fit: boolean): void;
}

export interface PdfView {
  readonly pages: number;
  setZoom(zoom: number | null): void;
  zoomBy(factor: number): void;
  goTo(page: number, frac?: number): void;
  position(): ReaderPos;
  /** O painel mudou de tamanho. */
  resize(): void;
  dispose(): Promise<void>;
}

class Timeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let id = 0;
  const timer = new Promise<never>((_, reject) => {
    id = window.setTimeout(() => reject(new Timeout("tempo esgotado")), ms);
  });
  return Promise.race([p, timer]).finally(() => window.clearTimeout(id));
}

interface Slot {
  el: HTMLElement;
  /** Tamanho a 100%; null enquanto só se conhece o da primeira página. */
  base: { w: number; h: number } | null;
  /** Presente enquanto a página está desenhada. */
  drawn?: { canvas: HTMLCanvasElement; layers: HTMLElement[]; page: PDFPageProxy; task?: RenderTask; scale: number };
  busy?: boolean;
}

export async function openPdfView(host: HTMLElement, id: string, size: number, pos: ReaderPos, hooks: PdfViewHooks): Promise<PdfView> {
  const { task, failure }: { task: PDFDocumentLoadingTask; failure: Promise<never> } = await openPdfTask(pdfjs, size, async (offset, len) => api.readerRead(id, offset, len));
  let doc: PDFDocumentProxy;
  try {
    doc = await withTimeout(Promise.race([task.promise, failure]), OPEN_MS);
  } catch (e) {
    void task.destroy().catch(() => {});
    throw e instanceof Timeout ? new ReaderError("O PDF demorou demais para abrir.") : e;
  }

  // a primeira página dá o tamanho de referência; se nem ela vier, o arquivo é abandonado
  let firstPage: PDFPageProxy;
  try {
    firstPage = await withTimeout(doc.getPage(1), OPEN_MS);
  } catch (e) {
    void task.destroy().catch(() => {});
    throw e instanceof Timeout ? new ReaderError("O PDF demorou demais para abrir.") : e;
  }

  const scroller = Object.assign(document.createElement("div"), { className: "rd-scroll", tabIndex: 0 });
  const pagesEl = Object.assign(document.createElement("div"), { className: "rd-pages" });
  scroller.append(pagesEl);
  host.replaceChildren(scroller);

  let disposed = false;
  let zoom = pos.zoom;
  let gen = 0; // muda a cada novo layout: desenhos antigos são descartados
  let posTimer = 0;
  let raf = 0;

  const v1 = firstPage.getViewport({ scale: 1 });
  const firstBase = { w: v1.width, h: v1.height };
  firstPage.cleanup();

  const slots: Slot[] = Array.from({ length: doc.numPages }, (_, i) => {
    const el = Object.assign(document.createElement("div"), { className: "rd-page" });
    el.dataset.page = String(i + 1);
    pagesEl.append(el);
    return { el, base: i === 0 ? firstBase : null };
  });

  const scale = () => (zoom ?? fitScale(scroller.clientWidth - 2 * PAD, firstBase.w));
  const baseOf = (s: Slot) => s.base ?? firstBase;
  const topOf = (i: number) => slots[i].el.offsetTop;
  const heightOf = (i: number) => slots[i].el.offsetHeight;

  function sizeSlot(s: Slot) {
    const sc = scale();
    const b = baseOf(s);
    s.el.style.width = `${Math.round(b.w * sc)}px`;
    s.el.style.height = `${Math.round(b.h * sc)}px`;
  }

  function position(): ReaderPos {
    const y = scroller.scrollTop - pagesEl.offsetTop;
    const i = pageIndexAt(slots.length, topOf, y + 1);
    const h = heightOf(i);
    return { page: i + 1, frac: h > 0 ? clamp((y - topOf(i)) / h, 0, 1) : 0, zoom };
  }

  function report() {
    const p = position();
    hooks.onView(p.page, slots.length, scale(), zoom === null);
    window.clearTimeout(posTimer);
    posTimer = window.setTimeout(() => !disposed && hooks.onPosition(position()), 300);
  }

  function goTo(page: number, frac = 0) {
    const i = clamp(Math.floor(page) - 1, 0, slots.length - 1);
    scroller.scrollTop = pagesEl.offsetTop + topOf(i) + frac * heightOf(i);
  }

  function relayout(anchor: ReaderPos) {
    gen++;
    for (const s of slots) {
      release(s);
      sizeSlot(s);
    }
    goTo(anchor.page, anchor.frac);
    schedule();
    report();
  }

  // ---- desenho das páginas visíveis --------------------------------------------

  function release(s: Slot) {
    if (!s.drawn) return;
    s.drawn.task?.cancel();
    s.drawn.canvas.width = s.drawn.canvas.height = 0; // devolve a memória do bitmap
    s.el.replaceChildren();
    s.drawn.page.cleanup();
    s.drawn = undefined;
  }

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!disposed) update();
    });
  }

  function update() {
    const margin = scroller.clientHeight * MARGIN_SCREENS;
    const y = scroller.scrollTop - pagesEl.offsetTop;
    const { first: a, last: b } = visibleRange(slots.length, topOf, heightOf, y - margin, y + scroller.clientHeight + margin);
    slots.forEach((s, i) => {
      if (i < a || i > b) release(s);
    });
    // as mais próximas do topo primeiro
    for (let i = a; i <= b; i++) void draw(i);
  }

  async function draw(i: number) {
    const s = slots[i];
    if (s.drawn || s.busy || disposed) return;
    s.busy = true;
    const myGen = gen;
    try {
      const page = await withTimeout(doc.getPage(i + 1), PAGE_MS);
      if (disposed || myGen !== gen) return void page.cleanup();
      const vp1 = page.getViewport({ scale: 1 });
      if (!s.base || Math.abs(s.base.w - vp1.width) > 0.5 || Math.abs(s.base.h - vp1.height) > 0.5) {
        const anchor = i < position().page ? position() : null; // página acima da tela muda de tamanho: não deslocar o que se lê
        s.base = { w: vp1.width, h: vp1.height };
        sizeSlot(s);
        if (anchor) goTo(anchor.page, anchor.frac);
      }
      const sc = scale();
      const vp = page.getViewport({ scale: sc });
      const ratio = canvasRatio(vp.width, vp.height, window.devicePixelRatio, MAX_CANVAS_PIXELS);

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(vp.width * ratio));
      canvas.height = Math.max(1, Math.floor(vp.height * ratio));
      canvas.style.width = `${Math.floor(vp.width)}px`;
      canvas.style.height = `${Math.floor(vp.height)}px`;
      s.el.replaceChildren(canvas);
      const drawn: NonNullable<Slot["drawn"]> = { canvas, layers: [], page, scale: sc };
      s.drawn = drawn;

      const rt = page.render({ canvas, viewport: page.getViewport({ scale: sc * ratio }) });
      drawn.task = rt;
      await withTimeout(rt.promise, PAGE_MS);
      if (disposed || s.drawn !== drawn) return;

      const text = Object.assign(document.createElement("div"), { className: "textLayer" });
      text.style.setProperty("--total-scale-factor", String(sc));
      text.style.setProperty("--scale-factor", String(sc));
      s.el.append(text);
      drawn.layers.push(text);
      await withTimeout(new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport: vp }).render(), PAGE_MS);
      if (disposed || s.drawn !== drawn) return;
      await addLinks(s, drawn, vp);
    } catch (e) {
      if (disposed || e instanceof pdfjs.RenderingCancelledException) return;
      if (e instanceof Timeout) return fatal("O PDF demorou demais para ser processado. Ele pode ser muito pesado ou malformado.");
      s.el.classList.add("failed");
      s.el.textContent = "Não foi possível mostrar esta página.";
      console.error("falha ao desenhar a página", i + 1, e);
    } finally {
      s.busy = false;
    }
  }

  /** Links do PDF: só `http`, `https` e `mailto`, abertos pelo navegador do sistema. */
  async function addLinks(s: Slot, drawn: NonNullable<Slot["drawn"]>, vp: ReturnType<PDFPageProxy["getViewport"]>) {
    const layer = Object.assign(document.createElement("div"), { className: "rd-links" });
    for (const a of await drawn.page.getAnnotations({ intent: "display" })) {
      const url = a.subtype === "Link" && typeof a.url === "string" ? a.url : null;
      if (!url || !isSafeLink(url) || !a.rect) continue;
      const [ax, ay] = vp.convertToViewportPoint(a.rect[0], a.rect[1]);
      const [bx, by] = vp.convertToViewportPoint(a.rect[2], a.rect[3]);
      const [x1, y1, x2, y2] = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
      const link = Object.assign(document.createElement("a"), { className: "rd-link", href: "#", title: url });
      Object.assign(link.style, { left: `${x1}px`, top: `${y1}px`, width: `${x2 - x1}px`, height: `${y2 - y1}px` });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        void api.openUrl(url).catch((err) => console.error("não abriu o link", err));
      });
      layer.append(link);
    }
    if (disposed || s.drawn !== drawn) return;
    s.el.append(layer);
    drawn.layers.push(layer);
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    window.clearTimeout(posTimer);
    cancelAnimationFrame(raf);
    for (const s of slots) release(s);
    await task.destroy().catch(() => {}); // encerra o worker e libera o que ele tinha em memória
    host.replaceChildren();
  }

  function fatal(message: string) {
    if (disposed) return;
    void dispose();
    hooks.onFatal(message);
  }

  scroller.addEventListener(
    "scroll",
    () => {
      schedule();
      report();
    },
    { passive: true },
  );

  for (const s of slots) sizeSlot(s);
  // a posição só vale depois de a caixa ter largura: espera o layout do painel
  requestAnimationFrame(() => {
    if (disposed) return;
    relayout(pos);
  });

  function setZoom(z: number | null) {
    const anchor = position();
    zoom = z === null ? null : clamp(z, MIN_ZOOM, MAX_ZOOM);
    relayout({ ...anchor, zoom });
  }

  return {
    pages: slots.length,
    setZoom,
    zoomBy: (factor) => setZoom(clamp(scale() * factor, MIN_ZOOM, MAX_ZOOM)),
    goTo,
    position,
    resize() {
      if (zoom === null) relayout(position());
      else schedule();
    },
    dispose,
  };
}
