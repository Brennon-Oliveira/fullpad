import { gotoLine, openSearchPanel } from "@codemirror/search";
import { redo, selectAll, undo } from "@codemirror/commands";
import type { EditorState, Extension } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";
import { message, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, type Encoding, type Eol, type Language, type Session, type TabState } from "./api";
import { createState, createView, hintLines, isDark, tabEffects } from "./editor";
import type { DiagramPanel } from "./dbml/panel";
import { type Lang, detectLanguage } from "./language";
import { MAX_PREVIEW_CHARS } from "./livepreview";
const MAX_DIAGRAM_CHARS = 500_000; // mesmo valor de dbml/panel.ts (não importamos o módulo no boot)
import { languageItems, mountMenuBar } from "./menus";
import { showMenu } from "./popup";
import { mountStatusBar } from "./statusbar";
import "./style.css";

const AUTOSAVE_MS = 400;
const DETECT_MS = 600;

let session: Session;
const states = new Map<string, EditorState>(); // abas já carregadas (guarda undo/seleção)
const detected = new Map<string, Lang>(); // linguagem detectada no modo automático
const dirtyNotes = new Set<string>();
let sessionDirty = false;
let timer: number | undefined;
let detectTimer: number | undefined;
let sizeTimer: number | undefined;
let writeChain: Promise<unknown> = Promise.resolve(); // serializa escritas
let wrap = readSetting("wrap", true);
let overwrite = false;
let lastSize = 0;

const menubarEl = document.getElementById("menubar")!;
const tabsEl = document.getElementById("tabs")!;
const editorEl = document.getElementById("editor")!;
const diagramEl = document.getElementById("diagram")!;
const statusEl = document.getElementById("status")!;
let view: ReturnType<typeof createView>;

const activeTab = () => session.tabs.find((t) => t.id === session.active)!;

