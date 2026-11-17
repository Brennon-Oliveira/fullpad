/**
 * Tabelas do markdown (`| a | b |`): leitura, reescrita alinhada, operações de linha e coluna e conversão
 * de/para CSV. Funções puras sobre texto, sem DOM. O resultado de cada operação é o texto novo da tabela
 * inteira; quem chama o aplica numa transação só (um passo no Ctrl+Z) e não mexe no resto do documento.
 */
import type { Edit, Outcome } from "./mdformat";

export type Align = "none" | "left" | "center" | "right";

export interface MdTable {
  header: string[];
  aligns: Align[];
  /** Linhas do corpo. Cada célula guarda o texto **como está no markdown** (`\|` e `<br>` incluídos). */
  rows: string[][];
}

/** Quebra uma linha da tabela em células (a barra escapada `\|` não separa; as das pontas são opcionais). */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  const cells: string[] = [];
  let cur = "";
  let closed = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) {
      cur += ch + s[i + 1];
      i++;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
      closed = true;
    } else {
      cur += ch;
      closed = false;
    }
  }
  if (cur.trim() !== "" || !closed) cells.push(cur.trim());
  return cells;
}

const DELIM = /^\s*:?-+:?\s*$/;

function alignOf(cell: string): Align {
  const c = cell.trim();
  const l = c.startsWith(":");
  const r = c.endsWith(":");
  return l && r ? "center" : l ? "left" : r ? "right" : "none";
}

/** A linha é a de delimitadores (`| --- | :-: |`)? */
export function isDelimiterRow(line: string): boolean {
  if (!line.includes("-")) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => DELIM.test(c));
}

/** Lê o texto de uma tabela (cabeçalho, linha de delimitadores e corpo). `null` se não for uma. */
export function parseTable(text: string): MdTable | null {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2 || !isDelimiterRow(lines[1])) return null;
  const header = splitRow(lines[0]);
  const delim = splitRow(lines[1]);
  if (header.length === 0 || header.length !== delim.length) return null;
  return { header, aligns: delim.map(alignOf), rows: lines.slice(2).map(splitRow) };
}

/** Tem linha com mais células do que o cabeçalho (o markdown ignora o excesso; a grade não reescreve assim). */
export function hasExcess(t: MdTable): boolean {
  return t.rows.some((r) => r.length > t.header.length);
}

const width = (s: string) => Array.from(s).length;

function delimiter(a: Align, w: number): string {
  const dashes = (n: number) => "-".repeat(Math.max(1, n));
  if (a === "center") return ":" + dashes(w - 2) + ":";
  if (a === "left") return ":" + dashes(w - 1);
  if (a === "right") return dashes(w - 1) + ":";
  return dashes(w);
}

function pad(s: string, w: number, a: Align): string {
  const gap = Math.max(0, w - width(s));
  if (a === "right") return " ".repeat(gap) + s;
  if (a === "center") {
    const left = Math.floor(gap / 2);
    return " ".repeat(left) + s + " ".repeat(gap - left);
  }
  return s + " ".repeat(gap);
}

/** O texto da tabela com as colunas alinhadas (linha a linha, sem quebra no fim). */
export function formatTable(t: MdTable): string {
  const n = t.header.length;
  const cell = (r: string[], i: number) => r[i] ?? "";
  const w = Array.from({ length: n }, (_, i) =>
    Math.max(3, width(t.header[i]), ...t.rows.map((r) => width(cell(r, i)))),
  );
  const line = (r: string[]) => "| " + w.map((cw, i) => pad(cell(r, i), cw, t.aligns[i])).join(" | ") + " |";
  const delim = "| " + w.map((cw, i) => delimiter(t.aligns[i], cw)).join(" | ") + " |";
  return [line(t.header), delim, ...t.rows.map(line)].join("\n");
}

/** Texto de uma célula como a pessoa o vê e edita: `\|` vira `|` e `<br>` vira quebra de linha. */
export function cellToText(raw: string): string {
  return raw.replace(/<br\s*\/?>/gi, "\n").replace(/\\\|/g, "|");
}

/** O que a pessoa digitou volta a ser uma célula do markdown: `|` escapada e quebra de linha em `<br>`. */
export function textToCell(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/(^|[^\\])\|/g, "$1\\|")
    .replace(/(^|[^\\])\|/g, "$1\\|") // a segunda passada pega barras seguidas (`||`)
    .split("\n")
    .map((l) => l.trim())
    .join("<br>")
    .trim();
}

const clone = (t: MdTable): MdTable => ({ header: [...t.header], aligns: [...t.aligns], rows: t.rows.map((r) => [...r]) });
const blank = (n: number) => Array.from({ length: n }, () => "");

