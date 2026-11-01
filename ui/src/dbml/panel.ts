import { type DagreLike, type Layout, layoutDiagram } from "./layout";
import { type CompilerLike, parseDbml } from "./model";
import { renderDiagram } from "./render";
import { attachViewport } from "./viewport";

/** Acima disso o diagrama desliga para não pesar. */
export const MAX_DIAGRAM_CHARS = 500_000;

const DEBOUNCE_MS = 300;
const NS = "http://www.w3.org/2000/svg";

interface Libs {
  Compiler: new () => CompilerLike;
  dagre: DagreLike;
}

// Carga sob demanda: nada disso entra no bundle de abertura do app.
let libsPromise: Promise<Libs> | undefined;
function loadLibs(): Promise<Libs> {
  libsPromise ??= Promise.all([import("@dbml/parse"), import("@dagrejs/dagre")]).then(([p, d]) => {
    const mod = d as unknown as { default?: DagreLike; layout?: unknown };
    const dagre = (typeof mod.layout === "function" ? mod : mod.default) as DagreLike;
    return { Compiler: p.Compiler as Libs["Compiler"], dagre };
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

export function createDiagramPanel(host: HTMLElement) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "dbml-svg");
  const g = document.createElementNS(NS, "g");
  svg.append(g);
  const viewport = attachViewport(svg, g);
  const message = div("dbml-msg"); // vazio / carregando
  const error = div("dbml-error");
  error.hidden = true;
  const fitBtn = document.createElement("button");
  fitBtn.className = "dbml-fit";
  fitBtn.textContent = "Ajustar";
  fitBtn.title = "Ajustar à tela";
  host.replaceChildren(svg, message, error, fitBtn);

  let layout: Layout | null = null;
  let lastText: string | null = null;
  let seq = 0;
  let fitNext = true;
  let timer: number | undefined;

  const fit = () => layout && viewport.fit(layout.width, layout.height);
  fitBtn.addEventListener("click", fit);
  svg.addEventListener("dblclick", fit);

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
    const res = parseDbml(libs.Compiler, text);
    if (res.error) {
      error.hidden = false;
      error.textContent = `Linha ${res.error.line}, col. ${res.error.column}: ${res.error.message}`;
      return; // mantém o último diagrama válido
    }
    error.hidden = true;
    const d = res.diagram;
    if (d.tables.length === 0) {
      layout = null;
      g.replaceChildren();
      message.textContent = "Nenhuma tabela. Escreva, por exemplo: Table usuarios { id int [pk] }";
      return;
    }
    message.textContent = "";
    layout = layoutDiagram(d, libs.dagre);
    renderDiagram(d, layout, g);
    if (fitNext) {
      fitNext = false;
      fit();
    }
  }

  return {
    /** Mostra o painel e renderiza já (troca de aba, ligar o preview). `resetView` reenquadra. */
    show(text: string, resetView: boolean) {
      host.classList.add("on");
      if (resetView) fitNext = true;
      if (text === lastText && !resetView) return;
      lastText = text;
      window.clearTimeout(timer);
      void render(text);
    },
    /** Texto mudou: renderiza com debounce. */
    update(text: string) {
      if (text === lastText) return;
      lastText = text;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void render(text), DEBOUNCE_MS);
    },
    hide() {
      window.clearTimeout(timer);
      lastText = null; // o texto pode mudar enquanto escondido: força renderizar ao reabrir
      host.classList.remove("on");
    },
  };
}

export type DiagramPanel = ReturnType<typeof createDiagramPanel>;
