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
    // "Abrir direto na linha": uma janelinha pergunta a linha; o botão fica à esquerda do principal
    const at = Object.assign(document.createElement("button"), { className: "rd-btn", textContent: "Abrir direto na linha", type: "button" });
    at.addEventListener("click", () => {
      void askLine().then((n) => {
        if (n === null) return;
        busy();
        onLoadAt(n);
      });
    });
    row.prepend(at);
    box.append(row);
  } else box.append(row);
  const center = el("rd-center");
  center.append(box);
  root.replaceChildren(center);
  btn.focus();
}

/**
 * Janelinha que pergunta a linha (a partir de 1) a que ir ao abrir o arquivo. Devolve a linha **a partir de 0** (a que o app
 * usa) ou `null` se a pessoa cancelou (Esc, Cancelar ou clicar fora). Número inválido não fecha: marca o campo.
 */
export function askLine(): Promise<number | null> {
  return new Promise((resolve) => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const back = Object.assign(document.createElement("div"), { className: "saving-back" });
    const box = Object.assign(document.createElement("div"), { className: "gate-modal" });
    box.setAttribute("role", "dialog");
    const title = Object.assign(document.createElement("div"), { className: "gate-modal-title", textContent: "Abrir direto na linha" });
    const hint = Object.assign(document.createElement("div"), { className: "saving-hint", textContent: "O arquivo é carregado e a tela vai até essa linha assim que o índice chegar a ela." });
    const input = Object.assign(document.createElement("input"), { type: "number", min: "1", step: "1", placeholder: "Número da linha", className: "rd-input gate-modal-input", ariaLabel: "Número da linha" });
    const row = Object.assign(document.createElement("div"), { className: "rd-actions" });
    const cancel = Object.assign(document.createElement("button"), { className: "rd-btn", textContent: "Cancelar", type: "button" });
    const go = Object.assign(document.createElement("button"), { className: "rd-btn primary", textContent: "Ir", type: "button" });
    row.append(cancel, go);
    box.append(title, input, hint, row);
    back.append(box);
    const done = (v: number | null) => {
      document.removeEventListener("keydown", onKey, true);
      back.remove();
      if (before?.isConnected) before.focus();
      resolve(v);
    };
    const submit = () => {
      const n = Math.floor(Number(input.value));
      if (input.value.trim() === "" || !Number.isFinite(n) || n < 1) {
        input.classList.add("invalid");
        input.focus();
        return;
      }
      done(n - 1);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done(null);
      } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        e.stopPropagation();
        submit();
      }
    };
    document.addEventListener("keydown", onKey, true);
    input.addEventListener("input", () => input.classList.remove("invalid"));
    go.addEventListener("click", submit);
    cancel.addEventListener("click", () => done(null));
    back.addEventListener("mousedown", (e) => {
      if (e.target === back) done(null);
    });
    document.body.append(back);
    input.focus();
  });
}
