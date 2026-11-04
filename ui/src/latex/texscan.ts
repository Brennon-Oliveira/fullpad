import { MASK, matchMath } from "./scan";

/**
 * Equações soltas de um arquivo `.tex`. O Fullpad **não compila** documentos LaTeX: só acha as
 * fórmulas (`$..$`, `$$..$$`, `\(..\)`, `\[..\]` e os ambientes `equation`, `align`, `gather`…) e as
 * entrega ao KaTeX. Um arquivo que é só uma fórmula (sem `\documentclass` nem delimitadores) vale
 * inteiro como uma equação. Puro e testado.
 */

export interface TexEquation {
  from: number;
  to: number;
  tex: string;
  display: boolean;
}

/** Ambientes que o KaTeX já entende como estão. */
const NATIVE = new Set(["equation", "equation*", "align", "align*", "alignat", "alignat*", "gather", "gather*"]);
/** Ambientes de matemática que o KaTeX não tem: vão embrulhados no mais parecido. */
const WRAPPED: Record<string, string> = {
  "multline": "gathered",
  "multline*": "gathered",
  "eqnarray": "aligned",
  "eqnarray*": "aligned",
  "flalign": "aligned",
  "flalign*": "aligned",
};
/** Ambientes só de corpo: o texto de dentro é a equação. */
const BODY = new Set(["displaymath", "math"]);

/** Troca os comentários (`% ...` até o fim da linha) por `MASK`, sem mudar o tamanho. */
export function maskComments(s: string): string {
  return s.replace(/(^|[^\\])((?:\\\\)*)%[^\n]*/g, (m, pre: string, bars: string) => {
    const keep = pre.length + bars.length;
    return m.slice(0, keep) + m.slice(keep).replace(/[^\n]/g, MASK);
  });
}

/** `\` imediatamente antes de `i` em número ímpar: o caractere em `i` está escapado. */
function escapedAt(s: string, i: number): boolean {
  let n = 0;
  while (i - 1 - n >= 0 && s[i - 1 - n] === "\\") n++;
  return n % 2 === 1;
}

const OPEN = /\\begin\{([A-Za-z]+\*?)\}|\\\[|\\\(|\$/g;

export function scanTex(text: string): TexEquation[] {
  const s = maskComments(text);
  const out: TexEquation[] = [];
  OPEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OPEN.exec(s))) {
    const i = m.index;
    const tok = m[0];
    let end = -1;
    let eq: TexEquation | null = null;
    if (tok === "$") {
      if (escapedAt(s, i)) continue;
      const r = matchMath(s, i);
      if (r && !r.tex.includes(MASK)) {
        end = r.end;
        eq = { from: i, to: r.end, tex: r.tex.trim(), display: r.display };
      } else if (s[i + 1] === "$") OPEN.lastIndex = i + 2;
    } else if (tok === "\\[" || tok === "\\(") {
      if (escapedAt(s, i)) continue; // `\\[2pt]`: quebra de linha com espaço, não abre equação
      const close = tok === "\\[" ? "\\]" : "\\)";
      const j = s.indexOf(close, i + 2);
      if (j > 0) {
        const body = s.slice(i + 2, j);
        if (!body.includes(MASK) && body.trim()) {
          end = j + 2;
          eq = { from: i, to: end, tex: body.trim(), display: tok === "\\[" };
        }
      }
    } else {
      const name = m[1]!;
      const known = NATIVE.has(name) || name in WRAPPED || BODY.has(name);
      const closeTag = `\\end{${name}}`;
      const j = known ? s.indexOf(closeTag, i + tok.length) : -1;
      if (j > 0) {
        end = j + closeTag.length;
        const body = s.slice(i + tok.length, j);
        if (!body.includes(MASK) && body.trim()) {
          const whole = text.slice(i, end);
          if (NATIVE.has(name)) eq = { from: i, to: end, tex: whole, display: true };
          else if (name in WRAPPED) eq = { from: i, to: end, tex: `\\begin{${WRAPPED[name]}}${text.slice(i + tok.length, j)}\\end{${WRAPPED[name]}}`, display: true };
          else eq = { from: i, to: end, tex: text.slice(i + tok.length, j).trim(), display: name === "displaymath" };
        }
      }
    }
    if (eq) {
      out.push(eq);
      OPEN.lastIndex = end;
    }
  }
  if (out.length === 0 && !/\\documentclass|\\begin\{document\}/.test(s) && s.replaceAll(MASK, "").trim()) {
    const from = text.length - text.trimStart().length;
    out.push({ from, to: text.trimEnd().length, tex: text.trim(), display: true });
  }
  return out;
}
