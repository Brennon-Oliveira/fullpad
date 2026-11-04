/**
 * Formatação do markdown pela seleção (a barra estilo Notion e os atalhos): funções puras sobre o
 * texto, sem DOM. Cada uma devolve trocas de texto e a nova seleção; quem chama aplica numa
 * transação só (um passo no Ctrl+Z). O documento continua markdown puro.
 */
import { ChangeSet } from "@codemirror/state";

export interface Edit {
  from: number;
  to: number;
  insert: string;
}
export interface Outcome {
  changes: Edit[];
  anchor: number;
  head: number;
}

export type Inline = "bold" | "italic" | "strike" | "code";
export type Block = "paragraph" | "h1" | "h2" | "h3" | "ul" | "ol" | "todo" | "quote" | "code";

const CH: Record<Inline, string> = { bold: "*", italic: "*", strike: "~", code: "`" };
const LEN: Record<Inline, number> = { bold: 2, italic: 1, strike: 2, code: 1 };

/** Início de linha que é marcação de bloco (título, lista, tarefa, citação), com o recuo. */
const PREFIX = /^([ \t]*)(?:#{1,6}[ \t]+|[-*+][ \t]+\[[ xX]\][ \t]+|[-*+][ \t]+|\d+[.)][ \t]+|>[ \t]?)/;

const lineStart = (doc: string, pos: number) => doc.lastIndexOf("\n", pos - 1) + 1;
const lineEnd = (doc: string, pos: number) => {
  const i = doc.indexOf("\n", pos);
  return i < 0 ? doc.length : i;
};

function runBefore(doc: string, pos: number, ch: string): number {
  let n = 0;
  while (pos - n - 1 >= 0 && doc[pos - n - 1] === ch) n++;
  return n;
}
function runAfter(doc: string, pos: number, ch: string): number {
  let n = 0;
  while (pos + n < doc.length && doc[pos + n] === ch) n++;
  return n;
}

interface Seg {
  from: number;
  to: number;
}

/** Trechos da seleção, um por linha, sem espaços nas pontas e sem a marcação de bloco do começo da linha. */
function segments(doc: string, from: number, to: number): Seg[] {
  const out: Seg[] = [];
  let pos = from;
  while (pos <= to) {
    const eol = lineEnd(doc, pos);
    let a = pos;
    let b = Math.min(eol, to);
    const ls = lineStart(doc, a);
    const m = PREFIX.exec(doc.slice(ls, eol));
    if (m && a < ls + m[0].length) a = Math.min(ls + m[0].length, b);
    while (a < b && /\s/.test(doc[a])) a++;
    while (b > a && /\s/.test(doc[b - 1])) b--;
    if (b > a) out.push({ from: a, to: b });
    if (eol >= to) break;
    pos = eol + 1;
  }
  return out;
}

type Where = "outside" | "inside" | null;

function wrapped(doc: string, s: Seg, k: Inline): Where {
  const ch = CH[k];
  const mo = Math.min(runBefore(doc, s.from, ch), runAfter(doc, s.to, ch));
  const outside = k === "bold" || k === "strike" ? mo >= 2 : k === "italic" ? mo % 2 === 1 : mo >= 1;
  if (outside) return "outside";
  const text = doc.slice(s.from, s.to);
  const rs = runAfter(text, 0, ch);
  const re = runBefore(text, text.length, ch);
  const mi = Math.min(rs, re);
  if (text.length <= rs + re && mi > 0) return null; // só marcadores: não há o que formatar
  const inside = k === "bold" || k === "strike" ? mi >= 2 : k === "italic" ? mi % 2 === 1 : mi >= 1;
  return inside ? "inside" : null;
}

const LINK = /^\[([^\]\n]*)\]\(([^)\n]*)\)$/;

function finish(doc: string, changes: Edit[], from: number, to: number): Outcome {
  const set = ChangeSet.of(changes, doc.length);
  return { changes, anchor: set.mapPos(from, 1), head: set.mapPos(to, -1) };
}

/** Quais formatações valem para toda a seleção (para acender os botões). */
export function activeMarks(doc: string, from: number, to: number): Record<Inline | "link", boolean> {
  const segs = segments(doc, from, to);
  const all = (f: (s: Seg) => boolean) => segs.length > 0 && segs.every(f);
  return {
    bold: all((s) => wrapped(doc, s, "bold") !== null),
    italic: all((s) => wrapped(doc, s, "italic") !== null),
    strike: all((s) => wrapped(doc, s, "strike") !== null),
    code: all((s) => wrapped(doc, s, "code") !== null),
    link: all((s) => LINK.test(doc.slice(s.from, s.to)) || (doc.slice(0, s.from).endsWith("[") && doc.slice(s.to).startsWith("]("))),
  };
}

