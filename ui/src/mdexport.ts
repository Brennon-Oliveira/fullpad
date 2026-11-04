/**
 * Exportação do markdown: HTML autônomo (com estilo próprio), cópia como HTML e PDF pela impressão.
 * O `marked` só carrega quando o usuário exporta: não pesa na abertura do app.
 */

import { type MathOutput, loadMath, mathStyles, renderMathSync } from "./latex/render";
import { MASK, matchMath, maskInlineCode } from "./latex/scan";
import { isMermaidInfo } from "./mermaid/render";

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
figure.mermaid { margin: 1em 0; text-align: center; }
figure.mermaid svg { max-width: 100%; height: auto; }
figure.math, .math-display { margin: 1em 0; text-align: center; overflow-x: auto; }
pre.math-error { color: #cf222e; }
hr { border: 0; border-top: 1px solid #d8dee4; margin: 2em 0; }
li.task, li:has(> input[type=checkbox]) { list-style: none; margin-left: -1.2em; }
@media print { body { margin: 0; max-width: none; } pre, blockquote, table, img, figure.mermaid, .math-display { break-inside: avoid; } }
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

/** `$...$` e `$$...$$` no `marked`: mesmas regras do editor (`latex/scan.ts`), desenhadas pelo KaTeX já carregado. */
function mathExtension(output: MathOutput) {
  const fail = (tex: string, display: boolean) =>
    display ? `<pre class="math-error"><code>${escapeHtml(tex)}</code></pre>\n` : `<code class="math-error">${escapeHtml(tex)}</code>`;
  const draw = (tex: string, display: boolean) => {
    const r = renderMathSync(tex, display, output);
    return r?.ok ? r.html : null;
  };
  return {
    extensions: [
      {
        name: "mathBlock",
        level: "block" as const,
        start: (src: string) => {
          const m = /(^|\n)[ \t]*\$\$/.exec(src);
          return m ? m.index + m[1]!.length : undefined;
        },
        tokenizer(src: string) {
          const lead = /^[ \t]*/.exec(src)![0].length;
          if (!src.startsWith("$$", lead)) return undefined;
          const m = matchMath(src, lead);
          const rest = m?.display ? /^[ \t]*(?:\n|$)/.exec(src.slice(m.end)) : null;
          if (!m || !rest) return undefined; // `$$` no meio de uma linha com texto é equação em linha
          return { type: "mathBlock", raw: src.slice(0, m.end + rest[0].length), tex: m.tex.trim() };
        },
        renderer(t: { tex?: string }) {
          const tex = t.tex ?? "";
          const html = draw(tex, true);
          return html ? `<div class="math-display">${html}</div>\n` : fail(tex, true);
        },
      },
      {
        name: "mathInline",
        level: "inline" as const,
        start: (src: string) => {
          const i = src.indexOf("$");
          return i < 0 ? undefined : i;
        },
        tokenizer(src: string) {
          const m = src[0] === "$" ? matchMath(maskInlineCode(src), 0) : null; // o `$` de um código não fecha equação
          return m && !m.tex.includes(MASK) ? { type: "mathInline", raw: src.slice(0, m.end), tex: m.tex.trim(), display: m.display } : undefined;
        },
        renderer(t: { tex?: string; display?: boolean }) {
          const tex = t.tex ?? "";
          return draw(tex, !!t.display) ?? fail(tex, false);
        },
      },
    ],
  };
}

/**
 * Só o corpo: o markdown convertido em HTML. Blocos ```mermaid saem como diagrama (SVG embutido, tema
 * claro, que é o do papel e do HTML autônomo); se um deles tem erro, fica como bloco de código.
 * `$...$` e `$$...$$` saem como equação: `htmlAndMathml` (precisa do CSS do KaTeX, ver `markdownToHtml`)
 * ou só `mathml` (para colar em outro programa, sem CSS nem fontes). Equação com erro fica como texto.
 */
export async function markdownToBody(text: string, mathOutput: MathOutput = "htmlAndMathml"): Promise<string> {
  const { Marked } = await import("marked");
  const md = new Marked({ gfm: true });
  if (text.includes("$")) {
    await loadMath();
    md.use(mathExtension(mathOutput));
  }
  const tokens = md.lexer(text);
  const diagrams: { lang?: string; text: string; type: string; raw: string }[] = [];
  md.walkTokens(tokens, (t) => {
    if (t.type === "code" && isMermaidInfo(String((t as { lang?: string }).lang ?? ""))) diagrams.push(t as never);
  });
  if (diagrams.length > 0) {
    const { renderMermaid } = await import("./mermaid/render");
    for (const d of diagrams) {
      const r = await renderMermaid(d.text, false);
      if (!r.ok) continue;
      Object.assign(d, { type: "html", text: `<figure class="mermaid">${r.svg}</figure>\n`, block: true });
    }
  }
  return md.parser(tokens) as string;
}

/** Documento HTML completo e autônomo (estilo embutido, sem dependências externas). */
export async function markdownToHtml(text: string, title: string, forPrint = false): Promise<string> {
  const content = await markdownToBody(text);
  const body = forPrint ? printLayout(content) : content;
  const math = content.includes('class="katex') ? await mathStyles() : ""; // CSS e fontes do KaTeX vão junto
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}${forPrint ? PRINT_STYLE : ""}</style>${math ? `\n<style>${math}</style>` : ""}
</head>
<body>
${body}
</body>
</html>
`;
}

/** Copia o markdown renderizado: quem cola num e-mail ou documento recebe o texto formatado. */
export async function copyAsHtml(text: string): Promise<void> {
  const html = await markdownToBody(text, "mathml"); // sem CSS nem fontes: quem cola não os tem
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
