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
});
