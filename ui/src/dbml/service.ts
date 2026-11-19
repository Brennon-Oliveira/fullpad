import { composeSource, stripDbmlx } from "./dbmlx";
import type { Interpreter } from "./model";
import { applyChanges, lineChanges } from "./textdiff";

/** Diagnóstico do @dbml/parse (linha/coluna a partir de 1). */
export interface DbmlDiagnostic {
  type: "error" | "warning" | "info";
  text: string;
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
  quickFixes?: { title: string; edits: { start: number; end: number; newText: string }[] }[];
}

/** Item de autocomplete do provider (formato Monaco; só os campos que usamos). */
export interface DbmlCompletion {
  label: string;
  insertText: string;
  /** Bitmask do Monaco: 4 = o texto é um snippet (`${1:nome}`). */
  insertTextRules?: number;
  /** `CompletionItemKind` do Monaco (5 = tabela, 3 = coluna, 24 = tipo, 9 = configuração, 17 = palavra-chave). */
  kind?: number;
  detail?: string;
}

type Compiler = {
  interpretFile(entry: unknown): ReturnType<Interpreter>;
  /** Edições (offsets do texto) para mudar/pôr/tirar uma configuração de um elemento; `value` `null` tira. */
  updateElementSettingEdit(entry: unknown, target: Record<string, unknown>, name: string, value: string | null): { start: number; end: number; newText: string }[];
  /** Renomeia a tabela e tudo o que a usa; devolve o texto novo por arquivo (vazio: não achou ou o nome já existe). */
  renameTable(entry: unknown, oldName: { schema?: string; table: string }, newName: { schema?: string; table: string }): Map<string, string>;
};
type Layout = { setSource(path: unknown, text: string): void };

/** O que usamos do módulo @dbml/parse (v11: o projeto é um layout em memória com um único arquivo). */
export interface DbmlParse {
  Compiler: new (layout: Layout) => Compiler;
  MemoryProjectLayout: new (files: Record<string, string>) => Layout;
  Filepath: { from(path: string): unknown };
  SymbolKind: { Column: string; Table: string };
  DBMLDiagnosticsProvider: new (c: Compiler) => { provideDiagnostics(entry: unknown): DbmlDiagnostic[] };
  DBMLReferencesProvider: new (c: Compiler) => {
    provideReferences(model: unknown, position: unknown): { range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } }[] | undefined;
  };
  DBMLDefinitionProvider: new (c: Compiler) => {
    provideDefinition(model: unknown, position: unknown): unknown;
  };
  DBMLCompletionItemProvider: new (c: Compiler) => {
    triggerCharacters: string[];
    provideCompletionItems(model: unknown, position: unknown, context: unknown, token: unknown): unknown;
  };
}

/** Arquivos que o texto inclui com `!include` (lidos pelo Rust) e o que deu errado ao incluir. */
export interface DbmlProject {
  parts: { file: string; line: number; text: string; context?: boolean }[];
  issues: { line: number; message: string }[];
}

/** Serviço único por janela: painel do diagrama, diagnóstico e autocomplete compartilham o compilador. */
export interface DbmlService {
  interpret: Interpreter;
  diagnostics(text: string): DbmlDiagnostic[];
  /** Sugestões para o cursor em `offset` (posição no texto). */
  completions(text: string, offset: number): DbmlCompletion[];
  /** Onde o símbolo sob `offset` é usado (sem a declaração): trechos do texto, em offsets. */
  references(text: string, offset: number): { from: number; to: number }[];
  /** Onde começa a declaração do símbolo usado em `offset` (`null` se `offset` não é um uso, ou é a própria declaração). */
  definition(text: string, offset: number): number | null;
  /** Trocas que mudam (ou tiram, com `null`) a configuração `name` da coluna `column` da tabela; `[]` se a biblioteca não achou. */
  columnSettingEdits(text: string, col: { schema?: string; table: string; column: string }, name: string, value: string | null): { from: number; to: number; insert: string }[];
  /** Como `columnSettingEdits`, para uma configuração da própria tabela (`[note: ...]` no cabeçalho). */
  tableSettingEdits(text: string, table: { schema?: string; table: string }, name: string, value: string | null): { from: number; to: number; insert: string }[];
  /** `renameTable` da biblioteca sobre o texto: o texto novo, ou `null` se não renomeou (não achou ou o nome já existe). */
  renameTable(text: string, from: { schema?: string; table: string }, to: { schema?: string; table: string }): string | null;
  /**
   * Os arquivos incluídos da aba em uso. O compilador passa a ver o texto da aba **seguido** do dos incluídos
   * (o do próprio arquivo mantém todas as posições). `null`: sem `!include`. Devolve se mudou algo.
   */
  setProject(p: DbmlProject | null): boolean;
  /** Onde, num arquivo incluído, cai uma posição além do fim do texto da aba (`null`: é do próprio texto). */
  explain(offset: number): { file: string; line: number } | null;
  /** O símbolo sob `offset` também é usado em arquivo incluído (um renome não alcançaria esses usos). */
  hasExternalUses(text: string, offset: number): boolean;
  /** Caracteres que, ao serem digitados, já pedem sugestões (`.`, `[`, espaço...). */
  triggerCharacters: string[];
}

