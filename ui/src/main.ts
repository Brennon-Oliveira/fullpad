import { mountGlobalSearch } from "./globalsearch";
import { openSearch } from "./searchpanel";
import { redo, selectAll, undo } from "@codemirror/commands";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView as CMEditorView, type EditorView, type ViewUpdate } from "@codemirror/view";
import { ask, message, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { type UnlistenFn, emit, emitTo, listen as listenAll } from "@tauri-apps/api/event";
import { listenHere as listen } from "./events";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { createFileDrop } from "./filedrop";
import { getVersion } from "@tauri-apps/api/app";
import { api, type ClosedTab, type Encoding, type Eol, type Language, type Session, type TabState, type ViewMode } from "./api";
import { createState, createView, csvHoverMarks, csvSelectionMarks, hintLines, isDark, tabEffects } from "./editor";
import type { DiagramPanel } from "./dbml/panel";
import type { CsvPanel } from "./csv/panel";
import type { JsonPanel, TreeFormat } from "./json/panel";
import { mapCursor } from "./json/format";
import type { MarkdownPane } from "./mdpreview";
import type { ReaderPanel } from "./reader/panel";
import type { ReaderPos } from "./reader/pos";
import { type CsvSettings, activeDelimiter, readCsvSettings } from "./csv/settings";
import { type Lang, detectLanguage, extOf } from "./language";
import { codeLanguageFor } from "./codelangs";
import { pinnedFirst, toCloseAll, toCloseOthers, toCloseSaved, withUnsavedChanges } from "./tabsets";
import { MAX_PREVIEW_CHARS } from "./livepreview";
const MAX_DIAGRAM_CHARS = 500_000; // mesmo valor de dbml/panel.ts (não importamos o módulo no boot)
const MAX_JSON_CHARS = 8_000_000; // mesmo valor de json/panel.ts
const MAX_CSV_CHARS = 50_000_000; // mesmo valor de csv/panel.ts
import { codeLangItems, exportItem, isTree, languageItems, mountMenuBar, sideOnly, topMenus, viewItems, zoomItems } from "./menus";
import { dbmlSymbols, markdownSymbols, pushRecent, treeSymbols, type Symbol as PaletteSymbol } from "./palettecore";
import { type MenuItem, showMenu, showMenuAt } from "./popup";
import { mountStatusBar } from "./statusbar";
import { currentZoom, loadZoom, onZoomChange, setZoom, stepZoom, wheelZoom } from "./zoom";
import { attachTabDrag, insertionIndex, type TearPoint } from "./tabdrag";
import { type DockGroup, type DockTile, type Rect, SIDES, dockTiles, tileAt } from "./dock";
import { type Layout, type Node, type Side, type Zone, groupsOf, leaf, nodeAt, normalize, pathTo, removeLeaf, resizeSizes, splitLeaf, splitPath, swapAdjacent, wrapCandidates } from "./grid";
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
let lineNumbers = readSetting("lineNumbers", true);
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
  jsonEl: HTMLElement;
  json?: JsonPanel;
  jsonLoading?: Promise<void>;
  jsonTab: string | null; // aba cuja árvore JSON está na tela
  /** Tabela do CSV: ocupa o painel sozinha ou ao lado do código. */
  csvEl: HTMLElement;
  /** Faixa de aviso logo abaixo das abas (CSV grande demais para a tabela). */
  noteEl: HTMLElement;
  csv?: CsvPanel;
  csvLoading?: Promise<void>;
  csvTab: string | null; // aba cuja tabela está na tela
  /** Leitor de PDF/EPUB (aba só de leitura): carregado sob demanda, cobre o editor. */
  readerEl: HTMLElement;
  reader?: ReaderPanel;
  readerLoading?: Promise<void>;
  /** Texto da barra de status enquanto o leitor está na tela. */
  readerInfo?: string | null;
}

