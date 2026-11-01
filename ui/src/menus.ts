import type { Language } from "./api";
import { type MenuItem, closeMenu, showMenu } from "./popup";

export interface MenuActions {
  newNote(): void;
  openFile(): void;
  save(): void;
  saveAs(): void;
  closeTab(): void;
  exit(): void;
  undo(): void;
  redo(): void;
  selectAll(): void;
  find(): void;
  replace(): void;
  gotoLine(): void;
  togglePreview(): void;
  toggleWrap(): void;
  setLanguage(l: Language): void;
  /** Estado atual para marcar checks e desabilitar itens. */
  current(): { language: Language; previewAvailable: boolean; previewOn: boolean; wrap: boolean };
}

export function languageItems(a: MenuActions): MenuItem[] {
  const cur = a.current().language;
  const mk = (label: string, l: Language): MenuItem => ({
    label,
    checked: cur === l,
    action: () => a.setLanguage(l),
  });
  return [mk("Automático", "auto"), "sep", mk("Texto simples", "plain"), mk("Markdown", "markdown")];
}

export function mountMenuBar(root: HTMLElement, a: MenuActions) {
  const menus: { label: string; items: () => MenuItem[] }[] = [
    {
      label: "Arquivo",
      items: () => [
        { label: "Novo", shortcut: "Ctrl+N", action: a.newNote },
        { label: "Abrir…", shortcut: "Ctrl+O", action: a.openFile },
        "sep",
        { label: "Salvar", shortcut: "Ctrl+S", action: a.save },
        { label: "Salvar como…", shortcut: "Ctrl+Shift+S", action: a.saveAs },
        "sep",
        { label: "Fechar", shortcut: "Ctrl+W", action: a.closeTab },
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
          {
            label: "Preview do markdown",
            shortcut: "Ctrl+E",
            checked: c.previewOn,
            disabled: !c.previewAvailable,
            action: a.togglePreview,
          },
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
