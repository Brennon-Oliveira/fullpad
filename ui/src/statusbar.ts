export interface StatusInfo {
  languageLabel: string;
  previewAvailable: boolean;
  previewOn: boolean;
  size: number;
  lines: number;
  ln: number;
  col: number;
  pos: number;
  eolLabel: string;
  encodingLabel: string;
  overwrite: boolean;
}

export interface StatusHandlers {
  onLanguage(anchor: HTMLElement): void;
  onPreview(): void;
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
  const previewLabel = document.createElement("label");
  previewLabel.className = "seg preview";
  previewLabel.title = "Mostrar markdown renderizado (Ctrl+E)";
  const check = document.createElement("input");
  check.type = "checkbox";
  previewLabel.append(check, " Preview");
  const spacer = document.createElement("div");
  spacer.className = "spacer";
  const size = document.createElement("span");
  size.className = "seg";
  const cursor = document.createElement("span");
  cursor.className = "seg";
  const eol = button("eol", "Fim de linha");
  const enc = button("enc", "Codificação");
  const ins = button("ins", "Inserir/Sobrescrever (Insert)");

  lang.addEventListener("click", () => h.onLanguage(lang));
  check.addEventListener("change", () => h.onPreview());
  eol.addEventListener("click", () => h.onEol(eol));
  enc.addEventListener("click", () => h.onEncoding(enc));
  ins.addEventListener("click", () => h.onOverwrite());

  root.append(lang, previewLabel, spacer, size, cursor, eol, enc, ins);

  return {
    update(i: StatusInfo) {
      lang.textContent = i.languageLabel;
      check.checked = i.previewOn;
      check.disabled = !i.previewAvailable;
      previewLabel.classList.toggle("disabled", !i.previewAvailable);
      size.textContent = `tamanho: ${nf.format(i.size)}   linhas: ${nf.format(i.lines)}`;
      cursor.textContent = `Ln: ${nf.format(i.ln)}   Col: ${nf.format(i.col)}   Pos: ${nf.format(i.pos)}`;
      eol.textContent = i.eolLabel;
      enc.textContent = i.encodingLabel;
      ins.textContent = i.overwrite ? "OVR" : "INS";
    },
  };
}
