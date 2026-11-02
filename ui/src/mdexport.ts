/**
 * Exportação do markdown: HTML autônomo (com estilo próprio), cópia como HTML e PDF pela impressão.
 * O `marked` só carrega quando o usuário exporta: não pesa na abertura do app.
 */

const STYLE = `
:root { color-scheme: light; }
body { font: 16px/1.65 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2328; max-width: 46rem; margin: 2rem auto; padding: 0 1.25rem; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 .6em; }
h1 { font-size: 2em; border-bottom: 1px solid #d8dee4; padding-bottom: .3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #d8dee4; padding-bottom: .3em; }
a { color: #0969da; }
code { font: .9em ui-monospace, "Cascadia Code", Consolas, monospace; background: #eff1f3; padding: .15em .35em; border-radius: 4px; }
pre { background: #f6f8fa; padding: .9rem 1rem; border-radius: 6px; overflow: auto; }
pre code { background: none; padding: 0; }
blockquote { margin: 1em 0; padding: 0 1em; color: #59636e; border-left: 4px solid #d1d9e0; }
table { border-collapse: collapse; }
th, td { border: 1px solid #d1d9e0; padding: .4em .8em; }
th { background: #f6f8fa; }
img { max-width: 100%; }
hr { border: 0; border-top: 1px solid #d8dee4; margin: 2em 0; }
li.task, li:has(> input[type=checkbox]) { list-style: none; margin-left: -1.2em; }
@media print { body { margin: 0; max-width: none; } pre, blockquote, table, img { break-inside: avoid; } }
`;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Impressão sem o cabeçalho e o rodapé do navegador (título e endereço, "tauri.localhost 6/13"): eles
 * ficam na margem da página, então com `@page { margin: 0 }` somem. As margens de verdade vêm de uma
 * tabela com espaçadores no topo e no pé (que se repetem em cada página), e o rodapé é nosso.
 */
const PRINT_STYLE = `
@page { margin: 0; }
body { margin: 0; max-width: none; padding: 0 20mm; }
table.pg { width: 100%; border-collapse: collapse; }
table.pg > thead > tr > td, table.pg > tbody > tr > td, table.pg > tfoot > tr > td { border: 0; padding: 0; background: none; }
.pg-space { height: 18mm; }
.pg-foot { position: fixed; left: 0; right: 0; bottom: 7mm; text-align: center; font-size: 9pt; color: #59636e; }
`;

function printLayout(body: string): string {
  return `<table class="pg"><thead><tr><td><div class="pg-space"></div></td></tr></thead><tbody><tr><td>
${body}
</td></tr></tbody><tfoot><tr><td><div class="pg-space"></div></td></tr></tfoot></table>
<div class="pg-foot">Fullpad</div>`;
}

/** Só o corpo: o markdown convertido em HTML. */
export async function markdownToBody(text: string): Promise<string> {
  const { marked } = await import("marked");
  return marked.parse(text, { gfm: true, async: false }) as string;
}

/** Documento HTML completo e autônomo (estilo embutido, sem dependências externas). */
export async function markdownToHtml(text: string, title: string, forPrint = false): Promise<string> {
  const body = forPrint ? printLayout(await markdownToBody(text)) : await markdownToBody(text);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}${forPrint ? PRINT_STYLE : ""}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/** Copia o markdown renderizado: quem cola num e-mail ou documento recebe o texto formatado. */
export async function copyAsHtml(text: string): Promise<void> {
  const html = await markdownToBody(text);
  const item = new ClipboardItem({
    "text/html": new Blob([html], { type: "text/html" }),
    "text/plain": new Blob([text], { type: "text/plain" }),
  });
  await navigator.clipboard.write([item]);
}

/** Abre a impressão do sistema com o documento renderizado (de lá dá para "Salvar como PDF"). */
export async function printAsPdf(text: string, title: string): Promise<void> {
  const html = await markdownToHtml(text, title, true);
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const done = () => setTimeout(() => frame.remove(), 1000);
  frame.addEventListener(
    "load",
    () => {
      const w = frame.contentWindow;
      if (!w) return done();
      w.addEventListener("afterprint", done);
      w.focus();
      w.print();
    },
    { once: true },
  );
  frame.srcdoc = html;
}
