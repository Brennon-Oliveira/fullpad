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
import { type ImagePlan, allImages, createFileDrop, imageDropText } from "./filedrop";
import { getVersion } from "@tauri-apps/api/app";
import { api, type ClosedTab, type Encoding, type Eol, type Language, type LargeHit, type LayoutEdit, type LayoutState, type SaveMode, type Session, type TabState, type ViewMode } from "./api";
import { acceptsImages, insertImage, registerImageHost } from "./mdimage";
import { createState, createView, csvHoverMarks, csvSelectionMarks, hintLines, isDark, tabEffects } from "./editor";
import { mermaidLanguage } from "./mermaidlang";

/** O que o painel da visão ao lado do código (diagrama DBML ou Mermaid, equações do .tex) oferece. */
interface DiagramPanel {
  show(text: string, resetView: boolean, rev?: number): void;
  update(text: string, rev?: number): void;
  setCursor(offset: number | null, rev: number): void;
  hide(): void;
  /** Só o diagrama DBML: o layout guardado da aba (chamar antes de `show`) e gravar o que está pendente. */
  setLayout?(l: { tables: LayoutState["tables"]; groups?: LayoutState["groups"]; viewport: LayoutState["viewport"]; error: string | null } | null): void;
  flush?(): void;
  /** Só o diagrama DBML: desenha de novo o texto de agora (os arquivos incluídos mudaram). */
  refresh?(): void;
  /** Só o diagrama DBML: o que ver (tudo, um arquivo incluído ou um grupo) e o nome do arquivo da aba; chamar antes de `show`. */
  setScope?(scope: DiagramScope, own: string): void;
  /** Só o diagrama DBML: liga/desliga a edição pelo diagrama (desligado, só se vê). */
  setEditable?(on: boolean): void;
}
import type { CsvPanel, LargeCtx } from "./csv/panel";
import type { LayoutView } from "./dbml/layoutview";
import type { DbmlProject } from "./dbml/service";
import { parseRoots, topRoot, withRoot } from "./dbml/roots";
import type { DiagramScope } from "./dbml/scope";
import type { JsonPanel, TreeFormat } from "./json/panel";
import { mapCursor } from "./json/format";
import type { MarkdownPane } from "./mdpreview";
import type { ReaderPanel } from "./reader/panel";
import type { ReaderPos } from "./reader/pos";
import { parseDelims, withDelim, withoutDelim } from "./csv/remember";
import { type CsvSettings, activeDelimiter, readCsvSettings } from "./csv/settings";
import { type Lang, detectLanguage, extOf } from "./language";
import { codeLanguageFor, latexDescription } from "./codelangs";
import { pinnedFirst, toCloseAll, toCloseOthers, toCloseSaved, withUnsavedChanges } from "./tabsets";
import { MAX_PREVIEW_CHARS } from "./livepreview";
const MAX_MERMAID_CHARS = 100_000; // mesmo valor de mermaid/render.ts
const MAX_TEX_CHARS = 500_000; // mesmo valor de latex/panel.ts
const MAX_DIAGRAM_CHARS = 500_000; // mesmo valor de dbml/panel.ts (não importamos o módulo no boot)
const MAX_JSON_CHARS = 8_000_000; // mesmo valor de json/panel.ts
const MAX_CSV_CHARS = 50_000_000; // mesmo valor de csv/panel.ts
import { codeLangItems, exportItem, isTree, languageItems, mountMenuBar, sideOnly, topMenus, viewItems, zoomItems } from "./menus";
import { type FormatId, runFormat } from "./mdtoolbar";
import { type Outline, type OutlineSide, createOutline } from "./outline";
import { type OutlineItem, activeIndex, treeOutline } from "./outlinecore";
import { dbmlSymbols, markdownSymbols, pushRecent, treeSymbols, type Symbol as PaletteSymbol } from "./palettecore";
import { type MenuItem, showMenu, showMenuAt } from "./popup";
import { mountStatusBar } from "./statusbar";
import { onThemeChange } from "./theme";
import { currentZoom, loadZoom, onZoomChange, setZoom, stepZoom, wheelZoom } from "./zoom";
import { attachTabDrag, insertionIndex, type TearPoint } from "./tabdrag";
import { type DockGroup, type DockTile, type Rect, SIDES, dockTiles, tileAt } from "./dock";
import { type Layout, type Node, type Side, type Zone, groupsOf, leaf, nodeAt, normalize, pathTo, removeLeaf, resizeSizes, splitLeaf, splitPath, swapAdjacent, wrapCandidates } from "./grid";
import { mountPostitBar, type PostitBar } from "./postit";
import { LargeTab, type LargeHooks, type LargeIo } from "./large/ctl";
import { type LargeFind, mountLargeFind } from "./large/find";
import { renderLargeGate } from "./large/gate";
import { showSaving } from "./large/saving";
import { chooseSaveMode } from "./large/savemode";
import { firstRecord, humanSize, statusText, stripBreaks as stripBreaksOf } from "./large/model";
import { type LargeScroll, mountLargeScroll } from "./large/scrollbar";
import { docPos, filePos, largeField, largeKeys, lineNumberFormat, windowLoad } from "./large/state";
import "./style.css";

const AUTOSAVE_MS = 400;
const DETECT_MS = 600;

const thisWindow = getCurrentWindow();
const winLabel = thisWindow.label;
const isMain = winLabel === "main";
const isPostit = winLabel.startsWith("postit-"); // nota rápida: só a nota e a barra amarela
let booted = false;
let shown = false; // a janela já apareceu (a reserva só aparece quando recebe a 1ª aba)
const pendingIn: TabState[] = []; // abas que chegaram antes de a janela terminar de iniciar
let exiting = false; // o app está fechando: janelas flutuantes só gravam, sem devolver as abas
let session: Session;
const states = new Map<string, EditorState>(); // abas já carregadas (guarda undo/seleção)
const larges = new Map<string, LargeTab>(); // arquivos grandes abertos nesta janela (modo de lotes)
const largeFailed = new Set<string>(); // aba grande cujo arquivo não pôde ser aberto: fica só leitura
// Abrir um arquivo grande não o lê: a aba mostra o cartão "Carregar" (como o PDF/EPUB) até a pessoa pedir. `largeGate` são as
// abas esperando; `largeLoaded`, as que já foram carregadas nesta execução (voltar a elas não pergunta de novo).
const largeGate = new Map<string, { size: number; edited: boolean }>();
const largeLoaded = new Set<string>();
const largeHeaders = new Map<string, string>(); // CSV grande: o cabeçalho do arquivo (a janela de lotes nem sempre começa nele)
let syncLock = 0; // tabela e texto rolam juntos: quem acabou de ser rolado pelo outro não devolve o eco
const lockSync = () => void (syncLock = performance.now() + 300);
let largeWrap = false; // quebra de linha das abas grandes (desligada: um segmento chega a 1 MB)
const detected = new Map<string, Lang>(); // linguagem detectada no modo automático
const dirtyNotes = new Set<string>();
let sessionDirty = false;
let timer: number | undefined;
let detectTimer: number | undefined;
let sizeTimer: number | undefined;
let writeChain: Promise<unknown> = Promise.resolve(); // serializa escritas
let wrap = readSetting("wrap", true);
let onTop = false; // "Manter no topo" desta janela (vem da sessão, ver boot)
let lineNumbers = readSetting("lineNumbers", true);
/** Editar pelo diagrama DBML (arrastar, renomear, colunas, notas); desmarcado, o diagrama só se vê. */
let diagramEdit = readSetting("diagramEdit", true);
let overwrite = false;
let outlineOn = readSetting("outline", true);
let outlinePinned = readSetting("outlinePinned", false);
let outlineSide: OutlineSide = readString("outlineSide", "left") === "right" ? "right" : "left";
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
  diagramKind?: "dbml" | "mermaid" | "latex"; // de qual linguagem é o painel que está em `diagram`
  diagramLoading?: Promise<void>;
  diagramTab: string | null; // aba cujo diagrama está na tela
  /** "Ver layout" do `.dbmlx`: o JSON do layout no lugar do diagrama. */
  layoutEl: HTMLElement;
  layoutView?: LayoutView;
  layoutLoading?: Promise<void>;
  layoutTab: string | null; // aba cujo layout está na tela
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
  csvAskEl: HTMLElement;
  backEl: HTMLElement;
  /** Faixa de aviso: o arquivo da aba mudou fora do Fullpad, ou sumiu. */
  diskEl: HTMLElement;
  csv?: CsvPanel;
  csvLoading?: Promise<void>;
  csvTab: string | null; // aba cuja tabela está na tela
  /** CSV de arquivo grande: quanto texto (o cabeçalho do arquivo, posto na frente do trecho) precede o trecho na tabela, e a linha do arquivo no topo dela. */
  csvPrefix: number;
  csvTopLine: number | null;
  /** Leitor de PDF/EPUB (aba só de leitura): carregado sob demanda, cobre o editor. */
  readerEl: HTMLElement;
  /** Cartão "Carregar" de uma aba de arquivo grande ainda não carregada. */
  gateEl: HTMLElement;
  reader?: ReaderPanel;
  readerLoading?: Promise<void>;
  /** Texto da barra de status enquanto o leitor está na tela. */
  readerInfo?: string | null;
  /** Arquivo grande (modo de lotes): barra de rolagem do arquivo, barra de busca e aviso fixo. */
  largeScroll: LargeScroll;
  largeFind: LargeFind;
  largeNoteEl: HTMLElement;
  largeTab: string | null; // aba grande cuja barra de busca está montada
  /** Sumário lateral deste painel (barrinhas ou fixo ao lado do arquivo). */
  outlineEl: HTMLElement;
  outline: Outline;
  olItems: OutlineItem[];
  olKey: string;
  olToken: number;
  olTimer?: number;
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
/** Aba de texto que não aceita alteração: a nota de versão (o texto vem embutido no app). */
const isReadOnlyText = (tab: TabState) => !!tab.release_notes;
/** CSV/TSV de arquivo grande: o único tipo que, nesse modo, também mostra a visão renderizada (a tabela do trecho de lotes que o editor tem). */
const largeCsv = (tab: TabState) => !!tab.large && (tab.language === "csv" || (tab.language === "auto" && /\.(csv|tsv)$/i.test(tab.path ?? "")));

/** Arquivo grande em modo de lotes: texto puro, sem visão renderizada, árvore, diagrama nem tabela. */
const largeOf = (tab: TabState | undefined | null) => (tab?.large ? larges.get(tab.id) : undefined);

function effectiveLang(tab: TabState): Lang {
  if (tab.large) return largeCsv(tab) ? "csv" : "plain"; // o resto: só o destaque pela extensão; nada que precise do texto inteiro
  if (tab.kind === "pdf") return "pdf";
  if (tab.kind === "epub") return "epub";
  return tab.language === "auto" ? (detected.get(tab.id) ?? "plain") : tab.language;
}

/** Markdown (live preview) e DBML (diagrama) têm visão renderizada; cada um com seu limite de tamanho. */
function previewAvailable(tab: TabState): boolean {
  const len = states.get(tab.id)?.doc.length ?? 0;
  const lang = effectiveLang(tab);
  return (lang === "markdown" && len <= MAX_PREVIEW_CHARS) || (lang === "dbml" && len <= MAX_DIAGRAM_CHARS) || (lang === "mermaid" && len <= MAX_MERMAID_CHARS) || (lang === "latex" && len <= MAX_TEX_CHARS) || (isTree(lang) && len <= MAX_JSON_CHARS) || (lang === "csv" && len <= MAX_CSV_CHARS);
}

/** Como o arquivo aparece: só código, renderizado no próprio texto (markdown) ou ao lado do código. */
type ViewKind = "source" | "inline" | "split" | "only";

function viewKind(tab: TabState): ViewKind {
  if (!previewAvailable(tab) || tab.mode === "source") return "source";
  const lang = effectiveLang(tab);
  if (tab.mode === "only" && (lang === "dbml" || lang === "mermaid") && !tab.detached) return "only"; // só o diagrama, sem o código
  if (sideOnly(lang)) return "split"; // diagrama e árvore sempre ficam ao lado
  return tab.mode === "split" ? "split" : "inline";
}

const previewOn = (tab: TabState) => viewKind(tab) !== "source";

function viewLabel(tab: TabState): string {
  const k = viewKind(tab);
  if (k === "source") return "Código";
  if (tab.detached) return "Janela separada";
  if (effectiveLang(tab) === "dbml" || effectiveLang(tab) === "mermaid") return k === "only" ? "Só diagrama" : "Diagrama";
  if (effectiveLang(tab) === "latex") return "Equações";
  if (isTree(effectiveLang(tab))) return "Árvore";
  if (effectiveLang(tab) === "csv") return k === "inline" ? "Tabela" : "Tabela e código";
  return k === "inline" ? "Preview" : "Lado a lado";
}

function redetect(tab: TabState) {
  const st = states.get(tab.id);
  if (!st || tab.language !== "auto" || tab.large) return;
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
      wrap: tab.large ? largeWrap : wrap,
      overwrite,
      lineNumbers: lineNumbers && viewKind(tab) !== "inline",
      lineNumberFormat: tab.large ? lineNumberFormat : undefined,
      mdFormat: effectiveLang(tab) === "markdown",
      readOnly: isReadOnlyText(tab) || (!!tab.large && (largeFailed.has(tab.id) || largeGate.has(tab.id))),
    }),
  });
  ensureDbmlSupport();
  ensureJsonSupport();
  ensureCsvSupport();
  ensureCodeSupport();
  scheduleOutline(cur, 0);
  cur.mdPane?.setDark(isDark());
  reconcileDetached();
  syncDiagram();
  syncLarge(cur);
  refreshStatus();
}

// Quando o tema muda (escolha, sistema ou outra janela), reaplica na aba ativa (as outras pegam ao serem mostradas).
onThemeChange(() => forEachGroup(applyTabConfig));

// ---- recursos de editor do DBML (diagnóstico; carregados sob demanda) -----------

let dbmlSupport: Extension | undefined;
let dbmlSupportLoading = false;

