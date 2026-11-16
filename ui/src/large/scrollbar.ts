// A barra de rolagem do ARQUIVO (não da janela de lotes): o polegar mostra onde a tela está entre
// todas as linhas, arrastá-lo ou clicar na trilha vai para a linha (`LargeTab.goto`, que só soma as
// linhas dos lotes). O editor continua rolando sozinho dentro da janela; esta barra substitui a nativa,
// que só enxergaria os poucos lotes carregados.
import { lineAtFraction, lineFraction } from "./model";

export interface ScrollDeps {
  /** Total de linhas (pode crescer enquanto o índice avança). */
  total(): number;
  /** Linha (a partir de 0) no topo da tela. */
  line(): number;
  /** Linhas que cabem na tela (para o tamanho do polegar). */
  visible(): number;
  /** Ir para a linha (chamado enquanto arrasta). */
  jump(line: number): void;
}

const MIN_THUMB = 28;
const nf = new Intl.NumberFormat("pt-BR");

/** Posição e altura do polegar na trilha. */
export function thumbGeometry(trackHeight: number, total: number, visible: number, topLine: number): { top: number; height: number } {
  const height = Math.min(trackHeight, Math.max(MIN_THUMB, total > 0 ? (visible / total) * trackHeight : trackHeight));
  const room = Math.max(0, trackHeight - height);
  return { top: lineFraction(topLine, total) * room, height };
}

/** Fração (0 a 1) da trilha em que o ponteiro está, descontando o meio do polegar. */
export function fractionAt(pointerY: number, trackTop: number, trackHeight: number, thumbHeight: number): number {
  const room = trackHeight - thumbHeight;
  if (room <= 0) return 0;
  return Math.min(1, Math.max(0, (pointerY - trackTop - thumbHeight / 2) / room));
}

export interface LargeScroll {
  el: HTMLElement;
  update(): void;
  show(on: boolean): void;
}

export function mountLargeScroll(parent: HTMLElement, deps: ScrollDeps): LargeScroll {
  const el = document.createElement("div");
  el.className = "lscroll";
  el.hidden = true;
  const thumb = document.createElement("div");
  thumb.className = "lthumb";
  el.append(thumb);
  parent.append(el);
  let dragging = false;

  const place = (line: number) => {
    const box = el.getBoundingClientRect();
    const g = thumbGeometry(box.height, deps.total(), deps.visible(), line);
    thumb.style.height = `${g.height}px`;
    thumb.style.transform = `translateY(${g.top}px)`;
    thumb.title = `Linha ${nf.format(line + 1)}`;
  };

  function update() {
    if (!el.hidden && !dragging) place(deps.line());
  }

  function jumpTo(clientY: number) {
    const box = el.getBoundingClientRect();
    const f = fractionAt(clientY, box.top, box.height, thumb.offsetHeight || MIN_THUMB);
    const line = lineAtFraction(f, deps.total());
    deps.jump(line);
    place(line); // o polegar acompanha o ponteiro na hora, sem esperar a janela carregar
  }

  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    el.setPointerCapture?.(e.pointerId);
    el.classList.add("dragging");
    jumpTo(e.clientY);
  });
  el.addEventListener("pointermove", (e) => {
    if (dragging) jumpTo(e.clientY);
  });
  const stop = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove("dragging");
    el.releasePointerCapture?.(e.pointerId);
    update();
  };
  el.addEventListener("pointerup", stop);
  el.addEventListener("pointercancel", stop);

  return {
    el,
    update,
    show(on) {
      el.hidden = !on;
      if (on) update();
    },
  };
}
