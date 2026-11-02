import { api } from "../api";
import { type MenuItem, showMenuAt } from "../popup";
import {
  type Analysis,
  type JNode,
  type JsonError,
  type Row,
  ancestors,
  defaultExpanded,
  isContainer,
  nodeAt,
  pathKeys,
  pathOf,
  spanOf,
  subtreeContainers,
  valueLabel,
  visibleRows,
} from "./tree";

/** Acima disso o painel desliga (o editor continua normal). */
export const MAX_JSON_CHARS = 8_000_000;

const ROW_H = 22;
const OVERSCAN = 8;
const DEBOUNCE_MS = 250;
/** Acima disso a expansão não é preservada entre edições (remapear custaria caro). */
const REMAP_LIMIT = 100_000;
const TIP_DELAY_MS = 350;

export interface Span {
  from: number;
  to: number;
}

export interface PanelHooks {
  /** Mouse sobre um nó: o trecho dele no código. `rev` é a versão do texto de que vêm os trechos. */
  onHover?(spans: Span[] | null, rev: number): void;
  /** Clique num nó: leva o cursor do código para ele. */
  onSelect?(pos: number, rev: number): void;
  /** "Ir para a linha no código". */
  onGoto?(span: Span, rev: number): void;
  /** Caminho do nó sob o cursor (ou `null`). */
  onPath?(path: string | null): void;
  /** Pasta do arquivo da aba, para imagens de caminho relativo. */
  baseDir?(): string | null;
}

export interface JsonPanel {
  /** Mostra o painel com este texto. `fresh`: é outra aba (expansão volta ao padrão). */
  show(text: string, fresh: boolean, rev: number): void;
  update(text: string, rev: number): void;
  hide(): void;
  /** Cursor do código (UTF-16). Só vale se `rev` for a versão da árvore na tela. */
  setCursor(pos: number | null, rev: number): void;
  expandAll(): void;
  collapseAll(): void;
  /** Caminho do nó sob o cursor, se a árvore está pronta. */
  currentPath(): string | null;
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon" };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** Conjunto de contêineres abertos depois de uma edição: o que estava aberto continua (pelo caminho). */
export function remapExpanded(oldNodes: JNode[], oldOpen: ReadonlySet<number>, next: JNode[]): Set<number> {
  if (oldNodes.length === 0 || oldNodes.length > REMAP_LIMIT || next.length > REMAP_LIMIT) return defaultExpanded(next);
  if (oldOpen.size === 0) return new Set();
  const oldKeys = pathKeys(oldNodes);
  const open = new Set([...oldOpen].map((i) => oldKeys[i]));
  const out = new Set<number>();
  pathKeys(next).forEach((k, i) => {
    if (open.has(k) && isContainer(next[i]) && next[i].len > 0) out.add(i);
  });
  return out;
}

export function createJsonPanel(host: HTMLElement, hooks: PanelHooks = {}): JsonPanel {
  host.classList.add("jt-host");
  const scroller = el("div", "jt-scroll");
  const spacer = el("div", "jt-spacer");
  const rowsEl = el("div", "jt-rows");
  spacer.append(rowsEl);
  scroller.append(spacer);
  const msg = el("div", "jt-msg");
  msg.hidden = true;
  const errEl = el("div", "jt-error");
  errEl.hidden = true;
  const tip = el("div", "jt-tip");
  tip.hidden = true;
  host.append(scroller, msg, errEl, tip);

  let nodes: JNode[] = [];
  let text = ""; // texto de que `nodes` vêm
  let rev = 0; // versão desse texto
  let expanded = new Set<number>();
  let rows: Row[] = [];
  let focusId = -1; // nó sob o cursor do código
  let pendingCursor: number | null = null;
  let hoverId = -1;
  let seq = 0;
  let timer: number | undefined;
  let want = { text: "", rev: 0, fresh: true };
  let lastError: JsonError | null = null;

  // ---- desenho -----------------------------------------------------------------------

  function buildRow(r: Row): HTMLElement {
    const n = nodes[r.id];
    const row = el("div", "jt-row" + (r.id === focusId ? " fc" : ""));
    row.dataset.id = String(r.id);
    row.style.paddingLeft = `${8 + r.depth * 16}px`;
    const container = isContainer(n);
    const tog = el("span", "jt-tog", container && n.len > 0 ? (expanded.has(r.id) ? "▾" : "▸") : "");
    row.append(tog);
    if (n.parent >= 0) {
      const inArray = nodes[n.parent].kind === "array";
      row.append(el("span", inArray ? "jt-idx" : "jt-key", inArray ? String(r.idx) : (n.key ?? "")), el("span", "jt-colon", ":"));
    }
    if (container) {
      row.append(el("span", "jt-sum", valueLabel(n)));
      return row;
    }
    if (n.hint === "color" && n.text) {
      const sw = el("span", "jt-sw");
      sw.style.background = n.text;
      row.append(sw);
    }
    const val = el("span", `jt-val jt-${n.kind}`, valueLabel(n));
    const link = n.hint === "url" || n.hint === "mail" || n.hint === "image";
    if (link) val.classList.add("jt-link");
    if (n.hint === "image" || n.hint === "image-data" || n.hint === "image-local") val.classList.add("jt-img");
    row.append(val);
    return row;
  }

  function render() {
    const top = scroller.scrollTop;
    const h = scroller.clientHeight || 400;
    const first = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
    const last = Math.min(rows.length, Math.ceil((top + h) / ROW_H) + OVERSCAN);
    spacer.style.height = `${rows.length * ROW_H}px`;
    rowsEl.style.transform = `translateY(${first * ROW_H}px)`;
    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) frag.append(buildRow(rows[i]));
    rowsEl.replaceChildren(frag);
  }

