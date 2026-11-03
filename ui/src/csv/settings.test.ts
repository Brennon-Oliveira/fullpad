import { describe, expect, it } from "vitest";
import { DEFAULT_CSV, activeDelimiter, readCsvSettings } from "./settings";

describe("escolhas do CSV", () => {
  it("sem nada gravado vale o padrão (separador automático, cabeçalho, ponto decimal)", () => {
    expect(readCsvSettings(undefined)).toEqual(DEFAULT_CSV);
    expect(readCsvSettings(null)).toEqual(DEFAULT_CSV);
    expect(readCsvSettings("lixo")).toEqual(DEFAULT_CSV);
    expect(DEFAULT_CSV).toEqual({ delimiter: "auto", header: true, decimal: "." });
  });

  it("lê o que foi gravado", () => {
    expect(readCsvSettings({ delimiter: ";", header: false, decimal: "," })).toEqual({ delimiter: ";", header: false, decimal: "," });
    expect(readCsvSettings({ delimiter: "\t" }).delimiter).toBe("\t");
  });

  it("valida campo a campo: um valor ruim não derruba os outros", () => {
    expect(readCsvSettings({ delimiter: "xx", header: "sim", decimal: "ponto" })).toEqual(DEFAULT_CSV);
    expect(readCsvSettings({ delimiter: "xx", header: false, decimal: "," })).toEqual({ delimiter: "auto", header: false, decimal: "," });
    expect(readCsvSettings({ delimiter: '"' }).delimiter).toBe("auto");
  });

  it("no automático usa o detectado; na escolha manual, nunca", () => {
    const auto = readCsvSettings({});
    expect(activeDelimiter(auto, ";")).toBe(";");
    expect(activeDelimiter(auto, undefined)).toBe(",");
    expect(activeDelimiter(auto, "x")).toBe(",");
    const manual = readCsvSettings({ delimiter: "|" });
    expect(activeDelimiter(manual, ";")).toBe("|");
  });
});
