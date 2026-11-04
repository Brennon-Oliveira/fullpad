import { LanguageDescription, LanguageSupport, StreamLanguage, type StreamParser } from "@codemirror/language";
import { dbmlLanguage } from "./dbmllang";
import { mermaidLanguage } from "./mermaidlang";

/**
 * Linguagens dos blocos de código do markdown (```js ... ```). Cada uma carrega sob demanda, só
 * quando um bloco daquela linguagem aparece, então não pesam na abertura do app. Lista enxuta de
 * propósito (em vez do `@codemirror/language-data`, que traz ~100 linguagens): para acrescentar
 * uma, é só mais uma entrada aqui.
 */
/** Linguagem de `@codemirror/legacy-modes` (analisador de fluxo, leve; carrega só quando usada). */
function legacy(name: string, alias: string[], extensions: string[], mode: () => Promise<StreamParser<unknown>>, filename?: RegExp) {
  return LanguageDescription.of({
    name,
    alias,
    extensions,
    filename,
    load: async () => new LanguageSupport(StreamLanguage.define(await mode())),
  });
}

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
    name: "C#",
    alias: ["cs", "csharp", "c#"],
    extensions: ["cs"],
    load: () => import("@codemirror/legacy-modes/mode/clike").then((m) => new LanguageSupport(StreamLanguage.define(m.csharp))),
  }),
  legacy("C", ["c"], ["c", "h"], () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.c)),
  legacy("C++", ["cpp", "cxx", "c++"], ["cpp", "cc", "cxx", "hpp", "hh", "hxx"], () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.cpp)),
  legacy("Java", [], ["java"], () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.java)),
  legacy("Kotlin", ["kt"], ["kt", "kts"], () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.kotlin)),
  legacy("Go", ["golang"], ["go"], () => import("@codemirror/legacy-modes/mode/go").then((m) => m.go)),
  legacy("Ruby", ["rb"], ["rb", "rake", "gemspec"], () => import("@codemirror/legacy-modes/mode/ruby").then((m) => m.ruby)),
  legacy("TOML", [], ["toml"], () => import("@codemirror/legacy-modes/mode/toml").then((m) => m.toml)),
  legacy("PowerShell", ["ps1", "pwsh"], ["ps1", "psm1", "psd1"], () => import("@codemirror/legacy-modes/mode/powershell").then((m) => m.powerShell)),
  legacy("Dockerfile", ["docker"], ["dockerfile"], () => import("@codemirror/legacy-modes/mode/dockerfile").then((m) => m.dockerFile), /^Dockerfile(\..*)?$/),
  legacy("Lua", [], ["lua"], () => import("@codemirror/legacy-modes/mode/lua").then((m) => m.lua)),
  legacy("Perl", ["pl"], ["pl", "pm"], () => import("@codemirror/legacy-modes/mode/perl").then((m) => m.perl)),
  legacy("Swift", [], ["swift"], () => import("@codemirror/legacy-modes/mode/swift").then((m) => m.swift)),
  legacy("Diff", ["patch"], ["diff", "patch"], () => import("@codemirror/legacy-modes/mode/diff").then((m) => m.diff)),
  legacy("INI", ["ini", "properties"], ["ini", "cfg", "conf", "properties"], () => import("@codemirror/legacy-modes/mode/properties").then((m) => m.properties)),
  legacy("XML", [], ["xml", "xsd", "xsl", "xslt", "svg", "csproj"], () => import("@codemirror/legacy-modes/mode/xml").then((m) => m.xml)),
  LanguageDescription.of({
    name: "DBML",
    alias: ["dbmlx"],
    extensions: ["dbml", "dbmlx"],
    load: async () => new LanguageSupport(dbmlLanguage), // já está no bundle: não há o que carregar
  }),
  LanguageDescription.of({
    name: "Mermaid",
    alias: ["mermaid", "mmd"],
    extensions: ["mmd", "mermaid"],
    load: async () => new LanguageSupport(mermaidLanguage), // pequeno, já está no bundle
  }),
];

/** Tipos de arquivo que têm visão própria (não são "só destaque"): ficam de fora do seletor de Lang. */
const OWN_TYPE = new Set(["DBML", "Mermaid", "JSON", "YAML", "TOML"]);

/** As linguagens que o usuário pode escolher à mão para colorir um arquivo de texto. */
export const pickableLanguages: readonly LanguageDescription[] = codeLanguages.filter((l) => !OWN_TYPE.has(l.name));

/** Valor de `TabState.code_lang` para "sem destaque" (texto puro). */
export const NO_CODE_LANG = "none";

/**
 * Linguagem de código de uma aba de texto: a escolhida à mão (`chosen`) ou, sem escolha, a da
 * extensão do arquivo. Notas soltas (sem arquivo) e extensões desconhecidas ficam sem destaque.
 */
export function codeLanguageFor(path: string | null, chosen?: string): LanguageDescription | null {
  if (chosen === NO_CODE_LANG) return null;
  if (chosen) return pickableLanguages.find((l) => l.name === chosen) ?? null;
  const name = path?.split(/[\\/]/).pop();
  return name ? (LanguageDescription.matchFilename(pickableLanguages, name) ?? null) : null;
}
