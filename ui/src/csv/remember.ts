/**
 * Separador escolhido à mão para um arquivo, lembrado por caminho (`localStorage` `fullpad.csvDelims`):
 * fechar e abrir o mesmo arquivo de novo já vem com o separador certo. Funções puras sobre o texto
 * guardado; quem lê e grava o storage é o chamador. Só guarda o que a pessoa escolheu, nunca o detectado.
 */
import { isValidDelimiter } from "./settings";

const MAX_ENTRIES = 200;

/** Lê o texto guardado: o que não for um mapa caminho → separador válido é descartado, sem derrubar o resto. */
export function parseDelims(raw: string | null | undefined): Record<string, string> {
  try {
    const o = JSON.parse(raw ?? "{}");
    if (!o || typeof o !== "object" || Array.isArray(o)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) if (isValidDelimiter(v)) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/** Acrescenta (ou troca) o separador do caminho; o mais recente fica por último e só as últimas 200 ficam. */
export function withDelim(map: Record<string, string>, path: string, delimiter: string): Record<string, string> {
  const next = { ...map };
  delete next[path];
  next[path] = delimiter;
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete next[k];
  return next;
}

export function withoutDelim(map: Record<string, string>, path: string): Record<string, string> {
  const next = { ...map };
  delete next[path];
  return next;
}
