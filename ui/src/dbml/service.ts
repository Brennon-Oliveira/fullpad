import type { Interpreter } from "./model";

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
  /** Renomeia a tabela e tudo o que a usa; devolve o texto novo por arquivo (vazio: não achou ou o nome já existe). */
  renameTable(entry: unknown, oldName: { schema?: string; table: string }, newName: { schema?: string; table: string }): Map<string, string>;
};
type Layout = { setSource(path: unknown, text: string): void };

/** O que usamos do módulo @dbml/parse (v11: o projeto é um layout em memória com um único arquivo). */
export interface DbmlParse {
  Compiler: new (layout: Layout) => Compiler;
  MemoryProjectLayout: new (files: Record<string, string>) => Layout;
  Filepath: { from(path: string): unknown };
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
  /** `renameTable` da biblioteca sobre o texto: o texto novo, ou `null` se não renomeou (não achou ou o nome já existe). */
  renameTable(text: string, from: { schema?: string; table: string }, to: { schema?: string; table: string }): string | null;
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

  /** Aponta o compilador para o texto; ele invalida o cache sozinho quando o texto muda. */
  const sync = (text: string) => {
    if (text !== current) {
      layout.setSource(entry, text);
      current = text;
    }
  };

  return {
    interpret(text) {
      sync(text);
      return compiler.interpretFile(entry);
    },
    diagnostics(text) {
      sync(text);
      return diag.provideDiagnostics(entry);
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
      const starts = lineStarts(text);
      const at = (line: number, col: number) => (starts[line - 1] ?? text.length) + col - 1;
      const found = refs.provideReferences(model, { lineNumber: 1, column: offset + 1 }) ?? [];
      return found.map((l) => ({ from: at(l.range.startLineNumber, l.range.startColumn), to: at(l.range.endLineNumber, l.range.endColumn) }));
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
      const starts = lineStarts(text);
      return (starts[first.range.startLineNumber - 1] ?? text.length) + first.range.startColumn - 1;
    },
    renameTable(text, from, to) {
      sync(text);
      const out = compiler.renameTable(entry, from, to);
      const next = out.get(ENTRY) ?? [...out.values()][0];
      return next !== undefined && next !== text ? next : null;
    },
    triggerCharacters: completion.triggerCharacters ?? [],
  };
}

// Carga sob demanda: o parser só entra na memória na primeira vez que um DBML precisa dele.
let promise: Promise<DbmlService> | undefined;
export function loadDbmlService(): Promise<DbmlService> {
  promise ??= import("@dbml/parse").then((m) => createDbmlService(m as unknown as DbmlParse));
  promise.catch(() => (promise = undefined)); // permite tentar de novo
  return promise;
}
