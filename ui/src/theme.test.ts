// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

describe("tema", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("sem escolha salva, o padrão é escuro", async () => {
    const t = await import("./theme");
    expect(t.themePref()).toBe("dark");
    expect(t.isDark()).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("escolher claro grava, aplica e avisa", async () => {
    const t = await import("./theme");
    let n = 0;
    t.onThemeChange(() => n++);
    t.setThemePref("light");
    expect(t.isDark()).toBe(false);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("fullpad.theme")).toBe("light");
    expect(n).toBe(1);
    t.setThemePref("dark");
  });
});
