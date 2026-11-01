/**
 * Arrastar abas com o mouse: reordenar dentro da barra e "tirar" a aba arrastando-a para fora dela.
 * É feito com eventos de ponteiro (e não com o arrastar do HTML5) porque o arrastar nativo não
 * atravessa janelas do app de forma confiável.
 */

const THRESHOLD = 5; // px antes de começar a contar como arrasto (senão é um clique)
const TEAR_DISTANCE = 36; // px para fora da barra, na vertical, a partir dos quais a aba "sai"

export interface DragHooks {
  /** Nova ordem das abas (ids) depois de reordenar. */
  onReorder(ids: string[]): void;
  /** A aba foi solta fora da barra: ponto da tela em pixels físicos. */
  onTearOff(id: string, screenX: number, screenY: number): void;
}

/** Índice de inserção para o ponteiro em `x`, dados os centros das outras abas (em ordem). */
export function insertionIndex(centers: number[], x: number): number {
  const i = centers.findIndex((c) => x < c);
  return i < 0 ? centers.length : i;
}

export function attachTabDrag(strip: HTMLElement, hooks: DragHooks) {
  let drag: { el: HTMLElement; id: string; x0: number; y0: number; moved: boolean; torn: boolean; order: string } | null = null;
  let swallowClick = false;

  const tabs = () => [...strip.querySelectorAll<HTMLElement>(".tab")];
  const orderOf = () => tabs().map((t) => t.dataset.id!).join(",");

  strip.addEventListener("pointerdown", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".tab");
    if (!el || e.button !== 0 || (e.target as HTMLElement).closest(".close")) return;
    drag = { el, id: el.dataset.id!, x0: e.clientX, y0: e.clientY, moved: false, torn: false, order: orderOf() };
    el.setPointerCapture(e.pointerId);
  });

  strip.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < THRESHOLD) return;
      drag.moved = true;
      drag.el.classList.add("dragging");
    }
    const r = strip.getBoundingClientRect();
    const outside = e.clientY < r.top - TEAR_DISTANCE || e.clientY > r.bottom + TEAR_DISTANCE || e.clientX < -TEAR_DISTANCE || e.clientX > window.innerWidth + TEAR_DISTANCE;
    drag.torn = outside;
    drag.el.classList.toggle("torn", outside);
    if (outside) return;
    const others = tabs().filter((t) => t !== drag!.el);
    const at = insertionIndex(others.map((t) => t.getBoundingClientRect().left + t.offsetWidth / 2), e.clientX);
    const before = others[at] ?? strip.querySelector("#new-tab");
    if (before !== drag.el.nextElementSibling) strip.insertBefore(drag.el, before);
  });

  const finish = (e: PointerEvent, cancelled: boolean) => {
    const d = drag;
    drag = null;
    if (!d) return;
    d.el.classList.remove("dragging", "torn");
    if (!d.moved) return;
    swallowClick = true; // o clique que o navegador gera ao soltar não deve ativar a aba
    setTimeout(() => (swallowClick = false));
    if (cancelled) return;
    if (d.torn) {
      const dpr = window.devicePixelRatio || 1;
      hooks.onTearOff(d.id, Math.round(e.screenX * dpr), Math.round(e.screenY * dpr));
    } else if (orderOf() !== d.order) {
      hooks.onReorder(tabs().map((t) => t.dataset.id!));
    }
  };
  strip.addEventListener("pointerup", (e) => finish(e, false));
  strip.addEventListener("pointercancel", (e) => finish(e, true));
  strip.addEventListener("click", (e) => swallowClick && (e.stopPropagation(), e.preventDefault()), true);
}
