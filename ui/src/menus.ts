import type { Language, ViewMode } from "./api";
import type { Lang } from "./language";
import { type MenuItem, closeMenu, showMenu } from "./popup";

export interface MenuActions {
  newNote(): void;
  newWindow(): void;
  tabToNewWindow(): void;
  openFile(): void;
  save(): void;
  saveAs(): void;
  closeTab(): void;
  reopenTab(id?: string): void;
  /** Abas fechadas recentemente (a mais nova primeiro). */
  closedTabs(): { id: string; title: string }[];
  exportHtml(): void;
  exportPdf(): void;
  copyHtml(): void;
  exit(): void;
  undo(): void;
  redo(): void;
  selectAll(): void;
  find(): void;
  replace(): void;
  gotoLine(): void;
  togglePreview(): void;
  toggleSplit(): void;
  setView(m: ViewMode): void;
  toggleDetached(): void;
  toggleWrap(): void;
  setLanguage(l: Language): void;
  /** Estado atual para marcar checks e desabilitar itens. */
  current(): { language: Language; lang: Lang; view: ViewMode; detached: boolean; previewAvailable: boolean; wrap: boolean };
}

/** Opções de visão do arquivo (menu Visualizar e botão da barra de status). */
export function viewItems(a: MenuActions): MenuItem[] {
  const c = a.current();
  const off = !c.previewAvailable;
  const item = (label: string, mode: ViewMode, shortcut?: string): MenuItem => ({
    label,
    shortcut,
    checked: !c.detached && (c.view === mode || (c.lang === "dbml" && mode === "split" && c.view === "rendered")),
    disabled: off,
    action: () => a.setView(mode),
  });
  const detach: MenuItem[] = [
    "sep",
    { label: c.lang === "dbml" ? "Diagrama em janela separada" : "Preview em janela separada", checked: c.detached, disabled: off, action: a.toggleDetached },
  ];
  if (c.lang === "dbml") return [item("Somente código", "source"), item("Código e diagrama lado a lado", "split", "Ctrl+E"), ...detach];
  return [
    item("Somente código", "source"),
    item("Preview no próprio texto", "rendered", "Ctrl+E"),
    item("Código e preview lado a lado", "split", "Ctrl+Shift+E"),
    ...detach,
  ];
}

/** "Reabrir aba fechada" e a lista das últimas fechadas. */
function reopenItems(a: MenuActions): MenuItem[] {
  const closed = a.closedTabs();
  const items: MenuItem[] = [
    { label: "Reabrir aba fechada", shortcut: "Ctrl+Shift+T", disabled: closed.length === 0, action: () => a.reopenTab() },
  ];
  if (closed.length > 1) {
    items.push("sep");
    for (const c of closed.slice(0, 8)) items.push({ label: c.title || "Nova nota", action: () => a.reopenTab(c.id) });
    items.push("sep");
  }
  return items;
}

export function languageItems(a: MenuActions): MenuItem[] {
  const cur = a.current().language;
  const mk = (label: string, l: Language): MenuItem => ({
    label,
    checked: cur === l,
    action: () => a.setLanguage(l),
  });
  return [mk("Automático", "auto"), "sep", mk("Texto simples", "plain"), mk("Markdown", "markdown"), mk("DBML", "dbml")];
}

export function mountMenuBar(root: HTMLElement, a: MenuActions) {
  const md = () => a.current().lang === "markdown";
  const menus: { label: string; items: () => MenuItem[] }[] = [
    {
      label: "Arquivo",
      items: () => [
        { label: "Novo", shortcut: "Ctrl+N", action: a.newNote },
        { label: "Nova janela", shortcut: "Ctrl+Shift+N", action: a.newWindow },
        { label: "Mover aba para uma nova janela", action: a.tabToNewWindow },
        { label: "Abrir…", shortcut: "Ctrl+O", action: a.openFile },
        "sep",
        { label: "Salvar", shortcut: "Ctrl+S", action: a.save },
        { label: "Salvar como…", shortcut: "Ctrl+Shift+S", action: a.saveAs },
        "sep",
        { label: "Fechar", shortcut: "Ctrl+W", action: a.closeTab },
        ...reopenItems(a),
        "sep",
        { label: "Exportar como HTML…", disabled: !md(), action: a.exportHtml },
        { label: "Exportar como PDF…", disabled: !md(), action: a.exportPdf },
        { label: "Copiar como HTML", disabled: !md(), action: a.copyHtml },
        "sep",
        { label: "Sair", shortcut: "Alt+F4", action: a.exit },
      ],
    },
    {
      label: "Editar",
      items: () => [
        { label: "Desfazer", shortcut: "Ctrl+Z", action: a.undo },
        { label: "Refazer", shortcut: "Ctrl+Y", action: a.redo },
        "sep",
        { label: "Selecionar tudo", shortcut: "Ctrl+A", action: a.selectAll },
        "sep",
        { label: "Localizar…", shortcut: "Ctrl+F", action: a.find },
        { label: "Substituir…", action: a.replace },
        { label: "Ir para linha…", shortcut: "Ctrl+Alt+G", action: a.gotoLine },
      ],
    },
    {
      label: "Visualizar",
      items: () => {
        const c = a.current();
        return [
          ...viewItems(a),
          "sep",
          { label: "Quebra de linha", checked: c.wrap, action: a.toggleWrap },
        ];
      },
    },
    { label: "Linguagem", items: () => languageItems(a) },
  ];

  let open: HTMLElement | null = null;
  const buttons = menus.map((m) => {
    const b = document.createElement("button");
    b.className = "menubtn";
    b.textContent = m.label;
    const openIt = () => {
      open?.classList.remove("open");
      open = b;
      b.classList.add("open");
      showMenu(b, m.items(), "below", () => {
        b.classList.remove("open");
        if (open === b) open = null;
      });
    };
    b.addEventListener("mousedown", (e) => {
      e.preventDefault(); // não rouba o foco do editor
      if (open === b) closeMenu();
      else openIt();
    });
    b.addEventListener("mouseenter", () => {
      if (open && open !== b) openIt();
    });
    return b;
  });
  root.replaceChildren(...buttons);
}
