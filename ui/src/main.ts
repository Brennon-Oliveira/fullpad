import { gotoLine, openSearchPanel } from "@codemirror/search";
import { redo, selectAll, undo } from "@codemirror/commands";
import type { EditorState, Extension } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { message, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { type UnlistenFn, emit, emitTo, listen as listenAll } from "@tauri-apps/api/event";
import { listenHere as listen } from "./events";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, type ClosedTab, type Encoding, type Eol, type Language, type Session, type TabState, type ViewMode } from "./api";
import { createState, createView, hintLines, isDark, tabEffects } from "./editor";
import type { DiagramPanel } from "./dbml/panel";
import type { MarkdownPane } from "./mdpreview";
import { type Lang, detectLanguage } from "./language";
import { MAX_PREVIEW_CHARS } from "./livepreview";
const MAX_DIAGRAM_CHARS = 500_000; // mesmo valor de dbml/panel.ts (não importamos o módulo no boot)
import { exportItem, languageItems, mountMenuBar, viewItems } from "./menus";
import { type MenuItem, showMenu, showMenuAt } from "./popup";
import { mountStatusBar } from "./statusbar";
import { attachTabDrag, insertionIndex, type TearPoint } from "./tabdrag";
import { type Layout, type Node, type Side, type Zone, groupsOf, leaf, normalize, removeLeaf, resizeSizes, splitLeaf, swapAdjacent, zoneAt } from "./grid";
import "./style.css";

const AUTOSAVE_MS = 400;
const DETECT_MS = 600;

const thisWindow = getCurrentWindow();
const winLabel = thisWindow.label;
const isMain = winLabel === "main";
let booted = false;
let shown = false; // a janela já apareceu (a reserva só aparece quando recebe a 1ª aba)
const pendingIn: TabState[] = []; // abas que chegaram antes de a janela terminar de iniciar
let exiting = false; // o app está fechando: janelas flutuantes só gravam, sem devolver as abas
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
const workEl = document.getElementById("work")!;
const statusEl = document.getElementById("status")!;

/**
 * Um painel da janela (como um grupo de editores do VS Code): barra de abas própria, editor, e o
 * markdown renderizado ou o diagrama ao lado. Cada aba pertence a um grupo (`TabState.group`).
 * Só um grupo tem o foco (`cur`): é nele que valem os menus, os atalhos e a barra de status.
 */
interface Group {
  id: number;
  el: HTMLElement;
  tabsEl: HTMLElement;
  bodyEl: HTMLElement;
  editorEl: HTMLElement;
  diagramEl: HTMLElement;
  mdEl: HTMLElement;
  view: EditorView;
  /** Aba aberta neste grupo. */
  active: string | null;
  /** Muda a cada edição/troca de aba: o diagrama só se liga ao código se for da mesma versão. */
  rev: number;
  diagram?: DiagramPanel;
  diagramLoading?: Promise<void>;
  diagramTab: string | null; // aba cujo diagrama está na tela
  mdPane?: MarkdownPane;
  mdLoading?: Promise<void>;
}

const groups = new Map<number, Group>();
let cur: Group;
let layout: Layout = { root: leaf(0), focus: 0 };

/** O grupo em que a aba aparece agora (aberta nele), se algum. */
const groupShowing = (id: string) => [...groups.values()].find((g) => g.active === id);
const tabsOf = (g: Group) => session.tabs.filter((t) => t.group === g.id);
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

/** Como o arquivo aparece: só código, renderizado no próprio texto (markdown) ou ao lado do código. */
type ViewKind = "source" | "inline" | "split";

function viewKind(tab: TabState): ViewKind {
  if (!previewAvailable(tab) || tab.mode === "source") return "source";
  if (effectiveLang(tab) === "dbml") return "split"; // o diagrama sempre fica ao lado
  return tab.mode === "split" ? "split" : "inline";
}

const previewOn = (tab: TabState) => viewKind(tab) !== "source";

function viewLabel(tab: TabState): string {
  const k = viewKind(tab);
  if (k === "source") return "Código";
  if (tab.detached) return "Janela separada";
  if (effectiveLang(tab) === "dbml") return "Diagrama";
  return k === "inline" ? "Preview" : "Lado a lado";
}

function redetect(tab: TabState) {
  const st = states.get(tab.id);
  if (!st || tab.language !== "auto") return;
  detected.set(tab.id, detectLanguage(st.sliceDoc(0, 20_000), tab.path));
}

/** Aplica linguagem, preview, quebra de linha e INS/OVR ao editor ativo. */
function applyTabConfig() {
  if (!session.active) return;
  const tab = activeTab();
  cur.view.dispatch({
    effects: tabEffects({
      markdown: effectiveLang(tab) === "markdown",
      dbml: effectiveLang(tab) === "dbml",
      dark: isDark(),
      support: effectiveLang(tab) === "dbml" ? dbmlSupport : undefined,
      preview: viewKind(tab) === "inline" && effectiveLang(tab) === "markdown",
      wrap,
      overwrite,
    }),
  });
  ensureDbmlSupport();
  cur.mdPane?.setDark(isDark());
  reconcileDetached();
  syncDiagram();
  refreshStatus();
}

// O tema segue o sistema: quando muda, reaplica na aba ativa (as outras pegam ao serem mostradas).
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => forEachGroup(applyTabConfig));

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
      forEachGroup(() => effectiveLang(activeTab()) === "dbml" && applyTabConfig());
    })
    .catch((e) => console.error("falha ao carregar o suporte a DBML", e))
    .finally(() => (dbmlSupportLoading = false));
}

// ---- visão renderizada em janela separada ------------------------------------------

const previewOpen = new Map<string, UnlistenFn[]>(); // abas com janela de preview aberta
let pvTimer: number | undefined;

const previewLang = (tab: TabState) => (effectiveLang(tab) === "dbml" ? "dbml" : "markdown");

async function textOf(id: string): Promise<string> {
  const showing = groupShowing(id);
  return showing?.view.state.doc.toString() ?? states.get(id)?.doc.toString() ?? api.readNote(id);
}

/** Manda o texto atual da aba para a janela de preview dela. */
async function pushPreview(tab: TabState) {
  const text = await textOf(tab.id);
  const showing = groupShowing(tab.id);
  const cursor = showing ? showing.view.state.selection.main.head : null;
  await emitTo(`preview-${tab.id}`, "pv-text", { text, rev: showing?.rev ?? 0, title: tab.title || "Nova nota", cursor }).catch(() => {});
}

