import type { Language, ViewMode } from "./api";
import { type CsvSettings, DELIMITERS, delimiterName } from "./csv/settings";
import { NO_CODE_LANG, pickableLanguages } from "./codelangs";
import type { Lang } from "./language";
import { type MenuItem, closeMenu, showMenu } from "./popup";
import { BLOCK_LABELS } from "./mdformat";
import { ZOOM_PRESETS } from "./zoom";

export interface MenuActions {
  newNote(): void;
  newWindow(): void;
  tabToNewWindow(): void;
  openFile(): void;
  save(): void;
  saveAs(): void;
  saveAll(): void;
  globalSearch(): void;
  /** `undefined` volta ao automático (extensão); `NO_CODE_LANG` desliga o destaque. */
  setCodeLang(v: string | undefined): void;
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
  /** Formata o markdown pela seleção (`bold`, `italic`, `strike`, `code`, `link`, `clear` ou um tipo de bloco). */
  formatMd(id: string): void;
  openPalette(): void;
  gotoSymbol(): void;
  commandPalette(): void;
  togglePreview(): void;
  toggleSplit(): void;
  setView(m: ViewMode): void;
  toggleDetached(): void;
  toggleWrap(): void;
  toggleLineNumbers(): void;
  toggleOutline(): void;
  toggleOutlinePinned(): void;
  setOutlineSide(side: "left" | "right"): void;
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
    /** Falso na nota de versão e nas abas de leitura: Salvar e Salvar como ficam desabilitados. */
    canSave: boolean;
    wrap: boolean;
    lineNumbers: boolean;
    outline: { on: boolean; pinned: boolean; side: "left" | "right" };
    jsonIndent: string;
    /** Escolhas do CSV da aba e o separador que a detecção achou (vale quando a escolha é automática). */
    csv: CsvSettings;
    csvDetected: string;
    hasSelection: boolean;
    /** Destaque de sintaxe do texto: o escolhido à mão (`undefined` = automático) e o que vale agora (`null` = nenhum). */
    codeLang: { chosen: string | undefined; effective: string | null };
    treeOn: boolean;
    zoom: number;
  };
}

/** Linguagens cuja visão renderizada fica sempre ao lado do código (diagrama, árvore). */
/** Formatos que mostram uma árvore ao lado do código (JSON, YAML e TOML). */
export const isTree = (l: Lang) => l === "json" || l === "yaml" || l === "toml";
export const sideOnly = (l: Lang) => l === "dbml" || isTree(l);

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
    { label: c.lang === "dbml" ? "Diagrama em janela separada" : isTree(c.lang) ? "Árvore em janela separada" : "Preview em janela separada", checked: c.detached, disabled: off, action: a.toggleDetached },
  ];
  if (c.lang === "dbml") return [item("Somente código", "source"), item("Código e diagrama lado a lado", "split", "Ctrl+E"), ...detach];
  if (c.lang === "json") return [item("Somente código", "source"), item("Código e árvore lado a lado", "split", "Ctrl+E"), ...detach];
  if (isTree(c.lang)) return [item("Somente código", "source"), item("Código e árvore lado a lado", "split", "Ctrl+E")];
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
/** Lista de linguagens de destaque (Lang) de um arquivo de texto: automático, texto puro e as demais. */
export function codeLangItems(a: MenuActions): MenuItem[] {
  const { chosen, effective } = a.current().codeLang;
  const names = pickableLanguages.map((l) => l.name).sort((x, y) => x.localeCompare(y, "pt-BR"));
  return [
    { label: `Automático${chosen === undefined && effective ? ` (${effective})` : ""}`, checked: chosen === undefined, action: () => a.setCodeLang(undefined) },
    { label: "Texto puro", checked: chosen === NO_CODE_LANG, action: () => a.setCodeLang(NO_CODE_LANG) },
    "sep",
    ...names.map((n): MenuItem => ({ label: n, checked: chosen === n, action: () => a.setCodeLang(n) })),
  ];
}

function textItems(a: MenuActions): MenuItem[] {
  return [
    ...(a.current().lang === "plain" ? [{ label: `Lang: ${a.current().codeLang.effective ?? "Texto"}`, submenu: codeLangItems(a) } as MenuItem, "sep" as const] : []),
    { label: "Quebra de linha", checked: a.current().wrap, action: a.toggleWrap },
    { label: "Números de linha", checked: a.current().lineNumbers, action: a.toggleLineNumbers },
    "sep",
    { label: "Localizar…", shortcut: "Ctrl+F", action: a.find },
    { label: "Substituir…", action: a.replace },
    { label: "Ir para linha…", shortcut: "Ctrl+G", action: a.gotoLine },
  ];
}

