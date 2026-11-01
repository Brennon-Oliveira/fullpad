import { createRequire } from "node:module";
import { type DbmlParse, createDbmlService } from "./service";

// O pacote ESM importa lodash de um jeito que o Node puro não aceita; o CJS funciona igual.
const parse = createRequire(import.meta.url)("@dbml/parse") as DbmlParse;

/** Mesmo serviço do app (`service.ts`), para os testes exercitarem o parser real. */
export const service = createDbmlService(parse);
export const interpret = service.interpret;