/** Troca o texto de uma célula (`row` -1 é o cabeçalho). */
export function setCell(t: MdTable, row: number, col: number, raw: string): MdTable {
  const o = clone(t);
  if (row < 0) o.header[col] = raw;
  else {
    while (o.rows[row].length < o.header.length) o.rows[row].push("");
    o.rows[row][col] = raw;
  }
  return o;
}

/** Insere uma linha vazia no corpo, na posição `at` (0 = antes da primeira). */
export function insertRow(t: MdTable, at: number): MdTable {
  const o = clone(t);
  o.rows.splice(Math.max(0, Math.min(at, o.rows.length)), 0, blank(o.header.length));
  return o;
}

export function deleteRow(t: MdTable, row: number): MdTable {
  const o = clone(t);
  o.rows.splice(row, 1);
  return o;
}

/** Insere uma coluna vazia na posição `at`. */
export function insertCol(t: MdTable, at: number): MdTable {
  const o = clone(t);
  const i = Math.max(0, Math.min(at, o.header.length));
  o.header.splice(i, 0, "");
  o.aligns.splice(i, 0, "none");
  for (const r of o.rows) {
    while (r.length < o.header.length - 1) r.push("");
    r.splice(i, 0, "");
  }
  return o;
}

/** Apaga uma coluna (a última que sobra não se apaga: devolve `null`). */
export function deleteCol(t: MdTable, col: number): MdTable | null {
  if (t.header.length <= 1) return null;
  const o = clone(t);
  o.header.splice(col, 1);
  o.aligns.splice(col, 1);
  for (const r of o.rows) r.splice(col, 1);
  return o;
}

/** Move a coluna `col` uma posição (`-1` para a esquerda, `1` para a direita). `null` se não há para onde. */
export function moveCol(t: MdTable, col: number, dir: -1 | 1): MdTable | null {
  const to = col + dir;
  if (to < 0 || to >= t.header.length) return null;
  const o = clone(t);
  const swap = <T>(a: T[]) => {
    [a[col], a[to]] = [a[to], a[col]];
  };
  swap(o.header);
  swap(o.aligns);
  for (const r of o.rows) {
    while (r.length < o.header.length) r.push("");
    swap(r);
  }
  return o;
}

export function setAlign(t: MdTable, col: number, a: Align): MdTable {
  const o = clone(t);
  o.aligns[col] = a;
  return o;
}

// ---------------------------------------------------------------- CSV

/** Lê CSV/TSV (aspas `"`, `""` dentro de campo, quebras dentro de aspas). O separador vem de `delimiter()`. */
export function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  let fresh = true; // começo de campo: só aí uma aspa abre
  const src = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"' && fresh) {
      quoted = true;
      fresh = false;
    } else if (ch === sep) {
      row.push(cur);
      cur = "";
      fresh = true;
    } else if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      fresh = true;
    } else {
      cur += ch;
      fresh = false;
    }
  }
  if (cur !== "" || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

/** O separador mais provável (tab, `;` ou `,`): o que mais aparece, igual, em todas as primeiras linhas, fora das aspas. */
export function detectDelimiter(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "").slice(0, 20);
  let best = ",";
  let bestScore = 0;
  for (const sep of ["\t", ";", ","]) {
    const counts = lines.map((l) => {
      let n = 0;
      let q = false;
      for (const ch of l) {
        if (ch === '"') q = !q;
        else if (ch === sep && !q) n++;
      }
      return n;
    });
    if (counts.length === 0 || counts[0] === 0 || counts.some((c) => c !== counts[0])) continue;
    const score = counts[0] * (sep === "\t" ? 1000 : 1);
    if (score > bestScore) {
      best = sep;
      bestScore = score;
    }
  }
  return best;
}

/** Linhas de CSV/TSV em tabela (a primeira linha é o cabeçalho). `null` se não há duas colunas ou uma linha. */
export function csvToTable(text: string): MdTable | null {
  const rows = parseCsv(text, detectDelimiter(text));
  if (rows.length === 0) return null;
  const n = Math.max(...rows.map((r) => r.length));
  if (n < 2) return null;
  const fix = (r: string[]) => Array.from({ length: n }, (_, i) => textToCell((r[i] ?? "").trim()));
  const header = fix(rows[0]).map((c, i) => c || `Coluna ${i + 1}`);
  return { header, aligns: header.map(() => "none"), rows: rows.slice(1).map(fix) };
}