/** Liga/desliga negrito, itálico, tachado ou código na seleção (cada linha à parte). Sem seleção, abre o par. */
export function toggleInline(doc: string, from: number, to: number, k: Inline): Outcome {
  const mark = CH[k].repeat(LEN[k]);
  const segs = segments(doc, from, to);
  if (segs.length === 0) {
    const at = from;
    return { changes: [{ from: at, to: at, insert: mark + mark }], anchor: at + mark.length, head: at + mark.length };
  }
  const on = segs.every((s) => wrapped(doc, s, k) !== null);
  const changes: Edit[] = [];
  for (const s of segs) {
    const w = wrapped(doc, s, k);
    if (on) {
      const n = LEN[k];
      if (w === "outside") changes.push({ from: s.from - n, to: s.from, insert: "" }, { from: s.to, to: s.to + n, insert: "" });
      else changes.push({ from: s.from, to: s.from + n, insert: "" }, { from: s.to - n, to: s.to, insert: "" });
    } else if (w === null) {
      changes.push({ from: s.from, to: s.from, insert: mark }, { from: s.to, to: s.to, insert: mark });
    }
  }
  return finish(doc, changes, segs[0].from, segs[segs.length - 1].to);
}

const URL_RE = /^(https?:\/\/|mailto:)\S+$/i;

/** Transforma a seleção em link: `[texto](url)` com a url marcada; uma URL vira `[url](url)`; um link selecionado volta a texto. */
export function toggleLink(doc: string, from: number, to: number): Outcome {
  const segs = segments(doc, from, to);
  if (segs.length === 0) return { changes: [{ from, to: from, insert: "[]()" }], anchor: from + 1, head: from + 1 };
  const s = { from: segs[0].from, to: segs[segs.length - 1].to };
  const text = doc.slice(s.from, s.to);
  const m = LINK.exec(text);
  if (m) return { changes: [{ from: s.from, to: s.to, insert: m[1] }], anchor: s.from, head: s.from + m[1].length };
  // cursor/seleção dentro do texto de um link existente: desfaz o link
  if (doc.slice(0, s.from).endsWith("[") && doc.slice(s.to).startsWith("](")) {
    const close = doc.indexOf(")", s.to);
    if (close > 0 && !doc.slice(s.to, close).includes("\n")) {
      return { changes: [{ from: s.from - 1, to: s.from, insert: "" }, { from: s.to, to: close + 1, insert: "" }], anchor: s.from - 1, head: s.to - 1 };
    }
  }
  if (URL_RE.test(text)) return { changes: [{ from: s.from, to: s.to, insert: `[${text}](${text})` }], anchor: s.from + 1, head: s.from + 1 + text.length };
  const insert = `[${text}](url)`;
  const urlAt = s.from + text.length + 3;
  return { changes: [{ from: s.from, to: s.to, insert }], anchor: urlAt, head: urlAt + 3 };
}

function cleanInline(t: string): string {
  let prev: string;
  do {
    prev = t;
    t = t
      .replace(/(\*{1,3})([^*\n]+?)\1/g, "$2")
      .replace(/~~([^~\n]+?)~~/g, "$1")
      .replace(/`([^`\n]+)`/g, "$1")
      .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1");
  } while (t !== prev);
  return t;
}

/** Tira negrito, itálico, tachado, código e link da seleção (e de quem a envolve); o tipo de bloco fica. */
export function clearFormat(doc: string, from: number, to: number): Outcome | null {
  const segs = segments(doc, from, to);
  const changes: Edit[] = [];
  for (const s of segs) {
    let a = s.from;
    let b = s.to;
    for (let again = true; again; ) {
      again = false;
      for (const [ch, minLen] of [["*", 1], ["~", 2], ["`", 1]] as const) {
        const m = Math.min(runBefore(doc, a, ch), runAfter(doc, b, ch));
        const n = ch === "~" ? (m >= 2 ? 2 : 0) : m >= minLen ? m : 0;
        if (n > 0) {
          a -= n;
          b += n;
          again = true;
        }
      }
    }
    const inner = doc.slice(s.from, s.to);
    const cleaned = cleanInline(inner);
    if (a !== s.from || cleaned !== inner) changes.push({ from: a, to: b, insert: cleaned });
  }
  if (changes.length === 0) return null;
  let delta = 0;
  for (const c of changes.slice(0, -1)) delta += c.insert.length - (c.to - c.from);
  const last = changes[changes.length - 1];
  return { changes, anchor: changes[0].from, head: last.from + delta + last.insert.length };
}