function readSetting(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(`fullpad.${key}`);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
function writeSetting(key: string, value: boolean) {
  try {
    localStorage.setItem(`fullpad.${key}`, value ? "1" : "0");
  } catch {
    /* sem storage: só não lembra */
  }
}

function titleOf(text: string): string {
  const line = text.split("\n").find((l) => l.trim() !== "") ?? "";
  const t = line.replace(/^#+\s*/, "").trim();
  return t ? (t.length > 28 ? t.slice(0, 28) + "…" : t) : "Nova nota";
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

// ---- linguagem / preview ----------------------------------------------------

function effectiveLang(tab: TabState): Lang {
  return tab.language === "auto" ? (detected.get(tab.id) ?? "plain") : tab.language;
}

/** Markdown (live preview) e DBML (diagrama) têm visão renderizada; cada um com seu limite de tamanho. */
function previewAvailable(tab: TabState): boolean {
  const len = states.get(tab.id)?.doc.length ?? 0;
  const lang = effectiveLang(tab);
  return (lang === "markdown" && len <= MAX_PREVIEW_CHARS) || (lang === "dbml" && len <= MAX_DIAGRAM_CHARS);
}

function previewOn(tab: TabState): boolean {
  return previewAvailable(tab) && tab.mode === "rendered";
}

function redetect(tab: TabState) {
  const st = states.get(tab.id);
  if (!st || tab.language !== "auto") return;
  detected.set(tab.id, detectLanguage(st.sliceDoc(0, 20_000), tab.path));
}

/** Aplica linguagem, preview, quebra de linha e INS/OVR ao editor ativo. */
function applyTabConfig() {
  const tab = activeTab();
  view.dispatch({
    effects: tabEffects({
      markdown: effectiveLang(tab) === "markdown",
      dbml: effectiveLang(tab) === "dbml",
      dark: isDark(),
      support: effectiveLang(tab) === "dbml" ? dbmlSupport : undefined,
      preview: previewOn(tab) && effectiveLang(tab) === "markdown",
      wrap,
      overwrite,
    }),
  });
  ensureDbmlSupport();
  syncDiagram();
  refreshStatus();
}

// O tema segue o sistema: quando muda, reaplica na aba ativa (as outras pegam ao serem mostradas).
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => applyTabConfig());

// ---- recursos de editor do DBML (diagnóstico; carregados sob demanda) -----------

let dbmlSupport: Extension | undefined;
let dbmlSupportLoading = false;

/** Carrega o parser na 1ª vez que uma aba DBML aparece e reaplica a configuração com ele. */
function ensureDbmlSupport() {
  if (dbmlSupport || dbmlSupportLoading || effectiveLang(activeTab()) !== "dbml") return;
  dbmlSupportLoading = true;
  import("./dbml/editor")
    .then((m) => m.dbmlEditorSupport())
    .then((ext) => {
      dbmlSupport = ext;
      if (effectiveLang(activeTab()) === "dbml") applyTabConfig();
    })
    .catch((e) => console.error("falha ao carregar o suporte a DBML", e))
    .finally(() => (dbmlSupportLoading = false));
}

// ---- diagrama DBML (carregado sob demanda) ------------------------------------

let diagram: DiagramPanel | undefined;
let diagramLoading: Promise<void> | undefined;
let diagramTab: string | null = null; // aba cujo diagrama está na tela
let docRev = 0; // muda a cada edição/troca de aba: o diagrama só se liga ao código se for da mesma versão

const diagramWanted = (tab: TabState) => previewOn(tab) && effectiveLang(tab) === "dbml";

/** Mostra/esconde o painel conforme a aba ativa. O módulo só é importado na 1ª vez que um DBML pede. */
function syncDiagram(textChanged = false) {
  const tab = activeTab();
  if (!diagramWanted(tab)) {
    diagram?.hide();
    diagramTab = null;
    return;
  }
  const text = view.state.doc.toString();
  const run = () => {
    if (!diagram || !diagramWanted(activeTab())) return;
    if (textChanged && diagramTab === tab.id) diagram.update(text, docRev);
    else diagram.show(text, diagramTab !== tab.id, docRev);
    diagramTab = tab.id;
    diagram.setCursor(view.state.selection.main.head, docRev);
  };
  if (diagram) return run();
  diagramEl.classList.add("on"); // já abre o espaço enquanto o módulo carrega
  diagramLoading ??= import("./dbml/panel").then((m) => {
    diagram = m.createDiagramPanel(diagramEl, {
      // mouse sobre o diagrama → destaca a linha no código (sem selecionar)
      onHover: (spans, rev) => view.dispatch({ effects: hintLines(spans && rev === docRev ? spans : null) }),
    });
  });
  void diagramLoading.then(run);
}

function scheduleDetect() {
  window.clearTimeout(detectTimer);
  detectTimer = window.setTimeout(() => {
    const tab = activeTab();
    if (tab.language !== "auto") return;
    const before = effectiveLang(tab);
    redetect(tab);
    if (effectiveLang(tab) !== before) applyTabConfig();
  }, DETECT_MS);
}

// ---- barra de status --------------------------------------------------------

const EOL_LABEL: Record<Eol, string> = { crlf: "Windows (CR LF)", lf: "Unix (LF)" };
const ENC_LABEL: Record<Encoding, string> = {
  utf8: "UTF-8",
  "utf8-bom": "UTF-8-BOM",
  utf16le: "UTF-16 LE BOM",
  utf16be: "UTF-16 BE BOM",
  windows1252: "Windows-1252",
};
const LANG_LABEL: Record<Lang, string> = { plain: "Texto simples", markdown: "Markdown", dbml: "DBML" };

function langLabel(tab: TabState): string {
  const l = LANG_LABEL[effectiveLang(tab)];
  return tab.language === "auto" ? `${l} (automático)` : l;
}

function computeSize(): number {
  const st = view.state;
  const tab = activeTab();
  let bytes = new TextEncoder().encode(st.doc.toString()).length;
  if (tab.eol === "crlf") bytes += st.doc.lines - 1;
  if (tab.encoding === "utf8-bom") bytes += 3;
  return bytes;
}

function refreshStatus(recomputeSize = true) {
  const tab = activeTab();
  const st = view.state;
  const head = st.selection.main.head;
  const line = st.doc.lineAt(head);
  if (recomputeSize) lastSize = computeSize();
  status.update({
    languageLabel: langLabel(tab),
    previewAvailable: previewAvailable(tab),
    previewOn: previewOn(tab),
    size: lastSize,
    lines: st.doc.lines,
    ln: line.number,
    col: head - line.from + 1,
    pos: head + 1,
    eolLabel: EOL_LABEL[tab.eol],
    encodingLabel: ENC_LABEL[tab.encoding],
    overwrite,
  });
}

function scheduleSizeRefresh() {
  window.clearTimeout(sizeTimer);
  sizeTimer = window.setTimeout(() => refreshStatus(), 200);
}

function markModified(tab: TabState) {
  if (tab.path && !tab.dirty) {
    tab.dirty = true;
    renderTabs();
  }
  dirtyNotes.add(tab.id);
  sessionDirty = true;
  scheduleSave();
}

const status = mountStatusBar(statusEl, {
  onLanguage: (a) => showMenu(a, languageItems(menuActions), "above"),
  onPreview: () => togglePreview(),
  onEol: (a) =>
    showMenu(
      a,
      (["crlf", "lf"] as Eol[]).map((e) => ({
        label: EOL_LABEL[e],
        checked: activeTab().eol === e,
        action: () => {
          const tab = activeTab();
          if (tab.eol === e) return;
          tab.eol = e;
          markModified(tab);
          refreshStatus();
          view.focus();
        },
      })),
      "above",
    ),
  onEncoding: (a) =>
    showMenu(
      a,
      (Object.keys(ENC_LABEL) as Encoding[]).map((e) => ({
        label: ENC_LABEL[e],
        checked: activeTab().encoding === e,
        action: () => {
          const tab = activeTab();
          if (tab.encoding === e) return;
          tab.encoding = e;
          markModified(tab);
          refreshStatus();
          view.focus();
        },
      })),
      "above",
    ),
  onOverwrite: () => toggleOverwrite(),
});

// ---- persistência -----------------------------------------------------------

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = writeChain.then(job, job);
  writeChain = next.catch((e) => console.error("falha ao salvar", e));
  return next;
}

/** Captura cursor/scroll da aba ativa no objeto da sessão e guarda o estado. */
function snapshotActive() {
  const tab = activeTab();
  states.set(tab.id, view.state);
  tab.cursor = view.state.selection.main.head;
  tab.scroll = view.scrollDOM.scrollTop;
}

async function flush() {
  window.clearTimeout(timer);
  timer = undefined;
  snapshotActive();
  const ids = [...dirtyNotes];
  dirtyNotes.clear();
  const writes = ids.map((id) => {
    const text = states.get(id)!.doc.toString();
    return enqueue(() => api.saveNote(id, text));
  });
  await Promise.all(writes);
  if (sessionDirty || ids.length) {
    sessionDirty = false;
    await enqueue(() => api.saveSession(structuredClone(session)));
  }
}

function scheduleSave() {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void flush(), AUTOSAVE_MS);
}