function openPreviewWindow(tab: TabState) {
  if (previewOpen.has(tab.id)) return;
  const id = tab.id;
  const stops: UnlistenFn[] = [];
  previewOpen.set(id, stops);
  void (async () => {
    stops.push(
      await listen(`pv-ready:${id}`, () => {
        const t = session.tabs.find((x) => x.id === id);
        if (t) void pushPreview(t);
      }),
      // mouse sobre o diagrama da outra janela → destaca a linha aqui
      await listen<{ spans: { from: number; to: number }[] | null; rev: number }>(`pv-hover:${id}`, (e) => {
        const showing = groupShowing(id);
        const ok = !!showing && e.payload.rev === showing.rev;
        showing?.view.dispatch({ effects: hintLines(ok ? e.payload.spans : null) });
      }),
      // o usuário fechou a janela de preview: a visão volta para ao lado do código
      await listen(`pv-closed:${id}`, () => {
        forgetPreview(id);
        const t = session.tabs.find((x) => x.id === id);
        if (!t) return;
        t.detached = false;
        sessionDirty = true;
        scheduleSave();
        const showing = groupShowing(id);
        if (showing) withGroup(showing, applyTabConfig);
      }),
    );
    await api.openPreview(id, previewLang(tab));
  })().catch((e) => {
    console.error("falha ao abrir a janela de preview", e);
    forgetPreview(id);
  });
}

function forgetPreview(id: string) {
  for (const stop of previewOpen.get(id) ?? []) stop();
  previewOpen.delete(id);
}

function closePreviewWindow(id: string) {
  if (!previewOpen.has(id)) return;
  forgetPreview(id);
  void api.closePreview(id);
}

/** Abre/fecha a janela de preview da aba ativa conforme `detached` e a visão atual. */
function reconcileDetached() {
  const tab = activeTab();
  const want = tab.detached && viewKind(tab) !== "source";
  if (tab.detached && !want) {
    tab.detached = false; // perdeu a visão renderizada (outra linguagem, texto grande demais…)
    sessionDirty = true;
    scheduleSave();
  }
  if (want) openPreviewWindow(tab);
  else closePreviewWindow(tab.id);
}

/** Texto ou cursor mudou: atualiza a janela de preview da aba ativa. */
function syncDetached(textChanged: boolean) {
  const tab = activeTab();
  if (!tab.detached || !previewOpen.has(tab.id)) return;
  window.clearTimeout(pvTimer);
  pvTimer = window.setTimeout(() => void pushPreview(tab), textChanged ? 200 : 0);
}

function toggleDetached() {
  const tab = activeTab();
  if (!previewAvailable(tab)) return;
  if (tab.detached) tab.detached = false;
  else {
    tab.detached = true;
    if (viewKind(tab) === "source") tab.mode = effectiveLang(tab) === "dbml" ? "rendered" : "split";
    else if (effectiveLang(tab) === "markdown") tab.mode = "split";
  }
  sessionDirty = true;
  scheduleSave();
  applyTabConfig();
  cur.view.focus();
}

// ---- diagrama DBML (carregado sob demanda) ------------------------------------

const diagramWanted = (tab: TabState) => previewOn(tab) && !tab.detached && effectiveLang(tab) === "dbml";

// ---- markdown renderizado ao lado do código (carregado sob demanda) ----------------

const mdWanted = (tab: TabState) => effectiveLang(tab) === "markdown" && viewKind(tab) === "split" && !tab.detached;
const tabOf = (g: Group) => session.tabs.find((t) => t.id === g.active);

function syncMdPane(textChanged: boolean) {
  const g = cur;
  if (!mdWanted(activeTab())) {
    g.mdPane?.hide();
    g.mdEl.classList.remove("on");
    return;
  }
  g.mdEl.classList.add("on"); // já abre o espaço enquanto o módulo carrega
  g.mdLoading ??= import("./mdpreview").then((m) => {
    g.mdPane = m.createMarkdownPane(g.mdEl, {
      // mouse sobre uma linha do painel → destaca a linha no código (como no diagrama DBML)
      onHover: (span) => g.view.dispatch({ effects: hintLines(span ? [span] : null) }),
    });
  });
  void g.mdLoading.then(() => {
    const t = tabOf(g);
    if (!g.mdPane || !t || !mdWanted(t)) return;
    const text = g.view.state.doc.toString();
    if (textChanged) g.mdPane.update(text);
    else g.mdPane.show(text);
    g.mdPane.setCursor(g.view.state.selection.main.head);
    followScroll(g);
  });
}

/** O painel renderizado acompanha o scroll do código (proporcional). */
function followScroll(g: Group = cur) {
  const t = tabOf(g);
  if (!g.mdPane || !t || !mdWanted(t)) return;
  const s = g.view.scrollDOM;
  const room = s.scrollHeight - s.clientHeight;
  g.mdPane.scrollToFraction(room > 0 ? s.scrollTop / room : 0);
}

/** Mostra/esconde o painel conforme a aba ativa. O módulo só é importado na 1ª vez que um DBML pede. */
function syncDiagram(textChanged = false) {
  const g = cur;
  syncMdPane(textChanged);
  syncDetached(textChanged);
  const tab = activeTab();
  if (!diagramWanted(tab)) {
    g.diagram?.hide();
    g.diagramTab = null;
    return;
  }
  const text = g.view.state.doc.toString();
  const run = () => {
    const t = tabOf(g);
    if (!g.diagram || !t || !diagramWanted(t)) return;
    if (textChanged && g.diagramTab === tab.id) g.diagram.update(text, g.rev);
    else g.diagram.show(text, g.diagramTab !== tab.id, g.rev);
    g.diagramTab = tab.id;
    g.diagram.setCursor(g.view.state.selection.main.head, g.rev);
  };
  if (g.diagram) return run();
  g.diagramEl.classList.add("on"); // já abre o espaço enquanto o módulo carrega
  g.diagramLoading ??= import("./dbml/panel").then((m) => {
    g.diagram = m.createDiagramPanel(g.diagramEl, {
      // mouse sobre o diagrama → destaca a linha no código (sem selecionar)
      onHover: (spans, rev) => g.view.dispatch({ effects: hintLines(spans && rev === g.rev ? spans : null) }),
    });
  });
  void g.diagramLoading.then(run);
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
  const st = cur.view.state;
  const tab = activeTab();
  let bytes = new TextEncoder().encode(st.doc.toString()).length;
  if (tab.eol === "crlf") bytes += st.doc.lines - 1;
  if (tab.encoding === "utf8-bom") bytes += 3;
  return bytes;
}

