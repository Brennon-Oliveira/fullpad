export type Lang = "plain" | "markdown" | "dbml";

const MD_EXT = new Set(["md", "markdown", "mdown", "mkd", "mdx"]);
const DBML_EXT = new Set(["dbml", "dbmlx"]);
const PLAIN_EXT = new Set(["txt", "text", "log", "ini", "cfg", "conf", "csv"]);

function extOf(path: string): string {
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
    if (PLAIN_EXT.has(ext)) return "plain";
  }
  const { score, firstIsHeading } = markdownScore(text);
  return score >= 3 || (firstIsHeading && score >= 2) ? "markdown" : "plain";
}
