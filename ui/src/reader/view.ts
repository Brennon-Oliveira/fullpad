// O que o painel espera de um leitor (PDF ou EPUB). Só tipos.

import type { ReaderPos } from "./pos";

export interface ViewHooks {
  /** A posição de leitura mudou (a UI grava na sessão, com atraso). */
  onPosition(pos: ReaderPos): void;
  /** O arquivo não pôde ser processado: a visão já foi desfeita. */
  onFatal(message: string): void;
  /** Posição atual (página no PDF, capítulo no EPUB), total e escala em uso. */
  onView(page: number, total: number, scale: number, fit: boolean): void;
}

export interface ReaderView {
  readonly pages: number;
  setZoom(zoom: number | null): void;
  zoomBy(factor: number): void;
  goTo(page: number, frac?: number): void;
  position(): ReaderPos;
  /** O painel mudou de tamanho. */
  resize(): void;
  dispose(): Promise<void>;
}
