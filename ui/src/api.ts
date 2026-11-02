import { invoke } from "@tauri-apps/api/core";

export type ViewMode = "rendered" | "source" | "split";
export type Language = "auto" | "plain" | "markdown" | "dbml";
export type Eol = "lf" | "crlf";
export type Encoding = "utf8" | "utf8-bom" | "utf16le" | "utf16be" | "windows1252";

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
  /** Abre a janela com a visão renderizada da aba (`lang`: "markdown" ou "dbml"). */
  openPreview: (tab: string, lang: string) => invoke<void>("open_preview", { tab, lang }),
  previewInfo: () => invoke<{ owner: string; tab: string; lang: string }>("preview_info"),
  closePreview: (tab: string) => invoke<void>("close_preview", { tab }),
  exitApp: () => invoke<void>("exit_app"),
  newNote: () => invoke<TabState>("new_note"),
  closeNote: (id: string) => invoke<void>("close_note", { id }),
  /** Abas fechadas recentemente (a mais nova primeiro). */
  listClosed: (limit?: number) => invoke<ClosedTab[]>("list_closed", { limit }),
  /** Reabre uma aba fechada nesta janela. */
  restoreTab: (id: string) => invoke<{ tab: TabState; text: string }>("restore_tab", { id }),
  openFile: (path: string) => invoke<{ tab: TabState; text: string }>("open_file", { path }),
  exportFile: (path: string, bytes: number[]) => invoke<void>("export_file", { path, bytes }),
  saveFile: (id: string, path: string, text: string, encoding: Encoding, eol: Eol) =>
    invoke<void>("save_file", { id, path, text, encoding, eol }),
};
