// O documento que vai no <iframe> do EPUB e o tratamento dos cliques dentro dele. Sem o iframe em si
// (isso é `epubview.ts`): só funções que dá para testar.

export interface Theme {
  dark: boolean;
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  border: string;
  /** 1 = tamanho normal do texto. */
  scale: number;
}

export interface BookChapter {
  /** HTML já limpo pelo Rust (sem scripts, só imagens do próprio livro). */
  html: string;
  /** CSS do livro já filtrado pelo Rust. */
  css: string;
}

export const BASE_FONT_PX = 18;

/**
 * CSS do app: vem DEPOIS do livro (`@layer`), então o tema do Fullpad ganha. No tema escuro as
 * cores do livro são trocadas pelas do tema (o texto escuro de um livro feito para papel ficaria
 * ilegível); no claro o livro mantém as dele.
 */
export function appCss(t: Theme): string {
  // `body *`, não `*`: o html e o body precisam manter o fundo e a cor do tema (com `*` o fundo ficava
  // transparente e a página branca); os de dentro herdam deles. Links ficam de fora (têm a cor de destaque).
  const dark = t.dark
    ? `body *:not(a){color:inherit !important;background-color:transparent !important;border-color:${t.border} !important}`
    : "";
  return `html{background:${t.bg};color:${t.fg}}
body{margin:0 auto;padding:28px 28px 40px;max-width:46em;font:${(BASE_FONT_PX * t.scale).toFixed(2)}px/1.65 Georgia,"Noto Serif","Times New Roman",serif;background:${t.bg};color:${t.fg};overflow-wrap:break-word}
a{color:${t.accent}}
a:not([href]){color:inherit;text-decoration:none}
img:not([src]){display:none}
img,svg,video{max-width:100%;height:auto}
table{max-width:100%}
pre{white-space:pre-wrap}
h1,h2,h3,h4{line-height:1.25}
${dark}
.fp-nav{display:flex;justify-content:space-between;gap:16px;margin:48px 0 0;padding-top:16px;border-top:1px solid ${t.border};font:14px system-ui,"Segoe UI",sans-serif}
.fp-nav a{text-decoration:none;color:${t.accent} !important}
.fp-error{color:${t.muted};text-align:center;margin-top:20%}
::selection{background:${t.accent};color:#fff}
::highlight(fp-find){background:#ffe066;color:#000}
::highlight(fp-find-current){background:#ff9632;color:#000}`;
}

/**
 * Política do documento: nada de rede (`default-src 'none'`), imagens só `data:` (as que o Rust leu do
 * próprio livro) e estilo embutido. Vale além do `sandbox` do iframe, que já impede scripts.
 */
export const CSP = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** O `<nav>` do fim do capítulo (os links são `epub:` e o `epubview` os trata). */
function navHtml(prev: boolean, next: boolean): string {
  if (!prev && !next) return "";
  return `<nav class="fp-nav">${prev ? '<a href="epub:prev">← Capítulo anterior</a>' : "<span></span>"}${next ? '<a href="epub:next">Próximo capítulo →</a>' : "<span></span>"}</nav>`;
}

/**
 * Documento completo do capítulo. O CSS do livro vai numa camada `book` e o do app numa camada `app`
 * declarada depois, que vence. O texto que o Rust devolveu já é seguro; aqui só se monta a moldura.
 */
export function buildDocument(ch: BookChapter, theme: Theme, nav: { prev: boolean; next: boolean }): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${esc(CSP)}"><style>@layer book,app;</style><style>@layer book{${ch.css}}</style><style id="fp-app">@layer app{${appCss(theme)}}</style></head><body>${ch.html}${navHtml(nav.prev, nav.next)}</body></html>`;
}

/** Documento de erro (capítulo que não abriu). */
export function errorDocument(message: string, theme: Theme): string {
  return buildDocument({ html: `<p class="fp-error">${esc(message)}</p>`, css: "" }, theme, { prev: false, next: false });
}

export type EpubLink = { kind: "chapter"; index: number; fragment: string | null } | { kind: "step"; delta: 1 | -1 } | { kind: "anchor"; id: string } | { kind: "external"; url: string };

