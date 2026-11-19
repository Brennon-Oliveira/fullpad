/**
 * Extensões do `.dbmlx` que o parser DBML não conhece: `!include`, `DiagramView { }` e as anotações de
 * migração (`[add]`, `[drop]`, `[modify: ...]`, `[before: ...]`, `add ref:`, `drop ref:`). A referência diz que
 * elas "são tiradas antes de o parser DBML rodar", e é isso que `stripDbmlx` faz.
 *
 * **O comprimento do texto não muda**: o que sai vira espaço (a quebra de linha fica), então todo offset do
 * editor continua valendo no texto limpo (diagnóstico, referências, renomear, o `span` de cada elemento).
 * Puro, sem DOM e sem o parser (pode ser importado em qualquer lugar).
 */

/** Marca, para cada posição, se ela é código (1) ou está em comentário/texto entre aspas (0). */
export function codeMask(src: string): Uint8Array {
  const n = src.length;
  const code = new Uint8Array(n).fill(1);
  let i = 0;
  const off = (a: number, b: number) => code.fill(0, a, Math.min(b, n));
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      let e = src.indexOf("\n", i);
      if (e < 0) e = n;
      off(i, e);
      i = e;
    } else if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      const end = e < 0 ? n : e + 2;
      off(i, end);
      i = end;
    } else if (c === "'" && src.startsWith("'''", i)) {
      const e = src.indexOf("'''", i + 3);
      const end = e < 0 ? n : e + 3;
      off(i, end);
      i = end;
    } else if (c === "'" || c === '"' || c === "`") {
      let k = i + 1;
      while (k < n && src[k] !== c && src[k] !== "\n") k += src[k] === "\\" ? 2 : 1;
      const end = k < n && src[k] === c ? k + 1 : k;
      off(i, end);
      i = end;
    } else i++;
  }
  return code;
}

function blank(out: string[], from: number, to: number) {
  for (let k = from; k < to && k < out.length; k++) if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
}

const isWord = (c: string | undefined) => !!c && /[A-Za-z0-9_]/.test(c);

/** Fim (exclusivo) do bloco `{ ... }` que abre em `open`, só contando chaves de código; `-1` se não fecha. */
function matchBrace(src: string, code: Uint8Array, open: number): number {
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (!code[k]) continue;
    if (src[k] === "{") depth++;
    else if (src[k] === "}" && --depth === 0) return k + 1;
  }
  return -1;
}

const BARE = /^(add|drop)$/i;
const MODIFY = /^(modify|before)\s*:/i;
const DROP_REF = /^drop\s+ref\s*:/i;
const ADD_REF = /^add(\s+)ref\s*:/i;
const KEY_EQ = /^[A-Za-z_]\w*\s*=/;

