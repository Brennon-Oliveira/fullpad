import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { attachViewport } from "../dbml/viewport";
import { MAX_MERMAID_CHARS, renderMermaid } from "./render";

const DEBOUNCE_MS = 300;
const NS = "http://www.w3.org/2000/svg";

function div(cls: string, text = ""): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = text;
  return d;
}

export interface MermaidHooks {
  /** O app está no tema escuro? Perguntado a cada desenho: mudar o tema redesenha o diagrama. */
  isDark?(): boolean;
}

/** Largura e altura do diagrama pelo `viewBox` (o Mermaid põe `width="100%"` e um `max-width`). */
export function svgSize(svg: Element): { w: number; h: number } {
  const vb = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0) return { w: vb[2]!, h: vb[3]! };
  const w = parseFloat(svg.getAttribute("width") ?? "");
  const h = parseFloat(svg.getAttribute("height") ?? "");
  return { w: w > 0 ? w : 800, h: h > 0 ? h : 600 };
}

/**
 * Painel do diagrama Mermaid ao lado do código (arquivos `.mmd`/`.mermaid`): mesmo contrato do painel do
 * DBML (`show`/`update`/`setCursor`/`hide`) e o mesmo pan/zoom (`dbml/viewport.ts`). O desenho vem de
 * `renderMermaid`, que carrega a biblioteca só na primeira vez. O diagrama não guarda de onde cada
 * elemento veio no texto, então não há ligação cursor ↔ elemento (`setCursor` não faz nada).
 */
export function createMermaidPanel(host: HTMLElement, hooks: MermaidHooks = {}) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "dbml-svg");
  const g = document.createElementNS(NS, "g");
  svg.append(g);
  const viewport = attachViewport(svg, g);
  const message = div("dbml-msg");
  const error = div("dbml-error");
  error.hidden = true;
  const tools = div("dbml-tools");
  const tool = (label: string, title: string, run: () => void) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", run);
    tools.append(b);
  };
  host.replaceChildren(svg, message, error, tools);

  let size: { w: number; h: number } | null = null;
  let source: string | null = null; // SVG que está na tela (para exportar)
  let lastText: string | null = null;
  let renderedText: string | null = null;
  let renderedDark: boolean | null = null;
  let seq = 0;
  let fitNext = true;
  let timer: number | undefined;

  const dark = () => !!hooks.isDark?.();
  const fit = () => size && viewport.fit(size.w, size.h);
  svg.addEventListener("dblclick", fit);

  async function exportSvg() {
    if (!source) return;
    try {
      const path = await saveDialog({ defaultPath: "diagrama.svg", filters: [{ name: "SVG", extensions: ["svg"] }] });
      if (!path) return;
      await api.exportFile(path, Array.from(new TextEncoder().encode(source)));
    } catch (e) {
      error.hidden = false;
      error.textContent = `Não foi possível exportar: ${e}`;
    }
  }
  tool("Ajustar", "Ajustar à tela (ou duplo clique)", fit);
  tool("SVG", "Exportar como SVG", () => void exportSvg());

  async function render(text: string) {
    const my = ++seq;
    if (!text.trim()) {
      g.replaceChildren();
      size = null;
      source = null;
      error.hidden = true;
      message.textContent = "Nenhum diagrama. Escreva, por exemplo: flowchart LR\n  A --> B";
      renderedText = text;
      renderedDark = dark();
      return;
    }
    if (text.length > MAX_MERMAID_CHARS) {
      message.textContent = "Diagrama grande demais para desenhar. O texto continua normal.";
      return;
    }
    if (!renderedText) message.textContent = "Carregando diagrama…";
    const wantDark = dark();
    const res = await renderMermaid(text, wantDark);
    if (my !== seq) return; // chegou texto mais novo
    if (!res.ok) {
      error.hidden = false;
      error.textContent = res.error;
      if (!renderedText) message.textContent = ""; // sem diagrama antigo para manter
      return; // mantém o último diagrama válido
    }
    error.hidden = true;
    message.textContent = "";
    const tpl = document.createElement("template");
    tpl.innerHTML = res.svg;
    const root = tpl.content.querySelector("svg");
    if (!root) return;
    size = svgSize(root);
    root.setAttribute("width", String(size.w));
    root.setAttribute("height", String(size.h));
    root.removeAttribute("style"); // o `max-width` do Mermaid encolheria o desenho dentro do zoom
    g.replaceChildren(root);
    source = res.svg;
    renderedText = text;
    renderedDark = wantDark;
    if (fitNext) {
      fitNext = false;
      fit();
    }
  }

  const stale = (text: string) => text !== renderedText || renderedDark !== dark();

  return {
    /** Mostra o painel e desenha já (troca de aba, ligar a visão). `resetView` reenquadra. */
    show(text: string, resetView: boolean, _rev = 0) {
      host.classList.add("on");
      if (resetView) fitNext = true;
      if (text === lastText && !resetView && !stale(text)) return;
      lastText = text;
      window.clearTimeout(timer);
      void render(text);
    },
    /** Texto mudou: desenha com debounce. Tema mudou com o mesmo texto: desenha já. */
    update(text: string, _rev = 0) {
      if (text === lastText && !stale(text)) return;
      const themeOnly = text === lastText;
      lastText = text;
      window.clearTimeout(timer);
      if (themeOnly) void render(text);
      else timer = window.setTimeout(() => void render(text), DEBOUNCE_MS);
    },
    /** Sem ligação entre o cursor e os elementos do diagrama (ver o comentário acima). */
    setCursor(_offset: number | null, _rev: number) {},
    hide() {
      window.clearTimeout(timer);
      seq++; // descarta um desenho em andamento
      renderedText = null;
      renderedDark = null;
      lastText = null;
      host.classList.remove("on");
    },
  };
}

export type MermaidPanel = ReturnType<typeof createMermaidPanel>;