function refreshStatus(recomputeSize = true) {
  if (!session.active || !tabOf(cur)) return; // painel ainda sem aba
  const tab = activeTab();
  const st = cur.view.state;
  const head = st.selection.main.head;
  const line = st.doc.lineAt(head);
  if (recomputeSize) lastSize = computeSize();
  status.update({
    languageLabel: langLabel(tab),
    viewLabel: viewLabel(tab),
    viewAvailable: previewAvailable(tab),
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
  onView: (a) => showMenu(a, viewItems(menuActions), "above"),
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
          cur.view.focus();
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
          cur.view.focus();
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
  snapshotGroup(cur);
}

function snapshotGroup(g: Group) {
  const tab = tabOf(g);
  if (!tab) return; // janela reserva, ainda sem aba
  states.set(tab.id, g.view.state);
  tab.cursor = g.view.state.selection.main.head;
  tab.scroll = g.view.scrollDOM.scrollTop;
}

async function flush() {
  window.clearTimeout(timer);
  timer = undefined;
  for (const g of groups.values()) snapshotGroup(g);
  const ids = [...dirtyNotes];
  dirtyNotes.clear();
  const writes = ids.map((id) => {
    const text = states.get(id)!.doc.toString();
    return enqueue(() => api.saveNote(id, text));
  });
  await Promise.all(writes);
  if (sessionDirty || ids.length) {
    sessionDirty = false;
    await enqueue(() => api.saveWindow(structuredClone(session.tabs), session.active, layoutPayload()));
  }
}

/** A grade como vai para o disco: árvore de painéis, painel com foco e a aba aberta em cada um. */
const layoutPayload = (): unknown => ({
  root: layout.root,
  focus: cur.id,
  active: Object.fromEntries([...groups.values()].map((g) => [g.id, g.active])),
});

function scheduleSave() {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void flush(), AUTOSAVE_MS);
}

function onEditorUpdate(u: ViewUpdate) {
  const g = cur;
  if (u.view !== g.view) return; // só o painel com o foco recebe digitação
  if (u.docChanged) {
    g.rev++;
    syncDiagram(true);
    const tab = activeTab();
    if (!tab.path) {
      const before = tab.title;
      tab.title = titleOf(g.view.state.doc.toString());
      if (tab.title !== before) renderTabs();
    }
    markModified(tab);
    scheduleDetect();
    scheduleSizeRefresh();
  }
  if (u.selectionSet && !u.docChanged && g.diagramTab === activeTab().id) {
    g.diagram?.setCursor(u.state.selection.main.head, g.rev); // cursor → destaque no diagrama
    g.mdPane?.setCursor(u.state.selection.main.head); // ... ou a linha no markdown renderizado
  }
  if (u.selectionSet && !u.docChanged && activeTab().detached && previewOpen.has(session.active!)) {
    void emitTo(`preview-${session.active}`, "pv-cursor", { offset: u.state.selection.main.head, rev: g.rev }).catch(() => {});
  }
  if (u.docChanged || u.selectionSet) refreshStatus(false);
}

// ---- abas -------------------------------------------------------------------

function tabLabel(t: TabState): string {
  return (t.dirty ? "● " : "") + (t.title || "Nova nota");
}

function updateTitle() {
  if (session.active) void thisWindow.setTitle(`${tabLabel(activeTab())} — Fullpad`);
}

function renderTabs() {
  clearGhost();
  for (const g of groups.values()) renderStrip(g);
  updateTitle();
}

function renderStrip(g: Group) {
  g.tabsEl.replaceChildren(
    ...tabsOf(g).map((t) => {
      const el = document.createElement("div");
      el.className = "tab" + (t.id === g.active ? " active" : "");
      el.role = "tab";
      el.dataset.id = t.id;
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
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        void openTabMenu(t, el);
      });
      el.append(label, close);
      return el;
    }),
  );
  const add = document.createElement("button");
  add.className = "new-tab";
  add.textContent = "+";
  add.title = "Nova nota (Ctrl+N)";
  add.addEventListener("click", () => {
    enterGroup(g);
    void newTab();
  });
  g.tabsEl.append(add);
  g.tabsEl.querySelector(".active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

async function loadState(tab: TabState, text?: string): Promise<EditorState> {
  const cached = states.get(tab.id);
  if (cached) return cached;
  const doc = text ?? (await api.readNote(tab.id));
  const st = createState(doc, tab.cursor, onEditorUpdate);
  states.set(tab.id, st);
  return st;
}

/** Dá o foco ao painel: passa a valer para menus, atalhos e barra de status. */
function enterGroup(g: Group) {
  if (g === cur) return;
  snapshotActive();
  cur = g;
  session.active = g.active;
  layout.focus = g.id;
  markFocus();
  if (g.active) {
    refreshStatus();
    updateTitle();
  }
  sessionDirty = true;
  scheduleSave();
}

function markFocus() {
  for (const x of groups.values()) x.el.classList.toggle("focused", x === cur);
}

/** Roda `fn` como se `g` tivesse o foco (sem mexer no foco de verdade). Só para trabalho síncrono. */
function withGroup<T>(g: Group, fn: () => T): T {
  const [prevCur, prevActive] = [cur, session.active];
  cur = g;
  session.active = g.active;
  try {
    return fn();
  } finally {
    cur = prevCur;
    session.active = prevActive;
  }
}

const forEachGroup = (fn: () => void) => {
  for (const g of [...groups.values()]) if (g.active) withGroup(g, fn);
  if (session.active) refreshStatus(); // o último painel visitado não pode ficar na barra de status
};

async function show(tab: TabState, text?: string) {
  const g = groups.get(tab.group) ?? cur;
  if (g !== cur) enterGroup(g);
  const st = await loadState(tab, text);
  session.active = tab.id;
  g.active = tab.id;
  g.rev++;
  g.view.setState(st);
  redetect(tab);
  applyTabConfig();
  renderTabs();
  requestAnimationFrame(() => {
    g.view.scrollDOM.scrollTop = tab.scroll;
    g.view.focus();
  });
}

async function activate(id: string) {
  const tab = session.tabs.find((t) => t.id === id);
  if (!tab) return;
  const g = groups.get(tab.group)!;
  if (g.active === id) {
    if (g !== cur) {
      enterGroup(g);
      g.view.focus();
    }
    return;
  }
  snapshotActive();
  await show(tab);
  sessionDirty = true;
  scheduleSave();
}

/** Coloca a aba no painel `g`, na posição `index` entre as abas dele (no fim, se não vier). */
function placeInGroup(tab: TabState, g: Group, index?: number) {
  session.tabs = session.tabs.filter((t) => t.id !== tab.id);
  tab.group = g.id;
  const mine = tabsOf(g);
  const before = index !== undefined && index < mine.length ? mine[index] : null;
  if (before) session.tabs.splice(session.tabs.indexOf(before), 0, tab);
  else if (mine.length > 0) session.tabs.splice(session.tabs.indexOf(mine[mine.length - 1]) + 1, 0, tab);
  else session.tabs.push(tab);
}

async function newTab() {
  snapshotActive();
  const tab = await api.newNote();
  placeInGroup(tab, cur);
  await show(tab, "");
  sessionDirty = true;
  scheduleSave();
}

let closedCache: ClosedTab[] = [];
async function refreshClosed() {
  try {
    closedCache = await api.listClosed();
  } catch {
    closedCache = [];
  }
}

/** Reabre uma aba fechada (a mais recente, se `id` não vier) nesta janela. */
async function reopenTab(id?: string) {
  const target = id ?? closedCache[0]?.tab.id;
  if (!target) return;
  snapshotActive();
  try {
    await flush();
    const { tab, text } = await api.restoreTab(target);
    placeInGroup(tab, cur);
    await show(tab, text);
    sessionDirty = true;
    scheduleSave();
  } catch (e) {
    await message(String(e), { title: "Não foi possível reabrir", kind: "error" });
  }
  void refreshClosed();
}

/** Janelinha com as abas fechadas; escolher uma a reabre nesta janela. */
async function showHistory() {
  const { openHistory } = await import("./history");
  openHistory(await api.listClosed(300), (id) => void reopenTab(id));
}

async function closeTab(id: string) {
  const tab = session.tabs.find((t) => t.id === id);
  if (!tab) return;
  if (groups.get(tab.group) !== cur) enterGroup(groups.get(tab.group)!);
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
  closePreviewWindow(id);
  await enqueue(() => api.closeNote(id));
  void refreshClosed();
  await dropLocalTab(id);
}

function cycle(delta: number) {
  const mine = tabsOf(cur);
  if (mine.length < 2) return;
  const i = mine.findIndex((t) => t.id === cur.active);
  void activate(mine[(i + delta + mine.length) % mine.length].id);
}

// ---- painéis (grupos de abas) ---------------------------------------------------

const newGroupId = () => Math.max(-1, ...groups.keys()) + 1;

function createGroup(id: number): Group {
  const div = (cls: string) => Object.assign(document.createElement("div"), { className: cls });
  const el = div("group");
  const tabsEl = div("tabs");
  tabsEl.role = "tablist";
  const bodyEl = div("body");
  const editorEl = div("editor");
  const mdEl = div("mdview");
  const diagramEl = div("diagram");
  bodyEl.append(editorEl, mdEl, diagramEl);
  el.append(tabsEl, bodyEl);
  const view = createView(editorEl, createState("", 0, onEditorUpdate));
  const g: Group = { id, el, tabsEl, bodyEl, editorEl, diagramEl, mdEl, view, active: null, rev: 0, diagramTab: null };
  groups.set(id, g);
  view.scrollDOM.addEventListener("scroll", () => followScroll(g), { passive: true });
  // botão direito num markdown: copiar/colar e exportar (nos outros tipos fica o menu padrão)
  el.addEventListener("contextmenu", (e) => {
    const t = tabOf(g);
    if (!t || effectiveLang(t) !== "markdown" || (e.target as HTMLElement).closest(".tabs")) return;
    e.preventDefault();
    enterGroup(g);
    const inEditor = e.target instanceof HTMLElement && editorEl.contains(e.target);
    const sel = g.view.state.selection.main;
    const items: MenuItem[] = [];
    if (inEditor) {
      items.push(
        { label: "Recortar", shortcut: "Ctrl+X", disabled: sel.empty, action: () => (g.view.focus(), document.execCommand("cut")) },
        { label: "Copiar", shortcut: "Ctrl+C", disabled: sel.empty, action: () => (g.view.focus(), document.execCommand("copy")) },
        {
          label: "Colar",
          shortcut: "Ctrl+V",
          action: () =>
            void navigator.clipboard
              .readText()
              .then((text) => g.view.dispatch(g.view.state.replaceSelection(text), { scrollIntoView: true }))
              .catch(() => {}),
        },
        { label: "Selecionar tudo", shortcut: "Ctrl+A", action: () => (selectAll(g.view), g.view.focus()) },
      );
    } else {
      items.push({ label: "Copiar", shortcut: "Ctrl+C", disabled: !window.getSelection()?.toString(), action: () => document.execCommand("copy") });
    }
    items.push("sep", exportItem(menuActions, true));
    showMenuAt(e.clientX, e.clientY, items);
  });
  // qualquer clique ou foco dentro do painel o torna o painel ativo
  el.addEventListener("pointerdown", () => enterGroup(g), true);
  el.addEventListener("focusin", () => enterGroup(g));
  attachTabDrag(tabsEl, {
    onReorder(ids) {
      const byId = new Map(tabsOf(g).map((t) => [t.id, t]));
      const order = ids.map((i) => byId.get(i)!).filter(Boolean);
      order.push(...tabsOf(g).filter((t) => !ids.includes(t.id)));
      let k = 0;
      session.tabs = session.tabs.map((t) => (t.group === g.id ? order[k++] : t));
      sessionDirty = true;
      scheduleSave();
      renderTabs();
    },
    canTear: () => !isMain || session.tabs.length > 1,
    onTearStart: tearStart,
    onTearMove: tearMove,
    onTearEnd: tearEnd,
  });
  return g;
}

/** Remonta a árvore de painéis na tela, reaproveitando os elementos (e editores) que já existem. */
function renderLayout() {
  const scrolls = new Map([...groups.values()].map((g) => [g.id, g.view.scrollDOM.scrollTop]));
  const build = (n: Node): HTMLElement => {
    if (n.t === "leaf") {
      const g = groups.get(n.g)!;
      g.el.style.flex = "";
      return g.el;
    }
    const el = document.createElement("div");
    el.className = `split ${n.dir}`;
    n.kids.forEach((k, i) => {
      const kid = build(k);
      kid.style.flex = `${n.sizes[i]} 1 0`;
      if (i > 0) el.append(makeSplitter(n, i - 1, el));
      el.append(kid);
    });
    return el;
  };
  workEl.replaceChildren(build(layout.root));
  for (const g of groups.values()) g.view.scrollDOM.scrollTop = scrolls.get(g.id) ?? 0;
  markFocus();
}

function makeSplitter(n: Extract<Node, { t: "split" }>, i: number, container: HTMLElement): HTMLElement {
  const sp = document.createElement("div");
  sp.className = "splitter";
  // três pontinhos no meio da divisa: menu (também com o botão direito) para inverter os lados etc.
  const grip = document.createElement("button");
  grip.className = "splitter-grip";
  grip.textContent = n.dir === "row" ? "⋮" : "⋯";
  grip.title = "Opções da divisão";
  const menu = (x: number, y: number) => {
    const row = n.dir === "row";
    const apply = (fn: () => void) => () => {
      fn();
      renderLayout();
      sessionDirty = true;
      scheduleSave();
    };
    showMenuAt(x, y, [
      { label: row ? "Inverter esquerda e direita" : "Inverter cima e baixo", action: apply(() => swapAdjacent(n, i)) },
      { label: row ? "Empilhar (uma sobre a outra)" : "Colocar lado a lado", action: apply(() => (n.dir = row ? "col" : "row")) },
      { label: "Dividir igualmente", action: apply(() => (n.sizes = n.kids.map(() => 1))) },
    ]);
  };
  grip.addEventListener("pointerdown", (e) => e.stopPropagation());
  grip.addEventListener("click", (e) => {
    e.stopPropagation();
    const r = grip.getBoundingClientRect();
    menu(r.right, r.top);
  });
  sp.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    menu(e.clientX, e.clientY);
  });
  sp.append(grip);
  sp.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    sp.setPointerCapture(e.pointerId);
    sp.classList.add("active");
    const row = n.dir === "row";
    const rect = container.getBoundingClientRect();
    const total = row ? rect.width : rect.height;
    const start = row ? e.clientX : e.clientY;
    const base = [...n.sizes];
    const move = (ev: PointerEvent) => {
      n.sizes = resizeSizes(base, i, ((row ? ev.clientX : ev.clientY) - start) / total);
      const kids = [...container.children].filter((c) => !c.classList.contains("splitter")) as HTMLElement[];
      kids.forEach((k, j) => (k.style.flex = `${n.sizes[j]} 1 0`));
    };
    const up = () => {
      sp.classList.remove("active");
      sp.removeEventListener("pointermove", move);
      sp.removeEventListener("pointerup", up);
      sp.removeEventListener("pointercancel", up);
      sessionDirty = true;
      scheduleSave();
    };
    sp.addEventListener("pointermove", move);
    sp.addEventListener("pointerup", up);
    sp.addEventListener("pointercancel", up);
  });
  return sp;
}

