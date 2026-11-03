// Citação em markdown de um trecho selecionado no documento. Sem DOM: testado em quote.test.ts.

/** "p. 42" ou "pp. 42–43" (o trecho atravessa páginas). */
export function pageLabel(first: number, last: number): string {
  return last > first ? `pp. ${first}–${last}` : `p. ${first}`;
}

/** Nome do arquivo sem a extensão, para citar ("Livro.pdf" vira "Livro"). */
export const sourceName = (title: string) => title.replace(/\.(pdf|epub)$/i, "").trim() || title;

const escapeMd = (s: string) => s.replace(/([\\`*_[\]])/g, "\\$1");

/**
 * Texto selecionado num PDF vira um bloco de citação markdown com a origem:
 *
 *   > trecho em um parágrafo só,
 *   > — *Livro*, p. 42
 *
 * As quebras de linha do PDF não são parágrafos: viram espaço (e a hifenização de fim de linha é
 * desfeita). Uma linha em branco separa parágrafos. Devolve `null` se não sobrou texto.
 */
export function formatQuote(selected: string, source: string, firstPage: number, lastPage = firstPage): string | null {
  const text = selected
    .replace(/\r\n?/g, "\n")
    .replace(/­/g, "") // hífen opcional
    .replace(/(\p{L})-\n[ \t]*(\p{Ll})/gu, "$1$2"); // "informa-\nção" → "informação"
  const paragraphs = text
    .split(/\n[ \t]*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return null;
  const body = paragraphs.map((p) => `> ${p}`).join("\n>\n");
  return `${body}\n> — *${escapeMd(sourceName(source))}*, ${pageLabel(firstPage, lastPage)}`;
}
