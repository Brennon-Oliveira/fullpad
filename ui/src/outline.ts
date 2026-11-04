import { type OutlineItem, railItems } from "./outlinecore";

export type OutlineSide = "left" | "right";

export interface OutlineConfig {
  /** O usuário quer ver o sumário (Visualizar > Sumário). */
  enabled: boolean;
  /** Fixo ao lado do arquivo, em vez de só barrinhas que abrem ao passar o mouse. */
  pinned: boolean;
  side: OutlineSide;
}

export interface Outline {
  /** Itens do arquivo atual; `null` ou vazio esconde o sumário. */
  set(items: OutlineItem[] | null): void;
  /** Item atual (destacado). */
  setActive(i: number): void;
  config(c: OutlineConfig): void;
}

const PIN_ICON = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M6 2.5v11"/></svg>`;

/**
 * Sumário de um painel (estilo Notion): barrinhas na borda que viram um cartão com os títulos ao passar
 * o mouse, ou o mesmo cartão fixo ao lado do arquivo. `root` é filho do corpo do painel.
 */
export function createOutline(root: HTMLElement, host: { goto(pos: number): void; togglePinned(): void }): Outline {
  root.className = "outline";
  root.hidden = true;
  const hot = document.createElement("div");
  hot.className = "ol-hot";
  const rail = document.createElement("div");
  rail.className = "ol-rail";
  const card = document.createElement("div");
  card.className = "ol-card";
  const head = document.createElement("div");
  head.className = "ol-head";
  const title = document.createElement("span");
  title.textContent = "Sumário";
  const pin = document.createElement("button");
  pin.className = "ol-pin";
  pin.type = "button";
  pin.innerHTML = PIN_ICON;
  pin.addEventListener("click", () => host.togglePinned());
  head.append(title, pin);
  const list = document.createElement("div");
  list.className = "ol-list";
  card.append(head, list);
  hot.append(rail, card);
  root.append(hot);

  let items: OutlineItem[] = [];
  let active = 0;
  let cfg: OutlineConfig = { enabled: true, pinned: false, side: "left" };

  const paintActive = () => {
    list.querySelectorAll(".ol-item").forEach((el, i) => el.classList.toggle("on", i === active));
    // rola só a lista (scrollIntoView poderia rolar o painel inteiro)
    const row = list.querySelector<HTMLElement>(".on");
    if (row) {
      if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
      else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
    }
    const rails = railItems(items);
    const cur = items[active];
    let on = -1;
    rails.forEach((r, i) => cur && r.pos <= cur.pos && (on = i));
    rail.querySelectorAll(".ol-bar").forEach((el, i) => el.classList.toggle("on", i === Math.max(on, 0)));
  };

  const paint = () => {
    root.hidden = !(cfg.enabled && items.length > 0);
    root.classList.toggle("pinned", cfg.pinned);
    root.classList.toggle("left", cfg.side === "left");
    root.classList.toggle("right", cfg.side === "right");
    pin.title = cfg.pinned ? "Soltar (mostrar só as barrinhas)" : "Manter aberto";
    pin.classList.toggle("on", cfg.pinned);
  };

  return {
    set(next) {
      items = next ?? [];
      list.replaceChildren(
        ...items.map((it) => {
          const row = document.createElement("div");
          row.className = "ol-item";
          row.style.paddingLeft = `${10 + it.depth * 14}px`;
          row.textContent = it.label;
          row.title = it.label;
          row.addEventListener("click", () => host.goto(it.pos));
          return row;
        }),
      );
      rail.replaceChildren(
        ...railItems(items).map((it) => {
          const bar = document.createElement("div");
          bar.className = "ol-bar";
          bar.style.width = `${Math.max(8, 20 - it.depth * 5)}px`;
          return bar;
        }),
      );
      active = Math.min(active, Math.max(0, items.length - 1));
      paint();
      paintActive();
    },
    setActive(i) {
      if (i === active) return;
      active = i;
      paintActive();
    },
    config(c) {
      cfg = c;
      paint();
    },
  };
}
