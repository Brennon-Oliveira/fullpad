import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { buildSvg, svgToPng } from "./export";
import { type Box, type DagreLike, type Layout, type SavedGroups, type SavedPositions, fitExtent, frameGroups, groupKey, groupMembers, layoutDiagram } from "./layout";
import { type Diagram, type Interpreter, type Span, parseDbml } from "./model";
import { loadDbmlService } from "./service";
import { type Rendered, renderDiagram } from "./render";
import { attachTableDrag } from "./tabledrag";
import { attachViewport } from "./viewport";

/** Acima disso o diagrama desliga para não pesar. */
export const MAX_DIAGRAM_CHARS = 500_000;

const DEBOUNCE_MS = 300;
const SAVE_MS = 500; // depois de soltar a tabela ou parar de mexer na vista, grava o layout
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

/** O layout guardado da aba (do `.dbmlx` ou da nota avulsa); `null` = a aba não guarda layout. */
export interface PanelLayout {
  tables: SavedPositions;
  /** Molduras de grupo guardadas (por nome); ausente = só o que as tabelas pedem. */
  groups?: SavedGroups;
  viewport: { x: number; y: number; zoom: number } | null;
  /** Layout que não se entende: o diagrama usa o posicionamento automático e avisa. */
  error: string | null;
}

export interface LayoutEdit {
  viewport?: { x: number; y: number; zoom: number };
  tables?: SavedPositions;
  groups?: SavedGroups;
}

