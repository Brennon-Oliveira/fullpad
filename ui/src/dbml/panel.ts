import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { buildSvg, svgToPng } from "./export";
import { type DagreLike, type Layout, layoutDiagram } from "./layout";
import { type Interpreter, type Span, parseDbml } from "./model";
import { loadDbmlService } from "./service";
import { type Rendered, renderDiagram } from "./render";
import { attachViewport } from "./viewport";

/** Acima disso o diagrama desliga para não pesar. */
export const MAX_DIAGRAM_CHARS = 500_000;

const DEBOUNCE_MS = 300;
const NS = "http://www.w3.org/2000/svg";

interface Libs {
  interpret: Interpreter;
  dagre: DagreLike;
}

// O parser vem do serviço compartilhado (service.ts); o dagre só serve ao diagrama e carrega aqui.
let libsPromise: Promise<Libs> | undefined;
function loadLibs(): Promise<Libs> {
  libsPromise ??= Promise.all([loadDbmlService(), import("@dagrejs/dagre")]).then(([svc, d]) => {
    const mod = d as unknown as { default?: DagreLike; layout?: unknown };
    const dagre = (typeof mod.layout === "function" ? mod : mod.default) as DagreLike;
    return { interpret: svc.interpret, dagre };
  });
  libsPromise.catch(() => (libsPromise = undefined)); // permite tentar de novo
  return libsPromise;
}

function div(cls: string, text = ""): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = text;
  return d;
}

export interface PanelHooks {
  /**
   * Mouse sobre um elemento do diagrama. `rev` diz de qual versão do texto vêm os trechos; quem
   * recebe só deve usá-los se o texto ainda for essa versão (senão apontariam para o lugar errado).
   */
  onHover?(spans: Span[] | null, rev: number): void;
}

export function createDiagramPanel(host: HTMLElement, hooks: PanelHooks = {}) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "dbml-svg");
  const g = document.createElementNS(NS, "g");
  svg.append(g);
  const viewport = attachViewport(svg, g);
  const message = div("dbml-msg"); // vazio / carregando
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

  let layout: Layout | null = null;
  let lastText: string | null = null;
  let renderedText: string | null = null; // texto do diagrama que está na tela
  let latestRev = 0;
  let renderedRev = -1; // versão do texto a que o diagrama na tela corresponde
  let rendered: Rendered | null = null;
  let cursor: { offset: number | null; rev: number } = { offset: null, rev: -1 };
  let seq = 0;
  let fitNext = true;
  let timer: number | undefined;

  const fit = () => layout && viewport.fit(layout.width, layout.height);
  svg.addEventListener("dblclick", fit);

  async function exportAs(kind: "svg" | "png") {
    if (!layout) return;
    try {
      const path = await saveDialog({
        defaultPath: `diagrama.${kind}`,
        filters: [{ name: kind === "svg" ? "SVG" : "PNG", extensions: [kind] }],
      });
      if (!path) return;
      const { svg: text, width, height } = buildSvg(g, layout, getComputedStyle(host).backgroundColor);
      const bytes = kind === "svg" ? new TextEncoder().encode(text) : await svgToPng(text, width, height);
      await api.exportFile(path, Array.from(bytes));
    } catch (e) {
      error.hidden = false;
      error.textContent = `Não foi possível exportar: ${e}`;
    }
  }
  tool("Ajustar", "Ajustar à tela (ou duplo clique)", fit);
  tool("SVG", "Exportar como SVG", () => void exportAs("svg"));
  tool("PNG", "Exportar como PNG", () => void exportAs("png"));

  /** Destaca o que está sob o cursor do editor, se o diagrama ainda corresponde ao texto dele. */
  function applyFocus(reveal: boolean) {
    if (!rendered) return;
    const live = cursor.offset !== null && cursor.rev === renderedRev;
    const box = rendered.focusAt(live ? cursor.offset : null);
    if (box && reveal) viewport.reveal(box);
  }

  async function render(text: string) {
    const my = ++seq;
    if (!libsPromise) message.textContent = "Carregando diagrama…";
    let libs: Libs;
    try {
      libs = await loadLibs();
    } catch (e) {
      message.textContent = `Não foi possível carregar o diagrama: ${e}`;
      return;
    }
    if (my !== seq) return; // chegou texto mais novo
    const res = parseDbml(libs.interpret, text);
    if (res.error) {
      error.hidden = false;
      error.textContent = `Linha ${res.error.line}, col. ${res.error.column}: ${res.error.message}`;
      return; // mantém o último diagrama válido
    }
    error.hidden = true;
    const d = res.diagram;
    if (d.tables.length === 0) {
      layout = null;
      rendered = null;
      g.replaceChildren();
      message.textContent = "Nenhuma tabela. Escreva, por exemplo: Table usuarios { id int [pk] }";
      return;
    }
    message.textContent = "";
    layout = layoutDiagram(d, libs.dagre);
    rendered = renderDiagram(d, layout, g, { onHover: (spans) => hooks.onHover?.(spans, renderedRev) });
    renderedText = text;
    if (lastText === text) renderedRev = latestRev;
    applyFocus(false);
    if (fitNext) {
      fitNext = false;
      fit();
    }
  }

  return {
    /** Mostra o painel e renderiza já (troca de aba, ligar o preview). `resetView` reenquadra. */
    show(text: string, resetView: boolean, rev = 0) {
      host.classList.add("on");
      latestRev = rev;
      if (resetView) fitNext = true;
      if (text === lastText && !resetView) {
        if (renderedText === text) renderedRev = rev;
        return;
      }
      lastText = text;
      window.clearTimeout(timer);
      void render(text);
    },
    /** Texto mudou: renderiza com debounce. */
    update(text: string, rev = 0) {
      latestRev = rev;
      if (text === lastText) {
        if (renderedText === text) renderedRev = rev;
        return;
      }
      lastText = text;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void render(text), DEBOUNCE_MS);
    },
    /** O cursor do editor está em `offset` (versão `rev` do texto): destaca o elemento correspondente. */
    setCursor(offset: number | null, rev: number) {
      cursor = { offset, rev };
      applyFocus(true);
    },
    hide() {
      window.clearTimeout(timer);
      renderedText = null;
      renderedRev = -1;
      lastText = null; // o texto pode mudar enquanto escondido: força renderizar ao reabrir
      host.classList.remove("on");
    },
  };
}

export type DiagramPanel = ReturnType<typeof createDiagramPanel>;
