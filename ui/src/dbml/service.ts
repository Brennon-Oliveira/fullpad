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

type Compiler = { interpretFile(entry: unknown): ReturnType<Interpreter> };
type Layout = { setSource(path: unknown, text: string): void };

/** O que usamos do módulo @dbml/parse (v11: o projeto é um layout em memória com um único arquivo). */
export interface DbmlParse {
  Compiler: new (layout: Layout) => Compiler;
  MemoryProjectLayout: new (files: Record<string, string>) => Layout;
  Filepath: { from(path: string): unknown };
  DBMLDiagnosticsProvider: new (c: Compiler) => { provideDiagnostics(entry: unknown): DbmlDiagnostic[] };
}

/** Serviço único por janela: painel do diagrama, diagnóstico e autocomplete compartilham o compilador. */
export interface DbmlService {
  interpret: Interpreter;
  diagnostics(text: string): DbmlDiagnostic[];
}

const ENTRY = "/main.dbml";

export function createDbmlService(parse: DbmlParse): DbmlService {
  const entry = parse.Filepath.from(ENTRY);
  const layout = new parse.MemoryProjectLayout({ [ENTRY]: "" });
  const compiler = new parse.Compiler(layout);
  const diag = new parse.DBMLDiagnosticsProvider(compiler);
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
  };
}

// Carga sob demanda: o parser só entra na memória na primeira vez que um DBML precisa dele.
let promise: Promise<DbmlService> | undefined;
export function loadDbmlService(): Promise<DbmlService> {
  promise ??= import("@dbml/parse").then((m) => createDbmlService(m as unknown as DbmlParse));
  promise.catch(() => (promise = undefined)); // permite tentar de novo
  return promise;
}
