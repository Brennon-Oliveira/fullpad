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
  explain: (offset: number) => { file: string; line: number } | null;
  dagre: DagreLike;
}

// O parser vem do serviço compartilhado (service.ts); o dagre só serve ao diagrama e carrega aqui.
let libsPromise: Promise<Libs> | undefined;
function loadLibs(): Promise<Libs> {
  libsPromise ??= Promise.all([loadDbmlService(), import("@dagrejs/dagre")]).then(([svc, d]) => {
    const mod = d as unknown as { default?: DagreLike; layout?: unknown };
    const dagre = (typeof mod.layout === "function" ? mod : mod.default) as DagreLike;
    return { interpret: svc.interpret, explain: svc.explain, dagre };
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
  /** Durante o arrasto (a cada quadro): o que mudou até agora, sem gravar. */
  onLayoutLive?(edit: LayoutEdit): void;
  /**
   * Duplo clique no nome de uma tabela, coluna, enum, valor ou grupo: renomear. `decl` é onde a
   * declaração começa no texto da versão `rev`; `at` é onde abrir a caixa (coordenadas da tela).
   */
  onRename?(decl: number, at: { x: number; y: number; width: number }, rev: number): void;
  /**
   * Botão direito numa coluna (`column`: a linha) ou no nome de uma tabela, enum, valor ou grupo:
   * `decl` é onde a declaração começa no texto da versão `rev`; `at` é o ponto do clique.
   */
  onContext?(info: { decl: number; column: boolean }, at: { x: number; y: number }, rev: number): void;
  /**
   * Mouse sobre um elemento do diagrama. `rev` diz de qual versão do texto vêm os trechos; quem
   * recebe só deve usá-los se o texto ainda for essa versão (senão apontariam para o lugar errado).
   */
  onHover?(spans: Span[] | null, rev: number): void;
  /**
   * Apertou o botão sobre um elemento (clique ou começo de arrasto): `offset` é onde a declaração
   * dele começa no texto da versão `rev`. Quem recebe leva o código até lá.
   */
  onPick?(offset: number, rev: number): void;
  /**
   * Clicou no ícone de uma nota (só com o diagrama editável): `decl` é onde a declaração da tabela ou
   * da coluna começa no texto da versão `rev`; `at` é onde abrir a caixa (coordenadas da tela).
   */
  onNote?(info: { decl: number; kind: "table" | "column" }, at: { x: number; y: number }, rev: number): void;
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
  const noteTip = div("dbml-notetip");
  noteTip.hidden = true;
  host.replaceChildren(svg, message, error, warn, tools, noteTip);

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

  // ---- editar ou só ver ----
  let editable = true;
  const showNoteTip = (n: { text: string; rect: DOMRect; editable: boolean } | null) => {
    if (!n) {
      noteTip.hidden = true;
      return;
    }
    noteTip.replaceChildren(div("dbml-notetip-text", n.text));
    if (editable && n.editable && hooks.onNote) noteTip.append(div("dbml-notetip-hint", "Clique no ícone para editar"));
    noteTip.hidden = false;
    const h = host.getBoundingClientRect();
    const w = noteTip.offsetWidth;
    const left = Math.max(8, Math.min(n.rect.left - h.left, h.width - w - 8));
    const below = n.rect.bottom - h.top + 6;
    noteTip.style.left = `${left}px`;
    noteTip.style.top = `${below + noteTip.offsetHeight > h.height - 4 ? Math.max(4, n.rect.top - h.top - noteTip.offsetHeight - 6) : below}px`;
  };
  // o pan prende o ponteiro no <svg>, então o clique no ícone é achado pelo ponto, e só vale se não arrastou
  let down: { x: number; y: number } | null = null;
  svg.addEventListener(
    "pointerdown",
    (e) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
      showNoteTip(null);
    },
    true,
  );
  svg.addEventListener("click", (e) => {
    if (!editable || !hooks.onNote || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 3) return;
    const icon = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".dbml-noteicon");
    const decl = icon?.getAttribute("data-note");
    if (!icon || decl === null || decl === undefined) return;
    const r = icon.getBoundingClientRect();
    showNoteTip(null);
    hooks.onNote({ decl: Number(decl), kind: icon.getAttribute("data-note-kind") === "table" ? "table" : "column" }, { x: r.left, y: r.bottom + 4 }, renderedRev);
  });

  const fit = () => {
    if (layout) viewport.fit(layout.width, layout.height, layout.x0, layout.y0);
  };
  const fitByUser = () => {
    fit();
    scheduleView();
  };
  svg.addEventListener("dblclick", (e) => {
    // o pan prende o ponteiro no <svg> (pointer capture), então `e.target` vem sempre como o próprio
    // <svg>: o elemento de verdade é o que está sob o ponto do clique
    const target = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element);
    const named = target.closest?.("[data-off], [data-col]");
    if (named && hooks.onRename && editable) {
      const r = named.getBoundingClientRect();
      const decl = Number(named.getAttribute("data-off") ?? named.getAttribute("data-col"));
      hooks.onRename(decl, { x: r.left, y: r.bottom + 4, width: Math.max(220, r.width + 40) }, renderedRev);
      return;
    }
    // só o fundo enquadra: duplo clique em tabela, enum, grupo ou seta nunca mexe no zoom
    if (target.closest?.(".dbml-table, .dbml-enum, .dbml-group, .dbml-edge")) return;
    fitByUser();
  });
  // clicar (ou começar a arrastar) um elemento leva o código até a declaração dele
  svg.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      const pick = (e.target as Element).closest?.("[data-pick]");
      if (pick) hooks.onPick?.(Number(pick.getAttribute("data-pick")), renderedRev);
    },
    true,
  );

  svg.addEventListener("contextmenu", (e) => {
    const target = e.target as Element;
    const row = target.closest?.("[data-col]");
    const named = row ? null : target.closest?.("[data-off]");
    const decl = row ? Number(row.getAttribute("data-col")) : named ? Number(named.getAttribute("data-off")) : null;
    if (decl === null || !hooks.onContext || !editable) return;
    e.preventDefault();
    hooks.onContext({ decl, column: !!row }, { x: e.clientX, y: e.clientY }, renderedRev);
  });

  const draw = () => {
    if (!diagram || !layout) return;
    rendered = renderDiagram(diagram, layout, g, { onHover: (spans) => hooks.onHover?.(spans, renderedRev), onNoteHover: showNoteTip });
    applyFocus(false);
  };
  // ---- arrastar: tabela, grupo (move as tabelas dele) e moldura do grupo (aumenta) ----
  let snap: { boxes: Map<string, Box>; members: string[]; frame: Box } | null = null;
  let liveEdit: LayoutEdit | null = null;
  const redraw = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
      if (liveEdit) hooks.onLayoutLive?.(liveEdit);
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
    enabled: () => editable && layoutOn && !layoutError && !!layout,
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
        liveEdit = { tables: { [id]: positions[id] } };
      } else if (kind === "group") {
        for (const [m, b] of snap.boxes) place(m, b.x + dx, b.y + dy);
        groupRects = { ...groupRects, [id]: groupRect({ ...snap.frame, x: snap.frame.x + dx, y: snap.frame.y + dy }) };
        frameGroups(diagram, layout.boxes, groupRects);
        liveEdit = { tables: Object.fromEntries(snap.members.map((m) => [m, positions[m]])), groups: { [id]: groupRects[id] } };
      } else {
        const f = snap.frame;
        groupRects = { ...groupRects, [id]: groupRect({ x: f.x, y: f.y, w: Math.max(40, f.w + dx), h: Math.max(40, f.h + dy) }) };
        frameGroups(diagram, layout.boxes, groupRects);
        liveEdit = { groups: { [id]: groupRects[id] } };
      }
      redraw();
    },
    end(kind, id) {
      liveEdit = null;
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
    const res = parseDbml(libs.interpret, text, libs.explain);
    if (res.error) {
      error.hidden = false;
      error.textContent = res.error.file ? `Em ${res.error.file}, linha ${res.error.line}: ${res.error.message}` : `Linha ${res.error.line}, col. ${res.error.column}: ${res.error.message}`;
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
    /**
     * Liga ou desliga a edição pelo diagrama (arrastar tabelas e grupos, renomear, menu da coluna e notas).
     * Desligado, o diagrama só se vê: ainda dá para mover a vista, dar zoom e passar o mouse nas notas.
     */
    setEditable(on: boolean) {
      editable = on;
      svg.classList.toggle("can-drag", editable && layoutOn && !layoutError);
      svg.classList.toggle("view-only", !editable);
      showNoteTip(null);
    },
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
      svg.classList.toggle("can-drag", editable && layoutOn && !layoutError);
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
    /** O que o texto inclui mudou (`!include`): desenha de novo o mesmo texto. */
    refresh() {
      if (lastText === null || !host.classList.contains("on")) return;
      window.clearTimeout(timer);
      relayout = false;
      void render(lastText);
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
