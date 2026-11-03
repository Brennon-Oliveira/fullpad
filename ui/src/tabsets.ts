import type { TabState } from "./api";

/**
 * Quais abas cada comando de fechar/salvar em lote atinge. Funções puras sobre as abas de UMA janela
 * (a sessão da UI só enxerga as dela), então outras janelas nunca são afetadas. Abas fixadas ficam
 * de fora de todo fechamento em lote.
 */

const closable = (tabs: readonly TabState[]) => tabs.filter((t) => !t.pinned);

/** "Fechar todas": tudo, menos as fixadas. */
export const toCloseAll = (tabs: readonly TabState[]): TabState[] => closable(tabs);

/** "Fechar outras": tudo, menos as fixadas e a aba em questão. */
export const toCloseOthers = (tabs: readonly TabState[], keep: string): TabState[] => closable(tabs).filter((t) => t.id !== keep);

/**
 * "Fechar salvos": abas ligadas a um arquivo e sem alterações pendentes. Notas soltas (sem arquivo)
 * não entram: o texto delas só existe no Fullpad.
 */
export const toCloseSaved = (tabs: readonly TabState[]): TabState[] => closable(tabs).filter((t) => !!t.path && !t.dirty);

/** Abas de arquivo com alterações ainda não gravadas nele (as que "Salvar todos" grava). */
export const withUnsavedChanges = (tabs: readonly TabState[]): TabState[] => tabs.filter((t) => !!t.path && t.dirty);

/** Fixadas primeiro, mantendo a ordem relativa dentro de cada grupo. */
export const pinnedFirst = (tabs: readonly TabState[]): TabState[] => [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
