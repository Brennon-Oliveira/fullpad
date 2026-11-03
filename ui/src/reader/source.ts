// Como o pdf.js recebe o arquivo: por faixas, pedidas ao Rust, nunca o arquivo inteiro de uma vez.
// Este módulo não importa o pdf.js (ele chega por parâmetro), então é leve e testável.

import type { DocumentInitParameters, PDFDataRangeTransport, PDFDocumentLoadingTask } from "pdfjs-dist/types/src/display/api";

/** Primeira faixa lida de uma vez (o pdf.js pede o resto, em pedaços, conforme precisa). */
export const INITIAL_BYTES = 128 * 1024;
/** Tamanho máximo de cada faixa que o pdf.js pede. */
export const CHUNK_BYTES = 1024 * 1024;

/**
 * Opções do pdf.js. O arquivo é entrada não confiável:
 * - o JavaScript embutido no PDF não roda: o pdf.js só o executa no visualizador completo
 *   (`pdf_viewer`, com `enableScripting`), que não usamos; ações de abrir programa ou arquivo
 *   não existem na API, e os links passam por `isSafeLink` em `pdfview.ts`;
 * - imagens acima de 16 milhões de pixels e canvas acima de 64 MB são ignorados (bombas de imagem);
 * - sem pré-busca: só se lê o que a tela pede.
 *
 * Fontes, mapas de caracteres e wasm vêm do próprio app (`/pdfjs/`, copiados pelo `vite.config.ts`),
 * nunca da rede.
 */
export const PDF_OPTIONS = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  iccUrl: "/pdfjs/iccs/",
  wasmUrl: "/pdfjs/wasm/",
  disableAutoFetch: true,
  disableStream: true,
  rangeChunkSize: CHUNK_BYTES,
  maxImageSize: 16 * 1024 * 1024,
  canvasMaxAreaInBytes: 64 * 1024 * 1024,
  verbosity: 0,
} satisfies Partial<DocumentInitParameters>;

type Pdfjs = {
  PDFDataRangeTransport: new (length: number, initialData: Uint8Array | null) => PDFDataRangeTransport;
  getDocument(src: DocumentInitParameters): PDFDocumentLoadingTask;
};

/** Lê `len` bytes a partir de `offset` (no app, o comando `reader_read`). */
export type ReadRange = (offset: number, len: number) => Promise<ArrayBuffer | Uint8Array>;

export interface PdfOpening {
  task: PDFDocumentLoadingTask;
  /** Rejeita se uma leitura falhar no meio (o arquivo sumiu): o pdf.js ficaria esperando para sempre. */
  failure: Promise<never>;
}

/**
 * Abre o documento lendo por faixas. Espere `Promise.race([task.promise, failure])`.
 * `overrides` existe para os testes (em Node não há `/pdfjs/`).
 */
export async function openPdfTask(pdfjs: Pdfjs, size: number, read: ReadRange, overrides: Partial<DocumentInitParameters> = {}): Promise<PdfOpening> {
  const first = new Uint8Array(await read(0, Math.min(size, INITIAL_BYTES)));
  const transport = new pdfjs.PDFDataRangeTransport(size, first);
  const task = pdfjs.getDocument({ range: transport, ...PDF_OPTIONS, ...overrides } as DocumentInitParameters);
  let fail: (e: unknown) => void = () => {};
  const failure = new Promise<never>((_, reject) => (fail = reject));
  failure.catch(() => {}); // sem ninguém esperando, não é erro não tratado
  task.promise.catch(() => {}); // quem corre contra `failure` não pode deixar o outro lado sem tratador
  transport.requestDataRange = (begin: number, end: number) => {
    // O IPC leva pedaços de no máximo CHUNK_BYTES, mas o pdf.js espera a faixa pedida inteira de
    // uma vez (ele casa a resposta pelo início), então os pedaços são juntados antes de entregar.
    void (async () => {
      const to = Math.min(end, size);
      const whole = new Uint8Array(Math.max(0, to - begin));
      for (let at = begin; at < to; at += CHUNK_BYTES) {
        const part = new Uint8Array(await read(at, Math.min(CHUNK_BYTES, to - at)));
        whole.set(part, at - begin);
      }
      transport.onDataRange(begin, whole);
    })().catch(fail);
  };
  return { task, failure };
}
