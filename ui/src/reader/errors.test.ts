import { describe, expect, it } from "vitest";
import { friendlyError } from "./errors";

const named = (name: string, message: string) => Object.assign(new Error(message), { name });

describe("friendlyError", () => {
  it("traduz os erros conhecidos do pdf.js", () => {
    expect(friendlyError(named("InvalidPDFException", "Invalid PDF structure."))).toContain("não é um PDF válido ou está corrompido");
    expect(friendlyError(new Error("Invalid PDF structure."))).toContain("corrompido");
    expect(friendlyError(new Error("Pages tree contains circular reference."))).toContain("referência circular");
    expect(friendlyError(named("PasswordException", "No password given"))).toContain("senha");
    expect(friendlyError(named("MissingPDFException", "Missing PDF"))).toContain("vazio");
    expect(friendlyError(new Error("Worker was terminated"))).toBe("A leitura foi interrompida.");
  });
  it("o que não conhece mantém o texto original", () => {
    expect(friendlyError(new Error("algo novo"))).toBe("Erro ao ler o PDF: algo novo");
    expect(friendlyError("texto solto")).toBe("Erro ao ler o PDF: texto solto");
  });
  it("nenhuma mensagem conhecida sai em inglês", () => {
    for (const m of ["Invalid PDF structure.", "Pages tree contains circular reference.", "Missing PDF", "Loading aborted"]) {
      expect(friendlyError(new Error(m)), m).not.toMatch(/PDF structure|circular reference\.|Missing|aborted/);
    }
  });
});
