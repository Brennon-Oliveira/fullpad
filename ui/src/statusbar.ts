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
  /** Aba de leitura (PDF/EPUB): só este texto ("Página 3 de 120 · 2,3 MB") e o tipo; o resto some. */
  reader?: string | null;
}

export interface StatusHandlers {
  onLanguage(anchor: HTMLElement): void;
  onView(anchor: HTMLElement): void;
  onEol(anchor: HTMLElement): void;
  onEncoding(anchor: HTMLElement): void;
  onOverwrite(): void;
  /** Clicou no número do zoom: abre a lista de valores. */
  onZoom(anchor: HTMLElement): void;
  onZoomOut(): void;
  onZoomIn(): void;
}

const lens = (sign: "+" | "-") =>
  `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10l4 4M4.5 6.5h4${sign === "+" ? "M6.5 4.5v4" : ""}"/></svg>`;

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

  const zoomBox = document.createElement("span");
  zoomBox.className = "seg zoombox";
  const zOut = button("zbtn", "Diminuir zoom (Ctrl+-)");
  zOut.innerHTML = lens("-");
  const zVal = button("zval", "Zoom: clique para escolher (Ctrl+0 volta a 100%)");
  zVal.textContent = "100%";
  const zIn = button("zbtn", "Aumentar zoom (Ctrl++)");
  zIn.innerHTML = lens("+");
  zoomBox.append(zOut, zVal, zIn);
  zOut.addEventListener("click", () => h.onZoomOut());
  zIn.addEventListener("click", () => h.onZoomIn());
  zVal.addEventListener("click", () => h.onZoom(zVal));

  lang.addEventListener("click", () => h.onLanguage(lang));
  view.addEventListener("click", () => h.onView(view));
  eol.addEventListener("click", () => h.onEol(eol));
  enc.addEventListener("click", () => h.onEncoding(enc));
  ins.addEventListener("click", () => h.onOverwrite());

  root.append(lang, view, path, spacer, size, cursor, eol, enc, ins, zoomBox);

  return {
    setZoom(percent: number) {
      zVal.textContent = `${percent}%`;
    },
    update(i: StatusInfo) {
      lang.textContent = i.languageLabel;
      view.textContent = `Visão: ${i.viewLabel} ▾`;
      view.disabled = !i.viewAvailable;
      const reading = i.reader !== undefined;
      for (const e of [view, size, cursor, eol, enc, ins]) e.hidden = reading;
      path.textContent = (reading ? i.reader : i.path) ?? "";
      path.hidden = !path.textContent;
      path.title = reading ? "Posição de leitura" : i.path ? "Caminho do nó sob o cursor" : "";
      size.textContent = `tamanho: ${nf.format(i.size)}   linhas: ${nf.format(i.lines)}`;
      cursor.textContent = `Ln: ${nf.format(i.ln)}   Col: ${nf.format(i.col)}   Pos: ${nf.format(i.pos)}`;
      eol.textContent = i.eolLabel;
      enc.textContent = i.encodingLabel;
      ins.textContent = i.overwrite ? "OVR" : "INS";
    },
  };
}