  function relayout() {
    rows = visibleRows(nodes, expanded);
    render();
  }

  scroller.addEventListener("scroll", () => {
    hideTip();
    render();
  }, { passive: true });
  new ResizeObserver(() => render()).observe(scroller);

  // ---- ações sobre nós ------------------------------------------------------------------

  function toggle(id: number, deep: boolean) {
    const open = expanded.has(id);
    const ids = deep ? subtreeContainers(nodes, id) : [id];
    for (const i of ids) {
      if (open) expanded.delete(i);
      else expanded.add(i);
    }
    relayout();
  }

  /** Abre os pais do nó e o traz para a área visível. */
  function reveal(id: number) {
    let changed = false;
    for (const a of ancestors(nodes, id)) if (!expanded.has(a)) (expanded.add(a), (changed = true));
    if (changed) rows = visibleRows(nodes, expanded);
    const at = rows.findIndex((r) => r.id === id);
    if (at >= 0) {
      const y = at * ROW_H;
      const h = scroller.clientHeight;
      if (y < scroller.scrollTop || y + ROW_H > scroller.scrollTop + h) scroller.scrollTop = Math.max(0, y - h / 2 + ROW_H / 2);
    }
    render();
  }

  function focusNode(id: number) {
    focusId = id;
    hooks.onPath?.(id >= 0 ? pathOf(nodes, id) : null);
  }

  function applyCursor() {
    if (pendingCursor === null) {
      if (focusId >= 0) (focusNode(-1), render());
      return;
    }
    const id = nodeAt(nodes, pendingCursor);
    if (id === focusId) return;
    focusNode(id);
    if (id >= 0) reveal(id);
    else render();
  }

  /** Valor completo da string (o texto do nó é cortado quando enorme). */
  function fullValue(n: JNode): string {
    if (n.kind !== "string") return n.text ?? "";
    if (!n.cut) return n.text ?? "";
    try {
      return JSON.parse(text.slice(n.from, n.to)) as string;
    } catch {
      return n.text ?? "";
    }
  }

  const copy = (s: string) => void navigator.clipboard.writeText(s).catch(() => {});