/** Tira o painel (já sem abas) e passa o espaço aos vizinhos; o foco vai para um vizinho. */
function removeGroup(g: Group) {
  const order = groupsOf(layout.root);
  const i = order.indexOf(g.id);
  // o foco vai para um vizinho que tenha aba (o painel novo de uma divisão ainda pode estar vazio)
  const near = [order[i + 1], order[i - 1], ...order].filter((x) => x !== undefined && x !== g.id);
  const next = groups.get(near.find((x) => tabsOf(groups.get(x)!).length > 0) ?? near[0])!;
  layout.root = removeLeaf(layout.root, g.id) ?? leaf(next.id);
  groups.delete(g.id);
  g.view.destroy();
  g.el.remove();
  if (cur === g) {
    cur = next;
    session.active = next.active;
    layout.focus = next.id;
  }
  renderLayout();
  refreshStatus();
  updateTitle();
  sessionDirty = true;
  scheduleSave();
}

/** Tira a aba desta janela (fechada, ou levada para outra) e arruma o painel que ficou. */
async function dropLocalTab(id: string) {
  const tab = session.tabs.find((t) => t.id === id);
  if (!tab) return;
  const g = groups.get(tab.group)!;
  const idx = tabsOf(g).findIndex((t) => t.id === id);
  const wasActive = g.active === id;
  session.tabs = session.tabs.filter((t) => t.id !== id);
  states.delete(id);
  detected.delete(id);
  const rest = tabsOf(g);
  if (rest.length > 0) {
    if (wasActive) await show(rest[Math.min(idx, rest.length - 1)]);
    else renderTabs();
  } else if (groups.size > 1) {
    removeGroup(g);
    renderTabs();
  } else if (session.tabs.length === 0) {
    if (!isMain) {
      await flush();
      await thisWindow.destroy(); // janela flutuante sem abas some
      return;
    }
    const fresh = await api.newNote();
    placeInGroup(fresh, g);
    await show(fresh, "");
  }
  sessionDirty = true;
  await flush();
}