function onEditorUpdate(u: ViewUpdate) {
  if (u.docChanged) {
    docRev++;
    syncDiagram(true);
    const tab = activeTab();
    if (!tab.path) {
      const before = tab.title;
      tab.title = titleOf(view.state.doc.toString());
      if (tab.title !== before) renderTabs();
    }
    markModified(tab);
    scheduleDetect();
    scheduleSizeRefresh();
  }
  if (u.selectionSet && !u.docChanged && diagramTab === activeTab().id) {
    diagram?.setCursor(u.state.selection.main.head, docRev); // cursor → destaque no diagrama
  }
  if (u.docChanged || u.selectionSet) refreshStatus(false);
}

// ---- abas -------------------------------------------------------------------

function tabLabel(t: TabState): string {
  return (t.dirty ? "● " : "") + (t.title || "Nova nota");
}

function renderTabs() {
  tabsEl.replaceChildren(
    ...session.tabs.map((t) => {
      const el = document.createElement("div");
      el.className = "tab" + (t.id === session.active ? " active" : "");
      el.role = "tab";
      el.title = t.path ?? (t.title || "Nova nota");
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = tabLabel(t);
      const close = document.createElement("button");
      close.className = "close";
      close.textContent = "×";
      close.title = "Fechar (Ctrl+W)";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        void closeTab(t.id);
      });
      el.addEventListener("click", () => void activate(t.id));
      el.addEventListener("auxclick", (e) => e.button === 1 && void closeTab(t.id));
      el.append(label, close);
      return el;
    }),
  );
  const add = document.createElement("button");
  add.id = "new-tab";
  add.textContent = "+";
  add.title = "Nova nota (Ctrl+N)";
  add.addEventListener("click", () => void newTab());
  tabsEl.append(add);
  tabsEl.querySelector(".active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  void getCurrentWindow().setTitle(`${tabLabel(activeTab())} — Fullpad`);
}

