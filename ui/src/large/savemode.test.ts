// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { SavePlan } from "../api";
import { adviseSave, chooseSaveMode } from "./savemode";

const GB = 1024 ** 3;
const plan = (over: Partial<SavePlan> = {}): SavePlan => ({ edited: 1, resized: 1, size: 15 * GB, direct_bytes: 2 * GB, ...over });

afterEach(() => (document.body.innerHTML = ""));

describe("recomendação de como salvar", () => {
  it("editou no último quarto do arquivo: recomenda a escrita direta", () => {
    expect(adviseSave(plan({ direct_bytes: 3 * GB })).recommended).toBe("direct");
    expect(adviseSave(plan({ direct_bytes: (15 * GB) / 4 })).recommended).toBe("direct"); // no limite
  });

  it("editou mais para o começo: recomenda o seguro e diz que o ganho é pequeno", () => {
    const a = adviseSave(plan({ direct_bytes: 10 * GB }));
    expect(a.recommended).toBe("safe");
    expect(a.text).toContain("não compensa o risco");
    expect(a.text).toContain("67%");
  });

  it("arquivo vazio ou plano sem tamanho não quebra", () => {
    expect(adviseSave(plan({ size: 0, direct_bytes: 0 })).recommended).toBe("safe");
  });
});

describe("janela de como salvar", () => {
  const cards = () => [...document.querySelectorAll<HTMLButtonElement>(".savemode-card")];

  it("tem dois cartões clicáveis, com o recomendado marcado, e cada um devolve o seu modo", async () => {
    const p = chooseSaveMode(plan({ direct_bytes: GB }), "grande.csv");
    expect(cards().map((c) => c.dataset.mode)).toEqual(["safe", "direct"]);
    expect(cards().find((c) => c.classList.contains("recommended"))?.dataset.mode).toBe("direct");
    expect(document.body.textContent).toContain("Recomendado");
    cards()[0].click();
    expect(await p).toBe("safe");
    expect(document.querySelector(".savemode")).toBeNull();
  });

  it("explica o risco de cada um, e o botão direto avisa que não dá para cancelar", async () => {
    const p = chooseSaveMode(plan(), "grande.csv");
    const text = document.body.textContent ?? "";
    expect(text).toContain("continua intacto");
    expect(text).toContain("fica corrompido");
    expect(text).toContain("Não dá para cancelar");
    cards()[1].click();
    expect(await p).toBe("direct");
  });

  it("Cancelar e Esc não escolhem nada", async () => {
    const p = chooseSaveMode(plan(), "grande.csv");
    document.querySelector<HTMLButtonElement>(".savemode-cancel")!.click();
    expect(await p).toBeNull();
    const q = chooseSaveMode(plan(), "grande.csv");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(await q).toBeNull();
    expect(document.querySelector(".savemode")).toBeNull();
  });

  it("ao fechar, o foco volta para onde estava (senão Ctrl+Z não chega à tabela)", async () => {
    const t = document.createElement("div");
    t.tabIndex = 0;
    document.body.append(t);
    t.focus();
    const p = chooseSaveMode(plan(), "grande.csv");
    expect(document.activeElement).not.toBe(t);
    document.querySelector<HTMLButtonElement>(".savemode-cancel")!.click();
    await p;
    expect(document.activeElement).toBe(t);
  });

  it("o saiba mais explica o salvamento de arquivos grandes", () => {
    void chooseSaveMode(plan(), "grande.csv");
    expect(document.querySelector(".savemode-more summary")?.textContent).toContain("Como funciona o salvamento");
  });
});
