import { humanSize } from "./model";

export interface GateInfo {
  /** Nome da aba. */
  name: string;
  /** Tamanho do arquivo em bytes (só metadados: nada foi lido). */
  size: number;
  /** Há alterações guardadas de antes de fechar o app. */
  edited: boolean;
}

/** A extensão em maiúsculas para o selo do cartão ("CSV", "LOG"); sem extensão, "TEXTO". */
export function kindOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return m ? m[1].toUpperCase() : "TEXTO";
}

/**
 * Cartão "Carregar" de uma aba de arquivo grande, o mesmo do PDF/EPUB (`reader/panel.ts`): abrir só mostra o nome e o
 * tamanho; o arquivo só é lido e indexado quando a pessoa clica. Nada aqui toca no disco.
 */
export function renderLargeGate(root: HTMLElement, info: GateInfo, onLoad: () => void, onLoadAt?: (line: number) => void): void {
  const el = (cls: string, text = "") => Object.assign(document.createElement("div"), { className: cls, textContent: text });
  const lines = [`${kindOf(info.name)} · ${humanSize(info.size)} · arquivo grande`, "O arquivo só é lido quando você carregar. Ele continua no disco: o Fullpad mostra só o trecho da tela e, ao salvar, grava só o que você mudou."];
  if (info.edited) lines.push("Há alterações suas guardadas, ainda não salvas: elas voltam quando você carregar.");
  const box = el("rd-card large-gate-card");
  box.append(el("rd-icon", kindOf(info.name)), el("rd-title", info.name));
  for (const l of lines) box.append(el("rd-line", l));
  const row = el("rd-actions");
  const btn = Object.assign(document.createElement("button"), { className: "rd-btn primary", textContent: "Carregar arquivo", type: "button" });
  const busy = () => {
    btn.disabled = true;
    btn.textContent = "Carregando…";
    for (const b of box.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")) b.disabled = true;
  };
  btn.addEventListener("click", () => {
    busy();
    onLoad();
  });
  row.append(btn);
  if (onLoadAt) {
    // "Abrir direto na linha": pede a linha e carrega já indo para ela (à esquerda do botão principal)
    const at = Object.assign(document.createElement("button"), { className: "rd-btn", textContent: "Abrir direto na linha", type: "button" });
    const ask = el("rd-actions large-gate-ask");
    ask.hidden = true;
    const input = Object.assign(document.createElement("input"), { type: "number", min: "1", step: "1", placeholder: "Linha", className: "rd-input", ariaLabel: "Número da linha" });
    const go = Object.assign(document.createElement("button"), { className: "rd-btn primary", textContent: "Ir", type: "button" });
    const submit = () => {
      const n = Math.floor(Number(input.value));
      if (!Number.isFinite(n) || n < 1) {
        input.classList.add("invalid");
        input.focus();
        return;
      }
      busy();
      onLoadAt(n - 1);
    };
    go.addEventListener("click", submit);
    input.addEventListener("input", () => input.classList.remove("invalid"));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    at.addEventListener("click", () => {
      ask.hidden = false;
      input.focus();
    });
    ask.append(input, go);
    row.prepend(at);
    box.append(row, ask);
  } else box.append(row);
  const center = el("rd-center");
  center.append(box);
  root.replaceChildren(center);
  btn.focus();
}