async function loadState(tab: TabState, text?: string): Promise<EditorState> {
  const cached = states.get(tab.id);
  if (cached) return cached;
  const doc = text ?? (await api.readNote(tab.id));
  const st = createState(doc, tab.cursor, onEditorUpdate);
  states.set(tab.id, st);
  return st;
}

async function show(tab: TabState, text?: string) {
  const st = await loadState(tab, text);
  session.active = tab.id;
  docRev++;
  view.setState(st);
  redetect(tab);
  applyTabConfig();
  renderTabs();
  requestAnimationFrame(() => {
    view.scrollDOM.scrollTop = tab.scroll;
    view.focus();
  });
}

async function activate(id: string) {
  if (id === session.active) return;
  snapshotActive();
  await show(session.tabs.find((t) => t.id === id)!);
  sessionDirty = true;
  scheduleSave();
}

async function newTab() {
  snapshotActive();
  const tab = await api.newNote();
  session.tabs.push(tab);
  await show(tab, "");
  sessionDirty = true;
  scheduleSave();
}

async function closeTab(id: string) {
  const idx = session.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const tab = session.tabs[idx];
  if (id === session.active) snapshotActive();

  if (tab.dirty && tab.path) {
    const r = await message(`Salvar as alterações em "${tab.title}"?`, {
      title: "Fullpad",
      kind: "warning",
      buttons: { yes: "Salvar", no: "Não salvar", cancel: "Cancelar" },
    });
    if (r === "Cancelar") return;
    if (r === "Salvar" && !(await save(tab))) return;
  }

  // grava o conteúdo pendente antes de mover para a lixeira
  if (dirtyNotes.has(id)) {
    dirtyNotes.delete(id);
    await enqueue(() => api.saveNote(id, states.get(id)!.doc.toString()));
  }
  await enqueue(() => api.closeNote(id));
  session.tabs.splice(idx, 1);
  states.delete(id);
  detected.delete(id);
  if (session.tabs.length === 0) {
    const fresh = await api.newNote();
    session.tabs.push(fresh);
    await show(fresh, "");
  } else if (id === session.active) {
    await show(session.tabs[Math.min(idx, session.tabs.length - 1)]);
  } else {
    renderTabs();
  }
  sessionDirty = true;
  await flush();
}

function cycle(delta: number) {
  const i = session.tabs.findIndex((t) => t.id === session.active);
  const n = session.tabs.length;
  void activate(session.tabs[(i + delta + n) % n].id);
}

// ---- arquivos ---------------------------------------------------------------

const FILTERS = [
  { name: "Texto, Markdown e DBML", extensions: ["md", "markdown", "txt", "dbml", "dbmlx"] },
  { name: "Todos os arquivos", extensions: ["*"] },
];

async function openFiles() {
  const picked = await openDialog({ multiple: true, filters: FILTERS });
  if (!picked) return;
  for (const path of Array.isArray(picked) ? picked : [picked]) {
    const existing = session.tabs.find((t) => t.path === path);
    if (existing) {
      await activate(existing.id);
      continue;
    }
    snapshotActive();
    try {
      const { tab, text } = await api.openFile(path);
      session.tabs.push(tab);
      await show(tab, text);
    } catch (e) {
      await message(String(e), { title: "Erro ao abrir", kind: "error" });
    }
  }
  sessionDirty = true;
  scheduleSave();
}

