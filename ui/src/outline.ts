import { type OutlineItem, filterOutline, railItems } from "./outlinecore";

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

const SEARCH_ICON = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>`;
const PIN_ICON = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M6 2.5v11"/></svg>`;

/**
 * Sumário de um painel (estilo Notion): barrinhas na borda que viram um cartão com os títulos ao passar
 * o mouse, ou o mesmo cartão fixo ao lado do arquivo. `root` é filho do corpo do painel.
 */
export function createOutline(root: HTMLElement, host: { goto(pos: number): void; togglePinned(): void; focusEditor?(): void }): Outline {
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
  const find = document.createElement("button");
  find.className = "ol-find";
  find.type = "button";
  find.title = "Buscar no sumário";
  find.innerHTML = SEARCH_ICON;
  const tools = document.createElement("span");
  tools.className = "ol-tools";
  tools.append(find, pin);
  head.append(title, tools);
  // campo de busca: só com o sumário fixo; filtra a lista do sumário e nada além dela
  const search = document.createElement("input");
  search.className = "ol-search";
  search.type = "search";
  search.placeholder = "Buscar no sumário…";
  search.spellcheck = false;
  const list = document.createElement("div");
  list.className = "ol-list";
  card.append(head, search, list);
  hot.append(rail, card);
  root.append(hot);

  let items: OutlineItem[] = [];
  let active = 0;
  let cfg: OutlineConfig = { enabled: true, pinned: false, side: "left" };

  let wantFocus = false; // a lupa fixou o sumário: o campo ganha o foco quando ele aparecer

  const paintActive = () => {
    list.querySelectorAll<HTMLElement>(".ol-item").forEach((el) => el.classList.toggle("on", Number(el.dataset.i) === active));
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
    if (!cfg.pinned && search.value) {
      search.value = ""; // sem o fixo não há campo: a lista volta inteira
      renderList();
    }
    if (cfg.pinned && wantFocus) search.focus();
    wantFocus = false;
    pin.title = cfg.pinned ? "Soltar (mostrar só as barrinhas)" : "Manter aberto";
    pin.classList.toggle("on", cfg.pinned);
  };

  /** Desenha a lista: todos os itens, ou só os que casam com o campo de busca. */
  const renderList = () => {
    const shown = filterOutline(items, search.value);
    if (shown.length === 0 && items.length > 0) {
      const empty = document.createElement("div");
      empty.className = "ol-empty";
      empty.textContent = "Nada encontrado";
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(
      ...shown.map((i) => {
        const it = items[i];
        const row = document.createElement("div");
        row.className = "ol-item";
        row.dataset.i = String(i);
        row.style.paddingLeft = `${10 + it.depth * 14}px`;
        row.textContent = it.label;
        row.title = it.label;
        row.addEventListener("click", () => host.goto(it.pos));
        return row;
      }),
    );
    paintActive();
  };

  find.addEventListener("click", () => {
    if (cfg.pinned) search.focus();
    else {
      wantFocus = true;
      host.togglePinned();
    }
  });
  search.addEventListener("input", renderList);
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (search.value) {
        search.value = "";
        renderList();
      } else host.focusEditor?.();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const first = items[filterOutline(items, search.value)[0]];
      if (first && search.value.trim()) host.goto(first.pos);
    }
  });

  return {
    set(next) {
      items = next ?? [];
      active = Math.min(active, Math.max(0, items.length - 1));
      renderList();
      rail.replaceChildren(
        ...railItems(items).map((it) => {
          const bar = document.createElement("div");
          bar.className = "ol-bar";
          bar.style.width = `${Math.max(8, 20 - it.depth * 5)}px`;
          return bar;
        }),
      );
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
