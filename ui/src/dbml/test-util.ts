import { createRequire } from "node:module";
import type { Interpreter } from "./model";

// O pacote ESM importa lodash de um jeito que o Node puro não aceita; o CJS funciona igual.
const { Compiler, MemoryProjectLayout, Filepath } = createRequire(import.meta.url)("@dbml/parse");
const entry = Filepath.from("/main.dbml");

/** Mesmo caminho do painel (`panel.ts`), para os testes exercitarem o parser real. */
export const interpret: Interpreter = (text) =>
  new Compiler(new MemoryProjectLayout({ "/main.dbml": text })).interpretFile(entry);
