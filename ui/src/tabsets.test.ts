import { describe, expect, it } from "vitest";
import type { TabState } from "./api";
import { pinnedFirst, toCloseAll, toCloseOthers, toCloseSaved, withUnsavedChanges } from "./tabsets";

const tab = (id: string, o: Partial<TabState> = {}) => ({ id, path: null, dirty: false, ...o }) as TabState;
const ids = (ts: TabState[]) => ts.map((t) => t.id);

const tabs = [tab("a", { pinned: true, path: "/a" }), tab("b"), tab("c", { path: "/c" }), tab("d", { path: "/d", dirty: true }), tab("e", { pinned: true })];

describe("fechamento em lote", () => {
  it("fechar todas poupa as fixadas", () => expect(ids(toCloseAll(tabs))).toEqual(["b", "c", "d"]));
  it("fechar outras poupa as fixadas e a escolhida", () => expect(ids(toCloseOthers(tabs, "c"))).toEqual(["b", "d"]));
  it("fechar salvos só pega arquivo sem alteração pendente e não fixado", () => expect(ids(toCloseSaved(tabs))).toEqual(["c"]));
  it("salvar todos pega só arquivos com alteração pendente", () => expect(ids(withUnsavedChanges(tabs))).toEqual(["d"]));
  it("fixadas vão para a frente sem trocar a ordem relativa", () => expect(ids(pinnedFirst(tabs))).toEqual(["a", "e", "b", "c", "d"]));
});
