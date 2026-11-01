// O pacote traz tipos, mas o TypeScript não os resolve pelo campo `exports`. Usamos só o que está
// tipado de forma estrutural em ./panel.ts (`DbmlParse`) e ./model.ts (`Interpreter`).
declare module "@dbml/parse" {
  const parse: unknown;
  export = parse;
}