function suggestedName(tab: TabState): string {
  const base = (tab.title && tab.title !== "Nova nota" ? tab.title : "nota")
    .replace(/[\\/:*?"<>|…]/g, "")
    .trim();
  return `${base || "nota"}.${effectiveLang(tab) === "markdown" ? "md" : "txt"}`;
}

/** Salva a aba; sem caminho (ou `forceDialog`) abre "Salvar como". */
async function save(tab: TabState = activeTab(), forceDialog = false): Promise<boolean> {
  let path = tab.path;
  if (!path || forceDialog) {
    path = await saveDialog({ defaultPath: tab.path ?? suggestedName(tab), filters: FILTERS });
    if (!path) return false;
  }
  if (tab.id === session.active) snapshotActive();
  const text = states.get(tab.id)!.doc.toString();
  try {
    await enqueue(() => api.saveFile(tab.id, path, text, tab.encoding, tab.eol));
  } catch (e) {
    await message(String(e), { title: "Erro ao salvar", kind: "error" });
    return false;
  }
  dirtyNotes.delete(tab.id);
  tab.path = path;
  tab.title = baseName(path);
  tab.dirty = false;
  if (tab.id === session.active) {
    redetect(tab);
    applyTabConfig();
  }
  renderTabs();
  refreshStatus(false);
  sessionDirty = true;
  scheduleSave();
  return true;
}

// ---- ações ------------------------------------------------------------------

function togglePreview() {
  const tab = activeTab();
  if (!previewAvailable(tab)) return;
  tab.mode = tab.mode === "rendered" ? "source" : "rendered";
  sessionDirty = true;
  scheduleSave();
  applyTabConfig();
  view.focus();
}

function toggleWrap() {
  wrap = !wrap;
  writeSetting("wrap", wrap);
  applyTabConfig();
  view.focus();
}

function toggleOverwrite() {
  overwrite = !overwrite;
  applyTabConfig();
  view.focus();
}

function setLanguage(l: Language) {
  const tab = activeTab();
  tab.language = l;
  redetect(tab);
  sessionDirty = true;
  scheduleSave();
  applyTabConfig();
  view.focus();
}

const menuActions = {
  newNote: () => void newTab(),
  openFile: () => void openFiles(),
  save: () => void save(),
  saveAs: () => void save(activeTab(), true),
  closeTab: () => void closeTab(session.active!),
  exit: () => void getCurrentWindow().close(),
  undo: () => (undo(view), view.focus()),
  redo: () => (redo(view), view.focus()),
  selectAll: () => (selectAll(view), view.focus()),
  find: () => openSearchPanel(view),
  replace: () => openSearchPanel(view),
  gotoLine: () => gotoLine(view),
  togglePreview,
  toggleWrap,
  setLanguage,
  current: () => {
    const tab = activeTab();
    return {
      language: tab.language,
      previewAvailable: previewAvailable(tab),
      previewOn: previewOn(tab),
      wrap,
    };
  },
};

window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Insert" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      toggleOverwrite();
      return;
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const run = (fn: () => void) => (e.preventDefault(), fn());
    if ((key === "n" || key === "t") && !e.shiftKey) run(menuActions.newNote);
    else if (key === "o") run(menuActions.openFile);
    else if (key === "s") run(e.shiftKey ? menuActions.saveAs : menuActions.save);
    else if (key === "w") run(menuActions.closeTab);
    else if (key === "e") run(togglePreview);
    else if (e.key === "Tab") run(() => cycle(e.shiftKey ? -1 : 1));
  },
  true,
);

// ---- ciclo de vida ----------------------------------------------------------

window.addEventListener("blur", () => void flush());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void flush();
});

async function boot() {
  const startup = await api.loadStartup();
  session = startup.session;
  const tab = activeTab();
  const st = createState(startup.active_text, tab.cursor, onEditorUpdate);
  states.set(tab.id, st);
  view = createView(editorEl, st);
  mountMenuBar(menubarEl, menuActions);
  redetect(tab);
  applyTabConfig();
  renderTabs();
  requestAnimationFrame(() => {
    view.scrollDOM.scrollTop = tab.scroll;
    view.focus();
  });

  const win = getCurrentWindow();
  await win.onCloseRequested(async (e) => {
    e.preventDefault();
    await flush();
    await win.destroy();
  });
  await win.show(); // janela nasce escondida: sem flash branco
}

boot().catch((e) => {
  console.error(e);
  document.body.textContent = `Erro ao iniciar: ${e}`;
  void getCurrentWindow().show();
});
