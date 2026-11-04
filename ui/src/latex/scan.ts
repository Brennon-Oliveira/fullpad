/**
 * Onde há equações num texto markdown: `$...$` (em linha) e `$$...$$` (em bloco). Puro e sem KaTeX,
 * então pode ser importado à vontade (o KaTeX só carrega em `latex/render.ts`).
 *
 * Regras (as mesmas do Pandoc, para `R$ 5 e R$ 10` não virar equação):
 *  - o `$` que abre não pode ser seguido de espaço, e o que fecha não pode vir depois de espaço nem antes de dígito;
 *  - `\$` é um cifrão comum;
 *  - `$...$` fica numa linha só; `$$...$$` pode ter várias, mas não atravessa uma linha em branco;
 *  - o chamador troca o que é código (`` `x` ``, blocos, URLs) por `MASK` antes de procurar: o cifrão de
 *    dentro do código não conta, e uma equação nunca atravessa um trecho de código.
 */

/** Caractere que o chamador usa no lugar do que não pode conter equação (código, URL). */
export const MASK = "\u0001";

export interface MathSpan {
  from: number;
  to: number;
  tex: string;
  /** `$$...$$`: equação destacada (centralizada, tamanho grande). */
  display: boolean;
  /** `$$` sozinho nas linhas (começa no início da linha e termina no fim): troca as linhas inteiras. */
  block: boolean;
}

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

/** O `$` em `i` está escapado (número ímpar de `\` antes)? */
function escaped(s: string, i: number): boolean {
  let n = 0;
  while (i - 1 - n >= 0 && s[i - 1 - n] === "\\") n++;
  return n % 2 === 1;
}

/** Equação que começa no `$` de `s[i]`, ou `null` se ali não é o começo de uma. */
export function matchMath(s: string, i: number): { end: number; tex: string; display: boolean } | null {
  if (s[i] !== "$" || escaped(s, i)) return null;
  if (s[i + 1] === "$") {
    for (let j = i + 2; j < s.length; j++) {
      const c = s[j];
      if (c === "\\") j++;
      else if (c === "$" && s[j + 1] === "$") {
        const tex = s.slice(i + 2, j);
        return tex.trim() ? { end: j + 2, tex, display: true } : null;
      } else if (c === "\n" && /^\n[ \t]*(\n|$)/.test(s.slice(j, j + 200))) {
        return null; // linha em branco: acabou o parágrafo
      }
    }
    return null;
  }
  if (isSpace(s[i + 1])) return null;
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") j++;
    else if (c === "\n") return null;
    else if (c === "$") {
      if (isSpace(s[j - 1]) || /\d/.test(s[j + 1] ?? "")) return null;
      return { end: j + 1, tex: s.slice(i + 1, j), display: false };
    }
  }
  return null;
}

/** Troca os trechos de código em linha (`` `x` ``) por `MASK`, sem mudar o tamanho (para quem só tem o texto cru). */
export function maskInlineCode(s: string): string {
  return s.replace(/(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g, (m) => m.replace(/[^\n]/g, MASK));
}

/** Todas as equações do texto, na ordem. `text` já deve ter o código trocado por `MASK`. */
export function scanMath(text: string): MathSpan[] {
  const out: MathSpan[] = [];
  if (!text.includes("$")) return out;
  for (let i = text.indexOf("$"); i >= 0 && i < text.length; i = text.indexOf("$", i)) {
    const m = matchMath(text, i);
    if (!m || m.tex.includes(MASK)) {
      i += text[i + 1] === "$" && !escaped(text, i) ? 2 : 1; // o 2º `$` de um `$$` que falhou não abre nada
      continue;
    }
    const lineStart = text.lastIndexOf("\n", i - 1) + 1;
    let lineEnd = text.indexOf("\n", m.end);
    if (lineEnd < 0) lineEnd = text.length;
    const block = m.display && text.slice(lineStart, i).trim() === "" && text.slice(m.end, lineEnd).trim() === "";
    out.push({ from: i, to: m.end, tex: m.tex.trim(), display: m.display, block });
    i = m.end;
  }
  return out;
}
