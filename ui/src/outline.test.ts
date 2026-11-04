// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createOutline } from "./outline";

const items = [
  { label: "Intro", pos: 0, depth: 0 },
  { label: "Detalhe", pos: 40, depth: 1 },
  { label: "Fim", pos: 90, depth: 0 },
];

function make() {
  const root = document.createElement("div");
  document.body.append(root);
  const goto = vi.fn();
  const togglePinned = vi.fn();
  const o = createOutline(root, { goto, togglePinned });
  o.config({ enabled: true, pinned: false, side: "left" });
  return { root, o, goto, togglePinned };
}

describe("sumário lateral", () => {
  it("fica escondido sem itens e aparece com eles", () => {
    const { root, o } = make();
    expect(root.hidden).toBe(true);
    o.set(items);
    expect(root.hidden).toBe(false);
    expect(root.querySelectorAll(".ol-bar").length).toBe(3);
    expect(root.querySelectorAll(".ol-item").length).toBe(3);
    o.set(null);
    expect(root.hidden).toBe(true);
  });
  it("some quando o usuário desliga", () => {
    const { root, o } = make();
    o.set(items);
    o.config({ enabled: false, pinned: false, side: "left" });
    expect(root.hidden).toBe(true);
  });
  it("clicar num item vai para a posição; o botão alterna o fixo", () => {
    const { root, o, goto, togglePinned } = make();
    o.set(items);
    (root.querySelectorAll(".ol-item")[1] as HTMLElement).click();
    expect(goto).toHaveBeenCalledWith(40);
    (root.querySelector(".ol-pin") as HTMLElement).click();
    expect(togglePinned).toHaveBeenCalled();
  });
  it("destaca o item atual (na lista e na barrinha) e respeita lado e fixo", () => {
    const { root, o } = make();
    o.set(items);
    o.setActive(2);
    expect(root.querySelectorAll(".ol-item")[2].classList.contains("on")).toBe(true);
    expect(root.querySelectorAll(".ol-bar")[2].classList.contains("on")).toBe(true);
    expect(root.querySelectorAll(".ol-bar.on").length).toBe(1);
    o.config({ enabled: true, pinned: true, side: "right" });
    expect(root.classList.contains("pinned")).toBe(true);
    expect(root.classList.contains("right")).toBe(true);
    expect(root.classList.contains("left")).toBe(false);
  });

  const type = (root: HTMLElement, text: string) => {
    const input = root.querySelector(".ol-search") as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event("input"));
    return input;
  };
  const key = (input: HTMLElement, k: string) => input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

  it("a lupa fixa o sumário e leva o foco ao campo; já fixo, só foca", () => {
    const { root, o, togglePinned } = make();
    o.set(items);
    (root.querySelector(".ol-find") as HTMLElement).click();
    expect(togglePinned).toHaveBeenCalledTimes(1);
    o.config({ enabled: true, pinned: true, side: "left" }); // o app reaplica a configuração ao fixar
    expect(document.activeElement).toBe(root.querySelector(".ol-search"));
    (document.activeElement as HTMLElement).blur();
    (root.querySelector(".ol-find") as HTMLElement).click();
    expect(togglePinned).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(root.querySelector(".ol-search"));
  });
  it("o campo filtra só a lista do sumário, sem mexer nas barrinhas", () => {
    const { root, o } = make();
    o.config({ enabled: true, pinned: true, side: "left" });
    o.set(items);
    type(root, "det");
    expect([...root.querySelectorAll(".ol-item")].map((e) => e.textContent)).toEqual(["Detalhe"]);
    expect(root.querySelectorAll(".ol-bar").length).toBe(3);
    type(root, "zzz");
    expect(root.querySelector(".ol-empty")?.textContent).toBe("Nada encontrado");
    type(root, "");
    expect(root.querySelectorAll(".ol-item").length).toBe(3);
  });
  it("clicar num item filtrado vai para a posição dele; o destaque segue o item certo", () => {
    const { root, o, goto } = make();
    o.config({ enabled: true, pinned: true, side: "left" });
    o.set(items);
    o.setActive(2);
    type(root, "fim");
    expect(root.querySelector(".ol-item")?.classList.contains("on")).toBe(true);
    (root.querySelector(".ol-item") as HTMLElement).click();
    expect(goto).toHaveBeenCalledWith(90);
  });
  it("Enter vai ao primeiro resultado; Esc limpa e, vazio, devolve o foco ao editor", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const goto = vi.fn();
    const focusEditor = vi.fn();
    const o = createOutline(root, { goto, togglePinned: vi.fn(), focusEditor });
    o.config({ enabled: true, pinned: true, side: "left" });
    o.set(items);
    const input = type(root, "fim");
    key(input, "Enter");
    expect(goto).toHaveBeenCalledWith(90);
    key(input, "Escape");
    expect(input.value).toBe("");
    expect(root.querySelectorAll(".ol-item").length).toBe(3);
    expect(focusEditor).not.toHaveBeenCalled();
    key(input, "Escape");
    expect(focusEditor).toHaveBeenCalledTimes(1);
  });
  it("soltar o sumário limpa a busca", () => {
    const { root, o } = make();
    o.config({ enabled: true, pinned: true, side: "left" });
    o.set(items);
    type(root, "fim");
    o.config({ enabled: true, pinned: false, side: "left" });
    expect((root.querySelector(".ol-search") as HTMLInputElement).value).toBe("");
    expect(root.querySelectorAll(".ol-item").length).toBe(3);
  });
});
