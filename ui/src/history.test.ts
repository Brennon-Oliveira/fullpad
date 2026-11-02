import { describe, expect, it } from "vitest";
import type { ClosedTab } from "./api";
import { filterClosed, whenLabel } from "./history";

const tab = (title: string, path: string | null = null) => ({ tab: { title, path } as ClosedTab["tab"], closed_at: 0 });

describe("history", () => {
  it("filtra por título ou caminho", () => {
    const l = [tab("Receita"), tab("x", "C:\\docs\\plano.md"), tab("Outro")];
    expect(filterClosed(l, "")).toHaveLength(3);
    expect(filterClosed(l, "RECEI")).toHaveLength(1);
    expect(filterClosed(l, "plano")).toHaveLength(1);
    expect(filterClosed(l, "zzz")).toHaveLength(0);
  });

  it("rotula hoje, ontem e datas antigas", () => {
    const now = new Date(2026, 10, 2, 15, 0);
    const at = (d: Date) => d.getTime() / 1000;
    expect(whenLabel(at(new Date(2026, 10, 2, 9, 5)), now)).toBe("hoje 09:05");
    expect(whenLabel(at(new Date(2026, 10, 1, 23, 59)), now)).toBe("ontem 23:59");
    expect(whenLabel(at(new Date(2026, 9, 20, 8, 0)), now)).toBe("20/10 08:00");
    expect(whenLabel(at(new Date(2025, 0, 3, 8, 0)), now)).toBe("03/01/2025 08:00");
  });
});