/** Leva a aba para outro painel desta janela (na posição `index`, se vier). O histórico de desfazer fica. */
async function moveTabToGroup(id: string, dst: Group, index?: number) {
  const tab = session.tabs.find((t) => t.id === id);
  if (!tab) return;
  const src = groups.get(tab.group)!;
  if (src === dst) {
    placeInGroup(tab, dst, index);
    renderTabs();
    sessionDirty = true;
    scheduleSave();
    return;
  }
  snapshotActive();
  const srcWasActive = src.active === id;
  const idx = tabsOf(src).findIndex((t) => t.id === id);
  placeInGroup(tab, dst, index);
  const rest = tabsOf(src);
  if (rest.length === 0) {
    src.active = null;
    removeGroup(src);
  } else if (srcWasActive) {
    await show(rest[Math.min(idx, rest.length - 1)]);
  }
  await show(tab);
  sessionDirty = true;
  scheduleSave();
}

/** Abre um painel novo ao lado de `src`. A aba `tabId` vai para ele; sem ela, nasce uma nota vazia. */
async function splitGroup(src: Group, side: Side, tabId?: string) {
  const g = createGroup(newGroupId());
  layout.root = splitLeaf(layout.root, src.id, side, g.id);
  renderLayout();
  try {
    if (tabId) await moveTabToGroup(tabId, g);
    else {
      snapshotActive();
      const tab = await api.newNote();
      placeInGroup(tab, g);
      await show(tab, "");
    }
  } catch (e) {
    if (tabsOf(g).length === 0 && groups.size > 1) removeGroup(g);
    await message(String(e), { title: "Não foi possível dividir", kind: "error" });
  }
  sessionDirty = true;
  scheduleSave();
}

/** Ctrl+\: divide o painel do foco. Com várias abas nele, a aberta vai para o painel novo. */
function splitActive(side: Side) {
  if (!session.active) return;
  void splitGroup(cur, side, tabsOf(cur).length > 1 ? session.active : undefined);
}

/** Ctrl+1…9: foca o painel de número `n` (na ordem da grade). */
function focusGroupNumber(n: number) {
  const g = groups.get(groupsOf(layout.root)[n - 1]);
  if (!g) return;
  enterGroup(g);
  g.view.focus();
}

// ---- várias janelas ---------------------------------------------------------

/** Tira a aba desta janela depois de ela ter ido para outra (o texto já foi gravado). */
const removeLocalTab = dropLocalTab;

/** Grava o que for preciso para outra janela ler a aba, e devolve uma cópia do estado dela. */
async function prepareToLeave(id: string): Promise<TabState | null> {
  const tab = session.tabs.find((t) => t.id === id);
  if (!tab) return null;
  const showing = groupShowing(id);
  if (showing) snapshotGroup(showing);
  if (dirtyNotes.has(id)) {
    dirtyNotes.delete(id);
    const text = states.get(id)!.doc.toString();
    await enqueue(() => api.saveNote(id, text));
  }
  if (tab.detached) {
    tab.detached = false; // a janela de preview pertence a esta janela; volta ao lado do código no destino
    closePreviewWindow(id);
  }
  return structuredClone(tab);
}

/**
 * Leva a aba para outra janela (`to`: rótulo ou "new"). O texto pendente é gravado antes, para a
 * outra janela ler a versão mais recente; o histórico de desfazer fica para trás.
 */
async function sendTab(id: string, to: string) {
  const copy = await prepareToLeave(id);
  if (!copy) return;
  let dest: string;
  try {
    dest = await enqueue(() => api.moveTab(copy, to));
  } catch (e) {
    await message(String(e), { title: "Erro ao mover a aba", kind: "error" });
    return;
  }
  if (dest !== winLabel) await removeLocalTab(id);
}

// ---- arrastar a aba: dentro da janela divide/move painéis; fora, uma sombra e uma janela nova ----

let dragChain: Promise<unknown> = Promise.resolve(); // mantém a ordem: início, movimentos, fim
let dragPos: { x: number; y: number } | null = null; // só o movimento mais recente importa
let dragTitle = "";
let selfDragging = false; // a única aba da janela: é a janela inteira que anda
let dragId: string | null = null; // a aba arrastada (a que ficou apagada na barra)

