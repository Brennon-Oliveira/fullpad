import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Plugin } from "vite";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * O leitor de PDF precisa dos recursos do pdf.js (fontes padrão, mapas de caracteres, wasm de
 * imagens). Eles são copiados para `public/pdfjs/` (ignorado pelo git) e viajam dentro do app:
 * nada é baixado da rede. Só são lidos quando um PDF é carregado.
 */
function pdfjsAssets(): Plugin {
  return {
    name: "fullpad-pdfjs-assets",
    config() {
      const from = join(here, "node_modules", "pdfjs-dist");
      const to = join(here, "public", "pdfjs");
      mkdirSync(to, { recursive: true });
      for (const dir of ["cmaps", "standard_fonts", "iccs", "wasm"]) cpSync(join(from, dir), join(to, dir), { recursive: true });
    },
  };
}

/**
 * As equações (KaTeX) usam fontes próprias. Só as `.woff2` são copiadas para `public/katex/fonts/`
 * (ignorado pelo git) e viajam dentro do app; `latex/render.ts` aponta o CSS do KaTeX para essa pasta.
 */
function katexFonts(): Plugin {
  return {
    name: "fullpad-katex-fonts",
    config() {
      const from = join(here, "node_modules", "katex", "dist", "fonts");
      const to = join(here, "public", "katex", "fonts");
      mkdirSync(to, { recursive: true });
      for (const f of readdirSync(from)) if (f.endsWith(".woff2")) cpSync(join(from, f), join(to, f));
    },
  };
}

export default defineConfig({
  clearScreen: false,
  plugins: [pdfjsAssets(), katexFonts()],
  server: { port: 1420, strictPort: true },
  build: { target: "es2022" },
  // o CSS do KaTeX é lido como texto (`?raw`) e os testes precisam do conteúdo, não de uma string vazia
  test: { css: { include: /katex\.min\.css/ } },
});