/** Carrega o parser na 1ª vez que uma aba DBML aparece e reaplica a configuração com ele. */
function ensureDbmlSupport() {
  if (dbmlSupport || dbmlSupportLoading || effectiveLang(activeTab()) !== "dbml") return;
  dbmlSupportLoading = true;
  import("./dbml/editor")
    .then((m) => m.dbmlEditorSupport((written, view) => void openIncludeFrom(view, written)))
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
const csvUndecided = new Set<string>(); // abas em que a estrutura não revelou o separador: ficam no código até a pessoa escolher

const CSV_DELIMS_KEY = "csvDelims"; // separadores escolhidos à mão, por caminho de arquivo (`csv/remember.ts`)
const rememberedDelim = (path: string | null | undefined): string | undefined => (path ? parseDelims(readString(CSV_DELIMS_KEY, ""))[path] : undefined);
function rememberDelim(path: string | null | undefined, delimiter: string) {
  if (!path) return;
  const all = parseDelims(readString(CSV_DELIMS_KEY, ""));
  writeString(CSV_DELIMS_KEY, JSON.stringify(delimiter === "auto" ? withoutDelim(all, path) : withDelim(all, path, delimiter)));
}

const csvSettings = (tab: TabState): CsvSettings => readCsvSettings(tab.csv);
const csvDelimiter = (tab: TabState) => activeDelimiter(csvSettings(tab), csvDetected.get(tab.id));

/** Recursos extras da linguagem da aba para o editor (`undefined` enquanto carregam ou quando não há). */
function supportFor(tab: TabState): Extension | undefined {
  switch (effectiveLang(tab)) {
    case "dbml":
      return dbmlSupport;
    case "mermaid":
      return mermaidLanguage;
    case "latex":
      return codeSupports.get(latexDescription.name);
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
  if (isReader(tab)) return null;
  if (effectiveLang(tab) === "latex") return latexDescription; // tipo próprio, com destaque fixo
  return effectiveLang(tab) === "plain" ? codeLanguageFor(tab.path, tab.code_lang) : null;
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
  if (tab.large && csvDetected.has(tab.id)) return; // arquivo grande: o mesmo separador em todos os trechos
  if (tab.large && largeGate.has(tab.id)) return; // ainda no cartão "Carregar": o editor está vazio, não há o que detectar nem perguntar
  // o separador que a pessoa já escolheu para este arquivo vale mais que a detecção
  const kept = rememberedDelim(tab.path);
  if (kept) {
    tab.csv = { ...csvSettings(tab), delimiter: kept };
    csvUndecided.delete(tab.id);
    sessionDirty = true;
    scheduleSave();
    const showing = groupShowing(tab.id);
    if (showing) withGroup(showing, applyTabConfig);
    return;
  }
  // o texto de agora: o do editor do painel que mostra a aba (o de `states` é o retrato de quando ela saiu de vista, ou o vazio de antes de carregar)
  const st = groupShowing(tab.id)?.view.state ?? states.get(tab.id);
  if (!st) return;
  if (tab.large && st.doc.length === 0) return; // a janela de lotes ainda não chegou
  // arquivo (ou nota) vazio não tem o que perguntar: vale a vírgula, como sempre valeu
  const found = st.doc.length === 0 ? "," : await api.csvDetect(st.sliceDoc(0, 200_000), extOf(tab.path ?? "") || null).catch(() => ",");
  if (csvSettings(tab).delimiter !== "auto") return; // escolheu enquanto detectava
  if (!found) {
    // a estrutura não diz qual é: fica no código e a faixa pergunta
    csvDetected.delete(tab.id);
  csvUndecided.delete(tab.id);
    if (!csvUndecided.has(tab.id)) {
      csvUndecided.add(tab.id);
      const showing = groupShowing(tab.id);
      if (showing) withGroup(showing, () => syncCsvAsk(showing, tab));
    }
    return;
  }
  if (csvUndecided.delete(tab.id)) {
    const showing = groupShowing(tab.id);
    if (showing) syncCsvAsk(showing, tab);
  }
  if (csvDetected.get(tab.id) === found) return;
  csvDetected.set(tab.id, found);
  // reaplica no painel que mostra a aba (não necessariamente o que tem o foco)
  const showing = groupShowing(tab.id);
  if (showing && csvSettings(tab).delimiter === "auto") withGroup(showing, applyTabConfig);
}

/** Mostra ou esconde a faixa "Qual é o separador?" do painel, conforme a aba esteja sem separador decidido. */
function syncCsvAsk(g: Group, tab: TabState | undefined) {
  const on = !!tab && effectiveLang(tab) === "csv" && csvUndecided.has(tab.id) && csvSettings(tab).delimiter === "auto" && !tab.detached && !largeGate.has(tab.id);
  if (!on) {
    g.csvAskEl.hidden = true;
    g.csvAskEl.replaceChildren();
    return;
  }
  if (!g.csvAskEl.hidden) return; // já está montada
  void import("./csv/ask").then((m) => {
    if (!csvUndecided.has(tab.id)) return;
    m.renderCsvAsk(g.csvAskEl, (d) => {
      // escolher dá a tabela: o separador vale daqui em diante, para a aba e para este arquivo
      csvUndecided.delete(tab.id);
      tab.csv = { ...csvSettings(tab), delimiter: d };
      rememberDelim(tab.path, d);
      sessionDirty = true;
      scheduleSave();
      withGroup(g, () => {
        syncCsvAsk(g, tab);
        applyTabConfig();
      });
    });
    g.csvAskEl.hidden = false;
  });
}

/** Grava uma escolha do CSV na aba e reaplica o editor. */
function patchCsv(patch: Partial<CsvSettings>) {
  const tab = activeTab();
  if (patch.delimiter !== undefined) {
    rememberDelim(tab.path, patch.delimiter);
    csvUndecided.delete(tab.id);
  }
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

const previewLang = (tab: TabState) => (effectiveLang(tab) === "dbml" ? "dbml" : effectiveLang(tab) === "mermaid" ? "mermaid" : effectiveLang(tab) === "latex" ? "latex" : effectiveLang(tab) === "json" ? "json" : "markdown");

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
  await emitTo(`preview-${tab.id}`, "pv-text", { text, rev: showing?.rev ?? 0, title: tab.title || "Nova nota", cursor, base: dirOf(tab.path), project: dbmlProjects.get(tab.id) ?? null }).catch(() => {});
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

const isDiagramLang = (l: Lang): l is "dbml" | "mermaid" | "latex" => l === "dbml" || l === "mermaid" || l === "latex";
const diagramWanted = (tab: TabState) => previewOn(tab) && !tab.detached && isDiagramLang(effectiveLang(tab));

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

/** CSV grande: o cabeçalho do arquivo (a janela de lotes nem sempre começa nele), lido do lote 0. */
async function fetchLargeHeader(tab: TabState) {
  const b = await api.largeBatch(tab.id, 0);
  largeHeaders.set(tab.id, firstRecord(stripBreaksOf(b.text, b.breaks), csvDelimiter(tab)));
}

/** Posição do editor → posição no texto que a tabela recebeu (sem os cortes virtuais, depois do cabeçalho posto na frente). */
function csvTablePos(g: Group, tab: TabState, head: number): number {
  if (!tab.large) return head;
  return filePos(g.view.state.field(largeField), head) + g.csvPrefix;
}

/** Posição no texto da tabela → posição do editor (`null`: cai no cabeçalho posto na frente, que não existe no editor). */
function csvDocPos(g: Group, pos: number, end = false): number | null {
  const t = tabOf(g);
  if (!t?.large) return pos;
  if (pos < g.csvPrefix) return null;
  return docPos(g.view.state.field(largeField), pos - g.csvPrefix, end);
}

function csvDocSpans(g: Group, spans: { from: number; to: number }[]): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const sp of spans) {
    const from = csvDocPos(g, sp.from);
    const to = csvDocPos(g, sp.to, true);
    if (from !== null && to !== null) out.push({ from, to });
  }
  return out;
}

function syncCsvTable(textChanged: boolean) {
  const g = cur;
  const tab = activeTab();
  // CSV grande demais para a tabela: só o código funciona, e a faixa diz por quê
  const big = effectiveLang(tab) === "csv" && !tab.large && g.view.state.doc.length > MAX_CSV_CHARS;
  g.noteEl.hidden = !big;
  if (big) {
    const m = (n: number) => (n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
    g.noteEl.textContent = `Arquivo grande demais para a tabela (${m(g.view.state.doc.length)} milhões de caracteres; o limite é ${m(MAX_CSV_CHARS)}). Só o código está disponível.`;
  }
  // separador ainda não decidido (abriu agora, ou o app acabou de iniciar): detecta; ao terminar, volta aqui
  if (effectiveLang(tab) === "csv" && viewKind(tab) !== "source" && !csvWanted(tab) && !tab.detached && (textChanged || !csvUndecided.has(tab.id))) void syncCsv(tab);
  syncCsvAsk(g, tab);
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
  const cfg = () => {
    const s = csvSettings(tab);
    return { delimiter: csvDelimiter(tab), header: s.header, decimal: s.decimal };
  };
  let text = "";
  let large: LargeCtx | undefined;
  if (tab.large) {
    // arquivo grande: a tabela mostra o TEXTO da janela de lotes (o mesmo do editor, com as edições pendentes), então editar por ela
    // é editar o texto. Quando a janela não começa no começo do arquivo, o cabeçalho do arquivo vai na frente do trecho.
    const f = largeOf(tab)?.fileText();
    if (!f) return;
    let prefix = "";
    if (csvSettings(tab).header && f.startLine > 0) {
      const head = largeHeaders.get(tab.id);
      if (head === undefined) {
        void fetchLargeHeader(tab).then(() => syncCsvTable(true));
        return;
      }
      prefix = head + "\n";
    } else if (f.startLine === 0) largeHeaders.set(tab.id, firstRecord(f.text, csvDelimiter(tab)));
    text = prefix + f.text;
    g.csvPrefix = prefix.length;
    large = { lineBase: f.startLine - (prefix ? 1 : 0), headerPrefix: !!prefix };
  } else text = g.view.state.doc.toString();
  const run = () => {
    const t = tabOf(g);
    if (!g.csv || !t || !csvWanted(t)) return;
    const fresh = g.csvTab !== tab.id;
    if (large && fresh) large.topLine = largeOf(tab)?.pendingJump != null ? 0 : tab.cursor; // abrindo a aba: a tabela começa onde a pessoa estava (a linha do arquivo)
    if (textChanged && !fresh) g.csv.update(text, g.rev, large);
    else g.csv.show(tab.id, text, cfg(), g.rev, large);
    g.csvTab = tab.id;
    g.csv.setCursor(csvTablePos(g, tab, g.view.state.selection.main.head), g.rev);
    if (large) renderLargeNote(g, tab);
  };
  if (g.csv) return run();
  g.csvEl.classList.add("on"); // já abre o espaço enquanto o módulo carrega
  g.csvLoading ??= import("./csv/panel").then((m) => {
    g.csv = m.createCsvPanel(g.csvEl, {
      // clique numa célula → o cursor do código vai para ela (o foco fica na tabela)
      onSelect: (pos, rev) => {
        if (rev !== g.rev) return;
        const at = csvDocPos(g, pos);
        if (at !== null) g.view.dispatch({ selection: { anchor: Math.min(at, g.view.state.doc.length) }, scrollIntoView: true });
      },
      // gravar uma célula: troca no texto do código, num passo só do desfazer (vale só para o texto que a tabela indexou)
      onEdit: (edits, rev) => {
        if (rev !== g.rev) return false;
        const t = tabOf(g);
        const w = t?.large ? g.view.state.field(largeField) : null;
        // arquivo grande: as posições são as do texto do arquivo (sem os cortes virtuais, e depois do cabeçalho posto na frente)
        if (w && edits.some((e) => e.from < g.csvPrefix)) return false; // o cabeçalho é de outra parte do arquivo
        const changes = w
          ? edits.map((e) => ({ from: docPos(w, e.from - g.csvPrefix), to: docPos(w, e.to - g.csvPrefix, true), insert: e.insert }))
          : edits.map((e) => ({ from: e.from, to: e.to, insert: e.insert }));
        g.view.dispatch({ changes, userEvent: "input.csv" });
        return true;
      },
      onUndo: () => undoIn(g),
      onRedo: () => redoIn(g),
      // células selecionadas / sob o mouse → o texto delas ganha fundo no código
      onSelection: (spans, rev) => g.view.dispatch({ effects: csvSelectionMarks(spans && rev === g.rev ? csvDocSpans(g, spans) : null) }),
      onHover: (spans, rev) => g.view.dispatch({ effects: csvHoverMarks(spans && rev === g.rev ? csvDocSpans(g, spans) : null) }),
      // arquivo grande: a primeira linha à vista da tabela é a do código (na visão lado a lado rolam juntos) e a tabela pede o lote vizinho na borda
      onTopLine: (line) => {
        const t = tabOf(g);
        if (!t?.large) return;
        g.csvTopLine = line;
        g.largeScroll.update();
        sessionDirty = true;
        scheduleSave();
        if (performance.now() < syncLock || viewKind(t) !== "split") return;
        lockSync();
        void largeOf(t)?.scrollToLine(line);
      },
      onEdge: (dir) => {
        const lt = largeOf(tabOf(g));
        if (lt?.canSlide(dir)) void lt.slide(dir);
      },
      // a tabela de arquivo grande achou o separador: o menu CSV e as cores do texto seguem
    });
  });
  void g.csvLoading.then(run);
}

// ---- leitor de PDF/EPUB (aba só de leitura; carregado sob demanda) ----------------------

/** Mostra o cartão "Carregar" no lugar do editor se a aba ativa é um arquivo grande ainda não carregado. */
function syncLargeGate() {
  const g = cur;
  const tab = activeTab();
  const info = tab?.large ? largeGate.get(tab.id) : undefined;
  g.bodyEl.classList.toggle("gated", !!info);
  g.gateEl.classList.toggle("on", !!info);
  if (!info || !tab) return void g.gateEl.replaceChildren();
  if (g.gateEl.dataset.tab === tab.id) return; // já desenhado para esta aba
  g.gateEl.dataset.tab = tab.id;
  renderLargeGate(
    g.gateEl,
    { name: tab.title || baseName(tab.path ?? ""), size: info.size, edited: info.edited },
    () => void releaseLarge(tab),
    (line) => void releaseLarge(tab, line),
  );
}

/** A janela abriu no começo porque o índice ainda não chegava à linha salva: vai até lá em segundo plano, quando ele chegar. */
async function restoreLargeJump(tab: TabState) {
  const lt = largeOf(tab);
  const line = lt?.pendingJump;
  if (!lt || line === null || line === undefined || jumping.has(tab.id)) return;
  jumping.add(tab.id);
  flashLarge(`Voltando à linha ${(line + 1).toLocaleString("pt-BR")} quando o índice chegar. Rolar o texto, Ctrl+G ou a barra do arquivo cancelam.`);
  try {
    const ok = await lt.goto(line, { focus: false, restore: true });
    if (ok && lt.pendingJump === line) {
      lt.pendingJump = null;
      const g = groupShowing(tab.id);
      if (g && largeCsv(tab) && g.csvTab === tab.id) {
        lockSync();
        g.csv?.scrollToLine(line); // a tabela vai à mesma linha do arquivo
      }
    }
  } catch (e) {
    if (lt.pendingJump === line) lt.pendingJump = null;
    flashLarge(`Não foi possível voltar à linha salva: ${e}`);
  } finally {
    jumping.delete(tab.id);
  }
}
const jumping = new Set<string>();

/** "Carregar": o arquivo passa a ser lido e indexado, e a aba mostra o editor (ou a tabela). */
async function releaseLarge(tab: TabState, line?: number) {
  if (!largeGate.has(tab.id)) return;
  if (line !== undefined) tab.cursor = line; // "Abrir direto na linha": a linha pedida vale como a posição a restaurar (a mesma volta em segundo plano)
  largeLoaded.add(tab.id);
  largeGate.delete(tab.id);
  states.delete(tab.id);
  const g = groups.get(tab.group) ?? cur;
  delete g.gateEl.dataset.tab;
  await show(tab);
}

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
      base: () => dirOf(tabOf(g)?.path ?? null),
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

// ---- renomear símbolos do DBML -------------------------------------------------------
//
// F2 no editor (ou botão direito > "Renomear símbolo…") e duplo clique no nome, no diagrama. A conta é
// de `dbml/rename.ts` (a tabela pela biblioteca, o resto pelas referências dela): o resultado são trocas
// de texto aplicadas numa transação só (um passo no Ctrl+Z), e a aba fica com alterações não salvas
// como em qualquer edição. No `.dbmlx`, a posição guardada acompanha o nome novo.

const SYMBOL_LABEL: Record<string, string> = { table: "tabela", column: "coluna", enum: "enum", value: "valor do enum", group: "grupo" };

/**
 * Pede o novo nome e renomeia. `mode`: "at" = `offset` é onde está o cursor (um uso ou o nome na
 * declaração); "decl" = `offset` é onde a declaração começa (vem do diagrama). `at` = onde abrir a caixa.
 */
async function renameSymbolAt(g: Group, offset: number, mode: "at" | "decl", at: { x: number; y: number; width?: number }, rev = g.rev) {
  const tab = tabOf(g);
  if (!tab || effectiveLang(tab) !== "dbml" || isReadOnlyText(tab)) return;
  if (rev !== g.rev) return flashDiskInfo(tab, "O texto mudou depois de o diagrama ser desenhado; tente de novo.");
  const [{ loadDbmlService }, model, rn] = await Promise.all([import("./dbml/service"), import("./dbml/model"), import("./dbml/rename")]);
  const svc = await loadDbmlService();
  const text = g.view.state.doc.toString();
  const parsed = model.parseDbml(svc.interpret, text);
  if (!parsed.diagram) return flashDiskInfo(tab, "Corrija o erro de sintaxe antes de renomear.");
  const diagram = parsed.diagram;
  const target = mode === "decl" ? rn.targetForDecl(diagram, text, offset) : rn.targetAt(svc, diagram, text, offset);
  if (!target) return flashDiskInfo(tab, "Não há um nome para renomear aqui (tabela, coluna, enum, valor ou grupo).");
  const { promptRename } = await import("./renamebox");
  // a tabela mostra o nome completo (`esquema.tabela`); escrever outro esquema também o troca
  const shown = target.kind === "table" && target.table?.schema ? `${target.table.schema}.${target.name}` : target.name;
  promptRename({
    ...at,
    value: shown,
    title: `Renomear ${SYMBOL_LABEL[target.kind]} — ${shown}`,
    onClose: () => g.view.focus(),
    submit: async (name) => {
      if (g.rev !== rev && mode === "decl") return "O texto mudou; tente de novo.";
      const r = rn.renameChanges(svc, diagram, text, target, name);
      if ("error" in r) return r.error;
      if (g.view.state.doc.toString() !== text) return "O texto mudou; tente de novo.";
      withGroup(g, () => g.view.dispatch({ changes: r.changes, userEvent: "input.rename", scrollIntoView: false }));
      if (layoutAvailable(tab) && (r.renamedTable || r.renamedGroup)) {
        await saveLayoutEdit(tab.id, {
          rename_tables: r.renamedTable ? { [r.renamedTable.from]: r.renamedTable.to } : undefined,
          rename_groups: r.renamedGroup ? { [r.renamedGroup.from]: r.renamedGroup.to } : undefined,
        });
        refreshLayoutUi(tab.id, false);
      }
      return null;
    },
  });
}

/** F2 / menu: renomeia o símbolo sob o cursor do editor do painel atual. */
function renameSymbolAtCursor() {
  const g = cur;
  const tab = tabOf(g);
  if (!tab || effectiveLang(tab) !== "dbml") return;
  const head = g.view.state.selection.main.head;
  const c = g.view.coordsAtPos(head);
  void renameSymbolAt(g, head, "at", { x: c?.left ?? 120, y: (c?.bottom ?? 120) + 4 });
}

/** Aplica trocas de texto vindas do diagrama, se o texto ainda é o da versão que ele desenhou. */
function applyDiagramChanges(g: Group, text: string, changes: { from: number; to: number; insert: string }[]): string | null {
  if (g.view.state.doc.toString() !== text) return "O texto mudou; tente de novo.";
  withGroup(g, () => g.view.dispatch({ changes, userEvent: "input.diagram", scrollIntoView: false }));
  return null;
}

/**
 * Botão direito no diagrama. Numa **coluna**: renomear, tipo, chave primária, não nulo, único e nota
 * (cada um é uma troca de texto pequena, uma transação, um passo no Ctrl+Z; a aba fica não salva).
 * Num nome (tabela, enum, valor, grupo): renomear. Vale em `.dbml`, `.dbmlx` e nota avulsa.
 */
async function diagramContextMenu(g: Group, info: { decl: number; column: boolean }, at: { x: number; y: number }, rev: number) {
  const tab = tabOf(g);
  if (!tab || effectiveLang(tab) !== "dbml" || isReadOnlyText(tab)) return;
  if (rev !== g.rev) return flashDiskInfo(tab, "O texto mudou depois de o diagrama ser desenhado; tente de novo.");
  const rename: MenuItem = { label: "Renomear…", shortcut: "F2", action: () => void renameSymbolAt(g, info.decl, "decl", at, rev) };
  const [{ loadDbmlService }, model, ed, { promptRename }] = await Promise.all([import("./dbml/service"), import("./dbml/model"), import("./dbml/edit"), import("./renamebox")]);
  const svc = await loadDbmlService();
  const text = g.view.state.doc.toString();
  const parsed = model.parseDbml(svc.interpret, text);
  if (!info.column) {
    // no nome de uma tabela, além de renomear dá para editar a nota dela
    const t = parsed.diagram ? ed.tableAt(parsed.diagram, info.decl) : null;
    if (!t) return void showMenuAt(at.x, at.y, [rename]);
    return void showMenuAt(at.x, at.y, [rename, "sep", { label: "Nota…", action: () => void editNoteAt(g, info.decl, "table", at, rev) }]);
  }
  if (!parsed.diagram) return flashDiskInfo(tab, "Corrija o erro de sintaxe antes de editar pelo diagrama.");
  const d = parsed.diagram;
  const ref = ed.columnAt(d, info.decl);
  if (!ref) return;
  const c = ref.column;
  const run = (r: { changes: { from: number; to: number; insert: string }[] } | { error: string }): string | null => ("error" in r ? r.error : applyDiagramChanges(g, text, r.changes));
  const failed = (reason: string | null) => reason !== null && flashDiskInfo(tab, reason);
  const flag = (label: string, f: "pk" | "not null" | "unique", on: boolean): MenuItem => ({
    label,
    checked: on,
    action: () => void failed(run(ed.setFlag(svc, d, text, ref, f, !on))),
  });
  const ask = (title: string, value: string, apply: (v: string) => ReturnType<typeof ed.setType>) =>
    promptRename({ ...at, value, title, onClose: () => g.view.focus(), submit: (v) => run(apply(v)) });
  showMenuAt(at.x, at.y, [
    rename,
    "sep",
    { label: "Tipo…", action: () => ask(`Tipo de ${c.name}`, c.type, (v) => ed.setType(svc, d, text, ref, v)) },
    flag("Chave primária", "pk", c.pk),
    flag("Não nulo", "not null", c.notNull),
    flag("Único", "unique", c.unique),
    { label: "Nota…", action: () => void editNoteAt(g, info.decl, "column", at, rev) },
  ]);
}

/** Edita a nota de uma tabela ou coluna do diagrama numa caixa de várias linhas (vazio tira a nota). */
async function editNoteAt(g: Group, decl: number, kind: "table" | "column", at: { x: number; y: number }, rev: number) {
  const tab = tabOf(g);
  if (!tab || effectiveLang(tab) !== "dbml" || isReadOnlyText(tab) || !diagramEdit) return;
  if (rev !== g.rev) return flashDiskInfo(tab, "O texto mudou depois de o diagrama ser desenhado; tente de novo.");
  const [{ loadDbmlService }, model, ed, { promptNote }] = await Promise.all([import("./dbml/service"), import("./dbml/model"), import("./dbml/edit"), import("./notebox")]);
  const svc = await loadDbmlService();
  const text = g.view.state.doc.toString();
  const parsed = model.parseDbml(svc.interpret, text);
  if (!parsed.diagram) return flashDiskInfo(tab, "Corrija o erro de sintaxe antes de editar pelo diagrama.");
  const d = parsed.diagram;
  const ref = kind === "column" ? ed.columnAt(d, decl) : null;
  const table = kind === "table" ? ed.tableAt(d, decl) : null;
  if (!ref && !table) return;
  const name = ref ? `coluna ${ref.column.name}` : `tabela ${table!.name}`;
  promptNote({
    ...at,
    value: (ref ? ref.column.note : table!.note) ?? "",
    title: `Nota da ${name}`,
    onClose: () => g.view.focus(),
    submit: (v) => {
      const r = ref ? ed.setNote(svc, d, text, ref, v) : ed.setTableNote(svc, d, text, table!, v);
      return "error" in r ? r.error : applyDiagramChanges(g, text, r.changes);
    },
  });
}

// ---- layout do diagrama (.dbmlx) ----------------------------------------------------
//
// Posições das tabelas e enquadramento da vista ficam num JSON ao lado do arquivo (`.dbmlx`) ou, numa
// nota avulsa, numa pasta interna do app (o Rust decide onde). O texto do DBML nunca é tocado. O que
// a UI guarda por aba é a leitura mais recente (`layouts`), com o carimbo do arquivo para o Rust
// recusar gravar por cima de uma mudança feita fora do Fullpad.

const layouts = new Map<string, LayoutState>();
const layoutOpen = new Set<string>(); // abas que estão em "Ver layout"
const layoutLoads = new Map<string, Promise<LayoutState>>();

/** A aba guarda layout: DBML em nota avulsa ou em arquivo `.dbmlx` (um `.dbml` comum fica no automático). */
function layoutAvailable(tab: TabState): boolean {
  return effectiveLang(tab) === "dbml" && !tab.detached && !isReader(tab) && !tab.release_notes && (!tab.path || /\.dbmlx$/i.test(tab.path));
}

const layoutShown = (tab: TabState) => layoutOpen.has(tab.id) && layoutAvailable(tab) && previewOn(tab);

const layoutFileName = (tab: TabState) => (tab.path ? `${baseName(tab.path)}.layout.json` : "Layout (guardado pelo Fullpad)");

function loadLayout(id: string): Promise<LayoutState> {
  let p = layoutLoads.get(id);
  if (!p) {
    p = api
      .layoutLoad(id)
      .then((l) => {
        layouts.set(id, l);
        return l;
      })
      .finally(() => layoutLoads.delete(id));
    layoutLoads.set(id, p);
  }
  return p;
}

/**
 * Salvar: consolida as alterações do layout (a cópia de trabalho) no arquivo ao lado do `.dbmlx` que
 * acabou de ser gravado. Se o arquivo de layout mudou fora do Fullpad, pergunta; "Descartar as minhas"
 * fica com o do disco. Devolve `false` se a pessoa cancelou (as alterações do layout continuam pendentes).
 */
async function commitLayoutOnSave(tab: TabState, path: string): Promise<boolean> {
  if (effectiveLang(tab) !== "dbml") return true;
  let l: LayoutState | null | undefined = layouts.get(tab.id);
  if (!l) l = await loadLayout(tab.id).catch(() => null); // rascunho de uma sessão anterior
  if (!l?.draft) return true; // nada pendente
  const attempt = (force: boolean) => api.layoutCommit(tab.id, path, l?.base ?? null, force);
  try {
    await attempt(false);
  } catch (e) {
    if (!isConflict(e)) {
      await message(`O arquivo foi salvo, mas o layout do diagrama não: ${e}`, { title: "Layout do diagrama", kind: "error" });
      return false;
    }
    const r = await message(`O layout de "${tab.title}" foi alterado fora do Fullpad. Gravar por cima apaga essa mudança.`, {
      title: "Layout alterado",
      kind: "warning",
      buttons: { yes: "Sobrescrever", no: "Descartar as minhas", cancel: "Cancelar" },
    });
    try {
      if (r === "Sobrescrever") await attempt(true);
      else if (r === "Descartar as minhas") await api.layoutDiscard(tab.id);
      else return false;
    } catch (e2) {
      await message(`Não foi possível gravar o layout: ${e2}`, { title: "Layout do diagrama", kind: "error" });
      return false;
    }
  }
  layouts.delete(tab.id); // relido na próxima vez (o arquivo ao lado agora é o que vale)
  refreshLayoutUi(tab.id);
  return true;
}

/** O diagrama (ou o JSON) da aba mudou de dono dos dados: redesenha onde ela está à vista. */
function refreshLayoutUi(id: string, rereadJson = true) {
  const g = groupShowing(id);
  if (!g || g !== cur) return;
  if (rereadJson) g.layoutTab = null; // força o "Ver layout" a reler o texto
  syncDiagram();
}

/**
 * As gravações do layout de uma aba andam **uma de cada vez**: cada uma parte do texto que a anterior
 * deixou na cópia de trabalho (senão duas edições seguidas, arrasto e vista, se atropelariam).
 */
const layoutQueue = new Map<string, Promise<unknown>>();
function queueLayout(id: string, job: () => Promise<void>): Promise<void> {
  const run = (layoutQueue.get(id) ?? Promise.resolve()).catch(() => {}).then(job);
  layoutQueue.set(id, run);
  void run.finally(() => layoutQueue.get(id) === run && layoutQueue.delete(id));
  return run;
}

/** Mexer no layout é uma alteração não salva da aba de arquivo (a bolinha na aba); só a vista não conta. */
function layoutChanged(tab: TabState) {
  if (tab.path) markModified(tab);
}

/** Tabelas, grupos e/ou vista mexidos no diagrama: aplica ao layout e grava na cópia de trabalho (o Salvar consolida). */
function saveLayoutEdit(id: string, edit: LayoutEdit): Promise<void> {
  return queueLayout(id, async () => {
    const tab = session.tabs.find((t) => t.id === id);
    if (!tab) return;
    groupShowing(id)?.layoutView?.flush(); // o que se digitou no JSON entra antes (na fila)
    try {
      const next = await api.layoutEdit(id, edit);
      layouts.set(id, next);
      if (next.text !== null) groupShowing(id)?.layoutView?.setText(id, next.text); // o JSON ao lado acompanha o arrasto
      if (edit.tables || edit.groups || edit.rename_tables || edit.rename_groups) layoutChanged(tab);
    } catch (e) {
      await message(`Não foi possível gravar o layout: ${e}`, { title: "Layout do diagrama", kind: "error" });
    }
  });
}

/** O JSON do "Ver layout" foi editado: grava como está na cópia de trabalho (pode estar no meio de uma edição inválida). */
function commitLayoutText(id: string, text: string): Promise<void> {
  return queueLayout(id, async () => {
    const tab = session.tabs.find((t) => t.id === id);
    if (!tab) return;
    const g = groupShowing(id);
    try {
      await api.layoutWrite(id, text);
    } catch (e) {
      g?.layoutView?.setState("Não gravado");
      await message(`Não foi possível gravar o layout: ${e}`, { title: "Layout do diagrama", kind: "error" });
      return;
    }
    const parsed = await api.layoutParse(text);
    layouts.set(id, { ...parsed, text, base: layouts.get(id)?.base ?? null, draft: true });
    layoutChanged(tab);
    g?.layoutView?.setState(parsed.error ? `Alterado, mas inválido: ${parsed.error}` : "Alterado, não salvo");
  });
}

/** O texto do JSON está sendo digitado: o diagrama ao lado já o mostra (sem gravar; a gravação vem depois). */
async function previewLayoutText(id: string, text: string) {
  const parsed = await api.layoutParse(text);
  const cached = layouts.get(id);
  if (!layoutOpen.has(id)) return;
  layouts.set(id, { ...parsed, text: cached?.text ?? null, base: cached?.base ?? null, draft: cached?.draft ?? false });
  refreshLayoutUi(id, false);
}

/** Enquanto se arrasta no diagrama, o JSON do "Ver layout" acompanha (só na tela, sem gravar; um pedido por vez). */
let dragPreviewBusy = false;
let dragPreviewNext: { id: string; edit: LayoutEdit } | null = null;
function previewDragInJson(id: string, edit: LayoutEdit) {
  const view = groupShowing(id)?.layoutView;
  if (!view || view.tab !== id) return;
  if (dragPreviewBusy) {
    dragPreviewNext = { id, edit }; // vale só o mais novo
    return;
  }
  dragPreviewBusy = true;
  const run = async (job: { id: string; edit: LayoutEdit }) => {
    try {
      const v = groupShowing(job.id)?.layoutView;
      if (v && !v.dirty) v.setText(job.id, await api.layoutApply(v.text(), job.edit));
    } catch {
      // texto do JSON inválido no meio da edição: sem prévia (o arrasto grava normalmente ao soltar)
    }
    const next = dragPreviewNext;
    dragPreviewNext = null;
    if (next) await run(next);
    else dragPreviewBusy = false;
  };
  void run({ id, edit });
}

function hideLayoutPane(g: Group) {
  if (g.layoutTab !== null) g.layoutView?.hide();
  g.layoutTab = null;
  g.layoutEl.classList.remove("on");
  g.bodyEl.classList.remove("layoutjson");
}

/** "Ver layout": o JSON do layout toma o lugar do código DBML (que continua sendo o documento da aba). */
async function syncLayoutPane(g: Group, tab: TabState) {
  if (!layoutShown(tab)) return hideLayoutPane(g);
  g.layoutEl.classList.add("on");
  g.bodyEl.classList.add("layoutjson");
  const l = layouts.get(tab.id) ?? (await loadLayout(tab.id).catch(() => null));
  if (!l || tabOf(g)?.id !== tab.id || !layoutShown(tab)) return;
  g.layoutLoading ??= import("./dbml/layoutview").then((m) => {
    g.layoutView = m.createLayoutView(g.layoutEl, {
      onChange: (id, text) => void commitLayoutText(id, text),
      onLive: (id, text) => void previewLayoutText(id, text),
    });
  });
  await g.layoutLoading;
  if (tabOf(g)?.id !== tab.id || !layoutShown(tab)) return;
  if (g.layoutTab === tab.id) return;
  g.layoutTab = tab.id;
  const { EMPTY_LAYOUT } = await import("./dbml/layoutview");
  await g.layoutView!.show(tab.id, l.text ?? EMPTY_LAYOUT, layoutFileName(tab));
  g.layoutView!.focus();
}

/** "Ver layout" / "Ver diagrama": troca o diagrama pelo JSON do layout e volta. */
function toggleLayoutView() {
  const tab = activeTab();
  if (!layoutAvailable(tab)) return;
  if (layoutShown(tab)) {
    cur.layoutView?.flush();
    layoutOpen.delete(tab.id);
  } else {
    layoutOpen.add(tab.id);
    if (viewKind(tab) === "source") {
      setView("split");
      return;
    }
  }
  applyTabConfig();
  refreshStatus(false);
}

// ---- `!include` do dbmlx (arquivos lidos pelo Rust; o parser os vê depois do texto da aba) ----

const dbmlProjects = new Map<string, DbmlProject | null>(); // o que cada aba incluía da última vez (evita piscar ao trocar de aba)
let dbmlProjectTimer = 0;

/** Lê o que a aba DBML inclui e o entrega ao serviço; se mudou, o erro no editor e o diagrama são refeitos. */
async function refreshDbmlProject(id: string) {
  const tab = session.tabs.find((t) => t.id === id);
  const g = tab ? groupShowing(id) : undefined;
  if (!tab || !g || effectiveLang(tab) !== "dbml") return;
  const text = g.view.state.doc.toString();
  const root = dbmlRootOf(tab);
  const has = root !== null || /^[ \t]*!include\b/m.test(text);
  let project: DbmlProject | null = null;
  if (root !== null) {
    // módulo aberto a partir de outro: a raiz (com o texto de agora, se a aba dela tem alterações) dá o contexto
    const rootTab = session.tabs.find((t) => t.path === root);
    const rootText = rootTab ? await textOf(rootTab.id) : null;
    project = await api.dbmlIncludes(text, dirOf(tab.path), root, rootText, tab.path).catch(() => null);
  } else if (has) project = await api.dbmlIncludes(text, dirOf(tab.path)).catch(() => null);
  if (groupShowing(id) !== g || g.view.state.doc.toString() !== text) return; // mudou enquanto lia: a próxima leitura já está agendada
  const svc = has ? await (await import("./dbml/service")).loadDbmlService() : (await import("./dbml/service")).peekDbmlService();
  if (!svc) return;
  dbmlProjects.set(id, project);
  if (!svc.setProject(project)) return;
  void import("@codemirror/lint").then((m) => m.forceLinting(g.view));
  g.diagram?.refresh?.();
  if (tab.detached && previewOpen.has(id)) void pushPreview(tab); // a janela separada recebe os incluídos junto do texto
}

// ---- módulo dbmlx aberto de outro (Ctrl+clique no `!include`): raiz lembrada, faixa de voltar e escopo ----

const DBML_ROOTS_KEY = "dbmlRoots";
const loadRoots = () => parseRoots(readString(DBML_ROOTS_KEY, ""));
/** A raiz que inclui este arquivo (lembrada por caminho), se for outro arquivo. */
const dbmlRootOf = (tab: TabState): string | null => {
  if (!tab.path) return null;
  const r = loadRoots()[tab.path];
  return r && r !== tab.path ? r : null;
};
const includeParent = new Map<string, string>(); // aba do módulo → aba de onde foi aberta (só nesta execução)
const dbmlScopes = new Map<string, DiagramScope>(); // o que cada aba DBML está vendo (só nesta execução)

/** O que a aba vê: o escolhido; sem escolha, um módulo vê só o próprio arquivo e o resto vê tudo. */
const scopeOf = (tab: TabState): DiagramScope => dbmlScopes.get(tab.id) ?? (dbmlRootOf(tab) !== null ? { kind: "file", file: null } : { kind: "all" });

/** Ctrl+clique num `!include "x"`: abre o arquivo e lembra de onde veio (a faixa dele volta para cá). */
async function openIncludeFrom(view: CMEditorView, written: string) {
  const g = [...groups.values()].find((x) => x.view === view);
  const tab = g && tabOf(g);
  if (!tab || !tab.path) {
    await message("Salve o arquivo para abrir os incluídos: os caminhos do !include são relativos a ele.", { title: "Abrir incluído", kind: "info" });
    return;
  }
  let target: string;
  try {
    target = await api.dbmlIncludePath(written, dirOf(tab.path)!);
  } catch (e) {
    await message(String(e), { title: "Abrir incluído", kind: "error" });
    return;
  }
  const roots = loadRoots();
  const root = topRoot(roots, tab.path); // quem abre um módulo de um módulo continua apontando para a raiz de verdade
  writeString(DBML_ROOTS_KEY, JSON.stringify(withRoot(roots, target, root)));
  await openPaths([target]);
  const child = session.tabs.find((t) => t.path === target);
  if (child) includeParent.set(child.id, tab.id);
  const cg = child && groupShowing(child.id);
  if (cg) withGroup(cg, () => syncDiagram());
}

/** A faixa "← voltar" de um módulo aberto a partir de outro arquivo. */
function renderBackBar(g: Group, tab: TabState | undefined) {
  const root = tab && effectiveLang(tab) === "dbml" ? dbmlRootOf(tab) : null;
  if (!tab || root === null) {
    g.backEl.hidden = true;
    g.backEl.replaceChildren();
    return;
  }
  const key = `${tab.id}|${root}`;
  if (!g.backEl.hidden && g.backEl.dataset.key === key) return;
  g.backEl.dataset.key = key;
  const name = baseName(root);
  const msg = document.createElement("span");
  msg.textContent = `Módulo de ${name} (as tabelas dos outros arquivos aparecem como externas).`;
  const back = document.createElement("button");
  back.type = "button";
  back.textContent = `← Voltar para ${name}`;
  back.title = "Volta ao arquivo que inclui este (Ctrl+clique no !include faz o caminho de ida)";
  back.addEventListener("click", () => {
    const parent = includeParent.get(tab.id);
    if (parent && session.tabs.some((t) => t.id === parent)) void activate(parent);
    else void openPaths([root]);
  });
  const forget = document.createElement("button");
  forget.type = "button";
  forget.textContent = "Ver sozinho";
  forget.title = "Esquece o arquivo raiz: este arquivo volta a ser compilado sozinho";
  forget.addEventListener("click", () => {
    if (tab.path) writeString(DBML_ROOTS_KEY, JSON.stringify(withRoot(loadRoots(), tab.path, tab.path)));
    dbmlProjects.delete(tab.id);
    dbmlScopes.delete(tab.id);
    g.backEl.hidden = true;
    scheduleDbmlProject(tab, 0);
  });
  g.backEl.replaceChildren(msg, back, forget);
  g.backEl.hidden = false;
}

function scheduleDbmlProject(tab: TabState, delay: number) {
  window.clearTimeout(dbmlProjectTimer);
  dbmlProjectTimer = window.setTimeout(() => void refreshDbmlProject(tab.id), delay);
}

/** Mostra/esconde o painel conforme a aba ativa. O módulo só é importado na 1ª vez que um DBML pede. */
function syncDiagram(textChanged = false) {
  const g = cur;
  syncLargeGate();
  syncReader();
  syncMdPane(textChanged);
  syncJson(textChanged);
  syncCsvTable(textChanged);
  syncDetached(textChanged);
  const tab = activeTab();
  if (effectiveLang(tab) === "dbml") {
    // o que esta aba inclui: o de antes já vale (sem piscar) e a leitura nova vem em seguida
    void import("./dbml/service").then((m) => m.peekDbmlService()?.setProject(dbmlProjects.get(tab.id) ?? null));
    scheduleDbmlProject(tab, textChanged ? 500 : 0);
  }
  renderBackBar(g, tab);
  // sozinho, o diagrama cobre o painel e o editor (que segue vivo, escondido, com o texto e o histórico) some
  g.bodyEl.classList.toggle("diagramonly", diagramWanted(tab) && viewKind(tab) === "only");
  if (!diagramWanted(tab)) {
    g.diagram?.hide();
    g.diagramTab = null;
    void syncLayoutPane(g, tab);
    return;
  }
  void syncLayoutPane(g, tab); // "Ver layout": o JSON no lugar do código; o diagrama segue ao lado
  const kind = effectiveLang(tab) as "dbml" | "mermaid" | "latex";
  if (g.diagram && g.diagramKind !== kind) {
    // a aba mudou de DBML para Mermaid (ou ao contrário): o painel de antes não serve
    g.diagram.hide();
    g.diagram = undefined;
    g.diagramLoading = undefined;
    g.diagramTab = null;
  }
  const text = g.view.state.doc.toString();
  const run = () => {
    const t = tabOf(g);
    if (!g.diagram || !t || !diagramWanted(t) || g.diagramKind !== effectiveLang(t)) return;
    if (g.diagram.setLayout) {
      // diagrama DBML: o layout guardado da aba (lido antes de desenhar, para não piscar o automático)
      const l = layoutAvailable(t) ? layouts.get(t.id) : undefined;
      if (layoutAvailable(t) && !l) {
        void loadLayout(t.id).then(() => syncDiagram());
        return;
      }
      g.diagram.setLayout(l ? { tables: l.tables, groups: l.groups, viewport: l.viewport, error: l.error } : null);
    }
    g.diagram.setEditable?.(diagramEdit);
    g.diagram.setScope?.(scopeOf(t), t.title || baseName(t.path ?? "") || "este arquivo");
    if (textChanged && g.diagramTab === tab.id) g.diagram.update(text, g.rev);
    else g.diagram.show(text, g.diagramTab !== tab.id, g.rev);
    g.diagramTab = tab.id;
    g.diagram.setCursor(g.view.state.selection.main.head, g.rev);
  };
  if (g.diagram) return run();
  g.diagramEl.classList.add("on"); // já abre o espaço enquanto o módulo carrega
  g.diagramLoading ??=
    kind === "mermaid"
      ? import("./mermaid/panel").then((m) => {
          g.diagram = m.createMermaidPanel(g.diagramEl, { isDark });
          g.diagramKind = "mermaid";
        })
      : kind === "latex"
        ? import("./latex/panel").then((m) => {
            g.diagram = m.createLatexPanel(g.diagramEl, {
              onHover: (spans, rev) => g.view.dispatch({ effects: hintLines(spans && rev === g.rev ? spans : null) }),
              onPick: (offset, rev) => {
                if (rev !== g.rev) return; // o texto mudou depois de a equação ser desenhada
                g.view.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
                g.view.focus();
              },
            });
            g.diagramKind = "latex";
          })
        : import("./dbml/panel").then((m) => {
          g.diagram = m.createDiagramPanel(g.diagramEl, {
            // mouse sobre o diagrama → destaca a linha no código (sem selecionar)
            onHover: (spans, rev) => g.view.dispatch({ effects: hintLines(spans && rev === g.rev ? spans : null) }),
            // clicar ou arrastar um elemento → o código rola até a declaração e a linha fica em destaque
            onPick: (offset, rev) => {
              if (rev !== g.rev || offset > g.view.state.doc.length) return;
              g.view.dispatch({
                selection: { anchor: offset },
                effects: [CMEditorView.scrollIntoView(offset, { y: "center" })],
              });
            },
            // tabela arrastada ou vista mexida → grava no layout da aba que está na tela
            onLayoutEdit: (edit) => g.diagramTab && void saveLayoutEdit(g.diagramTab, edit),
            // escolheu o que ver (tudo, um arquivo ou um grupo): vale para esta aba
            onScope: (s) => g.diagramTab && dbmlScopes.set(g.diagramTab, s),
            onLayoutLive: (edit) => g.diagramTab && previewDragInJson(g.diagramTab, edit),
            // duplo clique no nome (tabela, coluna, enum, valor, grupo) → renomear
            onRename: (decl, at, rev) => void renameSymbolAt(g, decl, "decl", at, rev),
            // botão direito numa coluna (tipo, chave, não nulo, único, nota) ou num nome (renomear)
            onContext: (info, at, rev) => void diagramContextMenu(g, info, at, rev),
            // clique no ícone de nota (tabela ou coluna) → editar a nota
            onNote: (info, at, rev) => void editNoteAt(g, info.decl, info.kind, at, rev),
          });
          g.diagramKind = "dbml";
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
const LANG_LABEL: Record<Lang, string> = { plain: "Texto simples", markdown: "Markdown", dbml: "DBML", mermaid: "Mermaid", latex: "LaTeX", json: "JSON", csv: "CSV", yaml: "YAML", toml: "TOML", pdf: "PDF", epub: "EPUB" };

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
  const lt = largeOf(tab);
  if (lt) {
    // arquivo grande: o editor só tem a janela, então tamanho, total de linhas e posição são os do arquivo
    const fileLine = lt.cursorLine();
    menubar?.refresh();
    status.update({
      languageLabel: langLabel(tab),
      viewLabel: viewLabel(tab),
      viewAvailable: previewAvailable(tab),
      codeLang: effectiveLang(tab) === "plain" ? (codeLangOf(tab)?.name ?? null) : undefined,
      size: lt.info.size,
      lines: lt.info.lines,
      ln: fileLine + 1,
      col: head - line.from + 1,
      pos: null,
      eolLabel: EOL_LABEL[tab.eol],
      encodingLabel: ENC_LABEL[tab.encoding],
      overwrite,
      path: statusText(fileLine, lt.info),
    });
    return;
  }
  if (recomputeSize) lastSize = computeSize();
  menubar?.refresh();
  status.update({
    languageLabel: langLabel(tab),
    viewLabel: viewLabel(tab),
    viewAvailable: previewAvailable(tab),
    editAvailable: effectiveLang(tab) === "dbml" && previewOn(tab) && !tab.detached,
    editChecked: diagramEdit,
    layoutLabel: layoutAvailable(tab) ? (layoutShown(tab) ? "Ver diagrama" : "Ver layout") : null,
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
  onLayout: () => toggleLayoutView(),
  onEdit: (on) => {
    diagramEdit = on;
    writeSetting("diagramEdit", on);
    for (const g of groups.values()) g.diagram?.setEditable?.(on);
    refreshStatus(false);
  },
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
          if (tab.large) return flashLarge("A quebra de linha de um arquivo grande não muda aqui.");
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
          if (tab.large) return flashLarge("A codificação de um arquivo grande não muda aqui.");
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
  if (largeGate.has(tab.id)) return; // arquivo grande ainda não carregado: o editor é só um espaço vazio, a posição guardada fica como está
  states.set(tab.id, g.view.state);
  const lt = largeOf(tab);
  if (lt) {
    // arquivo grande: o cursor é a linha do arquivo (a janela não tem posição fixa); com só a tabela à vista, é a linha dela
    // a linha salva que ainda espera o índice chegar vale mais que o começo onde a janela abriu
    tab.cursor = lt.pendingJump ?? (largeCsv(tab) && g.csvTab === tab.id && viewKind(tab) === "inline" && g.csvTopLine !== null ? g.csvTopLine : lt.cursorLine());
    tab.scroll = 0;
    return;
  }
  tab.cursor = g.view.state.selection.main.head;
  tab.scroll = g.view.scrollDOM.scrollTop;
}

async function flush() {
  window.clearTimeout(timer);
  timer = undefined;
  for (const g of groups.values()) snapshotGroup(g);
  await Promise.all([...larges.values()].map((l) => l.commit())); // as alterações dos lotes vão ao Rust antes de gravar a sessão
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
  const big = tabOf(g);
  if (big?.large) {
    // arquivo grande: o texto do editor é só uma janela; vai ao Rust por lote (nunca para `notes/`)
    largeOf(big)?.onUpdate(u);
    if (u.docChanged) {
      g.rev++;
      if (!u.transactions.some((t) => t.annotation(windowLoad))) g.largeFind.stale();
      if (largeCsv(big)) syncCsvTable(true); // a tabela é outra visão do mesmo texto
    } else if (u.selectionSet && largeCsv(big) && g.csvTab === big.id) {
      g.csv?.setCursor(csvTablePos(g, big, u.state.selection.main.head), g.rev); // cursor do código → célula
    }
    if (u.docChanged || u.selectionSet) refreshStatus(false);
    return;
  }
  if (u.docChanged) {
    g.rev++;
    scheduleOutline(g, 500);
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

// ---- arquivos grandes (modo de lotes) --------------------------------------------
//
// Um arquivo de texto acima de 20 MB abre sem ser lido (`large_open`): o Rust o divide em lotes e o editor
// só tem alguns deles (`ui/src/large/`, `crates/core/src/large.rs`). Aqui ficam o que liga isso às abas:
// carregar a janela, a barra de rolagem do arquivo, o Ctrl+F, o salvar e a conferência do disco. O texto
// de uma aba grande nunca vai para `notes/` (a nota é só um marcador) e a busca global não a lê.

const largeIo: LargeIo = {
  info: (id) => api.largeInfo(id),
  batch: (id, index) => api.largeBatch(id, index),
  locate: (id, line) => api.largeLocate(id, line),
  edit: (id, index, text) => api.largeEdit(id, index, text),
};

function largeHooks(tab: TabState): LargeHooks {
  return {
    onDirty(dirty) {
      tab.dirty = dirty;
      renderTabs();
      sessionDirty = true;
      scheduleSave();
    },
    onScroll() {
      // lado a lado: o código rolou, a tabela acompanha (a primeira linha à vista é a mesma)
      const g = groupShowing(tab.id);
      if (!g?.csv || g.csvTab !== tab.id || performance.now() < syncLock || viewKind(tab) !== "split") return;
      const lt = largeOf(tab);
      if (!lt) return;
      lockSync();
      g.csv.scrollToLine(lt.topLine());
    },
    onChange() {
      const g = groupShowing(tab.id);
      if (!g) return;
      g.largeScroll.update();
      if (g === cur && tab.id === session.active) {
        refreshStatus(false);
        renderLargeNote(g, tab);
      }
    },
    onError: (msg) => flashDiskInfo(tab, msg),
  };
}

/** Monta a janela de lotes da aba grande (ou, se o arquivo não abre, um editor vazio e só de leitura). */
async function loadLargeState(tab: TabState): Promise<EditorState> {
  try {
    let ctl = larges.get(tab.id);
    if (!ctl && !largeLoaded.has(tab.id)) {
      // só metadados (tamanho, alterações guardadas): nada é lido nem indexado até a pessoa carregar
      const info = await api.largeInfo(tab.id).catch(() => api.largeAttach(tab.id));
      largeGate.set(tab.id, { size: info.size, edited: info.edited_batches > 0 });
      if (info.edited_batches > 0 && !tab.dirty) {
        tab.dirty = true; // há alterações guardadas de antes de fechar o app
        sessionDirty = true;
      }
      const wait = createState("", 0, onEditorUpdate);
      states.set(tab.id, wait);
      return wait;
    }
    if (!ctl) {
      // outra janela pode já ter aberto o arquivo (a aba foi movida): o Rust é um só
      const info = await api.largeInfo(tab.id).catch(() => api.largeAttach(tab.id));
      ctl = new LargeTab(tab.id, info, largeIo, largeHooks(tab));
      larges.set(tab.id, ctl);
      if (info.edited_batches > 0 && !tab.dirty) {
        tab.dirty = true; // há alterações guardadas de antes de fechar o app
        sessionDirty = true;
      }
    }
    largeFailed.delete(tab.id);
    await api.largeStart(tab.id); // o índice só começa aqui (abrir não o pede)
    const st = await ctl.createState(tab.cursor, (doc, cursor, extra) => createState(doc, cursor, onEditorUpdate, extra));
    states.set(tab.id, st);
    return st;
  } catch (e) {
    largeFailed.add(tab.id);
    larges.delete(tab.id);
    void message(`Não foi possível abrir "${tab.title}" em modo de arquivo grande.\n\n${e}`, { title: "Arquivo grande", kind: "error" });
    const st = createState("", 0, onEditorUpdate);
    states.set(tab.id, st);
    return st;
  }
}

/** Aviso fixo da aba grande (tamanho, e o que é diferente neste modo). */
function renderLargeNote(g: Group, tab: TabState) {
  const lt = largeOf(tab);
  g.largeNoteEl.hidden = !lt;
  if (!lt) return;
  const orphan = lt.info.orphaned ? " As alterações guardadas são de outra versão do arquivo e não foram aplicadas." : "";
  const table = largeCsv(tab) && viewKind(tab) !== "source" && !tab.detached;
  g.largeNoteEl.textContent = table
    ? `Arquivo grande (${humanSize(lt.info.size)}): a tabela mostra o trecho carregado do texto e rola junto com ele; a primeira coluna é a linha do arquivo. Editar vale (é o texto: desfazer, salvar em fluxo); ordenar, filtrar e mexer em colunas não, pois agiriam só no trecho.${orphan}`
    : `Arquivo grande (${humanSize(lt.info.size)}): só o trecho da tela fica na memória. Localizar e ir para a linha leem o disco; substituir e a busca global não valem aqui.${orphan}`;
  if (lt.info.orphaned && !g.largeNoteEl.querySelector("button")) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "Descartar as alterações guardadas";
    b.addEventListener("click", () => void api.largeDiscard(tab.id).then((i) => ((lt.info = i), renderLargeNote(g, tab))));
    g.largeNoteEl.append(b);
  }
}

/** Liga ou desliga o que só existe numa aba grande (rolagem do arquivo, aviso, busca) conforme a aba do painel. */
function syncLarge(g: Group) {
  const tab = tabOf(g);
  const on = !!tab?.large && !!largeOf(tab);
  g.bodyEl.classList.toggle("large", !!tab?.large);
  g.largeScroll.show(on);
  if (!tab || g.largeTab !== tab.id) {
    g.largeFind.reset();
    g.largeTab = tab?.large ? tab.id : null;
  }
  if (tab) renderLargeNote(g, tab);
  else g.largeNoteEl.hidden = true;
}

/** Ctrl+F numa aba grande: a busca roda no Rust, em fluxo, e é cancelável. */
function findLarge() {
  const g = cur;
  if (!largeOf(tabOf(g))) return;
  const sel = g.view.state.selection.main;
  const text = sel.empty ? "" : g.view.state.sliceDoc(sel.from, sel.to);
  g.largeFind.open(text && !text.includes("\n") && text.length <= 200 ? text : undefined);
}

/** Ctrl+Z / Ctrl+Y do painel: numa aba grande vale também para os lotes que já saíram da janela. */
function undoIn(g: Group) {
  const lt = largeOf(tabOf(g));
  if (lt) void lt.undo();
  else undo(g.view);
}
function redoIn(g: Group) {
  const lt = largeOf(tabOf(g));
  if (lt) void lt.redo();
  else redo(g.view);
}

function flashLarge(text: string) {
  if (session.active) flashDiskInfo(activeTab(), text);
}

/** UTF-16 grande não tem índice por byte: a pessoa escolhe carregar tudo (o caminho de sempre) ou desistir. */
async function confirmWholeLoad(path: string, size: number): Promise<boolean> {
  const r = await message(`"${baseName(path)}" tem ${humanSize(size)} e está em UTF-16, que o modo de arquivo grande não abre. Carregar o arquivo inteiro na memória pode deixar o Fullpad lento.`, {
    title: "Arquivo grande",
    kind: "warning",
    buttons: { ok: "Carregar inteiro", cancel: "Cancelar" },
  });
  return r === "Carregar inteiro";
}

/** Salvar de uma aba grande: copia o original em fluxo trocando só os lotes editados (escrita atômica). */
async function saveLarge(tab: TabState, forceDialog: boolean): Promise<boolean> {
  if (largeGate.has(tab.id)) {
    flashLarge("Carregue o arquivo antes de salvar (botão Carregar na aba).");
    return false;
  }
  const ctl = largeOf(tab);
  if (!ctl) {
    await message("O arquivo grande desta aba não está aberto.", { title: "Erro ao salvar", kind: "error" });
    return false;
  }
  let dest: string | null = null;
  if (forceDialog) {
    dest = await saveDialog({ defaultPath: tab.path ?? undefined, filters: FILTERS });
    if (!dest) return false;
  }
  const showing = groupShowing(tab.id);
  if (showing) snapshotGroup(showing);
  await ctl.commit();
  // O que salvar custa: trechos que mantêm o tamanho gravam no lugar, sem perguntar; se algum mudou de
  // tamanho, o resto do arquivo muda de lugar e a pessoa escolhe entre seguro e direto. "Salvar como"
  // sempre monta um arquivo novo (o original fica intacto).
  let mode: SaveMode = "safe";
  let inPlace = false;
  if (!dest) {
    try {
      const plan = await api.largeSavePlan(tab.id);
      if (plan.edited === 0) {
        tab.dirty = false;
        renderTabs();
        return true;
      }
      if (plan.resized === 0) {
        mode = "direct";
        inPlace = true;
      } else {
        const choice = await chooseSaveMode(plan, tab.title);
        if (!choice) return false; // cancelou: nada foi gravado, as alterações continuam
        mode = choice;
      }
    } catch (e) {
      await message(String(e), { title: "Erro ao salvar", kind: "error" });
      return false;
    }
  }
  let saved: Awaited<ReturnType<typeof api.largeSave>>;
  const progress = showSaving({
    poll: () => api.largeSaveProgress(tab.id),
    cancel: () => void api.largeSaveCancel(tab.id).catch(() => {}),
    cancelable: mode === "safe",
  });
  try {
    saved = await enqueue(() => api.largeSave(tab.id, dest, mode));
  } catch (e) {
    progress.close();
    if (String(e).includes("salvar cancelado")) {
      flashLarge("Salvar cancelado: o arquivo ficou como estava");
      return false;
    }
    if (isConflict(e)) {
      // o arquivo mudou fora do Fullpad: os lotes editados não valem sobre outro conteúdo, então não há "sobrescrever"
      const r = await message(`"${tab.title}" foi alterado fora do Fullpad. As suas alterações não podem ser aplicadas a ele.`, {
        title: "Arquivo alterado",
        kind: "warning",
        buttons: { ok: "Recarregar do disco", cancel: "Cancelar" },
      });
      if (r === "Recarregar do disco") await reloadLarge(tab);
    } else {
      await message(String(e), { title: "Erro ao salvar", kind: "error" });
    }
    return false;
  }
  progress.close();
  tab.disk = saved.stamp;
  tab.path = saved.path;
  tab.title = saved.title;
  tab.dirty = false;
  diskIssue.delete(tab.id);
  rememberPath(saved.path);
  await ctl.afterWrite(saved.info, true);
  renderTabs();
  refreshStatus(false);
  sessionDirty = true;
  scheduleSave();
  const g = groupShowing(tab.id);
  if (g) renderDiskBar(g);
  // depois do `renderDiskBar` acima: ele esconde a faixa, e o aviso sumiria no mesmo instante
  if (inPlace) flashLarge("Salvo no lugar: só os trechos alterados foram regravados (mesmo tamanho).");
  return true;
}

/** Descarta as alterações e relê o arquivo do disco (a janela volta para a mesma linha, se ela ainda existir). */
async function reloadLarge(tab: TabState): Promise<boolean> {
  const ctl = largeOf(tab);
  if (!ctl) return false;
  try {
    const info = await api.largeReload(tab.id);
    await ctl.afterWrite(info, false);
  } catch (e) {
    await message(String(e), { title: "Não foi possível recarregar", kind: "error" });
    return false;
  }
  tab.dirty = false;
  diskIssue.delete(tab.id);
  const g = groupShowing(tab.id);
  if (g) renderDiskBar(g);
  renderTabs();
  refreshStatus(false);
  sessionDirty = true;
  scheduleSave();
  flashDiskInfo(tab, `"${tab.title}" recarregado do disco.`);
  return true;
}

/** Confere (só data e tamanho) se o arquivo grande mudou. Nunca recarrega sozinho: um log que cresce moveria a tela. */
async function checkLargeDisk(tab: TabState, g: Group) {
  const state = await api.largeCheck(tab.id);
  if (state === "unchanged") {
    if (diskIssue.delete(tab.id)) renderDiskBar(g);
    diskDismissed.delete(tab.id);
    return;
  }
  if (diskIssue.get(tab.id) !== state) {
    diskIssue.set(tab.id, state);
    diskDismissed.delete(tab.id);
  }
  renderDiskBar(g);
}

// ---- abas -------------------------------------------------------------------

function tabLabel(t: TabState): string {
  return (t.dirty ? "● " : "") + (t.title || "Nova nota");
}

function updateTitle() {
  if (session.active) {
    void thisWindow.setTitle(`${tabLabel(activeTab())} — Fullpad`);
    postitBar?.setTitle(tabLabel(activeTab()));
  }
}
let postitBar: PostitBar | undefined;

/** Alfinete (agulha) mostrado no lugar do × nas abas fixadas. */
const PIN_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M9.5 1.5 14.5 6.5l-1.4.4-2.4 2.4.3 3.1-1 1-2.6-2.6L3.6 13.3 2.7 13.3l0-.9 3.2-3.2L3.3 6.6l1-1 3.1.3 2.4-2.4z"/></svg>';

function renderTabs() {
  clearGhost();
  for (const g of groups.values()) {
    renderStrip(g);
    scheduleOutline(g, 120);
  }
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
  if (tab.large) return loadLargeState(tab);
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
  const prev = g.active && g.active !== tab.id ? session.tabs.find((t) => t.id === g.active) : undefined;
  largeOf(prev)?.attach(null); // a aba grande que sai guarda o estado da janela
  const st = await loadState(tab, text);
  session.active = tab.id;
  g.active = tab.id;
  g.rev++;
  g.view.setState(st);
  largeOf(tab)?.attach(g.view);
  redetect(tab);
  applyTabConfig();
  void syncCsv(tab);
  renderTabs();
  renderDiskBar(g);
  void checkDisk(tab); // o arquivo pode ter mudado enquanto a aba não estava à vista (ou o app, fechado)
  void restoreLargeJump(tab); // arquivo grande aberto no começo porque o índice ainda não chegava à linha salva
  requestAnimationFrame(() => {
    if (tab.large) largeOf(tab)?.reveal();
    else g.view.scrollDOM.scrollTop = tab.scroll;
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
  const big = largeOf(tabOf(cur));
  if (big) {
    // arquivo grande: a conta de qual lote tem a linha é só somar as linhas dos lotes (sem ler o arquivo)
    const g = cur;
    void big.goto(line - 1, { col: Math.max(0, (col ?? 1) - 1) }).then(() => {
      const t = tabOf(g);
      if (t && largeCsv(t) && g.csvTab === t.id) {
        lockSync();
        g.csv?.scrollToLine(line - 1); // a tabela vai à mesma linha do arquivo
      }
    });
    return;
  }
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
  // `show` restaura a rolagem da aba num requestAnimationFrame e desfaria o salto: espera esse quadro passar
  const jump = (line?: number, col?: number) => {
    if (line === undefined) return;
    requestAnimationFrame(() => requestAnimationFrame(() => gotoLineCol(line, col)));
  };
  openPalette(
    {
      tabs: () => pinnedFirst(session.tabs).map((t) => ({ id: t.id, title: t.title, path: t.path, pinned: !!t.pinned, active: t.id === session.active })),
      closed: () => closedCache.map((c) => ({ id: c.tab.id, title: c.tab.title, path: c.tab.path })),
      recents: loadRecents,
      commands: paletteCommands,
      symbols: symbolsOfActive,
      lineCount: () => (session.active && !isReader(activeTab()) ? (largeOf(activeTab())?.totalLines ?? cur.view.state.doc.lines) : null),
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

  await largeOf(tab)?.commit(); // as alterações de um arquivo grande vão ao Rust, que as guarda com a aba na lixeira
  // grava o conteúdo pendente antes de mover para a lixeira
  if (dirtyNotes.has(id)) {
    dirtyNotes.delete(id);
    await enqueue(() => api.saveNote(id, states.get(id)!.doc.toString()));
  }
  closePreviewWindow(id);
  layouts.delete(id);
  layoutOpen.delete(id);
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

const textTabIds = () => session.tabs.filter((t) => !isReader(t) && !t.large).map((t) => t.id); // a busca global não lê arquivo grande

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
    if (!tab || isReader(tab) || tab.release_notes) continue; // nota de versão é só de leitura
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

// ---- sumário lateral ----------------------------------------------------------------

/** Vai para a posição no editor do painel (a linha fica perto do topo) e devolve o foco a ele. */
function gotoPosIn(g: Group, pos: number) {
  if (g !== cur) enterGroup(g);
  const at = Math.min(pos, g.view.state.doc.length);
  g.view.dispatch({ selection: { anchor: at }, effects: CMEditorView.scrollIntoView(at, { y: "start", yMargin: 30 }) });
  g.view.focus();
}

function scheduleOutline(g: Group, delay: number) {
  window.clearTimeout(g.olTimer);
  g.olTimer = window.setTimeout(() => void refreshOutline(g), delay);
}

async function outlineItemsOf(g: Group): Promise<OutlineItem[] | null> {
  const tab = tabOf(g);
  if (!tab || isReader(tab)) return null;
  const lang = effectiveLang(tab);
  const text = g.view.state.doc.toString();
  if (lang === "markdown") return markdownSymbols(text).map((s) => ({ label: s.label, pos: s.pos, depth: s.depth ?? 0 }));
  if (lang === "dbml") return dbmlSymbols(text).map((s) => ({ label: `${s.meta === "Table" ? "" : (s.meta ?? "") + " "}${s.label}`, pos: s.pos, depth: 0 }));
  if (lang === "json" || lang === "yaml" || lang === "toml") {
    if (text.length > 2_000_000) return null;
    const a = lang === "json" ? await api.jsonAnalyze(text) : await api.dataAnalyze(lang, text);
    return a.doc ? treeOutline(a.doc.nodes) : null;
  }
  return null;
}

async function refreshOutline(g: Group) {
  const tab = tabOf(g);
  const key = tab ? `${tab.id}|${effectiveLang(tab)}|${g.rev}` : "";
  if (key === g.olKey) return;
  g.olKey = key;
  const token = ++g.olToken;
  let items: OutlineItem[] | null = null;
  try {
    items = await outlineItemsOf(g);
  } catch {
    items = null;
  }
  if (token !== g.olToken) return; // chegou outra pedida depois
  g.olItems = items ?? [];
  g.outline.set(items);
  updateOutlineActive(g);
}

function updateOutlineActive(g: Group) {
  if (g.olItems.length === 0) return;
  const top = g.view.lineBlockAtHeight(g.view.scrollDOM.scrollTop + 8).from;
  g.outline.setActive(activeIndex(g.olItems, top));
}

function applyOutlineConfig() {
  for (const g of groups.values()) g.outline.config({ enabled: outlineOn, pinned: outlinePinned, side: outlineSide });
}
function toggleOutline() {
  outlineOn = !outlineOn;
  writeSetting("outline", outlineOn);
  applyOutlineConfig();
}
function toggleOutlinePinned() {
  outlinePinned = !outlinePinned;
  writeSetting("outlinePinned", outlinePinned);
  applyOutlineConfig();
}
function setOutlineSide(side: OutlineSide) {
  outlineSide = side;
  try {
    localStorage.setItem("fullpad.outlineSide", side);
  } catch {
    /* sem storage: só não lembra */
  }
  applyOutlineConfig();
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
  const layoutEl = div("layoutview");
  const jsonEl = div("jsonview");
  const csvEl = div("csvview");
  const readerEl = div("reader");
  const gateEl = div("largegate");
  const outlineEl = div("outline");
  bodyEl.append(editorEl, layoutEl, mdEl, diagramEl, jsonEl, csvEl, readerEl, gateEl, outlineEl);
  const noteEl = div("note");
  noteEl.hidden = true;
  const diskEl = div("diskbar");
  diskEl.hidden = true;
  const csvAskEl = div("csvask");
  csvAskEl.hidden = true;
  const backEl = div("backbar");
  backEl.hidden = true;
  const largeNoteEl = div("largenote");
  largeNoteEl.hidden = true;
  el.append(tabsEl, diskEl, backEl, csvAskEl, noteEl, largeNoteEl, bodyEl);
  const view = createView(editorEl, createState("", 0, onEditorUpdate));
  const g: Group = { id, el, tabsEl, bodyEl, editorEl, diagramEl, layoutEl, layoutTab: null, mdEl, jsonEl, csvEl, noteEl, csvAskEl, backEl, diskEl, readerEl, gateEl, view, active: null, rev: 0, diagramTab: null, jsonTab: null, csvTab: null, csvPrefix: 0, csvTopLine: null, outlineEl, outline: undefined as unknown as Outline, olItems: [], olKey: "", olToken: 0, largeNoteEl, largeTab: null, largeScroll: undefined as unknown as LargeScroll, largeFind: undefined as unknown as LargeFind };
  // colar imagem no markdown: o editor pergunta a que aba pertence e onde avisar (`mdimage.ts`)
  registerImageHost(view, {
    tabId: () => {
      const t = tabOf(g);
      return acceptsImages(t) ? t!.id : null;
    },
    base: () => dirOf(tabOf(g)?.path ?? null),
    notify: (text) => {
      const t = tabOf(g);
      if (t) flashDiskInfo(t, text);
    },
  });
  const bigOf = () => largeOf(tabOf(g));
  // a barra de rolagem do arquivo vale para o editor e para a tabela (por isso fica no corpo do painel, não no editor)
  const tableShown = () => {
    const t = tabOf(g);
    return !!t && largeCsv(t) && g.csvTab === t.id && viewKind(t) === "inline";
  };
  const alignTable = (line: number) => {
    const t = tabOf(g);
    if (t && largeCsv(t) && g.csvTab === t.id) {
      lockSync();
      g.csv?.scrollToLine(line);
    }
  };
  g.largeScroll = mountLargeScroll(bodyEl, {
    total: () => bigOf()?.totalLines ?? 0,
    line: () => (tableShown() && g.csvTopLine !== null ? g.csvTopLine : (bigOf()?.topLine() ?? 0)),
    visible: () => Math.max(1, Math.floor((tableShown() ? g.csvEl : view.scrollDOM).clientHeight / (tableShown() ? 24 : Math.max(1, view.defaultLineHeight)))),
    jump: (line) => void bigOf()?.goto(line, { focus: false }).then(() => alignTable(line)),
  });
  g.largeFind = mountLargeFind(el, {
    search: (id, q, o) => api.largeSearch(g.active!, id, q, o),
    cancel: (id) => void api.largeCancel(id),
    listen: (h) => listen<{ search: string; hits: LargeHit[] }>("large-hits", (e) => h(e.payload.search, e.payload.hits)),
    reveal: (hit) => void bigOf()?.goto(hit.line, { col: hit.col, len: hit.len, focus: false }).then(() => alignTable(hit.line)),
    cursorLine: () => bigOf()?.cursorLine() ?? 0,
    indexed: () => bigOf()?.info.done ?? true,
    refocus: () => view.focus(),
  });
  el.insertBefore(g.largeFind.el, bodyEl);
  g.outline = createOutline(outlineEl, { goto: (pos) => gotoPosIn(g, pos), togglePinned: toggleOutlinePinned, focusEditor: () => g.view.focus() });
  g.outline.config({ enabled: outlineOn, pinned: outlinePinned, side: outlineSide });
  groups.set(id, g);
  let olFrame = 0;
  view.scrollDOM.addEventListener(
    "scroll",
    () => {
      followScroll(g);
      if (!olFrame) olFrame = requestAnimationFrame(() => ((olFrame = 0), updateOutlineActive(g)));
    },
    { passive: true },
  );
  // botão direito num markdown ou JSON: copiar/colar e exportar/formatar (nos outros tipos fica o menu padrão)
  el.addEventListener("contextmenu", (e) => {
    const t = tabOf(g);
    const lang = t ? effectiveLang(t) : "plain";
    const inEditor = e.target instanceof HTMLElement && editorEl.contains(e.target);
    if (!t || (lang !== "markdown" && lang !== "json" && !(lang === "dbml" && inEditor)) || (e.target as HTMLElement).closest(".tabs")) return;
    e.preventDefault();
    enterGroup(g);
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
    else if (lang === "dbml") {
      // o cursor não anda no botão direito: o símbolo é o que está sob o ponteiro
      const pos = g.view.posAtCoords({ x: e.clientX, y: e.clientY });
      items.push("sep", {
        label: "Renomear símbolo…",
        shortcut: "F2",
        disabled: pos === null || isReadOnlyText(t),
        action: () => {
          if (pos === null) return;
          g.view.dispatch({ selection: { anchor: pos } });
          void renameSymbolAt(g, pos, "at", { x: e.clientX, y: e.clientY });
        },
      });
    } else if (inEditor) {
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
  csvUndecided.delete(id);
  larges.get(id)?.dispose();
  larges.delete(id);
  largeFailed.delete(id);
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
  await largeOf(tab)?.commit(); // o Rust é de todas as janelas: a outra lê o arquivo grande dele
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

/** A aba pode virar nota adesiva: texto editável, e não já dentro de um post-it. */
const canPostit = (tab: TabState) => !isPostit && !isReader(tab) && !isReadOnlyText(tab) && !tab.large;

/** Manda a aba para uma nota adesiva (post-it) nova: sai desta janela como em `sendTab`. */
async function sendToPostit(id: string) {
  const tab = session.tabs.find((t) => t.id === id);
  if (!tab || !canPostit(tab)) return;
  const copy = await prepareToLeave(id);
  if (!copy) return;
  try {
    await enqueue(() => api.tabToPostit(copy));
  } catch (e) {
    await message(String(e), { title: "Não foi possível criar a nota adesiva", kind: "error" });
    return;
  }
  await removeLocalTab(id);
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
    { label: "Manter janela no topo", checked: onTop, action: toggleOnTop },
    { label: "Enviar para nota adesiva", disabled: !canPostit(tab), action: () => void sendToPostit(tab.id) },
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
  csvUndecided.delete(tab.id);
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
  { name: "Texto, Markdown, DBML, Mermaid, LaTeX, JSON, YAML, TOML, CSV, PDF e EPUB", extensions: ["md", "markdown", "txt", "dbml", "dbmlx", "mmd", "mermaid", "tex", "latex", "ltx", "json", "jsonc", "yaml", "yml", "toml", "csv", "tsv", "pdf", "epub"] },
  { name: "Todos os arquivos", extensions: ["*"] },
];

const FILTERS = [
  { name: "Texto, Markdown, DBML, Mermaid, LaTeX, JSON, YAML, TOML e CSV", extensions: ["md", "markdown", "txt", "dbml", "dbmlx", "mmd", "mermaid", "tex", "latex", "ltx", "json", "jsonc", "yaml", "yml", "toml", "csv", "tsv"] },
  { name: "Todos os arquivos", extensions: ["*"] },
];

function exportBaseName(tab: TabState): string {
  return suggestedName(tab).replace(/\.[^.]+$/, "");
}

/** De onde a exportação lê as imagens locais do markdown (a pasta do arquivo da aba). */
const exportImages = (tab: TabState) => ({ base: dirOf(tab.path), read: api.imageRead });

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
    const html = await markdownToHtml(cur.view.state.doc.toString(), exportBaseName(tab), false, exportImages(tab));
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
    await printAsPdf(cur.view.state.doc.toString(), exportBaseName(tab), exportImages(tab));
  } catch (e) {
    await message(String(e), { title: "Não foi possível exportar", kind: "error" });
  }
}

async function copyHtml() {
  if (effectiveLang(activeTab()) !== "markdown") return;
  try {
    const { copyAsHtml } = await import("./mdexport");
    await copyAsHtml(cur.view.state.doc.toString(), exportImages(activeTab()));
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

/** Ajuda > "Histórico de versões": o changelog completo numa aba só de leitura (ou a que já estiver aberta). */
async function showChangelog() {
  try {
    const opened = await api.openChangelog();
    const existing = session.tabs.find((t) => t.release_notes && t.title === opened.tab.title);
    if (existing) {
      await api.closeNote(opened.tab.id).catch(() => {});
      await activate(existing.id);
      return;
    }
    snapshotActive();
    placeInGroup(opened.tab, cur);
    await show(opened.tab, opened.text);
  } catch (e) {
    await message(String(e), { title: "Não foi possível abrir o histórico", kind: "error" });
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
      // arquivo de texto muito grande: modo de lotes (o arquivo nem é lido; os comuns seguem o caminho de sempre)
      const probe = reader ? ({ kind: "normal" } as const) : await api.largeProbe(path);
      if (probe.kind === "utf16" && !(await confirmWholeLoad(path, probe.size))) continue;
      const { tab, text } = probe.kind === "large" ? { tab: (await api.largeOpen(path)).tab, text: "" } : reader ? { tab: await api.openReader(path), text: "" } : await api.openFile(path);
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
// ---- o arquivo mudou fora do Fullpad ---------------------------------------------------
//
// Cada aba ligada a arquivo guarda o carimbo dele (`tab.disk`, do Rust). Ao focar a janela, a cada
// poucos segundos e ao mostrar a aba, `file_check` compara o arquivo com o carimbo:
//  - mudou e a aba não tem alterações: recarrega sozinho (Ctrl+Z traz o texto de antes);
//  - mudou e a aba tem alterações: faixa com "Recarregar do disco" ou "Manter o meu";
//  - sumiu: faixa avisando (o texto continua na aba; Salvar recria o arquivo).
// E Salvar nunca grava por cima de uma mudança externa sem perguntar (`save`, erro `conflito:`).

type DiskIssue = "changed" | "missing";
const diskIssue = new Map<string, DiskIssue>(); // aba → problema ainda sem resposta
const diskDismissed = new Set<string>(); // "sumiu" que a pessoa dispensou
const diskChecking = new Set<string>();
const DISK_POLL_MS = 2000;
const isConflict = (e: unknown) => String(e).startsWith("conflito:");

/** Aba ligada a um arquivo de texto do usuário (as únicas que têm o que conferir no disco). */
const hasDiskFile = (tab: TabState) => !!tab.path && !isReader(tab) && !tab.release_notes;

function renderDiskBar(g: Group, info?: string) {
  const tab = tabOf(g);
  const issue = tab && hasDiskFile(tab) ? diskIssue.get(tab.id) : undefined;
  const bar = g.diskEl;
  bar.replaceChildren();
  if (!tab || (!issue && !info) || (issue === "missing" && diskDismissed.has(tab.id))) {
    bar.hidden = true;
    return;
  }
  const msg = document.createElement("span");
  msg.className = "diskbar-msg";
  bar.append(msg);
  const btn = (label: string, title: string, run: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", run);
    bar.append(b);
  };
  const name = tab.title || "este arquivo";
  if (tab.large && issue === "changed") {
    msg.textContent = tab.dirty ? `"${name}" foi alterado fora do Fullpad. As suas alterações não podem ser aplicadas a ele.` : `"${name}" foi alterado fora do Fullpad (um log, por exemplo, pode ter crescido).`;
    btn("Recarregar do disco", tab.dirty ? "Relê o arquivo e descarta as alterações guardadas" : "Relê o arquivo", () => void reloadLarge(tab));
  } else if (tab.large && issue === "missing") {
    msg.textContent = `O arquivo de "${name}" foi apagado ou movido. As alterações ficam guardadas, mas não há de onde copiar o resto do arquivo.`;
    btn("Dispensar", "Esconde este aviso", () => {
      diskDismissed.add(tab.id);
      renderDiskBar(g);
    });
  } else if (issue === "changed") {
    msg.textContent = `"${name}" foi alterado fora do Fullpad, e você também tem alterações aqui.`;
    btn("Recarregar do disco", "Troca o texto pelo do arquivo (suas alterações ficam no Ctrl+Z)", () => void reloadFromDisk(tab));
    btn("Manter o meu", "Fica com o texto da aba; o próximo Salvar grava por cima do arquivo", () => void keepMine(tab));
  } else if (issue === "missing") {
    msg.textContent = `O arquivo de "${name}" foi apagado ou movido. O texto continua aqui.`;
    btn("Salvar como…", "Grava o texto da aba num arquivo", () => void save(tab, true));
    btn("Dispensar", "Esconde este aviso", () => {
      diskDismissed.add(tab.id);
      renderDiskBar(g);
    });
  } else {
    msg.textContent = info!;
  }
  bar.hidden = false;
}

/** Aviso passageiro (some sozinho) na faixa do painel que mostra a aba. */
function flashDiskInfo(tab: TabState, text: string) {
  const g = groupShowing(tab.id);
  if (!g) return;
  renderDiskBar(g, text);
  window.setTimeout(() => groupShowing(tab.id) === g && !diskIssue.has(tab.id) && renderDiskBar(g), 5000);
}

/** Confere o arquivo de uma aba que está à vista; as outras são conferidas quando aparecem. */
async function checkDisk(tab: TabState) {
  const g = groupShowing(tab.id);
  if (!g || !hasDiskFile(tab) || diskChecking.has(tab.id)) return;
  diskChecking.add(tab.id);
  try {
    if (tab.large) return await checkLargeDisk(tab, g);
    const state = await api.fileCheck(tab.id);
    if (state === "unchanged") {
      if (diskIssue.delete(tab.id)) renderDiskBar(g); // voltou ao normal (o arquivo reapareceu, ou a mudança foi desfeita)
      diskDismissed.delete(tab.id);
    } else if (state === "missing") {
      if (diskIssue.get(tab.id) !== "missing") {
        diskIssue.set(tab.id, "missing");
        diskDismissed.delete(tab.id);
      }
      renderDiskBar(g);
    } else if (!tab.dirty) {
      await reloadFromDisk(tab, true); // sem alterações para perder: acompanha o arquivo
    } else {
      diskIssue.set(tab.id, "changed");
      renderDiskBar(g);
    }
  } catch (e) {
    console.error("falha ao conferir o arquivo", e);
  } finally {
    diskChecking.delete(tab.id);
  }
}

function checkAllDisks() {
  for (const g of groups.values()) {
    const t = tabOf(g);
    if (t) void checkDisk(t);
  }
}

/** Troca o texto da aba pelo do arquivo no disco, numa transação (Ctrl+Z desfaz). */
async function reloadFromDisk(tab: TabState, automatic = false): Promise<boolean> {
  const g = groupShowing(tab.id);
  if (!g || !hasDiskFile(tab)) return false;
  const rev = g.rev;
  let r: Awaited<ReturnType<typeof api.fileReload>>;
  try {
    r = await api.fileReload(tab.id);
  } catch (e) {
    if (!automatic) await message(String(e), { title: "Não foi possível recarregar", kind: "error" });
    else console.error("falha ao recarregar o arquivo", e);
    return false;
  }
  if (g.rev !== rev || groupShowing(tab.id) !== g) {
    // a pessoa digitou (ou trocou de aba) enquanto o arquivo era lido: o texto dela fica
    diskIssue.set(tab.id, "changed");
    renderDiskBar(g);
    return false;
  }
  tab.encoding = r.encoding;
  tab.eol = r.eol;
  tab.disk = r.stamp;
  withGroup(g, () => {
    const len = g.view.state.doc.length;
    g.view.dispatch({
      changes: { from: 0, to: len, insert: r.text },
      selection: { anchor: Math.min(g.view.state.selection.main.head, r.text.length) },
    });
  });
  dirtyNotes.delete(tab.id); // o buffer em notas/ já é o do arquivo (o Rust o trocou)
  if (layouts.get(tab.id)?.draft) {
    // recarregar do disco joga fora as minhas alterações: as do layout também
    await api.layoutDiscard(tab.id).catch(() => {});
    layouts.delete(tab.id);
    refreshLayoutUi(tab.id);
  }
  tab.dirty = false;
  diskIssue.delete(tab.id);
  diskDismissed.delete(tab.id);
  redetect(tab);
  if (tab.id === session.active) applyTabConfig();
  renderTabs();
  refreshStatus(false);
  sessionDirty = true;
  scheduleSave();
  flashDiskInfo(tab, automatic ? `"${tab.title}" foi atualizado: o arquivo mudou no disco. Ctrl+Z volta ao texto de antes.` : `"${tab.title}" recarregado do disco. Ctrl+Z volta ao texto de antes.`);
  return true;
}

/** "Manter o meu": o arquivo de agora vira a referência; o próximo Salvar grava por cima sem perguntar. */
async function keepMine(tab: TabState) {
  try {
    const stamp = await api.fileKeep(tab.id);
    if (stamp) tab.disk = stamp;
  } catch (e) {
    await message(String(e), { title: "Erro", kind: "error" });
    return;
  }
  diskIssue.delete(tab.id);
  const g = groupShowing(tab.id);
  if (g) renderDiskBar(g);
  sessionDirty = true;
  scheduleSave();
}

/** Arquivo > "Recarregar do disco" (F5 / Ctrl+R). Com alterações não salvas, confirma antes. */
async function reloadActive() {
  if (!session.active) return;
  const tab = activeTab();
  if (!hasDiskFile(tab)) return;
  if (tab.dirty) {
    const r = await message(`Recarregar "${tab.title}" do disco? As alterações não salvas serão trocadas (Ctrl+Z as traz de volta).`, {
      title: "Fullpad",
      kind: "warning",
      buttons: { ok: "Recarregar", cancel: "Cancelar" },
    });
    if (r !== "Recarregar") return;
  }
  snapshotActive();
  if (tab.large) await reloadLarge(tab);
  else await reloadFromDisk(tab);
}

// Ao voltar para a janela (alt+tab) e de tempos em tempos enquanto ela está em foco.
window.addEventListener("focus", checkAllDisks);
window.setInterval(() => document.hasFocus() && checkAllDisks(), DISK_POLL_MS);

async function save(tab: TabState = activeTab(), forceDialog = false): Promise<boolean> {
  if (isReadOnlyText(tab)) return false; // nota de versão: o texto é do app e é refeito em Ajuda; não vira arquivo do usuário
  if (isReader(tab)) return false; // PDF/EPUB são só de leitura: nada a gravar, e o arquivo nunca é tocado
  if (tab.large) return saveLarge(tab, forceDialog);
  let path = tab.path;
  if (!path || forceDialog) {
    path = await saveDialog({ defaultPath: tab.path ?? suggestedName(tab), filters: FILTERS });
    if (!path) return false;
  }
  const showing = groupShowing(tab.id);
  if (showing) snapshotGroup(showing);
  const text = await textOf(tab.id); // aba que ainda não foi aberta nesta execução não tem estado
  try {
    try {
      tab.disk = await enqueue(() => api.saveFile(tab.id, path, text, tab.encoding, tab.eol));
    } catch (e) {
      if (!isConflict(e)) throw e;
      // o arquivo mudou fora do Fullpad depois de aberto: gravar por cima apagaria essa mudança
      const r = await message(`"${baseName(path)}" foi alterado fora do Fullpad depois de aberto. Gravar por cima apaga essa mudança.`, {
        title: "Arquivo alterado",
        kind: "warning",
        buttons: { yes: "Sobrescrever", no: "Salvar como…", cancel: "Cancelar" },
      });
      if (r === "Salvar como…") return save(tab, true);
      if (r !== "Sobrescrever") return false;
      tab.disk = await enqueue(() => api.saveFile(tab.id, path, text, tab.encoding, tab.eol, true));
    }
  } catch (e) {
    await message(String(e), { title: "Erro ao salvar", kind: "error" });
    return false;
  }
  // o layout do diagrama (.dbmlx) é salvo junto: a cópia de trabalho passa para o arquivo ao lado
  const layoutSaved = await commitLayoutOnSave(tab, path);
  diskIssue.delete(tab.id);
  diskDismissed.delete(tab.id);
  dirtyNotes.delete(tab.id);
  if (tab.path !== path) layouts.delete(tab.id); // salvar como: o arquivo de layout é outro (outro carimbo)
  tab.path = path;
  rememberPath(path);
  tab.release_notes = false; // virou arquivo do usuário: fechar volta a passar pelo histórico
  tab.title = baseName(path);
  tab.dirty = !layoutSaved; // o layout cancelado ou recusado continua pendente
  if (tab.id === session.active) {
    redetect(tab);
    applyTabConfig();
  }
  renderTabs();
  refreshStatus(false);
  sessionDirty = true;
  scheduleSave();
  const shown = groupShowing(tab.id);
  if (shown) renderDiskBar(shown);
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
  if (session.active && activeTab().large) largeWrap = !largeWrap;
  else {
    wrap = !wrap;
    writeSetting("wrap", wrap);
  }
  applyTabConfig();
  cur.view.focus();
}

function toggleLineNumbers() {
  lineNumbers = !lineNumbers;
  writeSetting("lineNumbers", lineNumbers);
  applyTabConfig();
  cur.view.focus();
}

/** "Manter no topo": a janela fica por cima das outras; o Rust grava a escolha na sessão. */
async function setOnTop(v: boolean): Promise<boolean> {
  try {
    await api.setOnTop(v);
    onTop = v;
  } catch (e) {
    console.error(e);
  }
  return onTop;
}

function toggleOnTop() {
  void setOnTop(!onTop).then(() => cur.view.focus());
}

function toggleOverwrite() {
  overwrite = !overwrite;
  applyTabConfig();
  cur.view.focus();
}

function setLanguage(l: Language) {
  const tab = activeTab();
  if (tab.large) {
    flashLarge("Arquivos grandes abrem só como texto (o destaque de sintaxe segue a extensão, em Lang).");
    return;
  }
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
  newPostit: () => void api.newPostit(),
  tabToPostit: () => void (session.active && sendToPostit(session.active)),
  postitsToFront: () => void api.postitsToFront(),
  tabToNewWindow: () => void sendTab(session.active!, "new"),
  openFile: () => void openFiles(),
  readerLoad: () => cur.reader?.load(),
  readerLocate: () => cur.reader?.locate(),
  readerQuote: () => void cur.reader?.quote(),
  save: () => void save(),
  saveAs: () => void save(activeTab(), true),
  saveAll: () => void saveAll(),
  reloadFromDisk: () => void reloadActive(),
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
  changelog: () => void showChangelog(),
  undo: () => (undoIn(cur), cur.view.focus()),
  redo: () => (redoIn(cur), cur.view.focus()),
  selectAll: () => (selectAll(cur.view), cur.view.focus()),
  find: () => void (readerZoom((r) => r.find()) || (largeOf(tabOf(cur)) ? (findLarge(), true) : openSearch(cur.view))),
  replace: () => (largeOf(tabOf(cur)) ? flashLarge("Substituir não está disponível em arquivo grande.") : openSearch(cur.view, true)),
  formatMd: (id: string) => void (session.active && effectiveLang(activeTab()) === "markdown" && runFormat(cur.view, id as FormatId)),
  gotoLine: () => openPaletteWith(":"),
  openPalette: () => openPaletteWith(""),
  gotoSymbol: () => openPaletteWith("@"),
  commandPalette: () => openPaletteWith(">"),
  togglePreview,
  toggleSplit,
  setView,
  toggleDetached,
  renameSymbol: renameSymbolAtCursor,
  toggleLayoutView,
  toggleWrap,
  toggleLineNumbers,
  toggleOnTop,
  toggleOutline,
  toggleOutlinePinned,
  setOutlineSide,
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
      layout: layoutAvailable(tab) ? (layoutShown(tab) ? ("open" as const) : ("closed" as const)) : null,
      canSave: !isReadOnlyText(tab) && !isReader(tab),
      canReload: hasDiskFile(tab),
      wrap: tab.large ? largeWrap : wrap,
      lineNumbers,
      onTop,
      canPostit: canPostit(tab),
      outline: { on: outlineOn, pinned: outlinePinned, side: outlineSide },
      jsonIndent,
      csv: csvSettings(tab),
      csvDetected: csvDetected.get(tab.id) ?? ",",
      hasSelection: !cur.view.state.selection.main.empty,
      codeLang: { chosen: tab.code_lang, effective: effectiveLang(tab) === "plain" ? (codeLangOf(tab)?.name ?? null) : null },
      treeOn: jsonTreeOn(),
      zoom: currentZoom(),
    };
  },
};

window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "F5" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault(); // sem isto o WebView recarrega a interface, e nada muda no texto
      return void reloadActive();
    }
    if (e.key === "F2" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && effectiveLang(activeTab()) === "dbml" && !(e.target as HTMLElement | null)?.closest?.(".renamebox")) {
      e.preventDefault();
      return renameSymbolAtCursor();
    }
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
    else if (key === "r" && !e.shiftKey) run(() => void reloadActive());
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
// Exceção: imagens soltas sobre um markdown viram `![](…)` no ponto onde caem (copiadas para a pasta das
// imagens da aba, como no Ctrl+V), com a prévia de onde e como vão ficar.
const fileDrop = createFileDrop();
const dropCaret = Object.assign(document.createElement("div"), { className: "imgdrop-caret", hidden: true });
document.body.append(dropCaret);

interface ImageDropTarget {
  g: Group;
  tab: TabState;
  pos: number;
}
/** As imagens soltas, a janela de onde vêm e o que se sabe de cada uma por aba (a pasta muda de aba para aba). */
let imageDrag: { paths: string[]; plans: Map<string, Promise<{ plans: ImagePlan[] | null; error: string | null }>> } | null = null;

/** Onde as imagens cairiam: no markdown do painel sob o ponteiro (no ponto do mouse se está no editor, senão no cursor). */
function imageDropTarget(paths: readonly string[], at: { x: number; y: number }): ImageDropTarget | null {
  if (!allImages(paths)) return null;
  const el = document.elementFromPoint(at.x, at.y);
  const g = [...groups.values()].find((x) => el && x.el.contains(el)) ?? cur;
  const tab = tabOf(g);
  if (!tab || !acceptsImages(tab) || effectiveLang(tab) !== "markdown" || g.view.state.readOnly) return null;
  const r = g.editorEl.getBoundingClientRect();
  const inEditor = at.x >= r.left && at.x <= r.right && at.y >= r.top && at.y <= r.bottom;
  const pos = (inEditor ? g.view.posAtCoords(at) : null) ?? g.view.state.selection.main.head;
  return { g, tab, pos };
}

function planImageDrop(tab: TabState, paths: string[]) {
  const hit = imageDrag!.plans.get(tab.id);
  if (hit) return hit;
  const p = Promise.all(paths.map((path) => api.imageImport(tab.id, path, true))).then(
    (plans) => ({ plans, error: null as string | null }),
    (e) => ({ plans: null, error: String(e).replace(/^Error: /, "") }),
  );
  imageDrag!.plans.set(tab.id, p);
  return p;
}

/** Mostra (ou atualiza) o aviso e a barra de onde as imagens cairiam. */
function paintImageDrop(paths: string[], at: { x: number; y: number }) {
  const t = imageDropTarget(paths, at);
  if (!t) {
    dropCaret.hidden = true;
    fileDrop.show(paths.length);
    return;
  }
  const line = t.g.view.state.doc.lineAt(t.pos).number;
  const draw = (r: { plans: ImagePlan[] | null; error: string | null } | null) => {
    if (!imageDrag) return;
    const { title, detail } = imageDropText(paths.length, line, r?.plans ?? null, r?.error ?? null);
    fileDrop.showImage(title, detail);
  };
  draw(null);
  void planImageDrop(t.tab, paths).then((r) => {
    const now = imageDropTarget(paths, at);
    if (now?.tab.id === t.tab.id) draw(r);
  });
  const c = t.g.view.coordsAtPos(t.pos);
  if (c) {
    Object.assign(dropCaret.style, { left: `${c.left - 1}px`, top: `${c.top}px`, height: `${c.bottom - c.top}px` });
    dropCaret.hidden = false;
  } else dropCaret.hidden = true;
}

/** Copia as imagens para a pasta da aba e as escreve no ponto onde caíram (uma transação, um passo no Ctrl+Z). */
async function dropImages(t: ImageDropTarget, paths: string[]) {
  const targets: string[] = [];
  const problems: string[] = [];
  let reused = 0;
  for (const path of paths) {
    try {
      const saved = await api.imageImport(t.tab.id, path, false);
      targets.push(saved.target);
      if (saved.reused) reused++;
    } catch (e) {
      problems.push(`${baseName(path)}: ${String(e).replace(/^Error: /, "")}`);
    }
  }
  if (targets.length > 0 && tabOf(t.g)?.id === t.tab.id) {
    insertImage(t.g.view, targets, { from: Math.min(t.pos, t.g.view.state.doc.length) }, "input.drop");
  }
  const parts = [];
  if (targets.length > 0) parts.push(`${targets.length === 1 ? "Imagem inserida" : `${targets.length} imagens inseridas`}${reused > 0 ? ` (${reused} já existia${reused === 1 ? "" : "m"}: reaproveitada${reused === 1 ? "" : "s"})` : ""}.`);
  if (problems.length > 0) parts.push(`Não foi possível inserir: ${problems.join("; ")}`);
  flashDiskInfo(t.tab, parts.join(" "));
}

void getCurrentWebview().onDragDropEvent((e) => {
  const p = e.payload;
  const at = () => {
    const pos = "position" in p ? p.position : null;
    const k = window.devicePixelRatio || 1;
    return pos ? { x: pos.x / k, y: pos.y / k } : { x: -1, y: -1 };
  };
  if (p.type === "enter") {
    imageDrag = allImages(p.paths) ? { paths: p.paths, plans: new Map() } : null;
    if (imageDrag) paintImageDrop(p.paths, at());
    else fileDrop.show(p.paths.length);
  } else if (p.type === "over") {
    if (imageDrag) paintImageDrop(imageDrag.paths, at());
  } else if (p.type === "drop") {
    const target = imageDrag ? imageDropTarget(p.paths, at()) : null;
    imageDrag = null;
    fileDrop.hide();
    dropCaret.hidden = true;
    if (p.paths.length > 0) {
      void thisWindow.setFocus();
      if (target) void dropImages(target, p.paths);
      else void openPaths(p.paths);
    }
  } else if (p.type === "leave") {
    imageDrag = null;
    fileDrop.hide();
    dropCaret.hidden = true;
  }
});

// ---- ciclo de vida ----------------------------------------------------------

window.addEventListener("blur", () => void flush());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void flush();
});

async function boot() {
  largeKeys.find = findLarge;
  largeKeys.undo = () => undoIn(cur);
  largeKeys.redo = () => redoIn(cur);
  largeKeys.replace = () => flashLarge("Substituir não está disponível em arquivo grande.");
  document.body.classList.toggle("floating", !isMain); // janelas flutuantes: sem menu superior
  document.body.classList.toggle("postit", isPostit);
  await incomingReady; // ouvindo antes de ler a sessão: nenhuma aba que chegue se perde
  const startup = await api.loadStartup();
  session = startup.session;
  onTop = startup.on_top;
  if (isPostit) {
    postitBar = mountPostitBar(document.body, { pinned: onTop, onPin: setOnTop, onClose: () => void thisWindow.close() });
    // Esc fecha o post-it (a menos que o editor o tenha usado: fechar a busca, por exemplo)
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !e.defaultPrevented && !e.ctrlKey && !e.altKey && !e.shiftKey) void thisWindow.close();
    });
  }
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
    let st: EditorState;
    if (tab.large) {
      st = await loadLargeState(tab); // o arquivo grande não passa por `notes/`
    } else {
      const text = tab.id === startTab?.id ? startup.active_text : await api.readNote(tab.id);
      st = createState(text, tab.cursor, onEditorUpdate);
      states.set(tab.id, st);
    }
    g.view.setState(st);
    largeOf(tab)?.attach(g.view);
    redetect(tab);
  }
  void refreshClosed();
  menubar = mountMenuBar(menubarEl, menuActions);
  // Ctrl+Z / Ctrl+Y com a tabela do CSV à vista e o foco perdido (depois de salvar, de um aviso…): o desfazer vale do mesmo jeito
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    const redoKey = k === "y" || (k === "z" && e.shiftKey);
    if (k !== "z" && !redoKey) return;
    const a = document.activeElement;
    if (a && a !== document.body && a !== document.documentElement) return;
    const t = tabOf(cur);
    if (!t || cur.csvTab !== t.id || !cur.csvEl.classList.contains("on")) return;
    e.preventDefault();
    if (redoKey) redoIn(cur);
    else undoIn(cur);
  });
  setZoom(loadZoom()); // reaplica o zoom lembrado
  if (!idle) {
    forEachGroup(applyTabConfig);
    renderTabs();
    requestAnimationFrame(() => {
      for (const g of groups.values()) {
        const tab = tabOf(g);
        if (tab?.large) largeOf(tab)?.reveal();
        else if (tab) g.view.scrollDOM.scrollTop = tab.scroll;
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
    if (isPostit) {
      // post-it sem nada escrito não vira aba na principal: vai para o histórico de fechadas
      for (const t of [...session.tabs]) {
        if (!t.path && (states.get(t.id)?.doc.length ?? 1) === 0) {
          await api.closeNote(t.id);
          session.tabs = session.tabs.filter((x) => x.id !== t.id);
        }
      }
    }
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
