import { invoke } from "@tauri-apps/api/core";
import type { Analysis, JsonError } from "./json/tree";

export type ViewMode = "rendered" | "source" | "split";
export type Language = "auto" | "plain" | "markdown" | "dbml" | "json" | "csv" | "yaml" | "toml";
export type Eol = "lf" | "crlf";
/** O que a aba mostra: o editor ("text") ou um leitor só de leitura. "unknown": tipo de uma versão mais nova. */
export type TabKind = "text" | "pdf" | "epub" | "unknown";
/** Resultado da verificação de um PDF: um trecho comprimido que expande demais é suspeito. */
export type PdfScan = { verdict: "ok" } | { verdict: "suspicious"; packed: number; unpacked: number; at_least: boolean };
/** Entrada do sumário de um EPUB: `spine` é o capítulo (posição na ordem de leitura) para onde aponta. */
export interface TocEntry {
  label: string;
  spine: number | null;
  fragment: string | null;
  depth: number;
}
export interface EpubInfo {
  title: string;
  author: string | null;
  /** Título de cada capítulo, na ordem de leitura. */
  chapters: string[];
  toc: TocEntry[];
}
/** Um capítulo já limpo pelo Rust: HTML sem scripts (imagens como `data:`) e CSS filtrado. */
export interface EpubChapter {
  html: string;
  css: string;
}
/** Identidade do arquivo (do conteúdo, não do caminho) e a última posição de leitura lembrada para ele. */
export interface ReaderMemo {
  key: string;
  pos: unknown | null;
}
/** Situação do arquivo de uma aba de leitura. `mtime` em milissegundos desde 1970. */
export type FileStatus = { status: "ok"; size: number; mtime: number } | { status: "missing" };
export type Encoding = "utf8" | "utf8-bom" | "utf16le" | "utf16be" | "windows1252";

/** Uma célula do CSV: `from`/`to` são o trecho no texto (UTF-16, aspas incluídas). */
export interface CsvCellOut {
  from: number;
  to: number;
  value: string;
  cut?: boolean;
  quoted: boolean;
}
export interface CsvRowOut {
  /** Linha do arquivo (a posição na tabela pode ser outra, se ordenada ou filtrada). */
  index: number;
  from: number;
  to: number;
  cells: CsvCellOut[];
}
export type CsvColType = "empty" | "number" | "date" | "text";
export interface CsvInfo {
  /** Linhas na visão (depois do filtro). */
  rows: number;
  /** Linhas de dados do arquivo, antes do filtro. */
  total: number;
  cols: number;
  delimiter: string;
  unterminated: boolean;
  types: CsvColType[];
  header: CsvRowOut | null;
}
export interface CsvStats {
  count: number;
  numeric: number;
  skipped: number;
  sum: number;
  avg: number | null;
  min: number | null;
  max: number | null;
}
export interface CsvLocated {
  row: number;
  col: number;
  view: number | null;
}
/** Mudança de estrutura da tabela: posições de linha são da visão (as da tela), as de coluna do arquivo. */
export type CsvOp =
  | { op: "insertRows"; pos: number | null; after: boolean; count: number }
  | { op: "deleteRows"; from: number; to: number }
  | { op: "insertCol"; at: number }
  | { op: "deleteCols"; cols: number[] }
  | { op: "moveCol"; from: number; to: number }
  | { op: "sortFile"; col: number; desc: boolean; header: boolean; decimal: string };

/** Uma troca no texto do CSV (UTF-16, do texto que foi indexado): sai de `csvEdit`. */
export interface CsvEditOut {
  from: number;
  to: number;
  insert: string;
}
export interface CsvSort {
  col: number;
  desc: boolean;
}
export interface CsvFilter {
  col: number | null;
  text: string;
}

export interface SearchOptions {
  case_sensitive: boolean;
  whole_word: boolean;
  regex: boolean;
}

export interface SearchMatch {
  /** Intervalo no texto (UTF-16, como o CodeMirror). */
  start: number;
  end: number;
  line: number;
  col: number;
  preview: string;
  preview_start: number;
  preview_end: number;
  replacement: string | null;
}

