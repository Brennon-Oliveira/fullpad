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
}

export interface Session {
  version: number;
  tabs: TabState[];
  active: string | null;
}

export interface Startup {
  session: Session;
  active_text: string;
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
  saveWindow: (tabs: TabState[], active: string | null) => invoke<void>("save_window", { tabs, active }),
  listWindows: () => invoke<WindowInfo[]>("list_windows"),
  /** `to`: rótulo de uma janela aberta ou "new". Devolve o rótulo de destino. */
  moveTab: (tab: TabState, to: string) => invoke<string>("move_tab", { tab, to }),
  /** Aba solta no ponto (x, y) da tela: vai para a janela que estiver ali, ou para uma nova. */
  dropTab: (tab: TabState, x: number, y: number) => invoke<string>("drop_tab", { tab, x, y }),
  newWindow: () => invoke<string>("new_window"),
  exitApp: () => invoke<void>("exit_app"),
  newNote: () => invoke<TabState>("new_note"),
  closeNote: (id: string) => invoke<void>("close_note", { id }),
  openFile: (path: string) => invoke<{ tab: TabState; text: string }>("open_file", { path }),
  exportFile: (path: string, bytes: number[]) => invoke<void>("export_file", { path, bytes }),
  saveFile: (id: string, path: string, text: string, encoding: Encoding, eol: Eol) =>
    invoke<void>("save_file", { id, path, text, encoding, eol }),
};
