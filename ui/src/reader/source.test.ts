import { describe, expect, it } from "vitest";
// o build "legacy" roda em Node; é o mesmo código do pdf.js que o app carrega
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { fileURLToPath } from "node:url";
import { findOffsets } from "./find";
import { CHUNK_BYTES, INITIAL_BYTES, PDF_OPTIONS, openPdfTask } from "./source";

// em Node as fontes padrão vêm direto de node_modules (no app, de `/pdfjs/`)
const FONTS = fileURLToPath(new URL("../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url));
const NODE = { standardFontDataUrl: FONTS, cMapUrl: undefined, iccUrl: undefined, wasmUrl: undefined };

/** PDF de uma página com texto, preenchido com comentários para passar de `INITIAL_BYTES`. */
function bigPdf(padding: number): Uint8Array {
  const enc = new TextEncoder();
  const content = "BT /F1 24 Tf 72 300 Td (Fullpad leitor) Tj ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.7\n" + "%" + "x".repeat(padding) + "\n";
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(enc.encode(out).length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = enc.encode(out).length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc.encode(out);
}

describe("openPdfTask", () => {
  it("lê o PDF por faixas, sem pedir o arquivo inteiro de uma vez", async () => {
    const bytes = bigPdf(CHUNK_BYTES * 3);
    const calls: [number, number][] = [];
    const read = async (offset: number, len: number) => {
      calls.push([offset, len]);
      return bytes.slice(offset, offset + len);
    };
    const { task, failure } = await openPdfTask(pdfjs as never, bytes.length, read, NODE);
    const doc = await Promise.race([task.promise, failure]);
    try {
      expect(doc.numPages).toBe(1);
      const text = await (await doc.getPage(1)).getTextContent();
      const joined = text.items.map((i) => ("str" in i ? i.str + (i.hasEOL ? " " : "") : "")).join("");
      expect(joined).toContain("Fullpad leitor");
      expect(findOffsets(joined, "LEITOR")).toEqual([8]); // a busca acha o texto que o pdf.js extraiu, sem maiúscula
    } finally {
      await task.destroy();
    }
    expect(calls[0]).toEqual([0, INITIAL_BYTES]);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every(([, len]) => len <= CHUNK_BYTES), "cada faixa respeita o tamanho máximo").toBe(true);
    expect(calls.every(([, len]) => len < bytes.length), "nenhuma chamada pediu o arquivo inteiro").toBe(true);
  });

  it("um arquivo que falha no meio termina com erro, sem ficar pendurado", async () => {
    const bytes = bigPdf(INITIAL_BYTES * 3);
    let n = 0;
    const read = async (offset: number, len: number) => {
      if (n++ > 0) throw new Error("arquivo sumiu"); // só a primeira faixa chega
      return bytes.slice(offset, offset + len);
    };
    const { task, failure } = await openPdfTask(pdfjs as never, bytes.length, read, NODE);
    await expect(Promise.race([task.promise, failure])).rejects.toThrow("arquivo sumiu");
    // sem task.destroy() aqui: o worker "falso" do Node rejeita a leitura pendente sem tratador
    // (no app o worker é de verdade e a leitura que sobra morre junto com ele)
  });

  it("não é PDF: erro claro", async () => {
    const junk = new TextEncoder().encode("isto não é um pdf");
    const { task, failure } = await openPdfTask(pdfjs as never, junk.length, async (o, l) => junk.slice(o, o + l), NODE);
    await expect(Promise.race([task.promise, failure])).rejects.toThrow();
    await task.destroy().catch(() => {});
  });

  it("as opções limitam imagens e canvas e usam recursos do próprio app", () => {
    expect(PDF_OPTIONS.maxImageSize).toBeLessThanOrEqual(16 * 1024 * 1024);
    expect(PDF_OPTIONS.canvasMaxAreaInBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
    for (const url of [PDF_OPTIONS.cMapUrl, PDF_OPTIONS.standardFontDataUrl, PDF_OPTIONS.iccUrl, PDF_OPTIONS.wasmUrl]) {
      expect(url.startsWith("/pdfjs/"), url).toBe(true); // nunca http(s)
    }
    expect(PDF_OPTIONS.disableAutoFetch).toBe(true);
  });
});
