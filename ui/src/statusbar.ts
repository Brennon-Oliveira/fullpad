export interface StatusInfo {
  languageLabel: string;
  /** Rótulo da visão atual ("Código", "Preview", "Lado a lado"...). */
  viewLabel: string;
  viewAvailable: boolean;
  size: number;
  lines: number;
  ln: number;
  col: number;
  pos: number;
  eolLabel: string;
  encodingLabel: string;
  overwrite: boolean;
  /** Caminho do nó sob o cursor (JSON com a árvore aberta). */
  path?: string | null;
}

export interface StatusHandlers {
  onLanguage(anchor: HTMLElement): void;
  onView(anchor: HTMLElement): void;
  onEol(anchor: HTMLElement): void;
  onEncoding(anchor: HTMLElement): void;
  onOverwrite(): void;
}

const nf = new Intl.NumberFormat("pt-BR");

function button(cls: string, title: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = `seg ${cls}`;
  b.title = title;
  return b;
}

export function mountStatusBar(root: HTMLElement, h: StatusHandlers) {
  const lang = button("lang", "Linguagem");
  const view = button("view", "Como mostrar o arquivo: código, renderizado ou lado a lado (Ctrl+E)");
  const spacer = document.createElement("div");
  spacer.className = "spacer";
  const path = document.createElement("span");
  path.className = "seg path";
  const size = document.createElement("span");
  size.className = "seg";
  const cursor = document.createElement("span");
  cursor.className = "seg";
  const eol = button("eol", "Fim de linha");
  const enc = button("enc", "Codificação");
  const ins = button("ins", "Inserir/Sobrescrever (Insert)");

  lang.addEventListener("click", () => h.onLanguage(lang));
  view.addEventListener("click", () => h.onView(view));
  eol.addEventListener("click", () => h.onEol(eol));
  enc.addEventListener("click", () => h.onEncoding(enc));
  ins.addEventListener("click", () => h.onOverwrite());

  root.append(lang, view, path, spacer, size, cursor, eol, enc, ins);

  return {
    update(i: StatusInfo) {
      lang.textContent = i.languageLabel;
      view.textContent = `Visão: ${i.viewLabel} ▾`;
      view.disabled = !i.viewAvailable;
      path.textContent = i.path ?? "";
      path.hidden = !i.path;
      path.title = i.path ? "Caminho do nó sob o cursor" : "";
      size.textContent = `tamanho: ${nf.format(i.size)}   linhas: ${nf.format(i.lines)}`;
      cursor.textContent = `Ln: ${nf.format(i.ln)}   Col: ${nf.format(i.col)}   Pos: ${nf.format(i.pos)}`;
      eol.textContent = i.eolLabel;
      enc.textContent = i.encodingLabel;
      ins.textContent = i.overwrite ? "OVR" : "INS";
    },
  };
}
