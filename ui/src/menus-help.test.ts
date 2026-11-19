import { describe, expect, it } from "vitest";
import { topMenus } from "./menus";

/** Só o menu Ajuda interessa: as ações são funções de mentira. */
function help(version: string) {
  const calls: string[] = [];
  const actions = new Proxy({} as never, {
    get: (_t, name: string) => (name === "version" ? () => version : () => void calls.push(name)),
  });
  const items = topMenus(actions).find((m) => m.label() === "Ajuda")!.items();
  return { items, calls };
}

describe("menu Ajuda", () => {
  it("termina com a versão instalada, sem ser clicável", () => {
    const { items } = help("4.4.0");
    const last = items[items.length - 1] as { label: string; disabled?: boolean; action?: () => void };
    expect(last.label).toBe("Fullpad 4.4.0");
    expect(last.disabled).toBe(true);
    expect(last.action).toBeUndefined();
  });

  it("antes de saber a versão não mostra número", () => {
    const { items } = help("");
    expect((items[items.length - 1] as { label: string }).label).toBe("Fullpad");
  });

  it("tem o código-fonte e as outras versões", () => {
    const { items, calls } = help("1.0.0");
    calls.length = 0; // montar os outros menus também consulta a aba atual
    const by = (label: string) => items.find((i) => typeof i === "object" && i.label === label) as { action: () => void };
    by("Código-fonte no GitHub").action();
    by("Outras versões").action();
    expect(calls).toEqual(["openRepo", "openReleases"]);
  });
});