export interface TabHits {
  id: string;
  hits: { matches: SearchMatch[]; total: number };
}

export interface TabState {
  id: string;
  title: string;
  path: string | null;
  cursor: number;
  scroll: number;
  /**
   * Visão do arquivo: "source" = só código; "rendered" = markdown renderizado no próprio texto (no DBML,
   * o diagrama ao lado); "split" = código e visão renderizada lado a lado.
   */
  mode: ViewMode;
  language: Language;
  eol: Eol;
  encoding: Encoding;
  dirty: boolean;
  /** Janela onde a aba está ("main" é a principal). */
  window: string;
  /** A visão renderizada está numa janela própria. */
  detached: boolean;
  /** Painel (grupo de abas) da janela em que a aba aparece. */
  group: number;
  /** Nota de versão: fechar apaga de vez, sem ir para o histórico de abas fechadas. */
  release_notes?: boolean;
  /** Ausente nas abas de texto. PDF/EPUB são só de leitura: o arquivo nunca é gravado. */
  kind?: TabKind;
  /** Posição de leitura (`ReaderPos`, validada em `reader/pos.ts`); o Rust a guarda sem interpretar. */
  reader?: unknown;
  /** Escolhas da visão de CSV (`CsvSettings`, validadas em `csv/settings.ts`); o Rust as guarda sem interpretar. */
  csv?: unknown;
  /** Aba fixada: alfinete no lugar do ×, à esquerda, imune a "Fechar todas/outras/salvos". */
  pinned?: boolean;
  /** Linguagem de código escolhida à mão (só destaque de sintaxe); ausente = a da extensão. */
  code_lang?: string;
}

export interface Session {
  version: number;
  tabs: TabState[];
  active: string | null;
}

export interface Startup {
  session: Session;
  active_text: string;
  /** Grade de painéis gravada para esta janela (a UI a valida). */
  layout: unknown;
}

export interface ClosedTab {
  tab: TabState;
  closed_at: number;
}

export interface WindowInfo {
  label: string;
  name: string;
}