const csvField = (s: string) => (/[",;\t\n\r]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s);

/** A tabela como CSV (vírgula, quebras de linha `\n`; `<br>` volta a ser quebra dentro de aspas). */
export function tableToCsv(t: MdTable): string {
  const n = t.header.length;
  const line = (r: string[]) => Array.from({ length: n }, (_, i) => csvField(cellToText(r[i] ?? ""))).join(",");
  return [line(t.header), ...t.rows.map(line)].join("\n");
}

// ---------------------------------------------------------------- no documento

const lineStart = (doc: string, pos: number) => doc.lastIndexOf("\n", pos - 1) + 1;
const lineEnd = (doc: string, pos: number) => {
  const i = doc.indexOf("\n", pos);
  return i < 0 ? doc.length : i;
};

/** Uma tabela vazia de duas colunas, para inserir numa linha em branco. */
export function skeleton(): string {
  return formatTable({ header: ["Coluna 1", "Coluna 2"], aligns: ["none", "none"], rows: [["", ""], ["", ""]] });
}

/**
 * Bloco "Tabela": várias linhas selecionadas (CSV/TSV) viram uma tabela; seleção de uma linha só ou vazia
 * insere uma tabela nova de duas colunas logo abaixo da linha (a linha que já tem texto não é tocada).
 * Já é uma tabela: reescreve alinhada.
 */
export function tableFromSelection(doc: string, from: number, to: number): Outcome {
  const end = to > from && doc[to - 1] === "\n" ? to - 1 : to;
  let a = lineStart(doc, from);
  let b = lineEnd(doc, end);
  if (from === to || !doc.slice(a, b).includes("\n")) {
    // o cursor numa tabela: vale a tabela inteira (as linhas seguidas sem linha em branco)
    let pa = a;
    let pb = b;
    while (pa > 0 && doc.slice(lineStart(doc, pa - 1), pa - 1).trim() !== "") pa = lineStart(doc, pa - 1);
    while (pb < doc.length && doc.slice(pb + 1, lineEnd(doc, pb + 1)).trim() !== "") pb = lineEnd(doc, pb + 1);
    if (parseTable(doc.slice(pa, pb))) {
      a = pa;
      b = pb;
    }
  }
  const block = doc.slice(a, b);
  const edit = (insert: string, at = a, upTo = b): Outcome => {
    const changes: Edit[] = [{ from: at, to: upTo, insert }];
    const pos = at + insert.length;
    return { changes, anchor: pos, head: pos };
  };
  const existing = parseTable(block);
  if (existing) return edit(formatTable(existing));
  if (block.includes("\n")) {
    const t = csvToTable(block);
    if (t) return edit(formatTable(t));
  }
  const sk = skeleton();
  if (block.trim() === "") return edit(sk);
  return edit("\n\n" + sk, b, b);
}

/** Põe uma tabela no documento: no lugar da seleção, da linha em branco ou logo abaixo da linha com texto. */
export function insertTable(doc: string, from: number, to: number, t: MdTable): Outcome {
  const text = formatTable(t);
  let edit: Edit;
  if (to > from) edit = { from, to, insert: text };
  else {
    const a = lineStart(doc, from);
    const b = lineEnd(doc, from);
    edit = doc.slice(a, b).trim() === "" ? { from: a, to: b, insert: text } : { from: b, to: b, insert: "\n\n" + text };
  }
  const pos = edit.from + edit.insert.length;
  return { changes: [edit], anchor: pos, head: pos };
}

/**
 * O separador de um texto colado que parece uma grade: duas linhas ou mais, com o mesmo número (maior que
 * zero) de separadores fora das aspas. Tab vale sempre que serve; `;` e `,` só se todas as linhas batem.
 * `null` se não parece tabela (prosa com vírgulas não costuma ter a mesma contagem em toda linha).
 */
export function tabularDelimiter(text: string): string | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2 || lines.length > 20_000) return null;
  const sample = lines.slice(0, 50);
  for (const sep of ["\t", ";", ","]) {
    const counts = sample.map((l) => {
      let n = 0;
      let q = false;
      for (const ch of l) {
        if (ch === '"') q = !q;
        else if (ch === sep && !q) n++;
      }
      return n;
    });
    if (counts[0] > 0 && counts.every((c) => c === counts[0])) return sep;
  }
  return null;
}

/** Um texto colado (CSV, TSV, planilha) como tabela, se parece uma; `null` se não (e se já é tabela do markdown). */
export function pastedTable(text: string): MdTable | null {
  if (parseTable(text)) return null;
  if (!tabularDelimiter(text)) return null;
  return csvToTable(text);
}

/** Cola uma grade de texto a partir da célula (`row`, `col`), criando linhas e colunas que faltarem. */
export function pasteGrid(t: MdTable, row: number, col: number, grid: string[][]): MdTable {
  let o = clone(t);
  const width = Math.max(...grid.map((r) => r.length));
  while (o.header.length < col + width) o = insertCol(o, o.header.length);
  const first = Math.max(row, -1);
  while (o.rows.length < first + grid.length) o = insertRow(o, o.rows.length);
  grid.forEach((r, i) =>
    r.forEach((v, j) => {
      o = setCell(o, first + i, col + j, textToCell(v.trim()));
    }),
  );
  return o;
}
