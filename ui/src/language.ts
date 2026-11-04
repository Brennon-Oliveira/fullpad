/** `pdf` e `epub`: aba de leitura (sem texto). Só `effectiveLang` o devolve; `detectLanguage` nunca. */
export type Lang = "plain" | "markdown" | "dbml" | "mermaid" | "json" | "csv" | "yaml" | "toml" | "pdf" | "epub";

const MD_EXT = new Set(["md", "markdown", "mdown", "mkd", "mdx"]);
const DBML_EXT = new Set(["dbml", "dbmlx"]);
const MERMAID_EXT = new Set(["mmd", "mermaid"]);
const JSON_EXT = new Set(["json", "jsonc", "geojson", "webmanifest"]);
const YAML_EXT = new Set(["yaml", "yml"]);
const TOML_EXT = new Set(["toml"]);
const CSV_EXT = new Set(["csv", "tsv"]);
const PLAIN_EXT = new Set(["txt", "text", "log", "ini", "cfg", "conf"]);

export function extOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Pontuação de "parece markdown" nas primeiras linhas. */
export function markdownScore(text: string): { score: number; firstIsHeading: boolean } {
  let score = 0;
  let firstIsHeading = false;
  let seenFirst = false;
  let inFence = false;
  for (const line of text.split("\n", 200)) {
    if (!seenFirst && line.trim() !== "") {
      seenFirst = true;
      firstIsHeading = /^#{1,6}\s+\S/.test(line);
    }
    if (/^\s*(```|~~~)/.test(line)) {
      score += 2;
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^#{1,6}\s+\S/.test(line)) score += 2;
    else if (/^\s*[-*+]\s+\[[ xX]\]\s/.test(line)) score += 2;
    else if (/^\s*([-*+]|\d+[.)])\s+\S/.test(line)) score += 1;
    else if (/^>\s?\S/.test(line)) score += 1;
    if (/\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\n]+\)|`[^`\n]+`/.test(line)) score += 1;
  }
  return { score, firstIsHeading };
}

/** Decide a linguagem efetiva no modo automático. */
export function detectLanguage(text: string, path: string | null): Lang {
  if (path) {
    const ext = extOf(path);
    if (MD_EXT.has(ext)) return "markdown";
    if (DBML_EXT.has(ext)) return "dbml";
    if (MERMAID_EXT.has(ext)) return "mermaid";
    if (JSON_EXT.has(ext)) return "json";
    if (CSV_EXT.has(ext)) return "csv";
    if (YAML_EXT.has(ext)) return "yaml";
    if (TOML_EXT.has(ext)) return "toml";
    if (PLAIN_EXT.has(ext)) return "plain";
  }
  const { score, firstIsHeading } = markdownScore(text);
  return score >= 3 || (firstIsHeading && score >= 2) ? "markdown" : "plain";
}
