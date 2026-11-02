/**
 * Arrastar abas com o mouse, com eventos de ponteiro (o arrastar do HTML5 não atravessa janelas do
 * app de forma confiável):
 *  - dentro da barra a aba acompanha o ponteiro e as vizinhas deslizam para dar lugar;
 *  - ao sair da barra a aba "descola": o chamador abre uma janela própria que segue o mouse
 *    (`onTearStart`/`onTearMove`/`onTearEnd`).
 */

const THRESHOLD = 5; // px antes de contar como arrasto (senão é um clique)
const TEAR_DISTANCE = 28; // px para fora da barra, na vertical, a partir dos quais a aba sai
const SLIDE_MS = 140;

export interface DragHooks {
  /** Nova ordem das abas (ids) depois de reordenar. */
  onReorder(ids: string[]): void;
  /** Esta aba pode sair da janela? (a única aba da janela principal não pode) */
  canTear(id: string): boolean;
  /** A aba saiu da barra. `x`/`y`: ponto da tela (px físicos); `gx`/`gy`: onde na aba ela foi segurada. */
  onTearStart(id: string, p: { x: number; y: number; gx: number; gy: number }): void;
  onTearMove(x: number, y: number): void;
  /** Soltou fora da barra (ou cancelou). `gx`/`gy`: onde na aba ela foi segurada. */
  onTearEnd(id: string, p: { x: number; y: number; gx: number; gy: number }, cancelled: boolean): void;
}

/** Índice de inserção para o ponteiro em `x`, dados os centros das abas (em ordem). */
export function insertionIndex(centers: number[], x: number): number {
  const i = centers.findIndex((c) => x < c);
  return i < 0 ? centers.length : i;
}

/** Para onde cada aba desliza quando a aba `from` é solta na posição `to`: deslocamento em px. */
export function slideOffsets(widths: number[], from: number, to: number): number[] {
  const w = widths[from];
  return widths.map((_, j) => {
    if (j === from) return 0;
    if (from < to && j > from && j <= to) return -w;
    if (to < from && j >= to && j < from) return w;
    return 0;
  });
}

export function attachTabDrag(strip: HTMLElement, hooks: DragHooks) {
  interface Drag {
    el: HTMLElement;
    id: string;
    pid: number;
    x0: number;
    y0: number;
    gx: number;
    gy: number;
    moved: boolean;
    torn: boolean;
    els: HTMLElement[];
    lefts: number[];
    widths: number[];
    from: number;
    to: number;
    last: { x: number; y: number };
  }
  let drag: Drag | null = null;
  let swallowClick = false;

  const tabs = () => [...strip.querySelectorAll<HTMLElement>(".tab:not(.ghost)")];
  const phys = (e: PointerEvent) => {
    const dpr = window.devicePixelRatio || 1;
    return { x: Math.round(e.screenX * dpr), y: Math.round(e.screenY * dpr) };
  };

  strip.addEventListener("pointerdown", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".tab");
    if (!el || e.button !== 0 || (e.target as HTMLElement).closest(".close")) return;
    const els = tabs();
    const rects = els.map((t) => t.getBoundingClientRect());
    const from = els.indexOf(el);
    drag = {
      el, id: el.dataset.id!, pid: e.pointerId, x0: e.clientX, y0: e.clientY,
      gx: e.clientX - rects[from].left, gy: e.clientY - rects[from].top,
      moved: false, torn: false, els, lefts: rects.map((r) => r.left), widths: rects.map((r) => r.width),
      from, to: from, last: phys(e),
    };
  });

  strip.addEventListener("pointermove", (e) => {
    const d = drag;
    if (!d || e.pointerId !== d.pid) return;
    d.last = phys(e);
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < THRESHOLD) return;
      d.moved = true;
      strip.setPointerCapture(d.pid); // a aba pode ser removida da barra no meio do arrasto
      d.el.classList.add("dragging");
      for (const t of d.els) if (t !== d.el) t.style.transition = `transform ${SLIDE_MS}ms ease`;
    }
    if (d.torn) return hooks.onTearMove(d.last.x, d.last.y);

    const r = strip.getBoundingClientRect();
    const outside = e.clientY < r.top - TEAR_DISTANCE || e.clientY > r.bottom + TEAR_DISTANCE || e.clientX < -TEAR_DISTANCE || e.clientX > window.innerWidth + TEAR_DISTANCE;
    if (outside && hooks.canTear(d.id)) {
      d.torn = true;
      // a aba original fica no lugar, apagada; quem anda com o mouse é a sombra
      for (const t of d.els) t.style.transform = t.style.transition = "";
      d.el.classList.add("torn");
      hooks.onTearStart(d.id, { ...d.last, gx: d.gx, gy: d.gy });
      return;
    }

    // a aba segue o ponteiro (limitada à barra) e as outras deslizam
    const minDx = d.lefts[0] - d.lefts[d.from];
    const maxDx = d.lefts[d.lefts.length - 1] + d.widths[d.widths.length - 1] - d.widths[d.from] - d.lefts[d.from];
    const dx = Math.max(minDx, Math.min(maxDx, e.clientX - d.x0));
    d.el.style.transition = "none";
    d.el.style.transform = `translateX(${dx}px)`;
    const centre = d.lefts[d.from] + d.widths[d.from] / 2 + dx;
    // posição final = quantas das outras estão antes do centro da aba arrastada
    d.to = d.els.filter((_, j) => j !== d.from && d.lefts[j] + d.widths[j] / 2 < centre).length;
    const shift = slideOffsets(d.widths, d.from, d.to);
    d.els.forEach((t, j) => {
      if (j !== d.from) t.style.transform = shift[j] ? `translateX(${shift[j]}px)` : "";
    });
  });

  const reset = (d: Drag) => {
    for (const t of d.els) {
      t.style.transform = t.style.transition = "";
      t.classList.remove("dragging");
    }
  };

  const finish = (e: PointerEvent, cancelled: boolean) => {
    const d = drag;
    if (!d || e.pointerId !== d.pid) return;
    drag = null;
    if (!d.moved) return;
    swallowClick = true; // o clique gerado ao soltar não deve ativar a aba
    setTimeout(() => (swallowClick = false));
    if (d.torn) {
      reset(d);
      d.el.classList.remove("torn");
      const p = cancelled ? d.last : phys(e);
      return hooks.onTearEnd(d.id, { ...p, gx: d.gx, gy: d.gy }, cancelled);
    }
    if (cancelled || d.to === d.from) return reset(d);
    // anima até o lugar final e só então grava a ordem
    const dest = d.to > d.from ? d.lefts[d.to] + d.widths[d.to] - d.widths[d.from] : d.lefts[d.to];
    d.el.style.transition = `transform ${SLIDE_MS}ms ease`;
    d.el.style.transform = `translateX(${dest - d.lefts[d.from]}px)`;
    const order = d.els.map((t) => t.dataset.id!);
    order.splice(d.to, 0, order.splice(d.from, 1)[0]);
    setTimeout(() => {
      reset(d);
      hooks.onReorder(order);
    }, SLIDE_MS + 10);
  };
  strip.addEventListener("pointerup", (e) => finish(e, false));
  strip.addEventListener("pointercancel", (e) => finish(e, true));
  strip.addEventListener("click", (e) => swallowClick && (e.stopPropagation(), e.preventDefault()), true);
}