/** O que um link do capítulo pede (`null`: nada a fazer, como `javascript:` que nunca devia estar ali). */
export function parseEpubLink(href: string): EpubLink | null {
  const h = href.trim();
  if (h === "epub:next") return { kind: "step", delta: 1 };
  if (h === "epub:prev") return { kind: "step", delta: -1 };
  const m = /^epub:(\d{1,6})(?:#(.*))?$/.exec(h);
  if (m) return { kind: "chapter", index: Number(m[1]), fragment: m[2] ? safeDecode(m[2]) : null };
  if (h.startsWith("#")) return h.length > 1 ? { kind: "anchor", id: safeDecode(h.slice(1)) } : null;
  if (/^(https?:|mailto:)/i.test(h)) return { kind: "external", url: h };
  return null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export interface FrameHandlers {
  link(l: EpubLink): void;
  /** Ctrl + roda: zoom do texto. */
  zoomWheel(deltaY: number): void;
  /** Tecla apertada dentro do documento: o app a trata como se fosse da janela (atalhos, zoom). */
  key(e: KeyboardEvent): void;
  /** Clicou ou focou dentro do documento (o painel passa a ser o atual). */
  focus(): void;
  scrolled(): void;
  /** Botão direito (`x`, `y` em coordenadas do documento do iframe). */
  context(x: number, y: number): void;
}

const BLOCKS = new Set(["P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "TR", "TABLE", "SECTION", "ARTICLE", "FIGURE", "FIGCAPTION", "DT", "DD", "HR"]);

/**
 * Texto de uma seleção com os parágrafos preservados: o `toString()` da seleção junta blocos com
 * uma quebra só, e a citação precisa distinguir parágrafo (linha em branco) de quebra de linha.
 */
export function fragmentToText(node: Node): string {
  let out = "";
  const walk = (n: Node) => {
    if (n.nodeType === 3) out += n.nodeValue ?? "";
    else if (n.nodeType === 1) {
      const el = n as Element;
      if (el.tagName === "BR") out += "\n";
      else if (BLOCKS.has(el.tagName)) {
        out += "\n\n";
        el.childNodes.forEach(walk);
        out += "\n\n";
      } else el.childNodes.forEach(walk);
    } else n.childNodes.forEach(walk);
  };
  walk(node);
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Liga os eventos do documento do iframe (o iframe é do mesmo domínio, mas sem scripts: quem
 * escuta é o app). Cliques em links nunca navegam o iframe: viram um pedido ao app.
 */
export function attachFrameHandlers(doc: Document, h: FrameHandlers): () => void {
  const win = doc.defaultView;
  const click = (e: Event) => {
    const a = (e.target as Element | null)?.closest?.("a");
    if (!a) return;
    e.preventDefault();
    const link = parseEpubLink(a.getAttribute("href") ?? "");
    if (link) h.link(link);
  };
  const wheel = (e: Event) => {
    const w = e as WheelEvent;
    if (!w.ctrlKey) return;
    e.preventDefault();
    h.zoomWheel(w.deltaY);
  };
  const key = (e: Event) => h.key(e as KeyboardEvent);
  const focus = () => h.focus();
  const scroll = () => h.scrolled();
  const context = (e: Event) => {
    e.preventDefault();
    const m = e as MouseEvent;
    h.context(m.clientX, m.clientY);
  };
  doc.addEventListener("contextmenu", context);
  doc.addEventListener("click", click);
  doc.addEventListener("wheel", wheel, { passive: false });
  doc.addEventListener("keydown", key);
  doc.addEventListener("pointerdown", focus, true);
  win?.addEventListener("scroll", scroll, { passive: true });
  // formulários e arrastar não existem no documento limpo, mas por garantia nada navega
  const stop = (e: Event) => e.preventDefault();
  doc.addEventListener("submit", stop);
  doc.addEventListener("dragstart", stop);
  return () => {
    doc.removeEventListener("click", click);
    doc.removeEventListener("wheel", wheel);
    doc.removeEventListener("keydown", key);
    doc.removeEventListener("pointerdown", focus, true);
    win?.removeEventListener("scroll", scroll);
    doc.removeEventListener("contextmenu", context);
    doc.removeEventListener("submit", stop);
    doc.removeEventListener("dragstart", stop);
  };
}
