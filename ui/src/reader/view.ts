// O que o painel espera de um leitor (PDF ou EPUB). Só tipos.

import type { Hit } from "./find";
import type { ReaderPos } from "./pos";

export interface ViewHooks {
  /** A posição de leitura mudou (a UI grava na sessão, com atraso). */
  onPosition(pos: ReaderPos): void;
  /** O arquivo não pôde ser processado: a visão já foi desfeita. */
  onFatal(message: string): void;
  /** Posição atual (página no PDF, capítulo no EPUB), total e escala em uso. */
  onView(page: number, total: number, scale: number, fit: boolean): void;
  /** Ctrl+Shift+C dentro do documento (o EPUB fica num iframe, onde o painel não ouve teclas). */
  onQuote?(): void;
  /** Botão direito dentro do documento, em coordenadas da janela. */
  onContextMenu?(x: number, y: number): void;
  /** Ctrl+F dentro do documento (o EPUB fica num iframe, onde o painel não ouve teclas). */
  onFind?(): void;
}

/** O que um leitor oferece à busca: o texto de cada unidade (página ou capítulo) e o realce. */
export interface Findable {
  units: number;
  textOf(unit: number): Promise<string>;
  /** Vai ao resultado e realça (`null`: só realça a consulta, sem resultado atual). */
  reveal(hit: Hit | null, query: string): void;
  /** Tira todo o realce. */
  clear(): void;
}

export interface ReaderView {
  readonly pages: number;
  setZoom(zoom: number | null): void;
  zoomBy(factor: number): void;
  goTo(page: number, frac?: number): void;
  position(): ReaderPos;
  /** O painel mudou de tamanho. */
  resize(): void;
  /**
   * O trecho selecionado no documento, para citar (só o EPUB: no PDF o painel lê a seleção da
   * própria tela). `source` é o nome da obra e `where` o lugar ("cap. 3 (Fim)").
   */
  selection?(): { text: string; source: string; where: string } | null;
  /** Busca no documento. */
  find?: Findable;
  /** Copia a seleção como texto (o EPUB mora num iframe, onde o `copy` do painel não alcança). */
  copySelection?(): void;
  dispose(): Promise<void>;
}
