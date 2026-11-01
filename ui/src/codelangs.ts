import { LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";
import { dbmlLanguage } from "./dbmllang";

/**
 * Linguagens dos blocos de código do markdown (```js ... ```). Cada uma carrega sob demanda, só
 * quando um bloco daquela linguagem aparece, então não pesam na abertura do app. Lista enxuta de
 * propósito (em vez do `@codemirror/language-data`, que traz ~100 linguagens): para acrescentar
 * uma, é só mais uma entrada aqui.
 */
export const codeLanguages: LanguageDescription[] = [
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["js", "jsx", "mjs", "cjs", "node"],
    extensions: ["js", "jsx", "mjs", "cjs"],
    load: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["ts", "tsx"],
    extensions: ["ts", "tsx"],
    load: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true, jsx: true })),
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: ["jsonc", "json5"],
    extensions: ["json"],
    load: () => import("@codemirror/lang-json").then((m) => m.json()),
  }),
  LanguageDescription.of({
    name: "SQL",
    alias: ["postgres", "postgresql", "mysql", "sqlite"],
    extensions: ["sql"],
    load: () => import("@codemirror/lang-sql").then((m) => m.sql()),
  }),
  LanguageDescription.of({
    name: "Python",
    alias: ["py"],
    extensions: ["py"],
    load: () => import("@codemirror/lang-python").then((m) => m.python()),
  }),
  LanguageDescription.of({
    name: "CSS",
    extensions: ["css"],
    load: () => import("@codemirror/lang-css").then((m) => m.css()),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["xml", "svg", "vue"],
    extensions: ["html", "htm"],
    load: () => import("@codemirror/lang-html").then((m) => m.html()),
  }),
  LanguageDescription.of({
    name: "Rust",
    alias: ["rs"],
    extensions: ["rs"],
    load: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  }),
  LanguageDescription.of({
    name: "YAML",
    alias: ["yml"],
    extensions: ["yaml", "yml"],
    load: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  }),
  LanguageDescription.of({
    name: "Shell",
    alias: ["sh", "bash", "zsh", "shell", "console"],
    extensions: ["sh", "bash"],
    load: () => import("@codemirror/legacy-modes/mode/shell").then((m) => new LanguageSupport(StreamLanguage.define(m.shell))),
  }),
  LanguageDescription.of({
    name: "DBML",
    alias: ["dbmlx"],
    extensions: ["dbml", "dbmlx"],
    load: async () => new LanguageSupport(dbmlLanguage), // já está no bundle: não há o que carregar
  }),
];
