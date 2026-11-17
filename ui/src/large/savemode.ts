import type { SaveMode, SavePlan } from "../api";
import { humanSize } from "./model";

/** Do último quarto do arquivo em diante a escrita direta compensa: regrava pouco. */
export const DIRECT_WORTH_IT = 0.25;

export interface SaveAdvice {
  /** Qual dos dois modos recomendar. */
  recommended: SaveMode;
  /** Parte do arquivo que a escrita direta regravaria (0 a 1). */
  fraction: number;
  /** A frase que explica a recomendação. */
  text: string;
}

/** Recomenda um modo pelo quanto a escrita direta regravaria: editou perto do fim, vale; perto do começo, não. */
export function adviseSave(plan: Pick<SavePlan, "size" | "direct_bytes">): SaveAdvice {
  const fraction = plan.size > 0 ? Math.min(1, plan.direct_bytes / plan.size) : 1;
  if (fraction <= DIRECT_WORTH_IT) {
    return {
      recommended: "direct",
      fraction,
      text: `Você editou perto do fim do arquivo: a escrita direta regrava só ${humanSize(plan.direct_bytes)} de ${humanSize(plan.size)}. Aqui ela compensa.`,
    };
  }
  return {
    recommended: "safe",
    fraction,
    text: `Você editou longe do fim do arquivo: a escrita direta regravaria ${humanSize(plan.direct_bytes)} de ${humanSize(plan.size)} (${Math.round(fraction * 100)}%). O ganho é pequeno e não compensa o risco.`,
  };
}

/**
 * Pergunta como salvar quando algum lote mudou de tamanho (o resto do arquivo muda de lugar). Dois
 * cartões clicáveis com o que cada um faz, o ganho e o risco; Cancelar não grava nada.
 */
export function chooseSaveMode(plan: SavePlan, title: string): Promise<SaveMode | null> {
  const advice = adviseSave(plan);
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "saving-back";
    const box = document.createElement("div");
    box.className = "savemode";
    box.setAttribute("role", "dialog");
    const h = document.createElement("h3");
    h.textContent = `Como salvar “${title}”?`;
    const why = document.createElement("p");
    why.className = "savemode-why";
    why.textContent = `${plan.resized === 1 ? "Um trecho que você editou mudou" : `${plan.resized} trechos que você editou mudaram`} de tamanho, então o que vem depois dele precisa mudar de lugar no arquivo. ${advice.text}`;

    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const done = (v: SaveMode | null) => {
      back.remove();
      if (before?.isConnected) before.focus();
      document.removeEventListener("keydown", onKey, true);
      resolve(v);
    };
    const card = (mode: SaveMode, name: string, how: string, good: string, bad: string, cost: string) => {
      const b = document.createElement("button");
      b.className = "savemode-card";
      b.dataset.mode = mode;
      if (advice.recommended === mode) b.classList.add("recommended");
      const t = document.createElement("div");
      t.className = "savemode-name";
      t.textContent = name;
      if (advice.recommended === mode) {
        const tag = document.createElement("span");
        tag.className = "savemode-tag";
        tag.textContent = "Recomendado";
        t.append(tag);
      }
      const rows = [
        ["Como funciona", how],
        ["Vantagem", good],
        ["Risco", bad],
        ["Grava", cost],
      ];
      b.append(t);
      for (const [k, v] of rows) {
        const r = document.createElement("div");
        r.className = "savemode-row";
        const kk = document.createElement("b");
        kk.textContent = `${k}: `;
        r.append(kk, document.createTextNode(v));
        b.append(r);
      }
      b.addEventListener("click", () => done(mode));
      return b;
    };
    const cards = document.createElement("div");
    cards.className = "savemode-cards";
    cards.append(
      card(
        "safe",
        "Salvar com segurança",
        "Monta o arquivo novo ao lado e só troca o original quando termina.",
        "Se o app ou o computador cair no meio, o seu arquivo original continua intacto. Dá para cancelar.",
        `Reescreve o arquivo inteiro e precisa de ${humanSize(plan.size)} livres no disco. Mais lento.`,
        humanSize(plan.size),
      ),
      card(
        "direct",
        "Salvar direto no arquivo",
        "Grava as alterações no próprio arquivo e desloca só o que vem depois delas.",
        "Mais rápido, quanto mais perto do fim você editou, e não usa espaço extra no disco.",
        "Não dá para cancelar, e se o app ou o computador cair no meio o arquivo fica corrompido dali em diante, sem volta.",
        humanSize(plan.direct_bytes),
      ),
    );
    const more = document.createElement("details");
    more.className = "savemode-more";
    const sum = document.createElement("summary");
    sum.textContent = "Como funciona o salvamento de arquivos grandes";
    const p = document.createElement("p");
    p.textContent =
      "O Fullpad edita o arquivo grande por lotes e não o lê inteiro. Ao salvar, os trechos que mantêm o mesmo tamanho (trocar um dígito, por exemplo) são gravados no lugar, na hora e sem risco, e isso acontece sem perguntar. Quando um trecho muda de tamanho, todo o resto do arquivo muda de posição, e é aí que existe a escolha: refazer o arquivo todo ao lado (seguro) ou regravar só do ponto editado em diante (rápido, mas sem proteção contra queda).";
    more.append(sum, p);
    const cancel = document.createElement("button");
    cancel.className = "savemode-cancel";
    cancel.textContent = "Cancelar";
    cancel.addEventListener("click", () => done(null));
    box.append(h, why, cards, more, cancel);
    back.append(box);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.append(back);
    cancel.focus();
  });
}