/** Nome do menu de ações do tipo de arquivo da aba ativa (muda com a linguagem). */
export const LANG_MENU: Record<Lang, string> = { plain: "Texto", markdown: "Markdown", dbml: "DBML", json: "JSON", csv: "CSV", yaml: "YAML", toml: "TOML", pdf: "PDF", epub: "EPUB" };

/** Itens do menu "YAML"/"TOML": só árvore e caminho (não reescrevemos o texto: perderia comentários). */
export function treeItems(a: MenuActions): MenuItem[] {
  const on = a.current().treeOn;
  return [
    ...viewItems(a),
    "sep",
    { label: "Expandir tudo", disabled: !on, action: a.expandJson },
    { label: "Recolher tudo", disabled: !on, action: a.collapseJson },
    { label: "Copiar caminho do cursor", disabled: !on, action: a.copyJsonPath },
    "sep",
    ...textItems(a),
  ];
}

/** Submenu "Formatar" do markdown (os mesmos comandos da barra ao selecionar). */
export function formatItem(a: Pick<MenuActions, "formatMd">): MenuItem {
  return {
    label: "Formatar",
    submenu: [
      { label: "Negrito", shortcut: "Ctrl+B", action: () => a.formatMd("bold") },
      { label: "Itálico", shortcut: "Ctrl+I", action: () => a.formatMd("italic") },
      { label: "Tachado", shortcut: "Ctrl+Shift+X", action: () => a.formatMd("strike") },
      { label: "Código", action: () => a.formatMd("code") },
      { label: "Link", shortcut: "Ctrl+K", action: () => a.formatMd("link") },
      { label: "Limpar formatação", action: () => a.formatMd("clear") },
      "sep",
      ...BLOCK_LABELS.map(([id, label]): MenuItem => ({ label, action: () => a.formatMd(id) })),
    ],
  };
}

/** Submenu "Sumário" de Visualizar: mostrar, manter aberto e o lado. */
export function outlineItem(a: MenuActions): MenuItem {
  const o = a.current().outline;
  return {
    label: "Sumário",
    submenu: [
      { label: "Mostrar sumário", checked: o.on, action: a.toggleOutline },
      { label: "Manter aberto", checked: o.pinned, action: a.toggleOutlinePinned },
      "sep",
      { label: "À esquerda", checked: o.side === "left", action: () => a.setOutlineSide("left") },
      { label: "À direita", checked: o.side === "right", action: () => a.setOutlineSide("right") },
    ],
  };
}

/** Itens do menu do tipo de arquivo: só o que faz sentido para ele. */
export function langMenuItems(a: MenuActions): MenuItem[] {
  const c = a.current();
  switch (c.lang) {
    case "json":
      return jsonItems(a);
    case "csv":
      return csvItems(a);
    case "yaml":
    case "toml":
      return treeItems(a);
    case "markdown":
      return [
        formatItem(a),
        "sep",
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
  return [mk("Automático", "auto"), "sep", mk("Texto simples", "plain"), mk("Markdown", "markdown"), mk("DBML", "dbml"), mk("JSON", "json"), mk("YAML", "yaml"), mk("TOML", "toml"), mk("CSV", "csv")];
}

/** Os menus do topo (título e itens, calculados na hora): a barra e a paleta de comandos leem o mesmo. */
export function topMenus(a: MenuActions): { label: () => string; items: () => MenuItem[] }[] {
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
        { label: "Salvar", shortcut: "Ctrl+S", action: a.save, disabled: !a.current().canSave },
        { label: "Salvar como…", shortcut: "Ctrl+Shift+S", action: a.saveAs, disabled: !a.current().canSave },
        { label: "Salvar todos", shortcut: "Ctrl+Alt+S", action: a.saveAll },
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
        { label: "Buscar em todas as abas…", shortcut: "Ctrl+Shift+F", action: a.globalSearch },
        { label: "Ir para linha…", shortcut: "Ctrl+G", action: a.gotoLine },
        { label: "Ir para arquivo…", shortcut: "Ctrl+P", action: a.openPalette },
        { label: "Ir para título ou símbolo…", shortcut: "Ctrl+Shift+O", action: a.gotoSymbol },
        { label: "Paleta de comandos…", shortcut: "Ctrl+Shift+P", action: a.commandPalette },
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
          { label: "Números de linha", checked: c.lineNumbers, action: a.toggleLineNumbers },
          outlineItem(a),
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
  return menus;
}

export function mountMenuBar(root: HTMLElement, a: MenuActions) {
  const menus = topMenus(a);

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
