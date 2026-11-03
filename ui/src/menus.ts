import type { Language, ViewMode } from "./api";
import { type CsvSettings, DELIMITERS, delimiterName } from "./csv/settings";
import type { Lang } from "./language";
import { type MenuItem, closeMenu, showMenu } from "./popup";
import { ZOOM_PRESETS } from "./zoom";

export interface MenuActions {
  newNote(): void;
  newWindow(): void;
  tabToNewWindow(): void;
  openFile(): void;
  save(): void;
  saveAs(): void;
  closeTab(): void;
  reopenTab(): void;
  history(): void;
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
  splitRight(): void;
  splitDown(): void;
  setLanguage(l: Language): void;
  checkUpdates(): void;
  releaseNotes(): void;
  formatJson(): void;
  formatJsonSelection(): void;
  minifyJson(): void;
  sortJson(): void;
  setJsonIndent(v: string): void;
  setCsvDelimiter(v: string): void;
  setCsvHeader(v: boolean): void;
  setCsvDecimal(v: string): void;
  expandJson(): void;
  collapseJson(): void;
  copyJsonPath(): void;
  readerLoad(): void;
  readerLocate(): void;
  readerQuote(): void;
  zoomIn(): void;
  zoomOut(): void;
  setZoom(percent: number): void;
  /** Estado atual para marcar checks e desabilitar itens. */
  current(): {
    language: Language;
    lang: Lang;
    view: ViewMode;
    detached: boolean;
    previewAvailable: boolean;
    wrap: boolean;
    jsonIndent: string;
    /** Escolhas do CSV da aba e o separador que a detecção achou (vale quando a escolha é automática). */
    csv: CsvSettings;
    csvDetected: string;
    hasSelection: boolean;
    treeOn: boolean;
    zoom: number;
  };
}

/** Linguagens cuja visão renderizada fica sempre ao lado do código (diagrama, árvore). */
export const sideOnly = (l: Lang) => l === "dbml" || l === "json";

/** Opções de visão do arquivo (menu Visualizar e botão da barra de status). */
export function viewItems(a: MenuActions): MenuItem[] {
  const c = a.current();
  const off = !c.previewAvailable;
  const item = (label: string, mode: ViewMode, shortcut?: string): MenuItem => ({
    label,
    shortcut,
    checked: !c.detached && (c.view === mode || (sideOnly(c.lang) && mode === "split" && c.view === "rendered")),
    disabled: off,
    action: () => a.setView(mode),
  });
  const detach: MenuItem[] = [
    "sep",
    { label: c.lang === "dbml" ? "Diagrama em janela separada" : c.lang === "json" ? "Árvore em janela separada" : "Preview em janela separada", checked: c.detached, disabled: off, action: a.toggleDetached },
  ];
  if (c.lang === "dbml") return [item("Somente código", "source"), item("Código e diagrama lado a lado", "split", "Ctrl+E"), ...detach];
  if (c.lang === "json") return [item("Somente código", "source"), item("Código e árvore lado a lado", "split", "Ctrl+E"), ...detach];
  if (c.lang === "csv") return [item("Somente tabela", "rendered", "Ctrl+E"), item("Somente código", "source"), item("Tabela e código lado a lado", "split", "Ctrl+Shift+E")];
  return [
    item("Somente código", "source"),
    item("Preview no próprio texto", "rendered", "Ctrl+E"),
    item("Código e preview lado a lado", "split", "Ctrl+Shift+E"),
    ...detach,
  ];
}

/** Submenu "Exportar" do markdown (Arquivo, menu da aba e menu do conteúdo). */
export function exportItem(a: Pick<MenuActions, "exportHtml" | "exportPdf" | "copyHtml">, enabled: boolean): MenuItem {
  return {
    label: "Exportar",
    disabled: !enabled,
    submenu: [
      { label: "HTML…", action: a.exportHtml },
      { label: "PDF…", action: a.exportPdf },
      "sep",
      { label: "Copiar como HTML", action: a.copyHtml },
    ],
  };
}