const ENTRY = "/main.dbml";

/** Offset onde começa cada linha (as posições do provider são linha/coluna a partir de 1). */
function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") out.push(i + 1);
  return out;
}

export function createDbmlService(parse: DbmlParse): DbmlService {
  const entry = parse.Filepath.from(ENTRY);
  const layout = new parse.MemoryProjectLayout({ [ENTRY]: "" });
  const compiler = new parse.Compiler(layout);
  const diag = new parse.DBMLDiagnosticsProvider(compiler);
  const completion = new parse.DBMLCompletionItemProvider(compiler);
  const refs = new parse.DBMLReferencesProvider(compiler);
  const defs = new parse.DBMLDefinitionProvider(compiler);
  let current = "";
  let project: DbmlProject | null = null;
  let projectKey = "";
  // o que o compilador vê agora: o texto limpo da aba + os incluídos (ver `composeSource`)
  let source = "";
  let mainLen = 0;
  let segments: { start: number; file: string; line: number; context: boolean }[] = [];

  /** Aponta o compilador para o texto; ele invalida o cache sozinho quando o texto muda. */
  const sync = (text: string) => {
    const key = `${projectKey}\u0000${text}`;
    if (key === current) return;
    const c = composeSource(text, project?.parts ?? []);
    source = c.source;
    mainLen = c.mainLength;
    segments = c.offsets.map((start, i) => ({ start, file: project!.parts[i].file, line: project!.parts[i].line, context: !!project!.parts[i].context }));
    layout.setSource(entry, source);
    current = key;
  };
  const segmentAt = (offset: number) => {
    for (let i = segments.length - 1; i >= 0; i--) if (offset >= segments[i].start) return { seg: segments[i], localLine: source.slice(segments[i].start, offset).split("\n").length };
    return null;
  };

  return {
    interpret(text) {
      sync(text);
      return compiler.interpretFile(entry);
    },
    diagnostics(text) {
      sync(text);
      const starts = lineStarts(source);
      const at = (row: number, col: number) => (starts[row - 1] ?? source.length) + col - 1;
      const out: DbmlDiagnostic[] = [];
      const seen = new Set<string>();
      const lineEnd = (row: number) => (text.split("\n")[row - 1]?.length ?? 0) + 1;
      const here = (row: number, message: string, type: DbmlDiagnostic["type"]) =>
        out.push({ type, text: message, startRow: row, startColumn: 1, endRow: row, endColumn: lineEnd(row) });
      for (const i of project?.issues ?? []) here(i.line, `!include: ${i.message}`, "error");
      for (const d of diag.provideDiagnostics(entry)) {
        const off = at(d.startRow, d.startColumn);
        if (off < mainLen) {
          out.push(d);
          continue;
        }
        // o erro está num arquivo incluído: aparece na linha do `!include` que o trouxe
        const w = segmentAt(off);
        if (!w || w.seg.context) continue; // o que é só contexto (a raiz do módulo e os outros arquivos) não é problema deste arquivo
        const k = `${w.seg.file}:${w.localLine}:${d.text}`;
        if (seen.has(k)) continue;
        seen.add(k);
        here(w.seg.line, `Em ${w.seg.file}, linha ${w.localLine}: ${d.text}`, d.type);
      }
      return out;
    },
    completions(text, offset) {
      sync(text);
      // O provider foi escrito para o Monaco, mas só usa `uri` (qual arquivo) e `getOffsetAt(posição)`:
      // como já temos o deslocamento, o "modelo" devolve ele mesmo e a posição nem precisa ser convertida.
      const model = {
        uri: { scheme: "file", path: ENTRY, fsPath: ENTRY, toString: () => `file://${ENTRY}` },
        getOffsetAt: () => offset,
      };
      const res = completion.provideCompletionItems(model, { lineNumber: 1, column: offset + 1 }, { triggerKind: 1 }, {
        isCancellationRequested: false,
      }) as { suggestions?: DbmlCompletion[] } | DbmlCompletion[] | Promise<unknown> | undefined;
      if (!res || "then" in res) return []; // o provider é síncrono; promessa = algo inesperado
      return Array.isArray(res) ? res : (res.suggestions ?? []);
    },
    references(text, offset) {
      sync(text);
      const model = {
        uri: { scheme: "file", path: ENTRY, fsPath: ENTRY, toString: () => `file://${ENTRY}` },
        getOffsetAt: () => offset,
      };
      const starts = lineStarts(source);
      const at = (line: number, col: number) => (starts[line - 1] ?? source.length) + col - 1;
      const found = refs.provideReferences(model, { lineNumber: 1, column: offset + 1 }) ?? [];
      return found.map((l) => ({ from: at(l.range.startLineNumber, l.range.startColumn), to: at(l.range.endLineNumber, l.range.endColumn) })).filter((r) => r.to <= mainLen);
    },
    definition(text, offset) {
      sync(text);
      const model = {
        uri: { scheme: "file", path: ENTRY, fsPath: ENTRY, toString: () => `file://${ENTRY}` },
        getOffsetAt: () => offset,
      };
      const res = defs.provideDefinition(model, { lineNumber: 1, column: offset + 1 });
      const first = (Array.isArray(res) ? res[0] : res) as { range?: { startLineNumber: number; startColumn: number } } | undefined;
      if (!first?.range) return null;
      const starts = lineStarts(source);
      const at = (starts[first.range.startLineNumber - 1] ?? source.length) + first.range.startColumn - 1;
      return at < mainLen ? at : null; // a declaração é de um arquivo incluído: não há para onde ir neste texto
    },
    columnSettingEdits(text, col, name, value) {
      sync(text);
      const edits = compiler.updateElementSettingEdit(entry, { kind: parse.SymbolKind.Column, ...col }, name, value);
      return edits.some((e) => e.end > mainLen) ? [] : edits.map((e) => ({ from: e.start, to: e.end, insert: e.newText }));
    },
    tableSettingEdits(text, table, name, value) {
      sync(text);
      const edits = compiler.updateElementSettingEdit(entry, { kind: parse.SymbolKind.Table, ...table }, name, value);
      return edits.some((e) => e.end > mainLen) ? [] : edits.map((e) => ({ from: e.start, to: e.end, insert: e.newText }));
    },
    renameTable(text, from, to) {
      sync(text);
      const out = compiler.renameTable(entry, from, to);
      const next = out.get(ENTRY) ?? [...out.values()][0];
      if (next === undefined) return null;
      // o texto que o compilador devolve é o limpo (sem as anotações do dbmlx) e seguido dos incluídos:
      // só valem as trocas no texto da aba, aplicadas ao texto original (que mantém as anotações)
      const tail = source.slice(mainLen);
      if (!next.endsWith(tail)) return null; // mexeria num arquivo incluído
      const nextMain = next.slice(0, next.length - tail.length);
      const clean = stripDbmlx(text);
      if (nextMain === clean) return null;
      return applyChanges(text, lineChanges(clean, nextMain));
    },
    setProject(p) {
      const key = p ? JSON.stringify(p) : "";
      if (key === projectKey) return false;
      project = p && (p.parts.length > 0 || p.issues.length > 0) ? p : null;
      projectKey = project ? key : "";
      return true;
    },
    explain(offset) {
      if (offset < mainLen) return null;
      const w = segmentAt(offset);
      return w ? { file: w.seg.file, line: w.localLine } : null;
    },
    hasExternalUses(text, offset) {
      sync(text);
      const model = { uri: { scheme: "file", path: ENTRY, fsPath: ENTRY, toString: () => `file://${ENTRY}` }, getOffsetAt: () => offset };
      const starts = lineStarts(source);
      const found = refs.provideReferences(model, { lineNumber: 1, column: offset + 1 }) ?? [];
      return found.some((l) => (starts[l.range.startLineNumber - 1] ?? source.length) + l.range.startColumn - 1 >= mainLen);
    },
    triggerCharacters: completion.triggerCharacters ?? [],
  };
}

// Carga sob demanda: o parser só entra na memória na primeira vez que um DBML precisa dele.
let promise: Promise<DbmlService> | undefined;
let loaded: DbmlService | undefined;
/** O serviço, se já foi carregado (sem pedir a carga: quem só quer limpar o que tinha não deve puxar o parser). */
export const peekDbmlService = () => loaded;
export function loadDbmlService(): Promise<DbmlService> {
  promise ??= import("@dbml/parse").then((m) => (loaded = createDbmlService(m as unknown as DbmlParse)));
  promise.catch(() => (promise = undefined)); // permite tentar de novo
  return promise;
}