/** Tipo de bloco da linha (títulos 4 a 6 contam como texto normal: não há item para eles). */
export function blockOf(line: string): Block {
  const h = /^[ \t]*(#{1,6})[ \t]+/.exec(line);
  if (h) return h[1].length <= 3 ? (`h${h[1].length}` as Block) : "paragraph";
  if (/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+/.test(line)) return "todo";
  if (/^[ \t]*[-*+][ \t]+/.test(line)) return "ul";
  if (/^[ \t]*\d+[.)][ \t]+/.test(line)) return "ol";
  if (/^[ \t]*>/.test(line)) return "quote";
  return "paragraph";
}

/** Linhas inteiras tocadas pela seleção (uma seleção que termina no começo de uma linha não a inclui). */
function lineSpan(doc: string, from: number, to: number): { a: number; b: number } {
  const end = to > from && doc[to - 1] === "\n" ? to - 1 : to;
  return { a: lineStart(doc, from), b: lineEnd(doc, end) };
}

/** O tipo de bloco da primeira linha da seleção (para marcar no menu "Texto normal"). */
export function currentBlock(doc: string, from: number): Block | "fence" {
  const ls = lineStart(doc, from);
  const above = doc.slice(0, ls).split("\n");
  // dentro de um bloco de código cercado?
  let open = false;
  for (const l of above.slice(0, -1)) if (/^\s{0,3}(```|~~~)/.test(l)) open = !open;
  if (open || /^\s{0,3}(```|~~~)/.test(doc.slice(ls, lineEnd(doc, from)))) return "fence";
  return blockOf(doc.slice(ls, lineEnd(doc, from)));
}

/** Muda o tipo de bloco das linhas da seleção; repetir o mesmo tipo volta a texto normal. */
export function setBlock(doc: string, from: number, to: number, kind: Block): Outcome {
  const { a, b } = lineSpan(doc, from, to);
  const changes: Edit[] = [];
  if (kind === "code") {
    const before = doc.slice(0, a).split("\n");
    const prev = a > 0 ? before[before.length - 2] : undefined;
    const after = b < doc.length ? doc.slice(b + 1).split("\n")[0] : undefined;
    if (prev !== undefined && after !== undefined && /^\s{0,3}(```|~~~)\w*\s*$/.test(prev) && /^\s{0,3}(```|~~~)\s*$/.test(after)) {
      const prevStart = a - prev.length - 1;
      changes.push({ from: prevStart, to: a, insert: "" }, { from: b, to: b + 1 + after.length, insert: "" });
      return finish(doc, changes, from, to);
    }
    changes.push({ from: a, to: a, insert: "```\n" }, { from: b, to: b, insert: "\n```" });
    return finish(doc, changes, from, to);
  }
  const lines: { start: number; text: string }[] = [];
  for (let p = a; p <= b; ) {
    const e = lineEnd(doc, p);
    lines.push({ start: p, text: doc.slice(p, e) });
    p = e + 1;
  }
  const filled = lines.filter((l) => l.text.trim() !== "");
  const same = filled.length > 0 && filled.every((l) => blockOf(l.text) === kind);
  const target: Block = same ? "paragraph" : kind;
  let n = 1;
  for (const l of filled) {
    const m = PREFIX.exec(l.text);
    const indent = /^[ \t]*/.exec(l.text)![0];
    const old = m ? m[0].length : indent.length;
    const keep = target === "ul" || target === "ol" || target === "todo" ? indent : "";
    const prefix =
      target === "h1" ? "# " : target === "h2" ? "## " : target === "h3" ? "### " : target === "ul" ? "- " : target === "ol" ? `${n++}. ` : target === "todo" ? "- [ ] " : target === "quote" ? "> " : "";
    const insert = keep + prefix;
    if (insert !== l.text.slice(0, old)) changes.push({ from: l.start, to: l.start + old, insert });
  }
  return finish(doc, changes, from, to);
}

/** Itens do tipo de bloco (menu "Texto normal" da barra e submenu Markdown > Formatar). */
export const BLOCK_LABELS: [Block, string][] = [
  ["paragraph", "Texto normal"],
  ["h1", "Título 1"],
  ["h2", "Título 2"],
  ["h3", "Título 3"],
  ["ul", "Lista"],
  ["ol", "Lista numerada"],
  ["todo", "Lista de tarefas"],
  ["quote", "Citação"],
  ["code", "Bloco de código"],
];