/** Itens do menu "JSON" (também usados no botão direito sobre o código). */
export function jsonItems(a: MenuActions): MenuItem[] {
  const c = a.current();
  const off = c.lang !== "json";
  const indent = (label: string, v: string): MenuItem => ({ label, checked: c.jsonIndent === v, disabled: off, action: () => a.setJsonIndent(v) });
  return [
    { label: "Formatar documento", shortcut: "Alt+Shift+F", disabled: off, action: a.formatJson },
    { label: "Formatar seleção", disabled: off || !c.hasSelection, action: a.formatJsonSelection },
    { label: "Minificar", disabled: off, action: a.minifyJson },
    { label: "Ordenar chaves e formatar", disabled: off, action: a.sortJson },
    "sep",
    { label: "Indentação", disabled: off, submenu: [indent("2 espaços", "2"), indent("4 espaços", "4"), indent("Tab", "tab")] },
    "sep",
    { label: "Expandir tudo", disabled: off || !c.treeOn, action: a.expandJson },
    { label: "Recolher tudo", disabled: off || !c.treeOn, action: a.collapseJson },
    { label: "Copiar caminho do cursor", disabled: off || !c.treeOn, action: a.copyJsonPath },
  ];
}

/** Itens do menu "CSV": separador (automático ou escolhido), cabeçalho e separador decimal. */
export function csvItems(a: MenuActions): MenuItem[] {
  const c = a.current();
  const s = c.csv;
  return [
    {
      label: "Separador",
      submenu: [
        { label: `Automático (${delimiterName(c.csvDetected)})`, checked: s.delimiter === "auto", action: () => a.setCsvDelimiter("auto") },
        "sep",
        ...DELIMITERS.map((d): MenuItem => ({ label: d.label, checked: s.delimiter === d.value, action: () => a.setCsvDelimiter(d.value) })),
      ],
    },
    { label: "Primeira linha é o cabeçalho", checked: s.header, action: () => a.setCsvHeader(!s.header) },
    {
      label: "Separador decimal",
      submenu: [
        { label: "Ponto ( . )", checked: s.decimal === ".", action: () => a.setCsvDecimal(".") },
        { label: "Vírgula ( , )", checked: s.decimal === ",", action: () => a.setCsvDecimal(",") },
      ],
    },
    "sep",
    ...viewItems(a),
    "sep",
    ...textItems(a),
  ];
}

/** Itens de um texto qualquer (também o fim do menu do CSV). */
function textItems(a: MenuActions): MenuItem[] {
  return [
    { label: "Quebra de linha", checked: a.current().wrap, action: a.toggleWrap },
    "sep",
    { label: "Localizar…", shortcut: "Ctrl+F", action: a.find },
    { label: "Substituir…", action: a.replace },
    { label: "Ir para linha…", shortcut: "Ctrl+Alt+G", action: a.gotoLine },
  ];
}

/** Nome do menu de ações do tipo de arquivo da aba ativa (muda com a linguagem). */
export const LANG_MENU: Record<Lang, string> = { plain: "Texto", markdown: "Markdown", dbml: "DBML", json: "JSON", csv: "CSV", pdf: "PDF", epub: "EPUB" };

/** Itens do menu do tipo de arquivo: só o que faz sentido para ele. */
export function langMenuItems(a: MenuActions): MenuItem[] {
  const c = a.current();
  switch (c.lang) {
    case "json":
      return jsonItems(a);
    case "csv":
      return csvItems(a);
    case "markdown":
      return [
        { label: "Exportar como HTML…", action: a.exportHtml },
        { label: "Exportar como PDF…", action: a.exportPdf },
        "sep",
        { label: "Copiar como HTML", action: a.copyHtml },
        "sep",
        ...viewItems(a),
      ];
    case "dbml":
      return viewItems(a);
    case "epub":
      return [
        { label: "Carregar EPUB", action: a.readerLoad },
        { label: "Localizar arquivo…", action: a.readerLocate },
        "sep",
        { label: "Buscar no livro…", shortcut: "Ctrl+F", action: a.find },
        { label: "Copiar seleção como citação", shortcut: "Ctrl+Shift+C", action: a.readerQuote },
      ];
    case "pdf":
      return [
        { label: "Carregar PDF", action: a.readerLoad },
        { label: "Localizar arquivo…", action: a.readerLocate },
        "sep",
        { label: "Buscar no documento…", shortcut: "Ctrl+F", action: a.find },
        { label: "Copiar seleção como citação", shortcut: "Ctrl+Shift+C", action: a.readerQuote },
      ];
    default:
      return textItems(a);
  }
}