const inDrag = (job: () => Promise<unknown>) => (dragChain = dragChain.then(job, job).catch((e) => console.error("arrasto", e)));

/** Onde a aba arrastada cairia dentro desta janela. `none`: soltar aqui não faz nada. */
type DropTarget = { kind: "strip"; g: Group; cx: number } | { kind: "zone"; g: Group; zone: Zone } | { kind: "none" };

/**
 * O que há sob o ponto (cx, cy) desta janela para uma aba arrastada. `src`: painel de onde a aba sai
 * (aba da própria janela); sem ele a aba vem de outra janela, que só entra pela barra ou pela borda
 * de um painel: o meio fica de fora e a aba vira uma janela própria. O preview/diagrama é parte do
 * painel, nunca um destino à parte: vale o painel inteiro (conteúdo e preview trocam juntos).
 */
function targetAt(cx: number, cy: number, src?: Group): DropTarget | null {
  if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return null;
  const el = document.elementFromPoint(cx, cy);
  const strip = el?.closest<HTMLElement>(".tabs");
  if (strip) return { kind: "strip", g: [...groups.values()].find((g) => g.tabsEl === strip)!, cx };
  const body = el?.closest<HTMLElement>(".group");
  const g = body && [...groups.values()].find((x) => x.el === body);
  if (!g) return null;
  // código e preview formam uma unidade: as bordas valem para o conjunto, esteja o ponteiro onde estiver
  const zone = zoneAt(g.bodyEl.getBoundingClientRect(), cx, cy);
  if (!src) return zone === "center" ? null : { kind: "zone", g, zone };
  if (zone === "center") {
    if (g !== src) return { kind: "zone", g, zone };
    // o meio do próprio painel: sobre o preview não faz nada; sobre o código cai como antes (janela nova)
    return el?.closest(".diagram, .mdview") ? { kind: "none" } : null;
  }
  const alone = g === src && tabsOf(src).length === 1; // sozinha, uma aba não divide o próprio painel
  return alone ? null : { kind: "zone", g, zone };
}

function localTarget(id: string, cx: number, cy: number): DropTarget | null {
  if (selfDragging) return null;
  const tab = session.tabs.find((t) => t.id === id);
  return tab ? targetAt(cx, cy, groups.get(tab.group)!) : null;
}

let overlay: HTMLElement | null = null;

function showDropHint(t: DropTarget | null) {
  if (!t || t.kind === "none") return clearDropHint();
  if (t.kind === "strip") {
    overlay?.remove();
    overlay = null;
    return showGhost(t.cx, dragTitle, t.g);
  }
  clearGhost();
  const r = t.g.bodyEl.getBoundingClientRect();
  const w = workEl.getBoundingClientRect();
  let { left, top, width, height } = { left: r.left - w.left, top: r.top - w.top, width: r.width, height: r.height };
  if (t.zone === "left") width /= 2;
  else if (t.zone === "right") (left += width / 2), (width /= 2);
  else if (t.zone === "top") height /= 2;
  else if (t.zone === "bottom") (top += height / 2), (height /= 2);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "drop-overlay";
    workEl.append(overlay);
  }
  Object.assign(overlay.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
}

function clearDropHint() {
  overlay?.remove();
  overlay = null;
  clearGhost();
}

async function dropLocal(id: string, t: Exclude<DropTarget, { kind: "none" }>) {
  if (t.kind === "strip") {
    const mine = tabsOf(t.g).filter((x) => x.id !== id);
    const centers = [...t.g.tabsEl.querySelectorAll<HTMLElement>(".tab:not(.ghost)")]
      .filter((x) => x.dataset.id !== id)
      .map((x) => {
        const r = x.getBoundingClientRect();
        return r.left + r.width / 2;
      });
    const index = Math.min(insertionIndex(centers, t.cx), mine.length);
    await moveTabToGroup(id, t.g, index);
  } else if (t.zone === "center") await moveTabToGroup(id, t.g);
  else await splitGroup(t.g, t.zone, id);
}

function tearStart(id: string, p: TearPoint) {
  const tab = session.tabs.find((t) => t.id === id);
  dragTitle = tab?.title || "Nova nota";
  dragId = id;
  // a única aba de uma janela: quem anda com o mouse é a janela inteira, não uma sombra
  selfDragging = !isMain && session.tabs.length === 1;
  inDrag(() => api.dragStart(dragTitle, p.x, p.y, p.gx, p.gy, selfDragging));
}

function tearMove(x: number, y: number, cx: number, cy: number) {
  if (dragId) showDropHint(localTarget(dragId, cx, cy));
  const pending = dragPos !== null;
  dragPos = { x, y };
  if (pending) return; // já há um envio na fila: ele leva a posição mais nova
  inDrag(async () => {
    const p = dragPos!;
    dragPos = null;
    await api.dragMove(dragTitle, p.x, p.y);
  });
}

function tearEnd(id: string, p: TearPoint, cancelled: boolean) {
  dragPos = null;
  dragId = null;
  selfDragging = false;
  const target = cancelled ? null : (localTarget(id, p.cx, p.cy) ?? null);
  clearDropHint();
  if (cancelled || target?.kind === "none") return void inDrag(() => api.dragCancel());
  if (target) {
    return void inDrag(async () => {
      await api.dragCancel();
      await dropLocal(id, target);
    });
  }
  inDrag(async () => {
    const copy = await prepareToLeave(id);
    if (!copy) return void (await api.dragCancel());
    const dest = await enqueue(() => api.dropTab(copy, p.x, p.y, p.gx, p.gy));
    if (dest !== winLabel) await removeLocalTab(id);
    void api.prewarm().catch(() => {}); // repõe a janela reserva
  });
}

/** Menu de contexto da aba: dividir, mover para outra janela, fechar. */
async function openTabMenu(tab: TabState, anchor: HTMLElement) {
  const others = (await api.listWindows()).filter((w) => w.label !== winLabel);
  const g = groups.get(tab.group)!;
  const split = (label: string, side: Side): MenuItem => ({ label, action: () => void splitGroup(g, side, tabsOf(g).length > 1 ? tab.id : undefined) });
  const asTab = (fn: () => void) => () => void activate(tab.id).then(fn);
  const items: MenuItem[] = [
    ...(effectiveLang(tab) === "markdown"
      ? [exportItem({ exportHtml: asTab(menuActions.exportHtml), exportPdf: asTab(menuActions.exportPdf), copyHtml: asTab(menuActions.copyHtml) }, true), "sep" as const]
      : []),
    split("Dividir à direita", "right"),
    split("Dividir abaixo", "bottom"),
    split("Dividir à esquerda", "left"),
    split("Dividir acima", "top"),
    "sep",
    { label: "Mover para uma nova janela", action: () => void sendTab(tab.id, "new") },
    ...others.map((w): MenuItem => ({ label: `Mover para: ${w.name}`, action: () => void sendTab(tab.id, w.label) })),
  ];
  if (!isMain) items.push({ label: "Voltar para a janela principal", action: () => void sendTab(tab.id, "main") });
  items.push("sep", { label: "Fechar", shortcut: "Ctrl+W", action: () => void closeTab(tab.id) });
  showMenu(anchor, items, "below");
}