  function menuFor(id: number): MenuItem[] {
    const n = nodes[id];
    const items: MenuItem[] = [{ label: "Copiar caminho", action: () => copy(pathOf(nodes, id)) }];
    if (n.key !== undefined) items.push({ label: "Copiar chave", action: () => copy(n.key!) });
    items.push({ label: "Copiar valor", action: () => copy(isContainer(n) ? text.slice(n.from, n.to) : fullValue(n)) });
    if (n.hint === "url" || n.hint === "mail" || n.hint === "image") {
      items.push("sep", { label: "Abrir link", action: () => void api.openUrl(fullValue(n)).catch(() => {}) }, { label: "Copiar link", action: () => copy(fullValue(n)) });
    }
    if (n.hint === "color") items.push("sep", { label: "Copiar cor", action: () => copy(fullValue(n)) });
    if (isContainer(n) && n.len > 0) {
      const open = expanded.has(id);
      items.push(
        "sep",
        { label: open ? "Recolher este nó" : "Expandir este nó", action: () => toggle(id, false) },
        { label: open ? "Recolher tudo daqui para baixo" : "Expandir tudo daqui para baixo", action: () => toggle(id, true) },
      );
    }
    items.push("sep", { label: "Expandir tudo", action: expandAll }, { label: "Recolher tudo", action: collapseAll });
    if (hooks.onGoto) items.push("sep", { label: "Ir para a linha no código", action: () => hooks.onGoto!(spanOf(n), rev) });
    return items;
  }

  function expandAll() {
    expanded = new Set(subtreeContainers(nodes, 0));
    relayout();
  }

  function collapseAll() {
    expanded = nodes.length > 0 && isContainer(nodes[0]) && nodes[0].len > 0 ? new Set([0]) : new Set();
    relayout();
  }

  // ---- eventos --------------------------------------------------------------------------

  const rowOf = (t: EventTarget | null): { row: HTMLElement; id: number } | null => {
    const row = (t as HTMLElement | null)?.closest?.<HTMLElement>(".jt-row");
    return row?.dataset.id !== undefined ? { row, id: Number(row.dataset.id) } : null;
  };

  rowsEl.addEventListener("click", (e) => {
    const hit = rowOf(e.target);
    if (!hit) return;
    const n = nodes[hit.id];
    const target = e.target as HTMLElement;
    if (target.closest(".jt-link") && (n.hint === "url" || n.hint === "mail" || n.hint === "image")) {
      void api.openUrl(fullValue(n)).catch(() => {});
      return;
    }
    focusNode(hit.id);
    if (isContainer(n) && n.len > 0) toggle(hit.id, e.ctrlKey || e.metaKey);
    else render();
    hooks.onSelect?.(n.kfrom ?? n.from, rev);
  });

  rowsEl.addEventListener("contextmenu", (e) => {
    const hit = rowOf(e.target);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    focusNode(hit.id);
    render();
    showMenuAt(e.clientX, e.clientY, menuFor(hit.id));
  });
  host.addEventListener("contextmenu", (e) => {
    if (rowOf(e.target) || nodes.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    showMenuAt(e.clientX, e.clientY, [{ label: "Expandir tudo", action: expandAll }, { label: "Recolher tudo", action: collapseAll }]);
  });

  rowsEl.addEventListener("mouseover", (e) => {
    const hit = rowOf(e.target);
    const id = hit?.id ?? -1;
    if (id !== hoverId) {
      hoverId = id;
      hooks.onHover?.(id >= 0 ? [spanOf(nodes[id])] : null, rev);
    }
    const img = (e.target as HTMLElement).closest?.<HTMLElement>(".jt-img");
    if (img && hit) scheduleTip(img, hit.id);
    else hideTip();
  });
  rowsEl.addEventListener("mouseleave", () => {
    hoverId = -1;
    hooks.onHover?.(null, rev);
    hideTip();
  });

  // ---- miniatura de imagem ----------------------------------------------------------------

  let tipTimer: number | undefined;
  let tipFor = -1;
  let tipUrl: string | null = null;

  function hideTip() {
    window.clearTimeout(tipTimer);
    tipFor = -1;
    tip.hidden = true;
    tip.replaceChildren();
    if (tipUrl) URL.revokeObjectURL(tipUrl);
    tipUrl = null;
  }

  function scheduleTip(anchor: HTMLElement, id: number) {
    if (tipFor === id) return;
    hideTip();
    tipFor = id;
    tipTimer = window.setTimeout(() => void showTip(anchor, id), TIP_DELAY_MS);
  }

  async function showTip(anchor: HTMLElement, id: number) {
    const n = nodes[id];
    if (!n) return;
    const value = fullValue(n);
    let src: string;
    try {
      if (n.hint === "image-local") {
        const bytes = await api.jsonPreviewImage(value, hooks.baseDir?.() ?? null);
        if (tipFor !== id) return;
        const ext = value.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
        tipUrl = URL.createObjectURL(new Blob([bytes], { type: MIME[ext] ?? "application/octet-stream" }));
        src = tipUrl;
      } else {
        src = value;
      }
    } catch (e) {
      if (tipFor === id) showTipText(anchor, String(e));
      return;
    }
    if (tipFor !== id) return;
    const img = document.createElement("img");
    img.alt = "";
    img.addEventListener("error", () => tipFor === id && showTipText(anchor, "Não foi possível carregar a imagem"));
    img.addEventListener("load", () => place(anchor));
    img.src = src;
    tip.replaceChildren(img);
    tip.hidden = false;
    place(anchor);
  }

  function showTipText(anchor: HTMLElement, s: string) {
    tip.replaceChildren(el("div", "jt-tip-msg", s));
    tip.hidden = false;
    place(anchor);
  }

  /** Ao lado do valor, para baixo se couber (não cobre a linha sob o mouse). */
  function place(anchor: HTMLElement) {
    const r = anchor.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const left = Math.min(Math.max(4, r.left), window.innerWidth - tw - 4);
    const below = r.bottom + 4 + th <= window.innerHeight;
    tip.style.left = `${left}px`;
    tip.style.top = `${below ? r.bottom + 4 : Math.max(4, r.top - th - 4)}px`;
  }

  // ---- análise --------------------------------------------------------------------------

  function schedule(immediate: boolean) {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(), immediate ? 0 : DEBOUNCE_MS);
  }

