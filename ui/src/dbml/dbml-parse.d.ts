// O pacote traz tipos, mas o TypeScript não os resolve pelo campo `exports`. Só usamos o `Compiler`
// (tipado de forma estrutural em ./model.ts como `CompilerLike`).
declare module "@dbml/parse" {
  export const Compiler: unknown;
}