// ---- onde a aba arrastada de outra janela vai entrar ----------------------------------

let ghost: { el: HTMLElement; index: number; timer: number; group: Group } | null = null;

function clearGhost() {
  if (!ghost) return;
  window.clearTimeout(ghost.timer);
  ghost.el.remove();
  ghost = null;
}

/** Mostra, na barra do painel `g`, um espaço com o título da aba no lugar exato em que ela entraria. */
function showGhost(cx: number, title: string, g: Group) {
  if (ghost && ghost.group !== g) clearGhost();
  const tabs = [...g.tabsEl.querySelectorAll<HTMLElement>(".tab:not(.ghost):not(.torn)")];
  const gw = ghost?.el.offsetWidth ?? 0;
  const centers = tabs.map((t) => {
    const r = t.getBoundingClientRect();
    const after = ghost && ghost.el.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING;
    return r.left + r.width / 2 - (after ? gw : 0); // descontando o espaço que o próprio marcador ocupa
  });
  const index = insertionIndex(centers, cx);
  if (!ghost) {
    const el = document.createElement("div");
    el.className = "tab ghost";
    ghost = { el, index: -1, timer: 0, group: g };
  }
  ghost.el.textContent = title || "Nova nota";
  if (ghost.index !== index || !ghost.el.isConnected) {
    ghost.index = index;
    g.tabsEl.insertBefore(ghost.el, tabs[index] ?? g.tabsEl.querySelector(".new-tab"));
  }
  window.clearTimeout(ghost.timer);
  ghost.timer = window.setTimeout(clearGhost, 1200); // some sozinho se o aviso de saída se perder
}

// Aba arrastada de OUTRA janela passando por esta: mostra onde entraria (na barra, ou numa borda
// de painel, que abre um painel novo) e avisa o Rust se aqui ela é aceita. O meio de um painel não é.
let incoming: { g: Group; index?: number; zone?: Side; at: number } | null = null;
let lastAccept = false;
const setAccept = (v: boolean) => {
  if (v === lastAccept) return;
  lastAccept = v;
  void api.dragAccept(v).catch(() => {});
};

void listen<{ cx: number; cy: number; title: string; target: string }>("drag-over", (e) => {
  if (e.payload.target !== winLabel) return;
  dragTitle = e.payload.title;
  const t = targetAt(e.payload.cx, e.payload.cy);
  showDropHint(t);
  if (t?.kind === "strip") incoming = { g: t.g, index: ghost?.index, at: Date.now() };
  else if (t?.kind === "zone" && t.zone !== "center") incoming = { g: t.g, zone: t.zone, at: Date.now() };
  else incoming = null;
  setAccept(!!t);
});
void listen<string>("drag-leave", (e) => {
  if (e.payload !== winLabel) return;
  clearDropHint(); // `incoming` fica: a aba chega logo depois e usa o último lugar mostrado
  lastAccept = false;
});

// uma aba chegou de outra janela (no lugar que a barra mostrou, se foi arrastada)
const incomingReady = listen<TabState>("tab-incoming", (e) => void receiveTab(e.payload));

async function receiveTab(tab: TabState) {
  if (!booted) {
    pendingIn.push(tab);
    return;
  }
  if (tab.window !== winLabel || session.tabs.some((t) => t.id === tab.id)) return;
  const inc = incoming && Date.now() - incoming.at < 2500 && groups.get(incoming.g.id) === incoming.g ? incoming : null;
  incoming = null;
  clearDropHint();
  snapshotActive();
  states.delete(tab.id);
  detected.delete(tab.id);
  if (inc?.zone) {
    // solta na borda de um painel: a aba ganha um painel novo ali (e é a última da lista de abas)
    const g = createGroup(newGroupId());
    layout.root = splitLeaf(layout.root, inc.g.id, inc.zone, g.id);
    renderLayout();
    placeInGroup(tab, g);
  } else {
    const g = inc?.g ?? cur;
    placeInGroup(tab, g, inc?.index !== undefined && inc.index >= 0 ? Math.min(inc.index, tabsOf(g).length) : undefined);
  }
  await show(tab); // lê o texto gravado pela janela de origem
  sessionDirty = true;
  scheduleSave();
  if (!shown) {
    shown = true;
    void api.windowReady(); // a janela reserva só aparece agora
  } else {
    void thisWindow.setFocus();
  }
}

// o app vai fechar: grava e avisa a principal
void listenAll("app-exit", async () => {
  exiting = true;
  await flush();
  await emitTo("main", "app-exit-ack", winLabel);
});

/** Principal: pede às outras janelas que gravem e espera as respostas (com limite de tempo). */
async function closeEverything() {
  await flush();
  const others = (await api.listWindows()).map((w) => w.label).filter((l) => l !== "main");
  if (others.length > 0) {
    const pending = new Set(others);
    await new Promise<void>((done) => {
      const t = window.setTimeout(done, 2500);
      void listen<string>("app-exit-ack", (e) => {
        pending.delete(e.payload);
        if (pending.size === 0) {
          window.clearTimeout(t);
          done();
        }
      }).then(() => emit("app-exit"));
    });
  }
  await api.exitApp();
}

// ---- arquivos ---------------------------------------------------------------

const FILTERS = [
  { name: "Texto, Markdown e DBML", extensions: ["md", "markdown", "txt", "dbml", "dbmlx"] },
  { name: "Todos os arquivos", extensions: ["*"] },
];

function exportBaseName(tab: TabState): string {
  return suggestedName(tab).replace(/\.[^.]+$/, "");
}