/** Opções de zoom (submenu de Visualizar e lista aberta pela barra de status). */
export function zoomItems(a: MenuActions): MenuItem[] {
  const z = a.current().zoom;
  return [
    { label: "Aumentar", shortcut: "Ctrl++", action: a.zoomIn },
    { label: "Diminuir", shortcut: "Ctrl+-", action: a.zoomOut },
    "sep",
    ...ZOOM_PRESETS.map((p): MenuItem => ({ label: `${p}%`, checked: z === p, action: () => a.setZoom(p) })),
    "sep",
    { label: "Restaurar (100%)", shortcut: "Ctrl+0", action: () => a.setZoom(100) },
  ];
}

/** Submenu "Zoom" do menu Visualizar. */
export function zoomItem(a: MenuActions): MenuItem {
  return { label: `Zoom (${a.current().zoom}%)`, submenu: zoomItems(a) };
}

/** Reabrir a última aba fechada e abrir o histórico das anteriores. */
function reopenItems(a: MenuActions): MenuItem[] {
  return [
    { label: "Reabrir aba fechada", shortcut: "Ctrl+Shift+T", action: () => a.reopenTab() },
    { label: "Histórico de abas fechadas…", shortcut: "Ctrl+Shift+H", action: a.history },
  ];
}

export function languageItems(a: MenuActions): MenuItem[] {
  const cur = a.current().language;
  const mk = (label: string, l: Language): MenuItem => ({
    label,
    checked: cur === l,
    action: () => a.setLanguage(l),
  });
  return [mk("Automático", "auto"), "sep", mk("Texto simples", "plain"), mk("Markdown", "markdown"), mk("DBML", "dbml"), mk("JSON", "json"), mk("CSV", "csv")];
}

export function mountMenuBar(root: HTMLElement, a: MenuActions) {
  // janela reserva ou ainda carregando: não há aba ativa, então `current()` não pode ser chamado
  const langMenuLabel = () => {
    try {
      return LANG_MENU[a.current().lang];
    } catch {
      return LANG_MENU.plain;
    }
  };
  const md = () => a.current().lang === "markdown";
  const menus: { label: () => string; items: () => MenuItem[] }[] = [
    {
      label: () => "Arquivo",
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
        exportItem(a, md()),
        "sep",
        { label: "Sair", shortcut: "Alt+F4", action: a.exit },
      ],
    },
    {
      label: () => "Editar",
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
      label: () => "Visualizar",
      items: () => {
        const c = a.current();
        return [
          ...viewItems(a),
          "sep",
          { label: "Dividir à direita", shortcut: "Ctrl+\\", action: a.splitRight },
          { label: "Dividir abaixo", shortcut: "Ctrl+Shift+\\", action: a.splitDown },
          "sep",
          { label: "Quebra de linha", checked: c.wrap, action: a.toggleWrap },
          "sep",
          zoomItem(a),
        ];
      },
    },
    { label: () => "Linguagem", items: () => languageItems(a) },
    { label: langMenuLabel, items: () => langMenuItems(a) },
    {
      label: () => "Ajuda",
      items: () => [
        { label: "Ver nota de versão", action: a.releaseNotes },
        { label: "Verificar atualizações…", action: a.checkUpdates },
      ],
    },
  ];

  let open: HTMLElement | null = null;
  const buttons = menus.map((m) => {
    const b = document.createElement("button");
    b.className = "menubtn";
    b.textContent = m.label();
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
  /** Reescreve os nomes (o menu do tipo de arquivo muda com a aba ativa). */
  return {
    refresh() {
      menus.forEach((m, i) => {
        const t = m.label();
        if (buttons[i].textContent !== t) buttons[i].textContent = t;
      });
    },
  };
}