/** `[ ... ]` de configurações: tira as anotações de migração, mantendo as demais configurações onde estavam. */
function stripBrackets(src: string, code: Uint8Array, out: string[]) {
  const n = src.length;
  let i = 0;
  while (i < n) {
    if (!(code[i] && src[i] === "[")) {
      i++;
      continue;
    }
    // acha o `]` que fecha e as vírgulas do nível de cima
    let depth = 1;
    let k = i + 1;
    const commas: number[] = [];
    for (; k < n; k++) {
      if (!code[k]) continue;
      const c = src[k];
      if (c === "[" || c === "(" || c === "{") depth++;
      else if (c === "]" || c === ")" || c === "}") {
        depth--;
        if (depth === 0) break;
      } else if (c === "," && depth === 1) commas.push(k);
    }
    if (k >= n || src[k] !== "]") break; // não fechou: deixa como está
    const close = k;
    const bounds = [i + 1, ...commas.flatMap((c) => [c, c + 1]), close]; // pares [início, fim) de cada item
    const items: { s: number; e: number; text: string; lead: number }[] = [];
    for (let t = 0; t < bounds.length; t += 2) {
      const raw = src.slice(bounds[t], bounds[t + 1]);
      const lead = raw.length - raw.trimStart().length;
      items.push({ s: bounds[t] + lead, e: bounds[t] + raw.trimEnd().length, text: raw.trim(), lead });
    }
    const keep: { s: number; text: string; has: boolean }[] = [];
    let removed = 0;
    let bareDrop = false;
    let inModify = false;
    items.forEach((it) => {
      const t = it.text;
      if (t === "") {
        keep.push({ s: it.s, text: "", has: false });
      } else if (MODIFY.test(t)) {
        removed++;
        inModify = true;
      } else if (inModify && KEY_EQ.test(t)) {
        removed++; // `name="x"`, `pk=false`...: o resto do `modify:`
      } else if (BARE.test(t)) {
        removed++;
        inModify = false;
        if (/^drop$/i.test(t)) bareDrop = true;
      } else if (DROP_REF.test(t)) {
        removed++;
        inModify = false;
      } else if (ADD_REF.test(t)) {
        inModify = false;
        removed++; // só o `add`: a relação existe depois da migração
        const m = ADD_REF.exec(t)!;
        keep.push({ s: it.s, text: " ".repeat(3 + m[1].length) + t.slice(3 + m[1].length), has: true });
      } else {
        inModify = false;
        keep.push({ s: it.s, text: t, has: true });
      }
    });
    if (removed === 0) {
      i = close + 1;
      continue;
    }
    const real = keep.filter((x) => x.has);
    // `Ref: a.b > c.d [drop]`: a relação é removida pela migração, não se desenha
    const lineStart = src.lastIndexOf("\n", i) + 1;
    if (bareDrop && /^\s*Ref\b/.test(src.slice(lineStart, i)) && code[lineStart + (src.slice(lineStart, i).length - src.slice(lineStart, i).trimStart().length)]) {
      blank(out, lineStart, close + 1);
      i = close + 1;
      continue;
    }
    if (real.length === 0) {
      blank(out, i, close + 1); // sobrou `[]`: tira os colchetes também
    } else {
      blank(out, i + 1, close);
      real.forEach((x, idx) => {
        for (let q = 0; q < x.text.length; q++) out[x.s + q] = x.text[q];
        if (idx < real.length - 1) {
          // a vírgula original que vem depois deste item (existe: há itens depois dele)
          const after = commas.find((c) => c >= x.s + x.text.length);
          if (after !== undefined) out[after] = ",";
        }
      });
    }
    i = close + 1;
  }
}

/** Tira de um texto `.dbmlx` o que não é DBML, sem mudar o comprimento nem as quebras de linha. */
export function stripDbmlx(src: string): string {
  if (!/[!\[]|DiagramView/.test(src)) return src;
  const code = codeMask(src);
  const out = src.split("");
  // 1. `!include "..."` (a UI junta o conteúdo dos arquivos depois do texto)
  const inc = /^[ \t]*!include\b[^\n]*/gm;
  for (let m = inc.exec(src); m; m = inc.exec(src)) {
    const at = m.index + m[0].search(/!/);
    if (code[at]) blank(out, m.index, m.index + m[0].length);
  }
  // 2. `DiagramView nome { ... }` (visões nomeadas: ainda não existem no diagrama)
  const dv = /\bDiagramView\b/g;
  for (let m = dv.exec(src); m; m = dv.exec(src)) {
    if (!code[m.index] || isWord(src[m.index - 1])) continue;
    const open = src.indexOf("{", m.index);
    if (open < 0 || !code[open]) continue;
    const end = matchBrace(src, code, open);
    if (end > 0) {
      blank(out, m.index, end);
      dv.lastIndex = end;
    }
  }
  // 3. anotações de migração dentro de `[ ... ]`
  stripBrackets(src, code, out);
  return out.join("");
}

/** O texto que o parser vê: o principal limpo e, depois dele, o de cada arquivo incluído (também limpo). */
export function composeSource(main: string, parts: { text: string }[]): { source: string; mainLength: number; offsets: number[] } {
  let source = stripDbmlx(main);
  const offsets: number[] = [];
  for (const p of parts) {
    source += "\n";
    offsets.push(source.length);
    source += stripDbmlx(p.text);
  }
  return { source, mainLength: main.length, offsets };
}
