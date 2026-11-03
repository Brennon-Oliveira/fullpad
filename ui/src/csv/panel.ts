import { type MenuItem, closeMenu, showMenuAt } from "../popup";
import { api, type CsvCellOut, type CsvEditOut, type CsvFilter, type CsvInfo, type CsvOp, type CsvRowOut, type CsvSort, type CsvStats } from "../api";

/** Acima disso a tabela desliga (o editor continua normal). Mesmo valor de `csv::MAX_CHARS` no Rust. */
export const MAX_CSV_CHARS = 50_000_000;

const ROW_H = 24; // altura padrão (cada aba pode mudar)
const ROW_MIN = 20;
const ROW_MAX = 400;
/** A partir daqui o texto das células quebra em linhas em vez de ser cortado. */
const WRAP_FROM = 44;
const HEAD_H = 28;
/** Quantas linhas, no máximo, são destacadas no código para uma seleção (o resto fica sem marca). */
const MARK_ROWS = 2_000;
const NUM_W = 56; // largura mínima da coluna do número da linha
const NUM_MIN = 32;
const NUM_MAX = 240;
const DEF_W = 140;
const MIN_W = 40;
const CHUNK = 100;
const OVERSCAN = 10;
const RELOAD_MS = 300;
const FILTER_MS = 250;
const STATS_MS = 80;
const CURSOR_MS = 50;
const COPY_MAX = 20_000;
const PASTE_MAX = 20_000;
/** Acima disso, Delete não apaga a seleção de uma vez. */
const CLEAR_ROWS = 5_000;
const EDIT_MIN_W = 160;
const EDIT_MAX_H = 220;

/** O que a tabela precisa saber da aba para ler o texto. */
export interface CsvConfig {
  delimiter: string;
  header: boolean;
  decimal: string;
}

export interface Span {
  from: number;
  to: number;
}

/**
 * Texto da área de transferência como grade de células: colunas por tab, linhas por quebra; um campo
 * entre aspas pode ter tab, quebra e `""` (é o que o Excel e o próprio Copiar da tabela escrevem).
 */
export function parseClipboard(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const n = text.length;
  while (i <= n) {
    let field = "";
    if (text[i] === '"') {
      i++;
      for (; i < n; i++) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            i++;
            break;
          }
        } else field += text[i];
      }
      while (i < n && text[i] !== "\t" && text[i] !== "\n" && text[i] !== "\r") field += text[i++]; // sobra depois da aspa
    } else {
      while (i < n && text[i] !== "\t" && text[i] !== "\n" && text[i] !== "\r") field += text[i++];
    }
    row.push(field);
    if (i >= n) break;
    if (text[i] === "\t") i++;
    else {
      if (text[i] === "\r" && text[i + 1] === "\n") i++;
      i++;
      out.push(row);
      row = [];
      if (i >= n) return out; // o texto acabava numa quebra: não sobra linha vazia
    }
  }
  out.push(row);
  return out;
}

export interface CsvHooks {
  /**
   * Grava as trocas no texto do código (uma só transação: um passo no desfazer). Só vale se `rev` ainda
   * for a versão do texto da tabela; devolve `false` se não for (e nada é aplicado).
   */
  onEdit?(edits: CsvEditOut[], rev: number): boolean;
  /** Ctrl+Z / Ctrl+Y com o foco na tabela: o histórico é o do editor. */
  onUndo?(): void;
  onRedo?(): void;
  /** Células selecionadas: o trecho de cada uma no código (`null`: nada selecionado). */
  onSelection?(spans: Span[] | null, rev: number): void;
  /** Célula sob o mouse: o trecho dela no código (`null`: mouse fora). */
  onHover?(spans: Span[] | null, rev: number): void;
  /** Clique numa célula: leva o cursor do código para ela. `rev` é a versão do texto da tabela. */
  onSelect?(pos: number, rev: number): void;
}

export interface CsvPanel {
  /** Mostra a tabela desta aba com este texto. Recarrega só se texto ou configuração mudaram. */
  show(tab: string, text: string, cfg: CsvConfig, rev: number): void;
  /** O texto mudou: recarrega depois de um instante. */
  update(text: string, rev: number): void;
  hide(): void;
  /** Cursor do código (UTF-16). Só vale se `rev` for a versão da tabela na tela. */
  setCursor(pos: number | null, rev: number): void;
  focusFilter(): void;
}

interface Pos {
  r: number;
  c: number;
}

/** Ordem, filtro e larguras de cada aba: voltar à aba os encontra como estavam. */
interface TabUi {
  sort: CsvSort | null;
  filter: CsvFilter;
  widths: number[];
  /** Altura das linhas (todas juntas). */
  /** Altura de cada linha mudada, pela posição na tela (o resto tem a altura padrão). */
  heights: Map<number, number>;
  /** Largura da coluna do número da linha escolhida na mão (sem isso, cabe o maior número). */
  numW?: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** A, B, ..., Z, AA, AB... como numa planilha. */
export function letters(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const nf = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 6 });
export const fmtNumber = (n: number) => nf.format(n);

/** "Soma 10 · Média 3,3 · ..." do que o Rust calculou. */
export function statsText(s: CsvStats | null): string {
  if (!s || s.count === 0) return "";
  const parts: string[] = [];
  if (s.numeric > 0) {
    parts.push(`Soma ${fmtNumber(s.sum)}`, `Média ${fmtNumber(s.avg ?? 0)}`, `Mín ${fmtNumber(s.min ?? 0)}`, `Máx ${fmtNumber(s.max ?? 0)}`);
  }
  parts.push(`Contagem ${s.count}`);
  if (s.numeric === 0) parts.push("sem números");
  else if (s.skipped > 0) parts.push(`${s.skipped} fora da conta`);
  return parts.join(" · ");
}

const display = (v: string) => v.replace(/\r\n|\r|\n/g, " ⏎ ");

