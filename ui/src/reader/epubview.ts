// Visão de um EPUB: sumário ao lado e o capítulo num <iframe> sem scripts. O Rust entrega o
// capítulo já limpo (`epub_chapter`); aqui só se monta a tela. Só entra ao clicar em "Carregar".
//
// O iframe tem `sandbox="allow-same-origin"` (e nunca `allow-scripts`): nenhum script do livro
// roda, mesmo que algo escapasse da limpeza, e a CSP do documento corta a rede. O mesmo domínio
// serve só para o app escutar cliques, rolagem e teclas lá dentro.

import { type EpubInfo, api } from "../api";
import { type EpubLink, type Theme, appCss, attachFrameHandlers, buildDocument, errorDocument, fragmentToText } from "./epubdoc";
import { chapterLabel } from "./quote";
import { type ReaderPos, clamp, wheelFactor } from "./pos";
import type { ReaderView, ViewHooks } from "./view";

const MIN_TEXT_ZOOM = 0.6;
const MAX_TEXT_ZOOM = 3;

const cssVar = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function theme(scale: number): Theme {
  const dark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  return {
    dark,
    bg: cssVar("--bg", dark ? "#1e1f22" : "#ffffff"),
    fg: cssVar("--fg", dark ? "#dcddde" : "#1f2328"),
    muted: cssVar("--muted", "#888888"),
    accent: cssVar("--accent", dark ? "#6ea8fe" : "#2563eb"),
    border: cssVar("--border", dark ? "#34363b" : "#d1d5db"),
    scale,
  };
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export async function openEpubView(host: HTMLElement, id: string, pos: ReaderPos, hooks: ViewHooks): Promise<ReaderView> {
  const info: EpubInfo = await api.epubOpen(id); // erro: o Rust já devolve a mensagem em português
  const total = info.chapters.length;

  // ---- tela ----
  const root = el("div", "rd-epub");
  const toc = el("aside", "rd-toc");
  toc.hidden = host.clientWidth > 0 && host.clientWidth < 720;
  const main = el("div", "rd-epub-main");
  const bar = el("div", "rd-epub-bar");
  const frame = el("iframe", "rd-epub-frame");
  frame.setAttribute("sandbox", "allow-same-origin"); // sem allow-scripts: nada do livro executa
  frame.title = info.title;

  const tool = (label: string, title: string, run: () => void) => {
    const b = el("button", "rd-tool", label);
    b.title = title;
    b.addEventListener("click", run);
    return b;
  };
  const chapterTitle = el("span", "rd-epub-title", info.title);
  bar.append(
    tool("☰", "Mostrar ou esconder o sumário", () => (toc.hidden = !toc.hidden)),
    tool("◀", "Capítulo anterior", () => void go(cur - 1)),
    tool("▶", "Próximo capítulo", () => void go(cur + 1)),
    chapterTitle,
  );
  main.append(bar, frame);
  root.append(toc, main);
  host.replaceChildren(root);

  // ---- estado ----
  let disposed = false;
  let cur = clamp(pos.page - 1, 0, total - 1);
  let zoom = pos.zoom;
  let token = 0;
  let posTimer = 0;
  let detach: (() => void) | null = null;
  const scale = () => zoom ?? 1;
  const doc = () => frame.contentDocument;

  // sumário: as entradas do livro; sem sumário, os capítulos
  const entries = info.toc.length > 0 ? info.toc : info.chapters.map((label, i) => ({ label, spine: i, fragment: null, depth: 0 }));
  const items = entries.map((t) => {
    const b = el("button", "rd-toc-item", t.label || "(sem título)");
    b.style.paddingLeft = `${12 + t.depth * 14}px`;
    b.title = t.label;
    if (t.spine === null) b.disabled = true;
    else b.addEventListener("click", () => void go(t.spine!, 0, t.fragment));
    toc.append(b);
    return { b, spine: t.spine };
  });

  function currentFrac(): number {
    const d = doc()?.documentElement;
    const max = d ? d.scrollHeight - d.clientHeight : 0;
    return d && max > 0 ? clamp(d.scrollTop / max, 0, 1) : 0;
  }

  function position(): ReaderPos {
    return { page: cur + 1, frac: currentFrac(), zoom };
  }

  function report() {
    hooks.onView(cur + 1, total, scale(), false);
    window.clearTimeout(posTimer);
    posTimer = window.setTimeout(() => !disposed && hooks.onPosition(position()), 300);
  }

  function markCurrent() {
    chapterTitle.textContent = info.chapters[cur] || info.title;
    let marked = false;
    for (const it of items) {
      const on: boolean = !marked && it.spine === cur;
      marked = marked || on;
      it.b.setAttribute("aria-current", on ? "true" : "false");
    }
  }

  function restyle() {
    const style = doc()?.getElementById("fp-app");
    if (style) style.textContent = `@layer app{${appCss(theme(scale()))}}`;
  }

  function handle(l: EpubLink) {
    if (l.kind === "chapter") void go(l.index, 0, l.fragment);
    else if (l.kind === "step") void go(cur + l.delta);
    else if (l.kind === "anchor") doc()?.getElementById(l.id)?.scrollIntoView();
    else void api.openUrl(l.url).catch((e) => console.error("não abriu o link", e));
  }

  /** Teclas apertadas dentro do documento valem como da janela (atalhos, zoom), e o que o app trata não rola. */
  function forwardKey(e: KeyboardEvent) {
    if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === "KeyC") {
      e.preventDefault();
      hooks.onQuote?.(); // o painel não ouve teclas de dentro do iframe
      return;
    }
    const copy = new KeyboardEvent("keydown", { key: e.key, code: e.code, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, bubbles: true, cancelable: true });
    window.dispatchEvent(copy);
    if (copy.defaultPrevented) e.preventDefault();
  }

  /** Vai ao capítulo `index` (posição na ordem de leitura), na fração `frac` ou no fragmento. */
  async function go(index: number, frac = 0, fragment: string | null = null) {
    if (index < 0 || index >= total || disposed) return;
    const my = ++token;
    let html: string;
    try {
      const chapter = await api.epubChapter(id, index);
      if (my !== token || disposed) return;
      html = buildDocument(chapter, theme(scale()), { prev: index > 0, next: index < total - 1 });
    } catch (e) {
      if (my !== token || disposed) return;
      html = errorDocument(typeof e === "string" ? e : "Não foi possível abrir este capítulo.", theme(scale()));
    }
    cur = index;
    markCurrent();
    detach?.();
    detach = null;
    frame.onload = () => {
      const d = doc();
      if (!d || my !== token || disposed) return;
      detach = attachFrameHandlers(d, {
        link: handle,
        zoomWheel: (dy) => setZoom(clamp(scale() * wheelFactor(dy), MIN_TEXT_ZOOM, MAX_TEXT_ZOOM)),
        key: forwardKey,
        focus: () => frame.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })), // o painel vira o atual
        scrolled: report,
        context: (x, y) => {
          const r = frame.getBoundingClientRect();
          hooks.onContextMenu?.(r.left + x, r.top + y);
        },
      });
      const target = fragment ? d.getElementById(fragment) : null;
      if (target) target.scrollIntoView();
      else d.documentElement.scrollTop = frac * Math.max(0, d.documentElement.scrollHeight - d.documentElement.clientHeight);
      report();
    };
    frame.srcdoc = html;
    report();
  }

  function setZoom(z: number | null) {
    zoom = z === null ? null : clamp(z, MIN_TEXT_ZOOM, MAX_TEXT_ZOOM);
    restyle();
    report();
  }

  // o tema do sistema mudou: refaz as cores sem recarregar o capítulo
  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const onTheme = () => restyle();
  mq?.addEventListener?.("change", onTheme);

  markCurrent();
  void go(cur, pos.frac);

  return {
    pages: total,
    setZoom,
    zoomBy: (factor) => setZoom(clamp(scale() * factor, MIN_TEXT_ZOOM, MAX_TEXT_ZOOM)),
    goTo: (page, frac = 0) => void go(Math.floor(page) - 1, frac),
    position,
    resize() {},
    selection() {
      const d = doc();
      const sel = d?.getSelection();
      if (!d || !sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
      const text = fragmentToText(sel.getRangeAt(0).cloneContents());
      return text ? { text, source: info.title, where: chapterLabel(cur, info.chapters[cur] ?? "") } : null;
    },
    copySelection() {
      doc()?.execCommand("copy");
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      token++;
      window.clearTimeout(posTimer);
      mq?.removeEventListener?.("change", onTheme);
      detach?.();
      frame.onload = null;
      frame.srcdoc = "";
      host.replaceChildren();
    },
  };
}