const groups = new Map<number, Group>();
let cur: Group;
let layout: Layout = { root: leaf(0), focus: 0 };
const nodeEls = new WeakMap<object, HTMLElement>(); // elemento de cada nó da grade, para medir blocos

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
function readString(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`fullpad.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeString(key: string, value: string) {
  try {
    localStorage.setItem(`fullpad.${key}`, value);
  } catch {
    /* sem storage: só não lembra */
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

/** Aba de leitura (PDF/EPUB/tipo desconhecido): não tem texto, o arquivo nunca é gravado. */
const isReader = (tab: TabState) => tab.kind !== undefined && tab.kind !== "text";

function effectiveLang(tab: TabState): Lang {
  if (tab.kind === "pdf") return "pdf";
  if (tab.kind === "epub") return "epub";
  return tab.language === "auto" ? (detected.get(tab.id) ?? "plain") : tab.language;
}

/** Markdown (live preview) e DBML (diagrama) têm visão renderizada; cada um com seu limite de tamanho. */
function previewAvailable(tab: TabState): boolean {
  const len = states.get(tab.id)?.doc.length ?? 0;
  const lang = effectiveLang(tab);
  return (lang === "markdown" && len <= MAX_PREVIEW_CHARS) || (lang === "dbml" && len <= MAX_DIAGRAM_CHARS) || (isTree(lang) && len <= MAX_JSON_CHARS) || (lang === "csv" && len <= MAX_CSV_CHARS);
}

/** Como o arquivo aparece: só código, renderizado no próprio texto (markdown) ou ao lado do código. */
type ViewKind = "source" | "inline" | "split";

function viewKind(tab: TabState): ViewKind {
  if (!previewAvailable(tab) || tab.mode === "source") return "source";
  if (sideOnly(effectiveLang(tab))) return "split"; // diagrama e árvore sempre ficam ao lado
  return tab.mode === "split" ? "split" : "inline";
}

const previewOn = (tab: TabState) => viewKind(tab) !== "source";

function viewLabel(tab: TabState): string {
  const k = viewKind(tab);
  if (k === "source") return "Código";
  if (tab.detached) return "Janela separada";
  if (effectiveLang(tab) === "dbml") return "Diagrama";
  if (isTree(effectiveLang(tab))) return "Árvore";
  if (effectiveLang(tab) === "csv") return k === "inline" ? "Tabela" : "Tabela e código";
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
      json: isTree(effectiveLang(tab)),
      dark: isDark(),
      support: supportFor(tab),
      preview: viewKind(tab) === "inline" && effectiveLang(tab) === "markdown",
      wrap,
      overwrite,
      lineNumbers: lineNumbers && viewKind(tab) !== "inline",
    }),
  });
  ensureDbmlSupport();
  ensureJsonSupport();
  ensureCsvSupport();
  ensureCodeSupport();
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

// ---- recursos de editor do JSON (linguagem, dobrar blocos, erro de sintaxe; sob demanda) ----

const treeSupport: Partial<Record<TreeFormat, Extension>> = {};
const treeSupportLoading = new Set<TreeFormat>();

function ensureJsonSupport() {
  const lang = effectiveLang(activeTab());
  if (!isTree(lang)) return;
  const f = lang as TreeFormat;
  if (treeSupport[f] || treeSupportLoading.has(f)) return;
  treeSupportLoading.add(f);
  import("./json/editor")
    .then((m) => (f === "json" ? m.jsonEditorSupport() : m.dataEditorSupport(f)))
    .then((ext) => {
      treeSupport[f] = ext;
      forEachGroup(() => effectiveLang(activeTab()) === f && applyTabConfig());
    })
    .catch((e) => console.error(`falha ao carregar o suporte a ${f}`, e))
    .finally(() => treeSupportLoading.delete(f));
}

// ---- recursos de editor do CSV (colunas coloridas; sob demanda) ----

let csvLang: typeof import("./csv/lang") | undefined;
let csvLangLoading = false;
const csvDetected = new Map<string, string>(); // separador achado pela estrutura, por aba (escolha automática)

const csvSettings = (tab: TabState): CsvSettings => readCsvSettings(tab.csv);
const csvDelimiter = (tab: TabState) => activeDelimiter(csvSettings(tab), csvDetected.get(tab.id));

/** Recursos extras da linguagem da aba para o editor (`undefined` enquanto carregam ou quando não há). */
function supportFor(tab: TabState): Extension | undefined {
  switch (effectiveLang(tab)) {
    case "dbml":
      return dbmlSupport;
    case "json":
    case "yaml":
    case "toml":
      return treeSupport[effectiveLang(tab) as TreeFormat];
    case "csv":
      return csvLang?.csvSupport(csvDelimiter(tab));
    default: {
      const d = codeLangOf(tab);
      return d ? codeSupports.get(d.name) : undefined;
    }
  }
}

// ---- destaque de sintaxe dos arquivos de texto (Lang): só colore, o arquivo continua "texto" ----

const codeSupports = new Map<string, Extension>();
const codeLoading = new Set<string>();

/** Linguagem de destaque da aba (escolhida à mão ou pela extensão); só para texto puro. */
function codeLangOf(tab: TabState) {
  return !isReader(tab) && effectiveLang(tab) === "plain" ? codeLanguageFor(tab.path, tab.code_lang) : null;
}

function ensureCodeSupport() {
  const d = codeLangOf(activeTab());
  if (!d || codeSupports.has(d.name) || codeLoading.has(d.name)) return;
  codeLoading.add(d.name);
  d.load()
    .then((sup) => {
      codeSupports.set(d.name, sup);
      forEachGroup(() => session.active && codeLangOf(activeTab())?.name === d.name && applyTabConfig());
    })
    .catch((e) => console.error(`falha ao carregar o destaque de ${d.name}`, e))
    .finally(() => codeLoading.delete(d.name));
}

function setCodeLang(v: string | undefined) {
  const tab = activeTab();
  tab.code_lang = v;
  sessionDirty = true;
  scheduleSave();
  applyTabConfig();
  cur.view.focus();
}

function ensureCsvSupport() {
  if (csvLang || csvLangLoading || effectiveLang(activeTab()) !== "csv") return;
  csvLangLoading = true;
  import("./csv/lang")
    .then((m) => {
      csvLang = m;
      forEachGroup(() => effectiveLang(activeTab()) === "csv" && applyTabConfig());
    })
    .catch((e) => console.error("falha ao carregar o suporte a CSV", e))
    .finally(() => (csvLangLoading = false));
}

/**
 * No automático, pergunta ao Rust qual é o separador (só olha o começo do texto). Escolha manual
 * nunca é redetectada: o que o usuário disse vale dali em diante.
 */
async function syncCsv(tab: TabState) {
  if (effectiveLang(tab) !== "csv" || csvSettings(tab).delimiter !== "auto") return;
  const st = states.get(tab.id);
  if (!st) return;
  const found = await api.csvDetect(st.sliceDoc(0, 200_000), extOf(tab.path ?? "") || null).catch(() => ",");
  if (csvDetected.get(tab.id) === found) return;
  csvDetected.set(tab.id, found);
  // reaplica no painel que mostra a aba (não necessariamente o que tem o foco)
  const showing = groupShowing(tab.id);
  if (showing && csvSettings(tab).delimiter === "auto") withGroup(showing, applyTabConfig);
}

/** Grava uma escolha do CSV na aba e reaplica o editor. */
function patchCsv(patch: Partial<CsvSettings>) {
  const tab = activeTab();
  tab.csv = { ...csvSettings(tab), ...patch };
  sessionDirty = true;
  scheduleSave();
  applyTabConfig();
  void syncCsv(tab);
  cur.view.focus();
}

// ---- visão renderizada em janela separada ------------------------------------------

const previewOpen = new Map<string, UnlistenFn[]>(); // abas com janela de preview aberta
let pvTimer: number | undefined;

const previewLang = (tab: TabState) => (effectiveLang(tab) === "dbml" ? "dbml" : effectiveLang(tab) === "json" ? "json" : "markdown");

/** Pasta do arquivo da aba (para imagens de caminho relativo no JSON). */
const dirOf = (p: string | null) => (p && /[\\/]/.test(p) ? p.replace(/[\\/][^\\/]*$/, "") : null);

async function textOf(id: string): Promise<string> {
  const showing = groupShowing(id);
  return showing?.view.state.doc.toString() ?? states.get(id)?.doc.toString() ?? api.readNote(id);
}

/** Manda o texto atual da aba para a janela de preview dela. */
async function pushPreview(tab: TabState) {
  const text = await textOf(tab.id);
  const showing = groupShowing(tab.id);
  const cursor = showing ? showing.view.state.selection.main.head : null;
  await emitTo(`preview-${tab.id}`, "pv-text", { text, rev: showing?.rev ?? 0, title: tab.title || "Nova nota", cursor, base: dirOf(tab.path) }).catch(() => {});
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
  if (!previewAvailable(tab) || ["yaml", "toml"].includes(effectiveLang(tab))) return; // a árvore de YAML/TOML não vai para janela própria
  if (tab.detached) tab.detached = false;
  else {
    tab.detached = true;
    if (viewKind(tab) === "source") tab.mode = sideOnly(effectiveLang(tab)) ? "rendered" : "split";
    else if (effectiveLang(tab) === "markdown") tab.mode = "split";
  }
  sessionDirty = true;
  scheduleSave();
  applyTabConfig();
  cur.view.focus();
}

// ---- diagrama DBML (carregado sob demanda) ------------------------------------

const diagramWanted = (tab: TabState) => previewOn(tab) && !tab.detached && effectiveLang(tab) === "dbml";

// ---- árvore JSON ao lado do código (carregada sob demanda) ----------------------------

const jsonWanted = (tab: TabState) => isTree(effectiveLang(tab)) && viewKind(tab) === "split" && !tab.detached;
let jsonPath: string | null = null; // caminho do nó sob o cursor, para a barra de status

function syncJson(textChanged: boolean) {
  const g = cur;
  const tab = activeTab();
  if (!jsonWanted(tab)) {
    g.json?.hide();
    g.jsonTab = null;
    jsonPath = null;
    return;
  }
  const text = g.view.state.doc.toString();
  const run = () => {
    const t = tabOf(g);
    if (!g.json || !t || !jsonWanted(t)) return;
    g.json.setFormat(effectiveLang(t) as TreeFormat);
    const fresh = g.jsonTab !== tab.id;
    if (fresh) jsonPath = null;
    if (textChanged && !fresh) g.json.update(text, g.rev);
    else g.json.show(text, fresh, g.rev);
    g.jsonTab = tab.id;
    g.json.setCursor(g.view.state.selection.main.head, g.rev);
  };
  if (g.json) return run();
  g.jsonEl.classList.add("on"); // já abre o espaço enquanto o módulo carrega
  g.jsonLoading ??= import("./json/panel").then((m) => {
    g.json = m.createJsonPanel(g.jsonEl, {
      // mouse sobre um nó → destaca o trecho no código (sem selecionar)
      onHover: (spans, rev) => g.view.dispatch({ effects: hintLines(spans && rev === g.rev ? spans : null) }),
      onSelect: (pos, rev) => rev === g.rev && g.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true }),
      onGoto: (span, rev) => {
        if (rev !== g.rev) return;
        g.view.dispatch({ selection: { anchor: span.from, head: span.to }, scrollIntoView: true });
        g.view.focus();
      },
      onPath: (p) => {
        jsonPath = p;
        if (g === cur) refreshStatus(false);
      },
      baseDir: () => dirOf(tabOf(g)?.path ?? null),
    });
  });
  void g.jsonLoading.then(run);
}

// ---- tabela do CSV (carregada sob demanda) --------------------------------------------

/** A tabela aparece na visão "tabela" (sozinha) e "lado a lado". O separador precisa já estar decidido. */
const csvWanted = (tab: TabState) =>
  effectiveLang(tab) === "csv" && viewKind(tab) !== "source" && !tab.detached && (csvSettings(tab).delimiter !== "auto" || csvDetected.has(tab.id));

function syncCsvTable(textChanged: boolean) {
  const g = cur;
  const tab = activeTab();
  // CSV grande demais para a tabela: só o código funciona, e a faixa diz por quê
  const big = effectiveLang(tab) === "csv" && g.view.state.doc.length > MAX_CSV_CHARS;
  g.noteEl.hidden = !big;
  if (big) {
    const m = (n: number) => (n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
    g.noteEl.textContent = `Arquivo grande demais para a tabela (${m(g.view.state.doc.length)} milhões de caracteres; o limite é ${m(MAX_CSV_CHARS)}). Só o código está disponível.`;
  }
  // separador ainda não decidido (abriu agora, ou o app acabou de iniciar): detecta; ao terminar, volta aqui
  if (effectiveLang(tab) === "csv" && viewKind(tab) !== "source" && !csvWanted(tab) && !tab.detached) void syncCsv(tab);
  const wanted = csvWanted(tab);
  // sozinha, a tabela cobre o painel e o editor (que segue vivo, escondido, com o texto e o histórico) some
  g.bodyEl.classList.toggle("tableonly", wanted && viewKind(tab) === "inline");
  if (!wanted) {
    g.csv?.hide();
    g.csvEl.classList.remove("on");
    if (g.csvTab !== null) queueMicrotask(() => g.view.dispatch({ effects: [csvSelectionMarks(null), csvHoverMarks(null)] })); // sai da tela: apaga os destaques no código
    g.csvTab = null;
    return;
  }
  const text = g.view.state.doc.toString();
  const cfg = () => {
    const s = csvSettings(tab);
    return { delimiter: csvDelimiter(tab), header: s.header, decimal: s.decimal };
  };
  const run = () => {
    const t = tabOf(g);
    if (!g.csv || !t || !csvWanted(t)) return;
    const fresh = g.csvTab !== tab.id;
    if (textChanged && !fresh) g.csv.update(text, g.rev);
    else g.csv.show(tab.id, text, cfg(), g.rev);
    g.csvTab = tab.id;
    g.csv.setCursor(g.view.state.selection.main.head, g.rev);
  };
  if (g.csv) return run();
  g.csvEl.classList.add("on"); // já abre o espaço enquanto o módulo carrega
  g.csvLoading ??= import("./csv/panel").then((m) => {
    g.csv = m.createCsvPanel(g.csvEl, {
      // clique numa célula → o cursor do código vai para ela (o foco fica na tabela)
      onSelect: (pos, rev) => rev === g.rev && g.view.dispatch({ selection: { anchor: Math.min(pos, g.view.state.doc.length) }, scrollIntoView: true }),
      // gravar uma célula: troca no texto do código, num passo só do desfazer (vale só para o texto que a tabela indexou)
      onEdit: (edits, rev) => {
        if (rev !== g.rev) return false;
        g.view.dispatch({ changes: edits.map((e) => ({ from: e.from, to: e.to, insert: e.insert })), userEvent: "input.csv" });
        return true;
      },
      onUndo: () => void undo(g.view),
      onRedo: () => void redo(g.view),
      // células selecionadas / sob o mouse → o texto delas ganha fundo no código
      onSelection: (spans, rev) => g.view.dispatch({ effects: csvSelectionMarks(spans && rev === g.rev ? spans : null) }),
      onHover: (spans, rev) => g.view.dispatch({ effects: csvHoverMarks(spans && rev === g.rev ? spans : null) }),
    });
  });
  void g.csvLoading.then(run);
}

// ---- leitor de PDF/EPUB (aba só de leitura; carregado sob demanda) ----------------------

/** Mostra o leitor no lugar do editor se a aba ativa do painel é de leitura; senão o esconde. */
function syncReader() {
  const g = cur;
  const tab = activeTab();
  const wanted = isReader(tab);
  g.bodyEl.classList.toggle("reading", wanted);
  if (!wanted) return void g.reader?.hide();
  g.readerLoading ??= import("./reader/panel").then((m) => {
    g.reader = m.createReaderPanel(g.readerEl, {
      onPosition(id, pos: ReaderPos) {
        const t = session.tabs.find((x) => x.id === id);
        if (!t) return;
        t.reader = pos;
        sessionDirty = true;
        scheduleSave();
      },
      onRelocated(updated) {
        const t = session.tabs.find((x) => x.id === updated.id);
        if (!t) return;
        t.path = updated.path;
        t.title = updated.title;
        renderTabs();
        sessionDirty = true;
        scheduleSave();
      },
      onInfo(text) {
        g.readerInfo = text;
        if (g === cur) refreshStatus(false);
      },
    });
    new ResizeObserver(() => g.reader?.resize()).observe(g.readerEl);
  });
  void g.readerLoading.then(() => {
    const t = tabOf(g);
    if (g.reader && t && isReader(t)) g.reader.show(t);
  });
}

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
  syncReader();
  syncMdPane(textChanged);
  syncJson(textChanged);
  syncCsvTable(textChanged);
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
    void syncCsv(tab);
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
const LANG_LABEL: Record<Lang, string> = { plain: "Texto simples", markdown: "Markdown", dbml: "DBML", json: "JSON", csv: "CSV", yaml: "YAML", toml: "TOML", pdf: "PDF", epub: "EPUB" };

function langLabel(tab: TabState): string {
  const l = LANG_LABEL[effectiveLang(tab)];
  return tab.language === "auto" && !isReader(tab) ? `${l} (automático)` : l; // aba de leitura não tem linguagem a detectar
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
  if (isReader(tab)) {
    menubar?.refresh();
    status.update({ languageLabel: langLabel(tab), viewLabel: "", viewAvailable: false, size: 0, lines: 0, ln: 0, col: 0, pos: 0, eolLabel: "", encodingLabel: "", overwrite: false, reader: cur.readerInfo ?? "" });
    return;
  }
  const st = cur.view.state;
  const head = st.selection.main.head;
  const line = st.doc.lineAt(head);
  if (recomputeSize) lastSize = computeSize();
  menubar?.refresh();
  status.update({
    languageLabel: langLabel(tab),
    viewLabel: viewLabel(tab),
    viewAvailable: previewAvailable(tab),
    codeLang: effectiveLang(tab) === "plain" ? (codeLangOf(tab)?.name ?? null) : undefined,
    size: lastSize,
    lines: st.doc.lines,
    ln: line.number,
    col: head - line.from + 1,
    pos: head + 1,
    eolLabel: EOL_LABEL[tab.eol],
    encodingLabel: ENC_LABEL[tab.encoding],
    overwrite,
    path: jsonTreeOn() ? jsonPath : null,
  });
}

function jsonTreeOn() {
  return cur.jsonTab !== null && cur.jsonTab === session.active;
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
  onZoom: (a) => showMenu(a, zoomItems(menuActions), "above"),
  onZoomOut: () => menuActions.zoomOut(),
  onZoomIn: () => menuActions.zoomIn(),
  onLanguage: (a) => showMenu(a, languageItems(menuActions), "above"),
  onView: (a) => showMenu(a, viewItems(menuActions), "above"),
  onCodeLang: (a) => showMenu(a, codeLangItems(menuActions), "above"),
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
  if (isReader(tab)) return; // sem texto: a posição de leitura é gravada pelo próprio leitor
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
  if (u.selectionSet && !u.docChanged && g.jsonTab === activeTab().id) g.json?.setCursor(u.state.selection.main.head, g.rev); // cursor → nó na árvore
  if (u.selectionSet && !u.docChanged && g.csvTab === activeTab().id) g.csv?.setCursor(u.state.selection.main.head, g.rev); // cursor → célula na tabela
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

/** Alfinete (agulha) mostrado no lugar do × nas abas fixadas. */
const PIN_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M9.5 1.5 14.5 6.5l-1.4.4-2.4 2.4.3 3.1-1 1-2.6-2.6L3.6 13.3 2.7 13.3l0-.9 3.2-3.2L3.3 6.6l1-1 3.1.3 2.4-2.4z"/></svg>';

function renderTabs() {
  clearGhost();
  for (const g of groups.values()) renderStrip(g);
  updateTitle();
}

function renderStrip(g: Group) {
  g.tabsEl.replaceChildren(
    ...tabsOf(g).map((t) => {
      const el = document.createElement("div");
      el.className = "tab" + (t.id === g.active ? " active" : "") + (t.pinned ? " pinned" : "");
      el.role = "tab";
      el.dataset.id = t.id;
      el.title = t.path ?? (t.title || "Nova nota");
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = tabLabel(t);
      const close = document.createElement("button");
      if (t.pinned) {
        close.className = "close pin";
        close.innerHTML = PIN_ICON;
        close.title = "Desafixar";
      } else {
        close.className = "close";
        close.textContent = "×";
        close.title = "Fechar (Ctrl+W)";
      }
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        if (t.pinned) setPinned(t.id, false);
        else void closeTab(t.id);
      });
      el.addEventListener("click", () => void activate(t.id));
      // botão do meio fecha. O mousedown é cancelado para o WebView não ligar a rolagem automática
      el.addEventListener("mousedown", (e) => e.button === 1 && e.preventDefault());
      el.addEventListener("mouseup", (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        void closeTab(t.id);
      });
      el.addEventListener("auxclick", (e) => e.button === 1 && e.preventDefault());
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
  if (!g.tabsEl.dataset.wheel) {
    g.tabsEl.dataset.wheel = "1";
    // a roda comum rola a barra na horizontal (Ctrl+roda continua sendo o zoom)
    g.tabsEl.addEventListener(
      "wheel",
      (e) => {
        if (e.ctrlKey || e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        e.preventDefault();
        g.tabsEl.scrollLeft += e.deltaY;
      },
      { passive: false },
    );
  }
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
  void syncCsv(tab);
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

// ---- paleta (Ctrl+P): arquivos, `:` linha, `@` título/símbolo, `>` comandos --------------

const RECENTS_KEY = "fullpad.recentFiles";
function loadRecents(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
/** Lembra um arquivo aberto/salvo para o Ctrl+P (só caminhos; os 50 últimos). */
function rememberPath(path: string) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(pushRecent(loadRecents(), path)));
  } catch {
    /* sem armazenamento: a paleta só fica sem "recentes" */
  }
}

/** Vai para a linha/coluna (1 = primeira) do editor do painel atual. */
function gotoLineCol(line: number, col?: number) {
  const v = cur.view;
  const doc = v.state.doc;
  const ln = doc.line(Math.min(Math.max(line, 1), doc.lines));
  const pos = Math.min(ln.from + Math.max(0, (col ?? 1) - 1), ln.to);
  v.dispatch({ selection: { anchor: pos }, effects: CMEditorView.scrollIntoView(pos, { y: "center" }) });
  v.focus();
}

function gotoPos(pos: number) {
  const v = cur.view;
  const at = Math.min(pos, v.state.doc.length);
  v.dispatch({ selection: { anchor: at }, effects: CMEditorView.scrollIntoView(at, { y: "start", yMargin: 60 }) });
  v.focus();
}

async function symbolsOfActive(): Promise<PaletteSymbol[] | null> {
  if (!session.active) return null;
  const tab = activeTab();
  if (isReader(tab)) return null;
  const text = cur.view.state.doc.toString();
  const lang = effectiveLang(tab);
  try {
    if (lang === "markdown") return markdownSymbols(text);
    if (lang === "dbml") return dbmlSymbols(text);
    if (lang === "json" || lang === "yaml" || lang === "toml") {
      const a = lang === "json" ? await api.jsonAnalyze(text) : await api.dataAnalyze(lang, text);
      return a.doc ? treeSymbols(a.doc.nodes) : [];
    }
  } catch {
    return [];
  }
  return null;
}

/** Itens dos menus, achatados: "Editar › Substituir…". Desligados e submenus de valores ficam de fora do que não executa. */
function paletteCommands() {
  const out: { title: string; path: string; shortcut?: string; run: () => void }[] = [];
  const walk = (items: MenuItem[], trail: string) => {
    for (const it of items) {
      if (it === "sep" || it.disabled) continue;
      if (it.submenu) walk(it.submenu, `${trail} › ${it.label.replace(/…$/, "")}`);
      else if (it.action) out.push({ title: it.label, path: trail, shortcut: it.shortcut, run: it.action });
    }
  };
  try {
    for (const m of topMenus(menuActions)) walk(m.items(), m.label());
  } catch {
    /* janela sem aba ativa: sem comandos que dependam dela */
  }
  return out;
}

async function openPaletteWith(initial: string) {
  const { openPalette } = await import("./palette");
  const jump = (line?: number, col?: number) => line !== undefined && gotoLineCol(line, col);
  openPalette(
    {
      tabs: () => pinnedFirst(session.tabs).map((t) => ({ id: t.id, title: t.title, path: t.path, pinned: !!t.pinned, active: t.id === session.active })),
      closed: () => closedCache.map((c) => ({ id: c.tab.id, title: c.tab.title, path: c.tab.path })),
      recents: loadRecents,
      commands: paletteCommands,
      symbols: symbolsOfActive,
      lineCount: () => (session.active && !isReader(activeTab()) ? cur.view.state.doc.lines : null),
      gotoLine: gotoLineCol,
      gotoPos,
      openTab: (id, line, col) => void activate(id).then(() => jump(line, col)),
      reopen: (id, line, col) => void reopenTab(id).then(() => jump(line, col)),
      openPath: (path, line, col) => void openPaths([path]).then(() => jump(line, col)),
      refocus: () => cur.view.focus(),
    },
    initial,
  );
}

async function closeTab(id: string, ask = true) {
  const tab = session.tabs.find((t) => t.id === id);
  if (!tab || (ask && tab.pinned)) return; // fixada: só fecha depois de desafixar
  if (ask && groups.get(tab.group) !== cur) enterGroup(groups.get(tab.group)!);
  if (id === session.active) snapshotActive();

  if (ask && tab.dirty && tab.path) {
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

/** Fixa/desafixa a aba; as fixadas ficam juntas à esquerda do painel dela. */
function setPinned(id: string, pinned: boolean) {
  const tab = session.tabs.find((t) => t.id === id);
  if (!tab || !!tab.pinned === pinned) return;
  tab.pinned = pinned || undefined;
  const mine = tabsOf(groups.get(tab.group)!);
  const ordered = pinnedFirst(mine);
  const slots = session.tabs.map((t, i) => (t.group === tab.group ? i : -1)).filter((i) => i >= 0);
  ordered.forEach((t, k) => (session.tabs[slots[k]] = t));
  sessionDirty = true;
  scheduleSave();
  renderTabs();
  if (pinned && session.active !== id) void activate(id); // fixar também seleciona a aba
  // a aba mudou de lugar: leva a barra até ela (depois do desenho, senão a medida ainda é a antiga)
  const g = groups.get(tab.group)!;
  const reveal = () => g.tabsEl.querySelector<HTMLElement>(`.tab[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  reveal();
  requestAnimationFrame(reveal);
}

/**
 * Fecha várias abas desta janela de uma vez. Se alguma tem alterações num arquivo, pergunta uma só
 * vez; "Cancelar" (ou uma falha ao salvar) não fecha nenhuma.
 */
async function closeMany(targets: TabState[]) {
  if (targets.length === 0) return;
  snapshotActive();
  const dirty = withUnsavedChanges(targets);
  if (dirty.length > 0) {
    const r = await message(
      dirty.length === 1 ? `Salvar as alterações em "${dirty[0].title}"?` : `Salvar as alterações em ${dirty.length} arquivos?`,
      { title: "Fullpad", kind: "warning", buttons: { yes: "Salvar", no: "Não salvar", cancel: "Cancelar" } },
    );
    if (r === "Cancelar") return;
    try {
      if (r === "Salvar") for (const t of dirty) if (!(await save(t))) return;
    } catch (e) {
      await message(String(e), { title: "Erro ao salvar", kind: "error" });
      return;
    }
  }
  for (const t of [...targets]) await closeTab(t.id, false);
}

/** Grava todas as abas desta janela que têm alterações em arquivo. */
async function saveAll() {
  snapshotActive();
  for (const t of withUnsavedChanges(session.tabs)) if (!(await save(t))) return;
}

// ---- busca global (todas as abas desta janela) ----------------------------------------

const textTabIds = () => session.tabs.filter((t) => !isReader(t)).map((t) => t.id);

/** Ativa a aba e seleciona o resultado nela. */
async function gotoMatch(id: string, m: { start: number; end: number }) {
  await activate(id);
  const tab = session.tabs.find((t) => t.id === id);
  const g = tab && groups.get(tab.group);
  if (!g || g.active !== id) return;
  const len = g.view.state.doc.length;
  if (m.end > len) return; // o texto mudou depois da busca
  g.view.dispatch({ selection: { anchor: m.start, head: m.end }, effects: CMEditorView.scrollIntoView(m.start, { y: "center" }) });
  g.view.focus();
}

/** Aplica as trocas da busca global: uma transação por aba (um passo no Ctrl+Z de cada). */
async function applyGlobalReplace(all: import("./api").TabHits[]): Promise<number> {
  let done = 0;
  let skipped = 0;
  for (const h of all) {
    const tab = session.tabs.find((t) => t.id === h.id);
    if (!tab || isReader(tab)) continue;
    if (h.hits.total > h.hits.matches.length) {
      skipped++; // mais resultados do que o Rust devolve: trocar só uma parte enganaria
      continue;
    }
    const changes = h.hits.matches.map((m) => ({ from: m.start, to: m.end, insert: m.replacement ?? "" }));
    const showing = groupShowing(h.id);
    const doc = showing ? showing.view.state.doc : (await loadState(tab)).doc;
    if (changes.some((c) => c.to > doc.length)) {
      skipped++;
      continue;
    }
    if (showing) {
      showing.view.dispatch({ changes, userEvent: "input.replace" });
      if (showing !== cur) markModified(tab);
    } else {
      states.set(h.id, (await loadState(tab)).update({ changes, userEvent: "input.replace" }).state);
      markModified(tab);
    }
    if (!tab.path) tab.title = titleOf(states.get(h.id)?.doc.toString() ?? showing!.view.state.doc.toString());
    done += changes.length;
  }
  renderTabs();
  if (skipped > 0) {
    await message(`${skipped} ${skipped === 1 ? "arquivo ficou" : "arquivos ficaram"} sem trocar: tem mais de 2000 resultados ou mudou desde a busca. Refine a busca e tente de novo.`, { title: "Fullpad", kind: "warning" });
  }
  return done;
}

const gsEl = document.getElementById("gsearch")!;
const globalSearch = mountGlobalSearch(gsEl, {
  titleOf: (id) => session.tabs.find((t) => t.id === id)?.title || "Nova nota",
  tabIds: textTabIds,
  search: async (query, options, replace) => {
    await flush(); // a busca lê do disco: o que está só na memória precisa ir antes
    return api.searchTabs(textTabIds(), query, options, replace);
  },
  open: (id, m) => void gotoMatch(id, m),
  applyReplace: applyGlobalReplace,
  confirm: async (text) => (await message(text, { title: "Substituir em todas as abas", kind: "warning", buttons: { ok: "Substituir", cancel: "Cancelar" } })) === "Substituir",
  close: () => {
    globalSearch.hide();
    cur.view.focus();
  },
});

function openGlobalSearch() {
  const sel = session.active && !isReader(activeTab()) ? cur.view.state.sliceDoc(cur.view.state.selection.main.from, cur.view.state.selection.main.to) : "";
  globalSearch.show(sel && !sel.includes("\n") && sel.length <= 200 ? sel : undefined);
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
  const jsonEl = div("jsonview");
  const csvEl = div("csvview");
  const readerEl = div("reader");
  bodyEl.append(editorEl, mdEl, diagramEl, jsonEl, csvEl, readerEl);
  const noteEl = div("note");
  noteEl.hidden = true;
  el.append(tabsEl, noteEl, bodyEl);
  const view = createView(editorEl, createState("", 0, onEditorUpdate));
  const g: Group = { id, el, tabsEl, bodyEl, editorEl, diagramEl, mdEl, jsonEl, csvEl, noteEl, readerEl, view, active: null, rev: 0, diagramTab: null, jsonTab: null, csvTab: null };
  groups.set(id, g);
  view.scrollDOM.addEventListener("scroll", () => followScroll(g), { passive: true });
  // botão direito num markdown ou JSON: copiar/colar e exportar/formatar (nos outros tipos fica o menu padrão)
  el.addEventListener("contextmenu", (e) => {
    const t = tabOf(g);
    const lang = t ? effectiveLang(t) : "plain";
    if (!t || (lang !== "markdown" && lang !== "json") || (e.target as HTMLElement).closest(".tabs")) return;
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
    if (lang === "markdown") items.push("sep", exportItem(menuActions, true));
    else if (inEditor) {
      items.push(
        "sep",
        { label: "Formatar documento", shortcut: "Alt+Shift+F", action: menuActions.formatJson },
        { label: "Formatar seleção", disabled: sel.empty, action: menuActions.formatJsonSelection },
        { label: "Minificar", action: menuActions.minifyJson },
        { label: "Ordenar chaves e formatar", action: menuActions.sortJson },
      );
    }
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
      nodeEls.set(n, g.el);
      return g.el;
    }
    const el = document.createElement("div");
    el.className = `split ${n.dir}`;
    nodeEls.set(n, el);
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
    const onGrip = e.target === grip;
    const [x0, y0] = [e.clientX, e.clientY];
    const move = (ev: PointerEvent) => {
      n.sizes = resizeSizes(base, i, ((row ? ev.clientX : ev.clientY) - start) / total);
      const kids = [...container.children].filter((c) => !c.classList.contains("splitter")) as HTMLElement[];
      kids.forEach((k, j) => (k.style.flex = `${n.sizes[j]} 1 0`));
    };
    const up = (ev: PointerEvent) => {
      sp.classList.remove("active");
      // clicar (sem arrastar) nos pontinhos abre o menu; arrastar a partir deles redimensiona como no resto da divisa
      if (ev.type === "pointerup" && onGrip && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) {
        const r = grip.getBoundingClientRect();
        menu(r.right, r.top);
      }
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
  csvDetected.delete(id);
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
async function splitGroup(src: Group, side: Side, tabId?: string, path?: number[]) {
  const g = createGroup(newGroupId());
  layout.root = path && nodeAt(layout.root, path) ? splitPath(layout.root, path, side, g.id) : splitLeaf(layout.root, src.id, side, g.id);
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
type DropTarget =
  | { kind: "strip"; g: Group; cx: number }
  | { kind: "zone"; g: Group; zone: Zone; /** nó da grade que ganha o vizinho (um painel ou um bloco inteiro) */ path?: number[] }
  | { kind: "none" };

// Enquanto se arrasta uma aba, cada painel mostra seus alvos (dock.ts): borda (divide o painel),
// barra externa (divide o bloco inteiro de uma pilha) e centro (move para o painel).
let dock: { tiles: DockTile[]; layer: HTMLElement; els: Map<DockTile, HTMLElement>; on: DockTile | null; timer: number } | null = null;

const rectOf = (el: HTMLElement): Rect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

/** Mostra os alvos de todos os painéis. `src`: painel de onde a aba sai (sem ele, vem de outra janela). */
function openDock(src?: Group) {
  closeDock();
  const input: DockGroup[] = [...groups.values()].map((g) => {
    const cands = {} as DockGroup["cands"];
    for (const side of SIDES) {
      cands[side] = wrapCandidates(layout.root, g.id, side).flatMap((path) => {
        const n = nodeAt(layout.root, path);
        const el = n && nodeEls.get(n);
        return el ? [{ path, rect: rectOf(el) }] : [];
      });
    }
    const alone = !!src && g === src && tabsOf(g).length === 1; // sozinha, uma aba não divide o próprio painel
    // de outra janela não há centro: soltar no meio de um painel vira uma janela própria
    return { g: g.id, body: rectOf(g.bodyEl), cands, edges: !alone, center: !!src && g !== src };
  });
  const tiles = dockTiles(input, cur.tabsEl.getBoundingClientRect().height);
  const layer = document.createElement("div");
  layer.className = "dock-layer";
  const w = workEl.getBoundingClientRect();
  const els = new Map<DockTile, HTMLElement>();
  for (const t of tiles) {
    const el = document.createElement("div");
    el.className = `dock-tile ${t.kind}`;
    Object.assign(el.style, { left: `${t.rect.left - w.left}px`, top: `${t.rect.top - w.top}px`, width: `${t.rect.width}px`, height: `${t.rect.height}px` });
    layer.append(el);
    els.set(t, el);
  }
  workEl.append(layer);
  dock = { tiles, layer, els, on: null, timer: 0 };
}

function closeDock() {
  if (!dock) return;
  window.clearTimeout(dock.timer);
  dock.layer.remove();
  dock = null;
}

function lightTile(t: DockTile | null) {
  if (!dock || dock.on === t) return;
  if (dock.on) dock.els.get(dock.on)?.classList.remove("on");
  dock.on = t;
  if (t) dock.els.get(t)?.classList.add("on");
}

/**
 * O que há sob o ponto (cx, cy) desta janela para uma aba arrastada. `src`: painel de onde a aba sai
 * (aba da própria janela); sem ele a aba vem de outra janela, que só entra pela barra de abas ou por
 * um alvo de borda: o meio de um painel fica de fora e a aba vira uma janela própria. O preview/diagrama
 * é parte do painel, nunca um destino à parte (conteúdo e preview trocam juntos).
 */
function targetAt(cx: number, cy: number, src?: Group): DropTarget | null {
  if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return lightTile(null), null;
  const tile = dock ? tileAt(dock.tiles, cx, cy) : null;
  lightTile(tile);
  if (tile) {
    const tg = groups.get(tile.g)!;
    return tile.kind === "center" ? { kind: "zone", g: tg, zone: "center" } : { kind: "zone", g: tg, zone: tile.side!, path: tile.path };
  }
  const el = document.elementFromPoint(cx, cy);
  const body = el?.closest<HTMLElement>(".group");
  const g = body && [...groups.values()].find((x) => x.el === body);
  if (!g) return null;
  if (el?.closest(".tabs")) return { kind: "strip", g, cx };
  if (!src) return null;
  if (g !== src) {
    // o resto de outro painel também vale "mover para cá" (o alvo do centro acende)
    lightTile(dock?.tiles.find((t) => t.kind === "center" && t.g === g.id) ?? null);
    return { kind: "zone", g, zone: "center" };
  }
  // o meio do próprio painel: sobre o preview não faz nada; sobre o código cai como antes (janela nova)
  return el?.closest(".diagram, .mdview") ? { kind: "none" } : null;
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
  const blockEl = t.path && t.path.length < (pathTo(layout.root, t.g.id)?.length ?? 0) ? nodeEls.get(nodeAt(layout.root, t.path)!) : undefined;
  const r = (blockEl ?? t.g.bodyEl).getBoundingClientRect(); // um bloco inteiro, ou só o painel
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
  else await splitGroup(t.g, t.zone, id, t.path);
}

function tearStart(id: string, p: TearPoint) {
  const tab = session.tabs.find((t) => t.id === id);
  dragTitle = tab?.title || "Nova nota";
  dragId = id;
  // a única aba de uma janela: quem anda com o mouse é a janela inteira, não uma sombra
  selfDragging = !isMain && session.tabs.length === 1;
  if (!selfDragging && tab) openDock(groups.get(tab.group));
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
  closeDock();
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
  items.push(
    "sep",
    { label: tab.pinned ? "Desafixar" : "Fixar", action: () => setPinned(tab.id, !tab.pinned) },
    "sep",
    { label: "Fechar", shortcut: "Ctrl+W", action: () => void closeTab(tab.id) },
    { label: "Fechar outras", action: () => void closeMany(toCloseOthers(session.tabs, tab.id)) },
    { label: "Fechar todas", action: () => void closeMany(toCloseAll(session.tabs)) },
    { label: "Fechar salvos", action: () => void closeMany(toCloseSaved(session.tabs)) },
    "sep",
    { label: "Salvar todos", action: () => void saveAll() },
  );
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
let incoming: { g: Group; index?: number; zone?: Side; path?: number[]; at: number } | null = null;
let lastAccept = false;
const setAccept = (v: boolean) => {
  if (v === lastAccept) return;
  lastAccept = v;
  void api.dragAccept(v).catch(() => {});
};

void listen<{ cx: number; cy: number; title: string; target: string }>("drag-over", (e) => {
  if (e.payload.target !== winLabel) return;
  dragTitle = e.payload.title;
  if (!dock) openDock();
  window.clearTimeout(dock!.timer);
  dock!.timer = window.setTimeout(() => (clearDropHint(), closeDock()), 1500); // some sozinho se o aviso de saída se perder
  const t = targetAt(e.payload.cx, e.payload.cy);
  showDropHint(t);
  if (t?.kind === "strip") incoming = { g: t.g, index: ghost?.index, at: Date.now() };
  else if (t?.kind === "zone" && t.zone !== "center") incoming = { g: t.g, zone: t.zone, path: t.path, at: Date.now() };
  else incoming = null;
  setAccept(!!t);
});
void listen<string>("drag-leave", (e) => {
  if (e.payload !== winLabel) return;
  clearDropHint();
  closeDock(); // `incoming` fica: a aba chega logo depois e usa o último lugar mostrado
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
  closeDock();
  snapshotActive();
  states.delete(tab.id);
  detected.delete(tab.id);
  csvDetected.delete(tab.id);
  if (inc?.zone) {
    // solta na borda de um painel: a aba ganha um painel novo ali (e é a última da lista de abas)
    const g = createGroup(newGroupId());
    layout.root = inc.path && nodeAt(layout.root, inc.path) ? splitPath(layout.root, inc.path, inc.zone, g.id) : splitLeaf(layout.root, inc.g.id, inc.zone, g.id);
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
  await saveEverything();
  await api.exitApp();
}

async function saveEverything() {
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
}

// ---- atualização ------------------------------------------------------------

let updating = false;

/** Procura versão nova; `manual` (menu Ajuda) também avisa quando não há ou quando falha. */
async function checkUpdates(manual: boolean) {
  if (updating) return;
  updating = true;
  try {
    let info;
    try {
      info = await api.checkUpdate();
    } catch (e) {
      if (manual) await message(String(e), { title: "Não foi possível verificar atualizações", kind: "error" });
      return;
    }
    if (!info) {
      if (manual) await message(`Você já está na versão mais recente (${await getVersion()}).`, { title: "Fullpad" });
      return;
    }
    // as notas já trazem os próprios títulos ("Novidades", "Melhorias"): não acrescentar outro
    const notes = info.notes?.trim() ? `\n\n${info.notes.trim()}` : "";
    const yes = await ask(
      `A versão ${info.version} do Fullpad está disponível (você tem a ${info.current}).${notes}\n\n` +
        "Atualizar agora? O Fullpad fecha, instala e abre de novo. Tudo o que você escreveu é gravado antes.",
      { title: "Atualização disponível", okLabel: "Atualizar", cancelLabel: "Agora não" },
    );
    if (!yes) return;
    try {
      await api.downloadUpdate();
    } catch (e) {
      await message(String(e), { title: "Não foi possível baixar a atualização", kind: "error" });
      return;
    }
    await saveEverything(); // nada se perde: todas as janelas gravam antes do instalador fechar o app
    try {
      await api.installUpdate();
    } catch (e) {
      await message(String(e), { title: "Não foi possível instalar a atualização", kind: "error" });
    }
  } finally {
    updating = false;
  }
}

// ---- arquivos ---------------------------------------------------------------

const OPEN_FILTERS = [
  { name: "Texto, Markdown, DBML, JSON, YAML, TOML, CSV, PDF e EPUB", extensions: ["md", "markdown", "txt", "dbml", "dbmlx", "json", "jsonc", "yaml", "yml", "toml", "csv", "tsv", "pdf", "epub"] },
  { name: "Todos os arquivos", extensions: ["*"] },
];

const FILTERS = [
  { name: "Texto, Markdown, DBML, JSON, YAML, TOML e CSV", extensions: ["md", "markdown", "txt", "dbml", "dbmlx", "json", "jsonc", "yaml", "yml", "toml", "csv", "tsv"] },
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
  const picked = await openDialog({ multiple: true, filters: OPEN_FILTERS });
  if (!picked) return;
  await openPaths(Array.isArray(picked) ? picked : [picked]);
}

/** Abre os arquivos pedidos fora do app (duplo clique, "Abrir com", segunda instância). */
async function openRequested() {
  const paths = await api.takeOpenPaths();
  if (paths.length === 0) return;
  await openPaths(paths); // a janela já foi trazida à frente pelo Rust (single-instance)
}

/** Abre a nota de versão: a que já estiver aberta nesta janela ou uma nova. */
async function showReleaseNotes(opened?: { tab: TabState; text: string } | null) {
  const title = `Nota de versão V${await getVersion()}`;
  const existing = session.tabs.find((t) => t.release_notes && t.title === title);
  if (existing) {
    // a da atualização chegou, mas já havia uma aberta: a nova não é usada
    if (opened) await api.closeNote(opened.tab.id).catch(() => {});
    await activate(existing.id);
    return;
  }
  try {
    const { tab, text } = opened ?? (await api.releaseNotes());
    snapshotActive();
    placeInGroup(tab, cur);
    await show(tab, text);
  } catch (e) {
    await message(String(e), { title: "Não foi possível abrir a nota de versão", kind: "error" });
    return;
  }
  sessionDirty = true;
  scheduleSave();
}

async function openPaths(paths: string[]) {
  for (const path of paths) {
    const existing = session.tabs.find((t) => t.path === path);
    if (existing) {
      await activate(existing.id);
      rememberPath(path);
      continue;
    }
    snapshotActive();
    try {
      // PDF/EPUB abrem como aba de leitura (o arquivo só é lido quando o usuário clicar em "Carregar")
      const reader = /\.(pdf|epub)$/i.test(path);
      const { tab, text } = reader ? { tab: await api.openReader(path), text: "" } : await api.openFile(path);
      session.tabs.push(tab);
      await show(tab, text);
      rememberPath(path);
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
  if (isReader(tab)) return false; // PDF/EPUB são só de leitura: nada a gravar, e o arquivo nunca é tocado
  let path = tab.path;
  if (!path || forceDialog) {
    path = await saveDialog({ defaultPath: tab.path ?? suggestedName(tab), filters: FILTERS });
    if (!path) return false;
  }
  const showing = groupShowing(tab.id);
  if (showing) snapshotGroup(showing);
  const text = await textOf(tab.id); // aba que ainda não foi aberta nesta execução não tem estado
  try {
    await enqueue(() => api.saveFile(tab.id, path, text, tab.encoding, tab.eol));
  } catch (e) {
    await message(String(e), { title: "Erro ao salvar", kind: "error" });
    return false;
  }
  dirtyNotes.delete(tab.id);
  tab.path = path;
  rememberPath(path);
  tab.release_notes = false; // virou arquivo do usuário: fechar volta a passar pelo histórico
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

// ---- JSON: formatar (o trabalho é do Rust) -------------------------------------------

let jsonIndent = readString("jsonIndent", "2");

async function formatJson(opts: { selection?: boolean; indent?: string; sort?: boolean } = {}) {
  const g = cur;
  const tab = tabOf(g);
  if (!tab || effectiveLang(tab) !== "json") return;
  const st = g.view.state;
  const sel = st.selection.main;
  const useSel = !!opts.selection && !sel.empty;
  const from = useSel ? sel.from : 0;
  const to = useSel ? sel.to : st.doc.length;
  const old = st.sliceDoc(from, to);
  if (old.trim() === "") return;
  const rev = g.rev;
  let res;
  try {
    res = await api.jsonFormat(old, opts.indent ?? jsonIndent, !!opts.sort);
  } catch (e) {
    await message(String(e), { title: "Não foi possível formatar", kind: "error" });
    return;
  }
  if (g.rev !== rev || tabOf(g)?.id !== tab.id) return; // o texto mudou enquanto o Rust trabalhava
  if ("Err" in res) {
    const err = res.Err;
    g.view.dispatch({ selection: { anchor: from + err.from, head: Math.min(from + err.to, st.doc.length) }, scrollIntoView: true });
    g.view.focus();
    await message(`${err.message}\n\nLinha ${err.line}, coluna ${err.col}`, { title: "Não foi possível formatar", kind: "warning" });
    return;
  }
  const out = res.Ok;
  if (out === old) return;
  const head = from + mapCursor(old, sel.head - from, out);
  g.view.dispatch({
    changes: { from, to, insert: out },
    selection: useSel ? { anchor: from, head: from + out.length } : { anchor: head },
    scrollIntoView: true,
    userEvent: "input.format",
  });
  g.view.focus();
}

function setJsonIndent(v: string) {
  jsonIndent = v;
  writeString("jsonIndent", v);
}

function toggleWrap() {
  wrap = !wrap;
  writeSetting("wrap", wrap);
  applyTabConfig();
  cur.view.focus();
}

function toggleLineNumbers() {
  lineNumbers = !lineNumbers;
  writeSetting("lineNumbers", lineNumbers);
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
  void syncCsv(tab);
  cur.view.focus();
}

let menubar: ReturnType<typeof mountMenuBar> | null = null;

const menuActions = {
  newNote: () => void newTab(),
  newWindow: () => void api.newWindow(),
  tabToNewWindow: () => void sendTab(session.active!, "new"),
  openFile: () => void openFiles(),
  readerLoad: () => cur.reader?.load(),
  readerLocate: () => cur.reader?.locate(),
  readerQuote: () => void cur.reader?.quote(),
  save: () => void save(),
  saveAs: () => void save(activeTab(), true),
  saveAll: () => void saveAll(),
  globalSearch: openGlobalSearch,
  setCodeLang,
  closeTab: () => void closeTab(session.active!),
  reopenTab: () => void reopenTab(),
  history: () => void showHistory(),
  exportHtml: () => void exportHtml(),
  exportPdf: () => void exportPdf(),
  copyHtml: () => void copyHtml(),
  exit: () => void thisWindow.close(),
  checkUpdates: () => void checkUpdates(true),
  releaseNotes: () => void showReleaseNotes(),
  undo: () => (undo(cur.view), cur.view.focus()),
  redo: () => (redo(cur.view), cur.view.focus()),
  selectAll: () => (selectAll(cur.view), cur.view.focus()),
  find: () => void (readerZoom((r) => r.find()) || openSearch(cur.view)),
  replace: () => openSearch(cur.view, true),
  gotoLine: () => openPaletteWith(":"),
  openPalette: () => openPaletteWith(""),
  gotoSymbol: () => openPaletteWith("@"),
  commandPalette: () => openPaletteWith(">"),
  togglePreview,
  toggleSplit,
  setView,
  toggleDetached,
  toggleWrap,
  toggleLineNumbers,
  setLanguage,
  formatJson: () => void formatJson(),
  formatJsonSelection: () => void formatJson({ selection: true }),
  minifyJson: () => void formatJson({ indent: "min" }),
  sortJson: () => void formatJson({ sort: true }),
  setJsonIndent,
  setCsvDelimiter: (v: string) => patchCsv({ delimiter: readCsvSettings({ delimiter: v }).delimiter }),
  setCsvHeader: (v: boolean) => patchCsv({ header: v }),
  setCsvDecimal: (v: string) => patchCsv({ decimal: v === "," ? "," : "." }),
  expandJson: () => cur.json?.expandAll(),
  collapseJson: () => cur.json?.collapseAll(),
  copyJsonPath: () => {
    const p = cur.json?.currentPath();
    if (p) void navigator.clipboard.writeText(p).catch(() => {});
  },
  zoomIn: () => setZoom(stepZoom(currentZoom(), 1)),
  zoomOut: () => setZoom(stepZoom(currentZoom(), -1)),
  setZoom: (p: number) => setZoom(p),
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
      lineNumbers,
      jsonIndent,
      csv: csvSettings(tab),
      csvDetected: csvDetected.get(tab.id) ?? ",",
      hasSelection: !cur.view.state.selection.main.empty,
      codeLang: { chosen: tab.code_lang, effective: codeLangOf(tab)?.name ?? null },
      treeOn: jsonTreeOn(),
      zoom: currentZoom(),
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
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === "KeyF") {
      e.preventDefault();
      return void menuActions.formatJson();
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.code === "KeyF") {
      e.preventDefault();
      return openGlobalSearch();
    }
    if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.code === "KeyS") {
      e.preventDefault();
      return menuActions.saveAll();
    }
    if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.code === "KeyG") {
      e.preventDefault();
      return void openPaletteWith(":");
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (e.code === "KeyP") {
      e.preventDefault(); // sem isto o WebView abre a impressão
      return void openPaletteWith(e.shiftKey ? ">" : "");
    }
    if (e.code === "KeyO" && e.shiftKey) {
      e.preventDefault();
      return void openPaletteWith("@");
    }
    // Ctrl+G com a busca do editor aberta continua sendo "próximo resultado"
    if (e.code === "KeyG" && !e.shiftKey && !(e.target instanceof Element && e.target.closest(".cm-panels"))) {
      e.preventDefault();
      return void openPaletteWith(":");
    }
    if (e.code === "Backslash" || e.code === "IntlBackslash" || key === "\\") {
      e.preventDefault();
      return splitActive(e.shiftKey ? "bottom" : "right");
    }
    if (/^[1-9]$/.test(key) && !e.shiftKey) {
      e.preventDefault();
      return focusGroupNumber(Number(key));
    }
    const run = (fn: () => void) => (e.preventDefault(), fn());
    // com um PDF carregado em destaque, o zoom é o do documento; sem ele, o da janela
    if (e.code === "Equal" || e.code === "NumpadAdd" || e.key === "+" || e.key === "=") return run(() => readerZoom((r) => r.zoomStep(1)) || menuActions.zoomIn());
    if (e.code === "Minus" || e.code === "NumpadSubtract" || e.key === "-") return run(() => readerZoom((r) => r.zoomStep(-1)) || menuActions.zoomOut());
    if (e.code === "Digit0" || e.code === "Numpad0") return run(() => readerZoom((r) => r.zoomFit()) || setZoom(100));
    if (key === "f" && !e.shiftKey && readerZoom((r) => r.find())) return e.preventDefault(); // aba de leitura: busca no documento
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

onZoomChange((z) => status.setZoom(z));

/** Aplica `fn` ao leitor do painel em destaque, se a aba dele é de leitura e há documento carregado. */
function readerZoom(fn: (r: ReaderPanel) => boolean): boolean {
  const t = session.active ? activeTab() : null;
  return !!t && isReader(t) && !!cur.reader && fn(cur.reader);
}

// Ctrl + roda do mouse: zoom fino (5% por clique). Com o mouse sobre um PDF carregado, é o do documento.
window.addEventListener(
  "wheel",
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const target = e.target;
    const over = target instanceof HTMLElement ? [...groups.values()].find((g) => g.readerEl.contains(target)) : undefined;
    if (over?.reader?.zoomWheel(e.deltaY)) return;
    setZoom(wheelZoom(currentZoom(), e.deltaY));
  },
  { passive: false, capture: true },
);

// Arquivos arrastados de fora (o Explorer, por exemplo) para dentro da janela: abrem como no Ctrl+O,
// com um aviso na tela enquanto o ponteiro está por cima. Arrastar abas é outra coisa (`tabdrag.ts`).
const fileDrop = createFileDrop();
void getCurrentWebview().onDragDropEvent((e) => {
  const p = e.payload;
  if (p.type === "enter") fileDrop.show(p.paths.length);
  else if (p.type === "drop") {
    fileDrop.hide();
    if (p.paths.length > 0) {
      void thisWindow.setFocus();
      void openPaths(p.paths);
    }
  } else if (p.type === "leave") fileDrop.hide();
});

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
  menubar = mountMenuBar(menubarEl, menuActions);
  setZoom(loadZoom()); // reaplica o zoom lembrado
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
  if (isMain) {
    void listen("open-paths", () => void openRequested());
    void openRequested();
    void api.startupReleaseNotes().then((n) => n && showReleaseNotes(n)); // acabou de atualizar
    window.setTimeout(() => void checkUpdates(false), 5000); // sem atrapalhar a abertura
  }
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