export interface PanelHooks {
  /** Tabelas arrastadas e/ou vista mexida: quem recebe grava no layout. */
  onLayoutEdit?(edit: LayoutEdit): void;
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
  const viewport = attachViewport(svg, g, () => scheduleView());
  const message = div("dbml-msg"); // vazio / carregando
  const error = div("dbml-error");
  error.hidden = true;
  const warn = div("dbml-error dbml-warn"); // aviso do layout (não é erro do DBML)
  warn.hidden = true;
  const tools = div("dbml-tools");
  const tool = (label: string, title: string, run: () => void) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", run);
    tools.append(b);
  };
  host.replaceChildren(svg, message, error, warn, tools);

  let layout: Layout | null = null;
  let lastText: string | null = null;
  let renderedText: string | null = null; // texto do diagrama que está na tela
  let latestRev = 0;
  let renderedRev = -1; // versão do texto a que o diagrama na tela corresponde
  let rendered: Rendered | null = null;
  let cursor: { offset: number | null; rev: number } = { offset: null, rev: -1 };
  let seq = 0;
  let relayout = false; // o layout mudou e a próxima `show` precisa redesenhar
  let fitNext = true;
  let timer: number | undefined;

  // ---- layout guardado ----
  let positions: SavedPositions = {};
  let groupRects: SavedGroups = {};
  let savedView: { x: number; y: number; zoom: number } | null = null;
  let layoutOn = false; // a aba guarda layout (senão não se arrasta: nada seria lembrado)
  let layoutError: string | null = null;
  let layoutKey = "";
  let diagram: Diagram | null = null;
  let pendingMoves: SavedPositions = {};
  let pendingGroups: SavedGroups = {};
  let pendingView = false;
  let saveTimer: number | undefined;
  let frame = 0;

  const flush = () => {
    window.clearTimeout(saveTimer);
    if (!layoutOn || layoutError) {
      pendingMoves = {};
      pendingGroups = {};
      pendingView = false;
      return;
    }
    const edit: LayoutEdit = {};
    if (Object.keys(pendingMoves).length) edit.tables = pendingMoves;
    if (Object.keys(pendingGroups).length) edit.groups = pendingGroups;
    if (pendingView) edit.viewport = viewport.get();
    pendingMoves = {};
    pendingGroups = {};
    pendingView = false;
    if (edit.tables || edit.groups || edit.viewport) hooks.onLayoutEdit?.(edit);
  };
  const scheduleSave = () => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(flush, SAVE_MS);
  };
  function scheduleView() {
    if (!layoutOn || layoutError) return;
    pendingView = true;
    scheduleSave();
  }

  const fit = () => {
    if (layout) viewport.fit(layout.width, layout.height, layout.x0, layout.y0);
  };
  const fitByUser = () => {
    fit();
    scheduleView();
  };
  svg.addEventListener("dblclick", (e) => {
    if ((e.target as Element).closest?.(".dbml-table, .dbml-group-move, .dbml-group-resize")) return; // duplo clique numa alça não enquadra
    fitByUser();
  });

  const draw = () => {
    if (!diagram || !layout) return;
    rendered = renderDiagram(diagram, layout, g, { onHover: (spans) => hooks.onHover?.(spans, renderedRev) });
    applyFocus(false);
  };
  // ---- arrastar: tabela, grupo (move as tabelas dele) e moldura do grupo (aumenta) ----
  let snap: { boxes: Map<string, Box>; members: string[]; frame: Box } | null = null;
  const redraw = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  };
  const place = (id: string, x: number, y: number) => {
    const b = layout?.boxes.get(id);
    if (!layout || !b) return;
    layout.boxes.set(id, { ...b, x, y });
    positions = { ...positions, [id]: { x, y } };
  };
  const groupRect = (b: Box) => ({ x: b.x, y: b.y, width: b.w, height: b.h });
  attachTableDrag(svg, g, {
    scale: () => viewport.scale(),
    enabled: () => layoutOn && !layoutError && !!layout,
    start(kind, id) {
      if (!layout || !diagram) return false;
      if (kind === "table") {
        const b = layout.boxes.get(id);
        if (!b) return false;
        snap = { boxes: new Map([[id, b]]), members: [id], frame: b };
        return true;
      }
      const frameBox = layout.boxes.get(groupKey(id));
      if (!frameBox) return false;
      const members = groupMembers(diagram, layout.boxes).get(id) ?? [];
      snap = { boxes: new Map(members.map((m) => [m, layout!.boxes.get(m)!])), members, frame: frameBox };
      return true;
    },
    move(kind, id, dx, dy) {
      if (!layout || !diagram || !snap) return;
      if (kind === "table") {
        const b = snap.boxes.get(id)!;
        place(id, b.x + dx, b.y + dy);
        frameGroups(diagram, layout.boxes, groupRects);
      } else if (kind === "group") {
        for (const [m, b] of snap.boxes) place(m, b.x + dx, b.y + dy);
        groupRects = { ...groupRects, [id]: groupRect({ ...snap.frame, x: snap.frame.x + dx, y: snap.frame.y + dy }) };
        frameGroups(diagram, layout.boxes, groupRects);
      } else {
        const f = snap.frame;
        groupRects = { ...groupRects, [id]: groupRect({ x: f.x, y: f.y, w: Math.max(40, f.w + dx), h: Math.max(40, f.h + dy) }) };
        frameGroups(diagram, layout.boxes, groupRects);
      }
      redraw();
    },
    end(kind, id) {
      if (!snap) return;
      if (kind === "table") {
        pendingMoves[id] = positions[id];
      } else {
        for (const m of snap.members) pendingMoves[m] = positions[m];
        pendingGroups[id] = groupRects[id];
      }
      snap = null;
      if (layout) fitExtent(layout);
      scheduleSave();
    },
  });

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
      diagram = null;
      rendered = null;
      g.replaceChildren();
      message.textContent = "Nenhuma tabela. Escreva, por exemplo: Table usuarios { id int [pk] }";
      return;
    }
    message.textContent = "";
    diagram = d;
    layout = layoutDiagram(d, libs.dagre, layoutError ? {} : positions, layoutError ? {} : groupRects);
    renderedText = text;
    if (lastText === text) renderedRev = latestRev;
    draw();
    if (fitNext) {
      fitNext = false;
      if (savedView && !layoutError) viewport.set(savedView);
      else fit();
    }
  }

  return {
    /** Mostra o painel e renderiza já (troca de aba, ligar o preview). `resetView` reenquadra. */
    show(text: string, resetView: boolean, rev = 0) {
      host.classList.add("on");
      latestRev = rev;
      if (resetView) fitNext = true;
      if (text === lastText && !resetView && !relayout) {
        if (renderedText === text) renderedRev = rev;
        return;
      }
      relayout = false;
      lastText = text;
      window.clearTimeout(timer);
      void render(text);
    },
    /**
     * O layout guardado da aba que vai aparecer (chamar antes de `show`; `null` se a aba não guarda
     * layout). Se for outro que o de agora e o texto continua o mesmo, redesenha já.
     */
    setLayout(l: PanelLayout | null) {
      flush();
      const key = JSON.stringify(l && [l.tables, l.groups, l.error]);
      layoutOn = l !== null;
      layoutError = l?.error ?? null;
      positions = l?.tables ?? {};
      groupRects = l?.groups ?? {};
      savedView = l?.viewport ?? null;
      svg.classList.toggle("can-drag", layoutOn && !layoutError);
      warn.hidden = !layoutError;
      warn.textContent = layoutError ? `Layout inválido, usando o posicionamento automático (${layoutError}). Corrija em "Ver layout".` : "";
      if (key === layoutKey) return;
      layoutKey = key;
      relayout = true;
      if (lastText !== null && host.classList.contains("on")) {
        window.clearTimeout(timer);
        relayout = false;
        void render(lastText);
      }
    },
    /** Grava já o que está pendente (arrasto e vista): antes de trocar de aba ou fechar o painel. */
    flush,
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
      flush();
      window.clearTimeout(timer);
      renderedText = null;
      renderedRev = -1;
      lastText = null; // o texto pode mudar enquanto escondido: força renderizar ao reabrir
      host.classList.remove("on");
    },
  };
}

export type DiagramPanel = ReturnType<typeof createDiagramPanel>;