async function exportHtml() {
  const tab = activeTab();
  if (effectiveLang(tab) !== "markdown") return;
  try {
    const path = await saveDialog({
      defaultPath: `${exportBaseName(tab)}.html`,
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (!path) return;
    const { markdownToHtml } = await import("./mdexport");
    const html = await markdownToHtml(cur.view.state.doc.toString(), exportBaseName(tab));
    await api.exportFile(path, Array.from(new TextEncoder().encode(html)));
  } catch (e) {
    await message(String(e), { title: "Não foi possível exportar", kind: "error" });
  }
}

async function exportPdf() {
  const tab = activeTab();
  if (effectiveLang(tab) !== "markdown") return;
  try {
    const { printAsPdf } = await import("./mdexport");
    await printAsPdf(cur.view.state.doc.toString(), exportBaseName(tab));
  } catch (e) {
    await message(String(e), { title: "Não foi possível exportar", kind: "error" });
  }
}

async function copyHtml() {
  if (effectiveLang(activeTab()) !== "markdown") return;
  try {
    const { copyAsHtml } = await import("./mdexport");
    await copyAsHtml(cur.view.state.doc.toString());
  } catch (e) {
    await message(String(e), { title: "Não foi possível copiar", kind: "error" });
  }
}

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
  const showing = groupShowing(tab.id);
  if (showing) snapshotGroup(showing);
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

function setView(mode: ViewMode) {
  const tab = activeTab();
  if (!previewAvailable(tab) || (tab.mode === mode && !tab.detached)) return;
  tab.mode = mode;
  tab.detached = false; // escolher uma visão traz a preview de volta para a janela
  sessionDirty = true;
  scheduleSave();
  applyTabConfig();
  cur.view.focus();
}

/** Ctrl+E: liga/desliga a visão renderizada (no markdown, a do próprio texto). */
function togglePreview() {
  setView(viewKind(activeTab()) === "source" ? "rendered" : "source");
}

/** Ctrl+Shift+E: liga/desliga a visão lado a lado. */
function toggleSplit() {
  setView(viewKind(activeTab()) === "split" ? "source" : "split");
}

function toggleWrap() {
  wrap = !wrap;
  writeSetting("wrap", wrap);
  applyTabConfig();
  cur.view.focus();
}

function toggleOverwrite() {
  overwrite = !overwrite;
  applyTabConfig();
  cur.view.focus();
}

function setLanguage(l: Language) {
  const tab = activeTab();
  tab.language = l;
  redetect(tab);
  sessionDirty = true;
  scheduleSave();
  applyTabConfig();
  cur.view.focus();
}

const menuActions = {
  newNote: () => void newTab(),
  newWindow: () => void api.newWindow(),
  tabToNewWindow: () => void sendTab(session.active!, "new"),
  openFile: () => void openFiles(),
  save: () => void save(),
  saveAs: () => void save(activeTab(), true),
  closeTab: () => void closeTab(session.active!),
  reopenTab: () => void reopenTab(),
  history: () => void showHistory(),
  exportHtml: () => void exportHtml(),
  exportPdf: () => void exportPdf(),
  copyHtml: () => void copyHtml(),
  exit: () => void thisWindow.close(),
  undo: () => (undo(cur.view), cur.view.focus()),
  redo: () => (redo(cur.view), cur.view.focus()),
  selectAll: () => (selectAll(cur.view), cur.view.focus()),
  find: () => openSearchPanel(cur.view),
  replace: () => openSearchPanel(cur.view),
  gotoLine: () => gotoLine(cur.view),
  togglePreview,
  toggleSplit,
  setView,
  toggleDetached,
  toggleWrap,
  setLanguage,
  splitRight: () => splitActive("right"),
  splitDown: () => splitActive("bottom"),
  current: () => {
    const tab = activeTab();
    return {
      language: tab.language,
      lang: effectiveLang(tab),
      view: tab.mode,
      detached: tab.detached,
      previewAvailable: previewAvailable(tab),
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
    if (e.code === "Backslash" || e.code === "IntlBackslash" || key === "\\") {
      e.preventDefault();
      return splitActive(e.shiftKey ? "bottom" : "right");
    }
    if (/^[1-9]$/.test(key) && !e.shiftKey) {
      e.preventDefault();
      return focusGroupNumber(Number(key));
    }
    const run = (fn: () => void) => (e.preventDefault(), fn());
    if (key === "t" && e.shiftKey) run(() => void reopenTab());
    else if (key === "h" && e.shiftKey) run(() => void showHistory());
    else if (key === "n" && e.shiftKey) run(menuActions.newWindow);
    else if ((key === "n" || key === "t") && !e.shiftKey) run(menuActions.newNote);
    else if (key === "o") run(menuActions.openFile);
    else if (key === "s") run(e.shiftKey ? menuActions.saveAs : menuActions.save);
    else if (key === "w") run(menuActions.closeTab);
    else if (key === "e") run(e.shiftKey ? toggleSplit : togglePreview);
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
  document.body.classList.toggle("floating", !isMain); // janelas flutuantes: sem menu superior
  await incomingReady; // ouvindo antes de ler a sessão: nenhuma aba que chegue se perde
  const startup = await api.loadStartup();
  session = startup.session;
  const idle = session.tabs.length === 0; // janela reserva: espera uma aba

  // a grade: um painel por grupo das abas; a gravada vale se ainda bater com elas
  for (const t of session.tabs) t.group = Number.isInteger(t.group) ? t.group : 0;
  const gids = [...new Set(session.tabs.map((t) => t.group))].sort((a, b) => a - b);
  const saved = startup.layout as (Layout & { active?: Record<string, string | null> }) | null;
  layout = normalize(saved, gids.length > 0 ? gids : [0]);
  workEl.replaceChildren();
  for (const gid of groupsOf(layout.root)) createGroup(gid);
  const startTab = session.tabs.find((t) => t.id === session.active);
  cur = groups.get(startTab?.group ?? layout.focus) ?? groups.get(layout.focus)!;
  layout.focus = cur.id;
  for (const g of groups.values()) {
    const mine = tabsOf(g);
    const wanted = g === cur ? session.active : (saved?.active?.[g.id] ?? null);
    g.active = mine.find((t) => t.id === wanted)?.id ?? mine[0]?.id ?? null;
  }
  session.active = cur.active;
  renderLayout();

  for (const g of groups.values()) {
    const tab = tabOf(g);
    if (!tab) continue;
    const text = tab.id === startTab?.id ? startup.active_text : await api.readNote(tab.id);
    const st = createState(text, tab.cursor, onEditorUpdate);
    states.set(tab.id, st);
    g.view.setState(st);
    redetect(tab);
  }
  void refreshClosed();
  mountMenuBar(menubarEl, menuActions);
  if (!idle) {
    forEachGroup(applyTabConfig);
    renderTabs();
    requestAnimationFrame(() => {
      for (const g of groups.values()) {
        const tab = tabOf(g);
        if (tab) g.view.scrollDOM.scrollTop = tab.scroll;
      }
      cur.view.focus();
    });
  }

  const win = thisWindow;
  await win.onCloseRequested(async (e) => {
    e.preventDefault();
    if (isMain) return void (await closeEverything());
    if (exiting) return void (await flush()); // o app encerra sozinho
    // janela flutuante fechada: as abas voltam para a principal (nada se perde)
    await flush();
    for (const t of [...session.tabs]) await sendTab(t.id, "main");
    await win.destroy();
  });

  booted = true;
  for (const t of pendingIn.splice(0)) await receiveTab(t);
  if (idle && pendingIn.length === 0 && session.tabs.length === 0) return; // segue escondida
  if (!shown) {
    shown = true;
    if (isMain) {
      await win.show(); // janela nasce escondida: sem flash branco
      // com a janela já na tela, prepara a reserva para tirar abas sem demora
      window.setTimeout(() => void api.prewarm().catch(() => {}), 1500);
    } else {
      await api.windowReady();
    }
  }
}

boot().catch((e) => {
  console.error(e);
  document.body.textContent = `Erro ao iniciar: ${e}`;
  void thisWindow.show();
});
