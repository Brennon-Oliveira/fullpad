export type MenuItem =
  | "sep"
  | {
      label: string;
      shortcut?: string;
      checked?: boolean;
      disabled?: boolean;
      action: () => void;
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
  const el = document.createElement("div");
  el.className = "menu";
  el.role = "menu";
  for (const it of items) {
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
    key.textContent = it.shortcut ?? "";
    row.append(check, label, key);
    if (!it.disabled) {
      row.addEventListener("click", () => {
        closeMenu();
        it.action();
      });
    }
    el.append(row);
  }
  document.body.append(el);

  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  el.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - w - 4))}px`;
  el.style.top =
    placement === "below"
      ? `${r.bottom}px`
      : `${Math.max(4, r.top - h)}px`;

  const onDown = (e: MouseEvent) => {
    const t = e.target as Node;
    if (!el.contains(t) && !anchor.contains(t)) closeMenu();
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
    el.remove();
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", closeMenu);
    close = null;
    onClose?.();
  };
  return close;
}
