import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Plugin, defineConfig } from "vite";

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

export default defineConfig({
  clearScreen: false,
  plugins: [pdfjsAssets()],
  server: { port: 1420, strictPort: true },
  build: { target: "es2022" },
});