export function createCsvPanel(host: HTMLElement, hooks: CsvHooks = {}): CsvPanel {
  host.classList.add("csv-host");
  const bar = el("div", "csv-bar");
  const filterIn = el("input", "csv-filter");
  filterIn.type = "search";
  filterIn.placeholder = "Filtrar linhas…";
  const colSel = el("select", "csv-colsel");
  const count = el("span", "csv-count");
  bar.append(filterIn, colSel, count);
  const scroller = el("div", "csv-scroll");
  scroller.tabIndex = 0;
  const headEl = el("div", "csv-head");
  const spacer = el("div", "csv-spacer");
  const rowsEl = el("div", "csv-rows");
  spacer.append(rowsEl);
  scroller.append(headEl, spacer);
  const msg = el("div", "csv-msg");
  msg.hidden = true;
  const foot = el("div", "csv-foot");
  const where = el("span", "csv-where");
  const statsEl = el("span", "csv-stats");
  foot.append(where, statsEl);
  host.append(bar, scroller, msg, foot);

  const uis = new Map<string, TabUi>();
  let tab = "";
  let ui: TabUi = { sort: null, filter: { col: null, text: "" }, widths: [], heights: new Map() };
  let cfg: CsvConfig = { delimiter: ",", header: true, decimal: "." };
  let info: CsvInfo | null = null;
  let text = ""; // texto de que a tabela vem
  let loadedRev = -1;
  let want = { text: "", rev: 0 };
  const chunks = new Map<number, CsvRowOut[]>();
  const pending = new Set<number>();
  let seq = 0; // descarta respostas de uma carga que já foi trocada por outra
  let sel: { a: Pos; b: Pos } | null = null;
  let focus: Pos | null = null; // célula sob o cursor do código
  let dragging = false;
  let reloadTimer: number | undefined;
  let filterTimer: number | undefined;
  let statsTimer: number | undefined;
  let cursorTimer: number | undefined;
  let statsSeq = 0;
  let cursorSeq = 0;

  const rows = () => info?.rows ?? 0;
  const cols = () => info?.cols ?? 0;
  const widthOf = (c: number) => ui.widths[c] ?? DEF_W;
  // Altura por linha: só as mudadas ficam guardadas (posição na tela -> altura), em ordem, para achar
  // o topo de uma linha, e a linha de um ponto, sem percorrer todas.
  let ov: [number, number][] = [];
  const refreshOv = () => {
    ov = [...ui.heights].sort((a, b) => a[0] - b[0]);
  };
  const numW = () => ui.numW ?? Math.max(NUM_W, String(info?.total ?? 0).length * 9 + 26);
  const applyNumW = () => host.style.setProperty("--csv-num-w", `${numW()}px`);
  const hOf = (r: number) => ui.heights.get(r) ?? ROW_H;
  const topOf = (r: number) => {
    let y = r * ROW_H;
    for (const [p, h] of ov) {
      if (p >= r) break;
      y += h - ROW_H;
    }
    return y;
  };
  const rowAtY = (y: number) => {
    let extra = 0;
    for (const [p, h] of ov) {
      const top = p * ROW_H + extra;
      if (y < top) break;
      if (y < top + h) return p;
      extra += h - ROW_H;
    }
    return Math.max(0, Math.floor((y - extra) / ROW_H));
  };
  const totalH = () => topOf(rows());
  function clearHeights() {
    if (ui.heights.size === 0) return;
    ui.heights.clear();
    refreshOv();
  }
  const totalW = () => {
    let w = numW();
    for (let c = 0; c < cols(); c++) w += widthOf(c);
    return w;
  };
  const colLabel = (c: number) => {
    const h = info?.header?.cells[c]?.value.trim();
    return h ? display(h) : cfg.header ? `Coluna ${c + 1}` : letters(c);
  };

  let toastTimer: number | undefined;
  function toast(message: string) {
    host.querySelector(".csv-toast")?.remove();
    const t = el("div", "csv-toast", message);
    host.append(t);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => t.remove(), 2000);
  }

  // ---- carga ---------------------------------------------------------------------------

  function showError(e: unknown) {
    msg.hidden = false;
    msg.textContent = `Não foi possível montar a tabela: ${e}`;
  }

  /** As linhas que estarão na tela, lidas antes de trocar a tabela: recarregar não pisca em branco. */
  async function prefetch(next: CsvInfo): Promise<Map<number, CsvRowOut[]>> {
    const out = new Map<number, CsvRowOut[]>();
    if (next.rows === 0) return out;
    const h = scroller.clientHeight || 600;
    const first = Math.max(0, rowAtY(scroller.scrollTop) - OVERSCAN);
    const last = Math.min(next.rows, rowAtY(scroller.scrollTop + h) + 1 + OVERSCAN);
    const ks: number[] = [];
    for (let k = Math.floor(first / CHUNK); k <= Math.floor((last - 1) / CHUNK); k++) ks.push(k);
    await Promise.all(ks.map(async (k) => out.set(k, await api.csvRows(tab, k * CHUNK, CHUNK))));
    return out;
  }

  function adopt(next: CsvInfo, rowsNow: Map<number, CsvRowOut[]> = new Map()) {
    if (editing) void finishEdit(false); // as linhas mudaram debaixo do editor
    if (info && info.rows !== next.rows) clearHeights(); // as posições deixaram de valer
    info = next;
    msg.hidden = true;
    chunks.clear();
    for (const [k, v] of rowsNow) chunks.set(k, v);
    pending.clear();
    if (ui.widths.length < next.cols) for (let c = ui.widths.length; c < next.cols; c++) ui.widths[c] = DEF_W;
    if (filterIn.value !== ui.filter.text) filterIn.value = ui.filter.text;
    fillColumnSelect();
    if (sel && (sel.a.r >= next.rows || sel.b.r >= next.rows || sel.a.c >= next.cols || sel.b.c >= next.cols)) sel = null;
    if (focus && (focus.r >= next.rows || focus.c >= next.cols)) focus = null;
    count.textContent =
      ui.filter.text || ui.sort ? `${next.rows.toLocaleString("pt-BR")} de ${next.total.toLocaleString("pt-BR")} linhas` : `${next.total.toLocaleString("pt-BR")} linhas`;
    if (next.unterminated) count.textContent += " · aspas sem fechar";
    buildHead();
    renderRows();
    scheduleStats();
  }

  function sortArg() {
    return ui.sort;
  }
  function filterArg(): CsvFilter | null {
    return ui.filter.text ? ui.filter : null;
  }

  async function load() {
    const my = ++seq;
    const t = tab;
    const body = want.text;
    try {
      const next = await api.csvLoad(t, body, cfg.delimiter, cfg.header, cfg.decimal, sortArg(), filterArg());
      if (my !== seq) return;
      const now = await prefetch(next);
      if (my !== seq) return;
      text = body;
      loadedRev = want.rev;
      adopt(next, now);
    } catch (e) {
      if (my === seq) showError(e);
    }
  }

  /** Ordem ou filtro mudou: o Rust refaz a visão sem o texto. */
  async function reloadView() {
    if (!info) return;
    const my = ++seq;
    try {
      const next = await api.csvView(tab, cfg.header, cfg.decimal, sortArg(), filterArg());
      if (my !== seq) return;
      sel = null;
      focus = null;
      clearHeights();
      scroller.scrollTop = 0;
      const now = await prefetch(next);
      if (my !== seq) return;
      adopt(next, now);
    } catch (e) {
      if (my === seq) showError(e);
    }
  }

  // ---- desenho -------------------------------------------------------------------------

  function fillColumnSelect() {
    const n = cols();
    if (colSel.options.length === n + 1) {
      for (let c = 0; c < n; c++) colSel.options[c + 1].textContent = colLabel(c);
      return;
    }
    colSel.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "Todas as colunas";
    colSel.append(all);
    for (let c = 0; c < n; c++) {
      const o = document.createElement("option");
      o.value = String(c);
      o.textContent = colLabel(c);
      colSel.append(o);
    }
    colSel.value = ui.filter.col === null ? "" : String(ui.filter.col);
  }

  function buildHead() {
    headEl.replaceChildren();
    headEl.style.width = `${totalW()}px`;
    applyNumW();
    const corner = el("div", "csv-hnum");
    corner.append(el("span", "csv-grip"));
    headEl.append(corner);
    for (let c = 0; c < cols(); c++) {
      const h = el("div", "csv-hcell");
      h.style.width = `${widthOf(c)}px`;
      h.dataset.c = String(c);
      if (info?.types[c] === "number") h.classList.add("num");
      const label = el("span", "csv-hlabel", colLabel(c));
      const arrow = ui.sort?.col === c ? (ui.sort.desc ? " ▼" : " ▲") : "";
      h.append(label, el("span", "csv-sort", arrow));
      h.append(el("span", "csv-grip"));
      headEl.append(h);
    }
    spacer.style.width = `${totalW()}px`;
    spacer.style.height = `${totalH()}px`;
    rowsEl.style.width = `${totalW()}px`;
  }

  const inSel = (r: number, c: number) => {
    if (!sel) return false;
    return r >= Math.min(sel.a.r, sel.b.r) && r <= Math.max(sel.a.r, sel.b.r) && c >= Math.min(sel.a.c, sel.b.c) && c <= Math.max(sel.a.c, sel.b.c);
  };

  function rowAt(i: number): CsvRowOut | undefined {
    return chunks.get(Math.floor(i / CHUNK))?.[i % CHUNK];
  }

  function fetchChunk(k: number) {
    if (chunks.has(k) || pending.has(k) || !info) return;
    pending.add(k);
    const my = seq;
    api
      .csvRows(tab, k * CHUNK, CHUNK)
      .then((r) => {
        if (my !== seq) return;
        pending.delete(k);
        chunks.set(k, r);
        renderRows();
      })
      .catch((e) => {
        if (my === seq) {
          pending.delete(k);
          showError(e);
        }
      });
  }

  function renderRows() {
    if (!info) return;
    const total = rows();
    const h = scroller.clientHeight || 600;
    const first = Math.max(0, rowAtY(scroller.scrollTop) - OVERSCAN);
    const last = Math.min(total, rowAtY(scroller.scrollTop + h) + 1 + OVERSCAN);
    rowsEl.style.top = `${topOf(first)}px`;
    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      const row = el("div", "csv-row" + (i % 2 ? " odd" : ""));
      row.dataset.i = String(i);
      if (ui.heights.has(i)) {
        const rh = hOf(i);
        row.style.setProperty("--csv-row-h", `${rh}px`);
        row.classList.toggle("wrap", rh >= WRAP_FROM);
      }
      const num = el("div", "csv-rnum", String((rowAt(i)?.index ?? 0) + 1 - (cfg.header ? 1 : 0)));
      if (!rowAt(i)) num.textContent = "";
      num.append(el("span", "csv-rgrip"));
      row.append(num);
      const data = rowAt(i);
      if (data) {
        for (let c = 0; c < cols(); c++) {
          const cell = data.cells[c];
          const d = el("div", "csv-cell");
          d.style.width = `${widthOf(c)}px`;
          d.dataset.c = String(c);
          if (info.types[c] === "number") d.classList.add("num");
          if (inSel(i, c)) d.classList.add("sel");
          if (focus && focus.r === i && focus.c === c) d.classList.add("cur");
          if (cell) d.textContent = display(cell.value);
          row.append(d);
        }
      }
      frag.append(row);
    }
    rowsEl.replaceChildren(frag);
    markOverflow();
    if (total > 0) for (let k = Math.floor(first / CHUNK); k <= Math.floor((last - 1) / CHUNK); k++) fetchChunk(k);
  }

  /** Células com texto cortado ganham um "…" clicável (o cortado nativo do navegador não é clicável). */
  function markOverflow() {
    const cells = [...rowsEl.querySelectorAll<HTMLElement>(".csv-cell")];
    const cut = cells.filter((c) => (c.parentElement?.classList.contains("wrap") ? c.scrollHeight > c.clientHeight + 1 : c.scrollWidth > c.clientWidth));
    for (const c of cut) {
      c.classList.add("cut");
      const more = el("span", "csv-more", "…");
      more.title = "Ver o texto completo";
      c.append(more);
    }
  }

  // ---- texto completo (popover) ----------------------------------------------------------

  let pop: HTMLElement | null = null;
  let popOff: (() => void) | null = null;

  function closePop() {
    popOff?.();
    popOff = null;
    pop?.remove();
    pop = null;
  }

  async function copyText(value: string, notice: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast(notice);
    } catch {
      toast("Não foi possível copiar");
    }
  }

  /** O valor inteiro da célula (a tabela recebe os textos muito longos cortados). */
  async function fullValue(row: number, col: number, shown: CsvCellOut | undefined): Promise<string> {
    if (shown && !shown.cut) return shown.value;
    const c = await api.csvCell(tab, row, col).catch(() => null);
    return c?.value ?? shown?.value ?? "";
  }

  async function openPop(anchor: HTMLElement, r: number, c: number, byKey = false) {
    closePop();
    const data = rowAt(r);
    if (!data) return;
    const value = await fullValue(data.index, c, data.cells[c]);
    const box = el("div", "csv-pop");
    const body = el("div", "csv-pop-text", value);
    const copy = el("button", "csv-pop-copy", "Copiar");
    copy.className += " kbd"; // o botão já vem em destaque: Enter o aciona
    copy.addEventListener("click", () => void copyText(value, "Copiado"));
    box.append(body, copy);
    document.body.append(box);
    pop = box;
    const a = anchor.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const left = Math.max(4, Math.min(a.left, window.innerWidth - w - 4));
    const top = a.bottom + h + 4 > window.innerHeight ? Math.max(4, a.top - h - 2) : a.bottom + 2;
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    // fecha ao tirar o mouse da célula e do popover (a célula pode sumir da tela ao rolar: vale o retângulo dela)
    const inside = (x: number, y: number, b: DOMRect) => x >= b.left - 2 && x <= b.right + 2 && y >= b.top - 2 && y <= b.bottom + 2;
    const move = (e: MouseEvent) => {
      if (!pop || byKey) return; // aberto pelo teclado: o mouse pode estar longe
      if (!inside(e.clientX, e.clientY, a) && !inside(e.clientX, e.clientY, pop.getBoundingClientRect())) closePop();
    };
    // pelo teclado (Tab abre): Enter copia e fecha, Tab de novo fecha sem copiar
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") return closePop();
      if (e.key !== "Enter" && e.key !== "Tab") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Enter") void copyText(value, "Copiado");
      closePop();
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("keydown", key, true);
    scroller.addEventListener("scroll", closePop, { once: true });
    popOff = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("keydown", key, true);
      scroller.removeEventListener("scroll", closePop);
    };
  }

  /** Atualiza só as classes de seleção/cursor das células na tela: sem refazer o DOM nem medir de novo. */
  function paint() {
    for (const row of rowsEl.children) {
      const i = Number((row as HTMLElement).dataset.i);
      for (const cell of row.getElementsByClassName("csv-cell")) {
        const c = Number((cell as HTMLElement).dataset.c);
        cell.classList.toggle("sel", inSel(i, c));
        cell.classList.toggle("cur", !!focus && focus.r === i && focus.c === c);
      }
    }
  }

  // ---- estatísticas --------------------------------------------------------------------

  function scheduleStats() {
    window.clearTimeout(statsTimer);
    statsTimer = window.setTimeout(updateStats, STATS_MS);
  }

  async function updateStats() {
    if (!info || rows() === 0) {
      statsEl.textContent = "";
      where.textContent = "";
      return;
    }
    // uma célula só (ou nada): a coluna inteira; uma faixa: a seleção
    const single = !sel || (sel.a.r === sel.b.r && sel.a.c === sel.b.c);
    const c0 = sel ? Math.min(sel.a.c, sel.b.c) : focus?.c ?? 0;
    const [r0, r1, k0, k1] = single
      ? [0, rows(), c0, c0 + 1]
      : [Math.min(sel!.a.r, sel!.b.r), Math.max(sel!.a.r, sel!.b.r) + 1, c0, Math.max(sel!.a.c, sel!.b.c) + 1];
    where.textContent = single ? `Coluna ${colLabel(c0)}` : `Seleção: ${r1 - r0} × ${k1 - k0}`;
    const my = ++statsSeq;
    try {
      const s = await api.csvStats(tab, r0, r1, k0, k1, cfg.decimal);
      if (my === statsSeq) statsEl.textContent = statsText(s);
    } catch {
      if (my === statsSeq) statsEl.textContent = "";
    }
  }

  // ---- ordem, filtro, larguras -------------------------------------------------------------

  function toggleSort(c: number) {
    ui.sort = ui.sort?.col !== c ? { col: c, desc: false } : ui.sort.desc ? null : { col: c, desc: true };
    void reloadView();
  }

  filterIn.addEventListener("input", () => {
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(() => {
      ui.filter = { col: colSel.value === "" ? null : Number(colSel.value), text: filterIn.value };
      void reloadView();
    }, FILTER_MS);
  });
  colSel.addEventListener("change", () => {
    ui.filter = { col: colSel.value === "" ? null : Number(colSel.value), text: filterIn.value };
    if (ui.filter.text) void reloadView();
  });
  filterIn.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && filterIn.value) {
      filterIn.value = "";
      filterIn.dispatchEvent(new Event("input"));
      e.stopPropagation();
    }
  });

  function sortMenu(c: number): MenuItem[] {
    const cur = ui.sort?.col === c ? ui.sort : null;
    return [
      { label: "Renomear coluna", disabled: !cfg.header, action: () => void renameCol(c) },
      "sep",
      {
        label: "Ordenar",
        submenu: [
          { label: "Crescente", checked: !!cur && !cur.desc, action: () => setSort({ col: c, desc: false }) },
          { label: "Decrescente", checked: !!cur && cur.desc, action: () => setSort({ col: c, desc: true }) },
          "sep",
          { label: "Limpar ordenação", disabled: !ui.sort, action: () => setSort(null) },
        ],
      },
      {
        label: "Ordenar o arquivo por esta coluna",
        submenu: [
          { label: "Crescente", action: () => sortFile(c, false) },
          { label: "Decrescente", action: () => sortFile(c, true) },
        ],
      },
      "sep",
      { label: "Inserir coluna à esquerda", action: () => insertCol(c) },
      { label: "Inserir coluna à direita", action: () => insertCol(c + 1) },
      { label: "Mover para a esquerda", disabled: c === 0, action: () => moveCol(c, c - 1) },
      { label: "Mover para a direita", disabled: c >= cols() - 1, action: () => moveCol(c, c + 1) },
      { label: "Apagar coluna", action: () => deleteCol(c) },
      "sep",
      { label: "Inserir linha no fim", action: () => insertRows(null, true) },
      "sep",
      { label: "Filtrar por esta coluna", action: () => void filterByColumn(c) },
      { label: "Copiar nome da coluna", action: () => void copyText(colLabel(c), "Copiado") },
    ];
  }

  function setSort(next: CsvSort | null) {
    ui.sort = next;
    void reloadView();
  }

  function filterByColumn(c: number) {
    colSel.value = String(c);
    ui.filter = { col: c, text: filterIn.value };
    if (ui.filter.text) void reloadView();
    filterIn.focus();
  }

  headEl.addEventListener("contextmenu", (e) => {
    const hc = (e.target as HTMLElement).closest<HTMLElement>(".csv-hcell");
    e.preventDefault();
    e.stopPropagation();
    if (hc) showMenuAt(e.clientX, e.clientY, sortMenu(Number(hc.dataset.c)));
  });

  headEl.addEventListener("dblclick", (e) => {
    if ((e.target as HTMLElement).parentElement?.classList.contains("csv-hnum")) {
      ui.numW = undefined; // volta a caber o maior número
      applyNumW();
      headEl.style.width = spacer.style.width = rowsEl.style.width = `${totalW()}px`;
    }
  });

  headEl.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return; // o botão direito só abre o menu
    const t = e.target as HTMLElement;
    if (t.parentElement?.classList.contains("csv-hnum")) {
      // largura da coluna do número da linha
      e.preventDefault();
      const startX = e.clientX;
      const startW = numW();
      const move = (ev: MouseEvent) => {
        ui.numW = Math.min(NUM_MAX, Math.max(NUM_MIN, startW + ev.clientX - startX));
        applyNumW();
        headEl.style.width = spacer.style.width = rowsEl.style.width = `${totalW()}px`;
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      return;
    }
    const hc = t.closest<HTMLElement>(".csv-hcell");
    if (!hc) return;
    e.preventDefault();
    const c = Number(hc.dataset.c);
    if (t.classList.contains("csv-grip")) {
      const startX = e.clientX;
      const startW = widthOf(c);
      const move = (ev: MouseEvent) => {
        ui.widths[c] = Math.max(MIN_W, startW + ev.clientX - startX);
        hc.style.width = `${ui.widths[c]}px`;
        headEl.style.width = spacer.style.width = rowsEl.style.width = `${totalW()}px`;
        renderRows();
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      return;
    }
    toggleSort(c);
  });

  // ---- altura das linhas -------------------------------------------------------------------

  /** Muda a altura de uma linha só (da posição `r`); voltar a 24 px tira o registro. */
  function setRowH(r: number, h: number) {
    const next = Math.min(ROW_MAX, Math.max(ROW_MIN, Math.round(h)));
    if (next === hOf(r)) return;
    if (next === ROW_H) ui.heights.delete(r);
    else ui.heights.set(r, next);
    refreshOv();
    spacer.style.height = `${totalH()}px`;
    renderRows();
  }

  rowsEl.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !(e.target as HTMLElement).classList.contains("csv-rgrip")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const r = Number((e.target as HTMLElement).closest<HTMLElement>(".csv-row")?.dataset.i);
    const startY = e.clientY;
    const startH = hOf(r);
    const move = (ev: MouseEvent) => setRowH(r, startH + ev.clientY - startY);
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
  rowsEl.addEventListener("dblclick", (e) => {
    const t = e.target as HTMLElement;
    if (t.classList.contains("csv-rgrip")) return setRowH(Number(t.closest<HTMLElement>(".csv-row")?.dataset.i), ROW_H); // volta ao padrão
    if (t.classList.contains("csv-more") || t.classList.contains("csv-rnum")) return;
    const at = cellFromPoint(e.clientX, e.clientY);
    if (at) void startEdit(at);
  });

  // ---- destaque no código ------------------------------------------------------------------

  let marksSeq = 0;
  let marksTimer: number | undefined;
  /**
   * Os trechos das células selecionadas (até `MARK_ROWS` linhas) vão para o código. Com as linhas já
   * na tela (o caso comum) é na hora; só uma seleção que passa do que foi carregado pede ao Rust.
   */
  function marks() {
    window.clearTimeout(marksTimer);
    marksSeq++;
    if (!sel || !info) return hooks.onSelection?.(null, loadedRev);
    const [a0, a1] = [Math.min(sel.a.r, sel.b.r), Math.max(sel.a.r, sel.b.r)];
    const [b0, b1] = [Math.min(sel.a.c, sel.b.c), Math.max(sel.a.c, sel.b.c)];
    const end = Math.min(a1, a0 + MARK_ROWS - 1);
    const local: Span[] = [];
    let all = true;
    for (let r = a0; r <= end && all; r++) {
      const row = rowAt(r);
      if (!row) all = false;
      else for (let c = b0; c <= b1; c++) if (row.cells[c]) local.push({ from: row.cells[c].from, to: row.cells[c].to });
    }
    if (all) return hooks.onSelection?.(local, loadedRev);
    marksTimer = window.setTimeout(async () => {
      const my = marksSeq;
      if (!sel || !info) return hooks.onSelection?.(null, loadedRev);
      const [r0, r1] = [Math.min(sel.a.r, sel.b.r), Math.max(sel.a.r, sel.b.r)];
      const [c0, c1] = [Math.min(sel.a.c, sel.b.c), Math.max(sel.a.c, sel.b.c)];
      const spans: Span[] = [];
      try {
        const end = Math.min(r1, r0 + MARK_ROWS - 1);
        for (let at = r0; at <= end; at += 500) {
          for (const row of await api.csvRows(tab, at, Math.min(500, end - at + 1))) {
            for (let c = c0; c <= c1; c++) if (row.cells[c]) spans.push({ from: row.cells[c].from, to: row.cells[c].to });
          }
          if (my !== marksSeq) return;
        }
      } catch {
        return;
      }
      if (my === marksSeq) hooks.onSelection?.(spans, loadedRev);
    }, 60);
  }

  let hoverCell: Pos | null = null;
  let hoverPt: { x: number; y: number } | null = null;
  let hoverFrame = 0;
  // no máximo uma checagem por quadro, sem esperar o mouse parar: o destaque acompanha o ponteiro
  rowsEl.addEventListener("mousemove", (e) => {
    if ((e.target as HTMLElement).classList.contains("csv-rgrip")) return;
    hoverPt = { x: e.clientX, y: e.clientY };
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      if (!hoverPt) return;
      const at = cellFromPoint(hoverPt.x, hoverPt.y);
      const cell = at ? rowAt(at.r)?.cells[at.c] : undefined;
      if (hoverCell && at && hoverCell.r === at.r && hoverCell.c === at.c) return;
      hoverCell = at && cell ? at : null;
      hooks.onHover?.(cell ? [{ from: cell.from, to: cell.to }] : null, loadedRev);
    });
  });
  rowsEl.addEventListener("mouseleave", () => {
    hoverPt = null;
    hoverCell = null;
    hooks.onHover?.(null, loadedRev);
  });

  // ---- editar célula -----------------------------------------------------------------------

  interface Editing {
    p: Pos;
    /** Linha do arquivo. */
    row: number;
    original: string;
    el: HTMLTextAreaElement;
  }
  let editing: Editing | null = null;

  const colLeft = (c: number) => {
    let x = numW();
    for (let i = 0; i < c; i++) x += widthOf(i);
    return x;
  };

  /** Manda as trocas para o código e refaz o índice na hora (sem esperar a pausa de quem digita no código). */
  async function applyEdits(list: { row: number; col: number; value: string }[]): Promise<boolean> {
    if (loadedRev !== want.rev) {
      toast("A tabela está atualizando; tente de novo");
      return false;
    }
    const mine = loadedRev;
    const out = await api.csvEdit(tab, list).catch(() => null);
    if (!out) {
      toast("Não foi possível editar");
      return false;
    }
    return commit(out, mine);
  }

  /** Aplica as trocas no código e refaz o índice na hora. */
  async function commit(out: CsvEditOut[], mine: number): Promise<boolean> {
    if (out.length === 0) return true;
    if (!hooks.onEdit?.(out, mine)) {
      toast("O texto mudou; tente de novo");
      return false;
    }
    window.clearTimeout(reloadTimer);
    await load();
    return true;
  }

  // ---- estrutura: linhas e colunas inteiras ----------------------------------------------------

  /** Roda a mudança no Rust e grava as trocas no código (um passo no desfazer). */
  async function structure(op: CsvOp, done?: string, fix?: () => void): Promise<boolean> {
    if (!info || editing) return false;
    if (loadedRev !== want.rev) {
      toast("A tabela está atualizando; tente de novo");
      return false;
    }
    const mine = loadedRev;
    const out = await api.csvStructure(tab, op).catch(() => null);
    if (!out) {
      toast("Não foi possível alterar");
      return false;
    }
    if (out.length === 0) {
      toast("Nada a mudar");
      return false;
    }
    fix?.();
    const ok = await commit(out, mine);
    if (ok && done) toast(done);
    return ok;
  }

  /** Colunas mudaram de lugar: ordem e filtro por coluna deixam de valer, e as larguras acompanham. */
  function colsChanged(widths: (w: number[]) => void) {
    widths(ui.widths);
    ui.sort = null;
    ui.filter = { col: null, text: ui.filter.text };
    colSel.value = "";
  }

  function insertRows(pos: number | null, after: boolean, count = 1) {
    void structure({ op: "insertRows", pos, after, count }, count === 1 ? "Linha inserida" : `${count} linhas inseridas`);
  }

  function deleteRows(r0: number, r1: number) {
    void structure({ op: "deleteRows", from: r0, to: r1 }, r1 === r0 ? "Linha apagada" : `${r1 - r0 + 1} linhas apagadas`, () => {
      clearSelection();
    });
  }

  function insertCol(at: number) {
    void structure({ op: "insertCol", at }, "Coluna inserida", () => colsChanged((w) => w.splice(at, 0, DEF_W)));
  }

  function deleteCol(c: number) {
    void structure({ op: "deleteCols", cols: [c] }, "Coluna apagada", () => {
      clearSelection();
      colsChanged((w) => w.splice(c, 1));
    });
  }

  function moveCol(from: number, to: number) {
    void structure({ op: "moveCol", from, to }, "Coluna movida", () =>
      colsChanged((w) => {
        const [x] = w.splice(from, 1);
        w.splice(to, 0, x ?? DEF_W);
      }),
    );
  }

  function sortFile(col: number, desc: boolean) {
    void structure({ op: "sortFile", col, desc, header: cfg.header, decimal: cfg.decimal }, "Arquivo ordenado", () => {
      ui.sort = null;
      clearSelection();
    });
  }

  async function startEdit(p: Pos, initial?: string) {
    if (!info || editing) return;
    const data = rowAt(p.r);
    if (!data) return;
    if (loadedRev !== want.rev) return toast("A tabela está atualizando; tente de novo");
    const original = await fullValue(data.index, p.c, data.cells[p.c]);
    if (editing || !info) return;
    const ta = el("textarea", "csv-edit");
    ta.value = initial ?? original;
    ta.spellcheck = false;
    ta.style.left = `${colLeft(p.c)}px`;
    ta.style.top = `${topOf(p.r)}px`;
    ta.style.width = `${Math.max(widthOf(p.c), EDIT_MIN_W)}px`;
    const fit = () => {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(EDIT_MAX_H, Math.max(hOf(p.r), ta.scrollHeight))}px`;
    };
    ta.addEventListener("input", fit);
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation(); // as teclas são do campo, não da tabela
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void finishEdit(true, "down");
      } else if (e.key === "Tab") {
        e.preventDefault();
        void finishEdit(true, e.shiftKey ? "left" : "right");
      } else if (e.key === "Escape") {
        e.preventDefault();
        void finishEdit(false);
      }
    });
    ta.addEventListener("blur", () => void finishEdit(true));
    editing = { p, row: data.index, original, el: ta };
    spacer.append(ta);
    fit();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  /** Termina a edição: grava (se mudou) ou descarta, e anda a seleção (Enter: abaixo; Tab: ao lado). */
  async function finishEdit(commit: boolean, move?: "down" | "right" | "left") {
    const ed = editing;
    if (!ed) return;
    editing = null; // antes de tirar o campo: o blur que isso causa não termina de novo
    const value = ed.el.value;
    ed.el.remove();
    scroller.focus();
    if (commit && value !== ed.original) {
      if (!(await applyEdits([{ row: ed.row, col: ed.p.c, value }]))) return;
    }
    if (!move || !info) return;
    const to = {
      r: Math.min(rows() - 1, Math.max(0, ed.p.r + (move === "down" ? 1 : 0))),
      c: Math.min(cols() - 1, Math.max(0, ed.p.c + (move === "right" ? 1 : move === "left" ? -1 : 0))),
    };
    select(to, to);
    reveal(to);
    void goToCell(to);
  }

  /**
   * Cola uma grade de células a partir do canto de cima à esquerda da seleção, em qualquer formato
   * (passando do fim, cria linhas e colunas). Uma célula só, com várias selecionadas, preenche todas.
   */
  async function paste(grid: string[][]) {
    if (!info || editing || grid.length === 0) return;
    const anchor = sel ? { r: Math.min(sel.a.r, sel.b.r), c: Math.min(sel.a.c, sel.b.c) } : focus;
    if (!anchor) return toast("Selecione uma célula para colar");
    const gw = Math.max(...grid.map((g) => g.length));
    const one = grid.length === 1 && grid[0].length === 1;
    const r1 = Math.max(sel ? Math.max(sel.a.r, sel.b.r) : anchor.r, 0);
    const c1 = sel ? Math.max(sel.a.c, sel.b.c) : anchor.c;
    const fill = one && !!sel && (r1 > anchor.r || c1 > anchor.c);
    const h = fill ? r1 - anchor.r + 1 : grid.length;
    const w = fill ? c1 - anchor.c + 1 : gw;
    if (h * w > PASTE_MAX) return toast(`Cole até ${PASTE_MAX.toLocaleString("pt-BR")} células de uma vez`);
    // linha do arquivo de cada linha da tela; passando do fim, as linhas novas vêm depois da última
    const files: number[] = [];
    const inView = Math.max(0, Math.min(h, rows() - anchor.r));
    for (let at = 0; at < inView; at += 500) {
      for (const row of await api.csvRows(tab, anchor.r + at, Math.min(500, inView - at))) files.push(row.index);
    }
    const base = (cfg.header ? 1 : 0) + info.total;
    for (let k = files.length; k < h; k++) files.push(base + (anchor.r + k - rows()));
    const list: { row: number; col: number; value: string }[] = [];
    for (let i = 0; i < h; i++) {
      for (let j = 0; j < w; j++) {
        const v = fill ? grid[0][0] : grid[i][j];
        if (v !== undefined) list.push({ row: files[i], col: anchor.c + j, value: v });
      }
    }
    if (!(await applyEdits(list))) return;
    const to = { r: Math.min(rows() - 1, anchor.r + h - 1), c: Math.min(cols() - 1, anchor.c + w - 1) };
    select(anchor, to);
    toast(`Colado: ${h} × ${w} células`);
  }

  async function pasteFromClipboard() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) await paste(parseClipboard(t));
    } catch {
      toast("Não foi possível colar");
    }
  }

  scroller.addEventListener("paste", (e) => {
    if (editing || !info) return; // no campo de edição vale o colar do próprio campo
    const t = e.clipboardData?.getData("text/plain");
    if (!t) return;
    e.preventDefault();
    void paste(parseClipboard(t));
  });

  /** Renomear coluna: edita a célula do cabeçalho (primeira linha do arquivo) sobre o próprio cabeçalho. */
  async function renameCol(c: number) {
    if (!info || editing || !cfg.header) return;
    if (loadedRev !== want.rev) return toast("A tabela está atualizando; tente de novo");
    const mine = tab;
    const original = await fullValue(0, c, info.header?.cells[c]);
    if (mine !== tab || !info) return;
    headEl.querySelector(".csv-hedit")?.remove();
    const input = el("input", "csv-hedit") as HTMLInputElement;
    input.value = original;
    input.style.left = `${colLeft(c)}px`;
    input.style.width = `${Math.max(widthOf(c), EDIT_MIN_W)}px`;
    let done = false;
    const end = async (save: boolean) => {
      if (done) return;
      done = true;
      const value = input.value;
      input.remove();
      scroller.focus();
      if (save && value !== original && mine === tab) await applyEdits([{ row: 0, col: c, value }]);
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        void end(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        void end(false);
      }
    });
    input.addEventListener("blur", () => void end(true));
    headEl.append(input);
    input.focus();
    input.select();
  }

  /** Delete: esvazia as células selecionadas (uma transação só). */
  async function clearCells() {
    if (!sel || !info) return;
    const [r0, r1] = [Math.min(sel.a.r, sel.b.r), Math.max(sel.a.r, sel.b.r)];
    const [c0, c1] = [Math.min(sel.a.c, sel.b.c), Math.max(sel.a.c, sel.b.c)];
    if (r1 - r0 + 1 > CLEAR_ROWS) return toast(`Selecione até ${CLEAR_ROWS.toLocaleString("pt-BR")} linhas para apagar`);
    const list: { row: number; col: number; value: string }[] = [];
    for (let at = r0; at <= r1; at += 500) {
      for (const row of await api.csvRows(tab, at, Math.min(500, r1 - at + 1))) {
        for (let c = c0; c <= c1; c++) if (row.cells[c] && row.cells[c].value !== "") list.push({ row: row.index, col: c, value: "" });
      }
    }
    if (list.length === 0) return;
    if (await applyEdits(list)) toast(list.length === 1 ? "Célula apagada" : `${list.length} células apagadas`);
  }

  // clicar em qualquer outro lugar enquanto edita: grava o que foi digitado
  host.addEventListener(
    "mousedown",
    (e) => {
      if (editing && e.target !== editing.el) void finishEdit(true);
    },
    true,
  );

  // ---- seleção ---------------------------------------------------------------------------

  function cellFromPoint(x: number, y: number): Pos | null {
    if (!info || rows() === 0) return null;
    const box = scroller.getBoundingClientRect();
    const px = x - box.left + scroller.scrollLeft - numW();
    const py = y - box.top + scroller.scrollTop - HEAD_H;
    const r = Math.min(rows() - 1, Math.max(0, rowAtY(py)));
    let c = 0;
    let acc = 0;
    for (; c < cols() - 1; c++) {
      if (px < acc + widthOf(c)) break;
      acc += widthOf(c);
    }
    return { r, c: px < 0 ? 0 : c };
  }

  function select(a: Pos, b: Pos) {
    sel = { a, b };
    paint();
    scheduleStats();
    marks();
  }

  /** Tira a seleção (clicar fora das células, Esc): some o destaque da tabela, o contorno da célula do cursor e o do código. */
  function clearSelection() {
    if (!sel && !focus) return;
    sel = null;
    focus = null;
    paint();
    scheduleStats();
    marks();
  }

  // clicar no vazio (abaixo das linhas ou à direita das colunas) desseleciona
  scroller.addEventListener("mousedown", (e) => {
    const t = e.target as HTMLElement;
    if (e.button === 0 && (t === scroller || t === spacer || t === rowsEl)) {
      closePop();
      clearSelection();
      scroller.focus();
    }
  });

  async function goToCell(p: Pos) {
    const data = rowAt(p.r);
    if (!data) return;
    const cell = await api.csvCell(tab, data.index, p.c).catch(() => null);
    if (cell) hooks.onSelect?.(cell.from, loadedRev);
  }

  rowsEl.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const more = (e.target as HTMLElement).closest<HTMLElement>(".csv-more");
    if (more) {
      e.preventDefault();
      const cellEl = more.parentElement!;
      const rowEl = cellEl.parentElement!;
      void openPop(cellEl, Number(rowEl.dataset.i), Number(cellEl.dataset.c));
      return;
    }
    closePop();
    const at = cellFromPoint(e.clientX, e.clientY);
    if (!at) return;
    const rnum = (e.target as HTMLElement).classList.contains("csv-rnum");
    scroller.focus();
    e.preventDefault();
    if (rnum) {
      select({ r: at.r, c: 0 }, { r: at.r, c: Math.max(0, cols() - 1) });
      return;
    }
    if (e.shiftKey && sel) select(sel.a, at);
    else {
      select(at, at);
      void goToCell(at);
    }
    dragging = true;
    const move = (ev: MouseEvent) => {
      const p = cellFromPoint(ev.clientX, ev.clientY);
      if (dragging && p && sel) select(sel.a, p);
    };
    const up = () => {
      dragging = false;
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });

  function reveal(p: Pos) {
    const top = topOf(p.r);
    const bottom = top + hOf(p.r);
    const viewH = scroller.clientHeight - HEAD_H;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (bottom > scroller.scrollTop + viewH) scroller.scrollTop = bottom - viewH;
    let left = 0;
    for (let c = 0; c < p.c; c++) left += widthOf(c);
    const viewW = scroller.clientWidth - numW();
    if (left < scroller.scrollLeft) scroller.scrollLeft = left;
    else if (left + widthOf(p.c) > scroller.scrollLeft + viewW) scroller.scrollLeft = left + widthOf(p.c) - viewW;
  }

  rowsEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const at = cellFromPoint(e.clientX, e.clientY);
    if (!at) return;
    closePop();
    closeMenu();
    if (!inSel(at.r, at.c)) select(at, at);
    const single = !!sel && sel.a.r === sel.b.r && sel.a.c === sel.b.c;
    const nRows = sel ? Math.abs(sel.a.r - sel.b.r) + 1 : 1;
    showMenuAt(e.clientX, e.clientY, [
      { label: single ? "Copiar" : "Copiar seleção", shortcut: "Ctrl+C", action: () => void copySelection() },
      ...(single ? [] : [{ label: "Copiar só esta célula", action: () => void copyCell(at) }]),
      { label: "Colar", shortcut: "Ctrl+V", action: () => void pasteFromClipboard() },
      "sep",
      { label: "Inserir linha acima", action: () => insertRows(at.r, false) },
      { label: "Inserir linha abaixo", action: () => insertRows(at.r, true) },
      {
        label: nRows === 1 ? "Apagar linha" : `Apagar ${nRows} linhas`,
        action: () => deleteRows(Math.min(sel!.a.r, sel!.b.r), Math.max(sel!.a.r, sel!.b.r)),
      },
      "sep",
      { label: "Ver o texto completo", action: () => void openPop(cellEl(at) ?? rowsEl, at.r, at.c) },
      "sep",
      { label: "Selecionar tudo", shortcut: "Ctrl+A", action: () => select({ r: 0, c: 0 }, { r: rows() - 1, c: cols() - 1 }) },
    ]);
  });

  /** O elemento da célula na tela (pode não estar, se rolou para fora). */
  function cellEl(p: Pos): HTMLElement | null {
    return rowsEl.querySelector<HTMLElement>(`.csv-row[data-i="${p.r}"] .csv-cell[data-c="${p.c}"]`);
  }

  async function copyCell(p: Pos) {
    const data = rowAt(p.r);
    if (!data) return;
    await copyText(await fullValue(data.index, p.c, data.cells[p.c]), "Copiado");
  }

  async function copySelection() {
    if (!sel || !info) return;
    const [r0, r1] = [Math.min(sel.a.r, sel.b.r), Math.max(sel.a.r, sel.b.r)];
    const [c0, c1] = [Math.min(sel.a.c, sel.b.c), Math.max(sel.a.c, sel.b.c)];
    if (r1 - r0 + 1 > COPY_MAX) return toast(`Selecione até ${COPY_MAX.toLocaleString("pt-BR")} linhas para copiar`);
    const lines: string[] = [];
    for (let at = r0; at <= r1; at += 500) {
      const part = await api.csvRows(tab, at, Math.min(500, r1 - at + 1));
      for (const row of part) {
        const vals: string[] = [];
        for (let c = c0; c <= c1; c++) {
          const v = await fullValue(row.index, c, row.cells[c]);
          vals.push(/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
        }
        lines.push(vals.join("\t"));
      }
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast(`Copiado: ${r1 - r0 + 1} × ${c1 - c0 + 1} células`);
    } catch {
      toast("Não foi possível copiar");
    }
  }

  scroller.addEventListener("keydown", (e) => {
    if (!info || rows() === 0) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && sel) {
      e.preventDefault();
      void copySelection();
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && !e.altKey && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      return hooks.onUndo?.();
    }
    if (ctrl && !e.altKey && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
      e.preventDefault();
      return hooks.onRedo?.();
    }
    const at = sel?.a ?? focus;
    if (at && e.key === "Tab" && !ctrl && !e.altKey && !e.shiftKey) {
      const cell = cellEl(at);
      if (cell?.classList.contains("cut")) {
        e.preventDefault();
        return void openPop(cell, at.r, at.c, true);
      }
    }
    if (at && !ctrl && !e.altKey && (e.key === "F2" || e.key === "Enter")) {
      e.preventDefault();
      return void startEdit(at);
    }
    if (at && !ctrl && !e.altKey && e.key.length === 1) {
      e.preventDefault(); // digitar numa célula selecionada começa a edição, trocando o conteúdo
      return void startEdit(at, e.key);
    }
    if (sel && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      return void clearCells();
    }
    if (e.key === "Escape" && sel) {
      e.preventDefault();
      clearSelection();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      select({ r: 0, c: 0 }, { r: rows() - 1, c: cols() - 1 });
      return;
    }
    const d: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], PageUp: [-10, 0], PageDown: [10, 0] };
    const step = d[e.key];
    if (!step) return;
    e.preventDefault();
    const from = sel ? sel.b : focus ?? { r: 0, c: 0 };
    const to = { r: Math.min(rows() - 1, Math.max(0, from.r + step[0])), c: Math.min(cols() - 1, Math.max(0, from.c + step[1])) };
    if (e.shiftKey && sel) select(sel.a, to);
    else {
      select(to, to);
      void goToCell(to);
    }
    reveal(to);
  });

  scroller.addEventListener("scroll", () => requestAnimationFrame(renderRows), { passive: true });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => renderRows()).observe(scroller);

  // ---- API -----------------------------------------------------------------------------------

  const sameCfg = (a: CsvConfig, b: CsvConfig) => a.delimiter === b.delimiter && a.header === b.header && a.decimal === b.decimal;

  return {
    show(id, body, next, rev) {
      host.classList.add("on");
      const fresh = id !== tab;
      if (fresh) {
        tab = id;
        hoverCell = null;
        void finishEdit(false);
        ui = uis.get(id) ?? { sort: null, filter: { col: null, text: "" }, widths: [], heights: new Map() };
        uis.set(id, ui);
        refreshOv();
        info = null;
        sel = null;
        focus = null;
        chunks.clear();
        scroller.scrollTop = scroller.scrollLeft = 0;
        filterIn.value = ui.filter.text;
        colSel.replaceChildren();
        headEl.replaceChildren();
        rowsEl.replaceChildren();
        statsEl.textContent = where.textContent = count.textContent = "";
      }
      window.clearTimeout(reloadTimer);
      if (!fresh && info && text === body && sameCfg(cfg, next)) {
        loadedRev = rev; // nada mudou de verdade: a ligação com o código continua valendo
        renderRows();
        return;
      }
      cfg = next;
      want = { text: body, rev };
      void load();
    },
    update(body, rev) {
      want = { text: body, rev };
      window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => void load(), RELOAD_MS);
    },
    hide() {
      void finishEdit(false);
      hooks.onHover?.(null, loadedRev);
      host.classList.remove("on");
      window.clearTimeout(reloadTimer);
    },
    setCursor(pos, rev) {
      window.clearTimeout(cursorTimer);
      if (pos === null || !info || rev !== loadedRev) return;
      cursorTimer = window.setTimeout(async () => {
        const my = ++cursorSeq;
        const hit = await api.csvLocate(tab, pos).catch(() => null);
        if (my !== cursorSeq || rev !== loadedRev) return;
        focus = hit && hit.view !== null ? { r: hit.view, c: hit.col } : null;
        if (focus) reveal(focus);
        paint();
      }, CURSOR_MS);
    },
    focusFilter() {
      filterIn.focus();
      filterIn.select();
    },
  };
}