  async function run() {
    const mine = ++seq;
    const job = { ...want };
    let res: Analysis;
    try {
      res = await api.jsonAnalyze(job.text, true);
    } catch (e) {
      if (mine === seq) showMessage(String(e));
      return;
    }
    if (mine !== seq) return; // chegou outra versão enquanto isso
    apply(res, job);
  }

  function showMessage(s: string) {
    msg.textContent = s;
    msg.hidden = s === "";
  }

  function showError(err: JsonError | null) {
    lastError = err;
    errEl.hidden = !err;
    if (err) errEl.textContent = `Linha ${err.line}, coluna ${err.col}: ${err.message}`;
  }

  errEl.addEventListener("click", () => lastError && hooks.onGoto?.({ from: lastError.from, to: lastError.to }, want.rev));

  function apply(res: Analysis, job: { text: string; rev: number; fresh: boolean }) {
    if (res.error || !res.doc) {
      // erro de sintaxe: mantém a última árvore boa (as posições dela são do texto antigo)
      showError(res.error);
      return;
    }
    showError(null);
    if (res.doc.too_big) {
      nodes = [];
      rows = [];
      text = job.text;
      rev = job.rev;
      showMessage(`Documento grande demais para a árvore (${res.doc.total.toLocaleString("pt-BR")} nós). O texto continua editável.`);
      render();
      return;
    }
    showMessage("");
    const next = res.doc.nodes;
    expanded = job.fresh ? defaultExpanded(next) : remapExpanded(nodes, expanded, next);
    nodes = next;
    text = job.text;
    rev = job.rev;
    focusId = -1;
    rows = visibleRows(nodes, expanded);
    hideTip();
    if (job.fresh) scroller.scrollTop = 0;
    render();
    applyCursor();
  }

  return {
    show(t, fresh, r) {
      host.classList.add("on");
      if (fresh) {
        nodes = [];
        rows = [];
        expanded = new Set();
        focusId = -1;
        showError(null);
        showMessage("");
        render();
      }
      want = { text: t, rev: r, fresh: fresh || nodes.length === 0 };
      schedule(true);
    },
    update(t, r) {
      want = { text: t, rev: r, fresh: want.fresh && nodes.length === 0 };
      schedule(false);
    },
    hide() {
      host.classList.remove("on");
      window.clearTimeout(timer);
      seq++;
      hideTip();
    },
    setCursor(pos, r) {
      pendingCursor = pos;
      if (r === rev) applyCursor();
    },
    expandAll,
    collapseAll,
    currentPath: () => (focusId >= 0 ? pathOf(nodes, focusId) : null),
  };
}