export const api = {
  /** Sessão da janela que pergunta: só as abas dela. */
  loadStartup: () => invoke<Startup>("load_startup"),
  readNote: (id: string) => invoke<string>("read_note", { id }),
  saveNote: (id: string, text: string) => invoke<void>("save_note", { id, text }),
  /** Envia as abas desta janela (na ordem dela) e a ativa. */
  saveWindow: (tabs: TabState[], active: string | null, layout: unknown) => invoke<void>("save_window", { tabs, active, layout }),
  listWindows: () => invoke<WindowInfo[]>("list_windows"),
  /** `to`: rótulo de uma janela aberta ou "new". Devolve o rótulo de destino. */
  moveTab: (tab: TabState, to: string) => invoke<string>("move_tab", { tab, to }),
  /** Cria em segundo plano a janela reserva: arrastar uma aba para fora fica instantâneo. */
  prewarm: () => invoke<void>("prewarm"),
  /** Começou a arrastar uma aba para fora da barra: mostra a sombra no ponteiro (tela, px físicos). */
  dragStart: (title: string, x: number, y: number, gx: number, gy: number, selfDrag: boolean) =>
    invoke<void>("drag_start", { title, x, y, gx, gy, selfDrag }),
  dragMove: (title: string, x: number, y: number) => invoke<void>("drag_move", { title, x, y }),
  dragCancel: () => invoke<void>("drag_cancel"),
  /** Soltou a aba na tela: vai para a barra de outra janela ou vira uma janela nova ali. Devolve o destino. */
  dropTab: (tab: TabState, x: number, y: number, gx: number, gy: number) => invoke<string>("drop_tab", { tab, x, y, gx, gy }),
  /** A janela sob o ponteiro aceita (ou não) a aba arrastada de outra janela onde ele está. */
  dragAccept: (accept: boolean) => invoke<void>("drag_accept", { accept }),
  /** Esta janela terminou de carregar e pode aparecer. */
  windowReady: () => invoke<void>("window_ready"),
  newWindow: () => invoke<string>("new_window"),
  /** Abre a janela com a visão renderizada da aba (`lang`: "markdown", "dbml" ou "json"). */
  openPreview: (tab: string, lang: string) => invoke<void>("open_preview", { tab, lang }),
  previewInfo: () => invoke<{ owner: string; tab: string; lang: string }>("preview_info"),
  closePreview: (tab: string) => invoke<void>("close_preview", { tab }),
  /** Arquivos pedidos na linha de comando que ainda não foram abertos (só a janela principal usa). */
  takeOpenPaths: () => invoke<string[]>("take_open_paths"),
  /** Versão nova disponível (ou `null`). */
  checkUpdate: () => invoke<{ version: string; current: string; notes: string | null } | null>("check_update"),
  downloadUpdate: () => invoke<void>("download_update"),
  /** Instala a versão baixada: o app encerra. Grave tudo antes. */
  installUpdate: () => invoke<void>("install_update"),
  /** Nota nova com a nota de versão do app em execução. */
  releaseNotes: () => invoke<{ tab: TabState; text: string }>("release_notes"),
  /** A nota de versão, só na primeira abertura depois de uma atualização. */
  startupReleaseNotes: () => invoke<{ tab: TabState; text: string } | null>("startup_release_notes"),
  exitApp: () => invoke<void>("exit_app"),
  newNote: () => invoke<TabState>("new_note"),
  closeNote: (id: string) => invoke<void>("close_note", { id }),
  /** Abas fechadas recentemente (a mais nova primeiro). */
  listClosed: (limit?: number) => invoke<ClosedTab[]>("list_closed", { limit }),
  /** Reabre uma aba fechada nesta janela. */
  restoreTab: (id: string) => invoke<{ tab: TabState; text: string }>("restore_tab", { id }),
  /** Abre um PDF/EPUB como aba de leitura. Não lê o arquivo: isso é `readerRead`, depois do clique em "Carregar". */
  openReader: (path: string) => invoke<TabState>("open_reader", { path }),
  /** Existe? Tamanho e data (só metadados). */
  readerInfo: (id: string) => invoke<FileStatus>("reader_info", { id }),
  /** Identidade do arquivo e a posição de leitura lembrada para ele (lê só o começo e o fim). */
  readerMemo: (id: string) => invoke<ReaderMemo>("reader_memo", { id }),
  /** Lembra a posição de leitura do arquivo (`key` vem de `readerMemo`). */
  readerRemember: (key: string, pos: unknown) => invoke<void>("reader_remember", { key, pos }),
  /** Abre o EPUB da aba: título, capítulos e sumário (não lê os capítulos). */
  epubOpen: (id: string) => invoke<EpubInfo>("epub_open", { id }),
  /** O texto puro de um capítulo do EPUB aberto (para a busca no livro). */
  epubText: (id: string, index: number) => invoke<string>("epub_text", { id, index }),
  /** Um capítulo do EPUB aberto, limpo pelo Rust (`index` é a posição na ordem de leitura). */
  epubChapter: (id: string, index: number) => invoke<EpubChapter>("epub_chapter", { id, index }),
  /** Procura bomba de compressão no PDF (no Rust, antes de o pdf.js tocar nele). */
  readerCheck: (id: string) => invoke<PdfScan>("reader_check", { id }),
  /** Faixa de bytes do arquivo da aba, em binário cru (o Rust limita o tamanho de cada chamada). */
  readerRead: (id: string, offset: number, len: number) => invoke<ArrayBuffer>("reader_read", { id, offset, len }),
  /** O arquivo mudou de lugar: aponta a aba para o novo caminho (mesmo tipo). Devolve a aba atualizada. */
  readerRelocate: (id: string, path: string) => invoke<TabState>("reader_relocate", { id, path }),
  openFile: (path: string) => invoke<{ tab: TabState; text: string }>("open_file", { path }),
  /** Analisa o JSON (nós com posições UTF-16, dicas de valor). Em erro, `doc` é nulo. */
  jsonAnalyze: (text: string, lenient = true) => invoke<Analysis>("json_analyze", { text, lenient }),
  /** Busca global: resultados nas abas pedidas (só as que têm). Rejeita com a mensagem se a expressão for inválida. */
  searchTabs: (ids: string[], query: string, options: SearchOptions, replace: string | null) =>
    invoke<TabHits[]>("search_tabs", { ids, query, options, replace }),
  /** YAML ou TOML: a mesma análise do JSON (`format`: "yaml" | "toml"). */
  dataAnalyze: (format: string, text: string) => invoke<Analysis>("data_analyze", { format, text }),
  /** YAML ou TOML: só valida. */
  dataCheck: (format: string, text: string) => invoke<JsonError | null>("data_check", { format, text }),
  /** Só valida: o erro (com posição) ou `null`. */
  jsonCheck: (text: string) => invoke<JsonError | null>("json_check", { text }),
  /** Formata (`indent`: "2", "4", "tab" ou "min"). Rejeita com o `JsonError` se o texto for inválido. */
  jsonFormat: (text: string, indent: string, sortKeys: boolean) =>
    invoke<{ Ok: string } | { Err: JsonError }>("json_format", { text, indent, sortKeys }),
  /** Separador do CSV pela estrutura do texto (`ext`: extensão do arquivo; `tsv` manda no tab). */
  csvDetect: (text: string, ext: string | null) => invoke<string>("csv_detect", { text, ext }),
  /** Indexa o CSV da aba no Rust e monta a visão (ordem e filtro). */
  csvLoad: (tab: string, text: string, delimiter: string, header: boolean, decimal: string, sort: CsvSort | null, filter: CsvFilter | null) =>
    invoke<CsvInfo>("csv_load", { tab, text, delimiter, header, decimal, sort, filter }),
  /** Refaz a visão do CSV já carregado, sem reenviar o texto. */
  csvView: (tab: string, header: boolean, decimal: string, sort: CsvSort | null, filter: CsvFilter | null) =>
    invoke<CsvInfo>("csv_view", { tab, header, decimal, sort, filter }),
  /** Linhas `[from, from + count)` da visão (até 500 por chamada). */
  csvRows: (tab: string, from: number, count: number) => invoke<CsvRowOut[]>("csv_rows", { tab, from, count }),
  /** Estatísticas das linhas `[from, to)` da visão nas colunas `[colFrom, colTo)`. */
  csvStats: (tab: string, from: number, to: number, colFrom: number, colTo: number, decimal: string) =>
    invoke<CsvStats>("csv_stats", { tab, from, to, colFrom, colTo, decimal }),
  /** A célula sob uma posição do código e onde ela está na tabela. */
  csvLocate: (tab: string, pos: number) => invoke<CsvLocated | null>("csv_locate", { tab, pos }),
  /** O que trocar no texto para gravar estes valores (`row` é a linha do arquivo, `RowOut.index`). */
  csvStructure: (tab: string, op: CsvOp) => invoke<CsvEditOut[]>("csv_structure", { tab, op }),
  csvEdit: (tab: string, edits: { row: number; col: number; value: string }[]) => invoke<CsvEditOut[]>("csv_edit", { tab, edits }),
  /** Uma célula do arquivo, para levar o cursor do código até ela. */
  csvCell: (tab: string, row: number, col: number) => invoke<CsvCellOut | null>("csv_cell", { tab, row, col }),
  /** Bytes de uma imagem local citada no JSON (só extensões de imagem, até 8 MB). */
  jsonPreviewImage: (value: string, base: string | null) => invoke<ArrayBuffer>("json_preview_image", { value, base }),
  /** Abre um link (http, https ou mailto) no navegador do sistema. */
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  exportFile: (path: string, bytes: number[]) => invoke<void>("export_file", { path, bytes }),
  saveFile: (id: string, path: string, text: string, encoding: Encoding, eol: Eol) =>
    invoke<void>("save_file", { id, path, text, encoding, eol }),
};
