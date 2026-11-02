export type MenuItem =
  | "sep"
  | {
      label: string;
      shortcut?: string;
      checked?: boolean;
      disabled?: boolean;
      /** Submenu: abre ao lado ao passar o mouse ou clicar. */
      submenu?: MenuItem[];
      action?: () => void;
    };

let close: (() => void) | null = null;

export function closeMenu() {
  close?.();
}

/** Abre um menu suspenso ancorado em `anchor`. Devolve a função que o fecha. */
export function showMenu(
  anchor: HTMLElement,
  items: MenuItem[],
  placement: "below" | "above" = "below",
  onClose?: () => void,
): () => void {
  closeMenu();
  const open: HTMLElement[] = []; // menu principal e submenus abertos, do mais fundo para o raso

  const build = (list: MenuItem[], depth: number): HTMLElement => {
    const el = document.createElement("div");
    el.className = "menu";
    el.role = "menu";
    for (const it of list) {
      if (it === "sep") {
        const hr = document.createElement("div");
        hr.className = "menu-sep";
        el.append(hr);
        continue;
      }
      const row = document.createElement("div");
      row.className = "menu-item" + (it.disabled ? " disabled" : "");
      row.role = "menuitem";
      const check = document.createElement("span");
      check.className = "menu-check";
      check.textContent = it.checked ? "✓" : "";
      const label = document.createElement("span");
      label.className = "menu-label";
      label.textContent = it.label;
      const key = document.createElement("span");
      key.className = "menu-key";
      key.textContent = it.submenu ? "▸" : (it.shortcut ?? "");
      row.append(check, label, key);
      const closeDeeper = () => {
        while (open.length > depth + 1) open.pop()!.remove();
      };
      if (it.submenu && !it.disabled) {
        const openSub = () => {
          closeDeeper();
          const sub = build(it.submenu!, depth + 1);
          document.body.append(sub);
          const rr = row.getBoundingClientRect();
          const left = rr.right + sub.offsetWidth + 4 > window.innerWidth ? rr.left - sub.offsetWidth : rr.right;
          sub.style.left = `${Math.max(4, left)}px`;
          sub.style.top = `${Math.max(4, Math.min(rr.top - 4, window.innerHeight - sub.offsetHeight - 4))}px`;
          open.push(sub);
        };
        row.addEventListener("mouseenter", openSub);
        row.addEventListener("click", openSub);
      } else {
        row.addEventListener("mouseenter", closeDeeper);
        if (!it.disabled && it.action) {
          const act = it.action;
          row.addEventListener("click", () => {
            closeMenu();
            act();
          });
        }
      }
      el.append(row);
    }
    return el;
  };

  const el = build(items, 0);
  open.push(el);
  document.body.append(el);

  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  el.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - w - 4))}px`;
  el.style.top =
    placement === "below"
      ? `${Math.max(4, Math.min(r.bottom, window.innerHeight - h - 4))}px`
      : `${Math.max(4, r.top - h)}px`;

  const onDown = (e: MouseEvent) => {
    const t = e.target as Node;
    if (!open.some((m) => m.contains(t)) && !anchor.contains(t)) closeMenu();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    }
  };
  setTimeout(() => document.addEventListener("mousedown", onDown, true));
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", closeMenu);

  close = () => {
    for (const m of open) m.remove();
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", closeMenu);
    close = null;
    onClose?.();
  };
  return close;
}

/** Abre um menu de contexto no ponto (x, y) da janela. */
export function showMenuAt(x: number, y: number, items: MenuItem[]): () => void {
  const anchor = document.createElement("div");
  anchor.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:0;height:0`;
  document.body.append(anchor);
  return showMenu(anchor, items, "below", () => anchor.remove());
}
