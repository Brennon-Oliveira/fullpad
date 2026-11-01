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

export const api = {
  loadStartup: () => invoke<Startup>("load_startup"),
  readNote: (id: string) => invoke<string>("read_note", { id }),
  saveNote: (id: string, text: string) => invoke<void>("save_note", { id, text }),
  saveSession: (session: Session) => invoke<void>("save_session", { session }),
  newNote: () => invoke<TabState>("new_note"),
  closeNote: (id: string) => invoke<void>("close_note", { id }),
  openFile: (path: string) => invoke<{ tab: TabState; text: string }>("open_file", { path }),
  exportFile: (path: string, bytes: number[]) => invoke<void>("export_file", { path, bytes }),
  saveFile: (id: string, path: string, text: string, encoding: Encoding, eol: Eol) =>
    invoke<void>("save_file", { id, path, text, encoding, eol }),
};
