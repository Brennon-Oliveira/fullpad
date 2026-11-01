import { invoke } from "@tauri-apps/api/core";

export type ViewMode = "rendered" | "source";
export type Language = "auto" | "plain" | "markdown";
export type Eol = "lf" | "crlf";
export type Encoding = "utf8" | "utf8-bom" | "utf16le" | "utf16be" | "windows1252";

export interface TabState {
  id: string;
  title: string;
  path: string | null;
  cursor: number;
  scroll: number;
  /** "rendered" = preview ligado (só vale quando a linguagem efetiva é markdown). */
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
  saveFile: (id: string, path: string, text: string, encoding: Encoding, eol: Eol) =>
    invoke<void>("save_file", { id, path, text, encoding, eol }),
};
