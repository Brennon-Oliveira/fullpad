// Uma aba de arquivo grande (`crates/core/src/large.rs`). O arquivo fica no disco; o editor tem só uma
// **janela** de lotes seguidos (`state.ts`). Aqui estão as operações sobre ela: carregar em volta de uma
// linha, deslizar ao rolar, ir para a linha, mandar as edições de cada lote ao Rust e refazer a janela
// depois de salvar. Nada aqui lê o arquivo inteiro nem toca na nota da aba (`notes/` é só um marcador).
import { EditorSelection, Transaction, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import type { LargeBatch, LargeEdit, LargeInfo } from "../api";
import { MAX_WINDOW_BATCHES, nearEdge, stripBreaks, windowAround } from "./model";
import { appendBatch, docPos, dropFirst, dropLast, fileLineAt, largeExtensions, largeField, loadSpec, prependBatch, resetWindow, windowLoad, type WindowState } from "./state";

/** O que o controlador pede ao Rust (o `api` do app, ou um de mentira nos testes). */
export interface LargeIo {
  info(id: string): Promise<LargeInfo>;
  batch(id: string, index: number): Promise<LargeBatch>;
  locate(id: string, line: number): Promise<{ batch: number; start_line: number }>;
  edit(id: string, index: number, text: string): Promise<LargeEdit>;
}

export interface LargeHooks {
  /** Há (ou deixou de haver) alterações não salvas. */
  onDirty(dirty: boolean): void;
  /** O índice avançou, o total de linhas mudou ou a janela se moveu: atualizar barra de status e barra de rolagem. */
  onChange(): void;
  /** A pessoa rolou o texto (a tabela ao lado rola junto). */
  onScroll?(): void;
  /** Algo que a pessoa precisa ver (texto que a codificação não comporta, arquivo que mudou…). */
  onError(message: string): void;
}

const COMMIT_MS = 500;
const POLL_MS = 400;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const countNl = (s: string) => {
  let n = 0;
  for (let i = s.indexOf("\n"); i !== -1; i = s.indexOf("\n", i + 1)) n++;
  return n;
};

/** Posição, no texto, do começo da linha `k` (a partir de 0). */
function offsetOfLine(text: string, k: number): number {
  let at = 0;
  for (let i = 0; i < k; i++) {
    const nl = text.indexOf("\n", at);
    if (nl === -1) return text.length;
    at = nl + 1;
  }
  return at;
}

/**
 * Um passo de edição de um lote, como o Rust o recebeu: no texto **do arquivo** do lote, `del` virou `ins` a partir de `at`.
 * É pequeno (só o trecho que mudou) e é tudo o que o Ctrl+Z de uma aba grande usa: o histórico do CodeMirror guarda posições
 * da janela, e ao trocar a janela ele aplicaria o desfazer num lugar errado do texto novo.
 */
interface Step {
  index: number;
  at: number;
  del: string;
  ins: string;
}

/** Quanto de texto de passos antigos se guarda para desfazer (por aba): passada a conta, os mais velhos se perdem. */
const MAX_STEP_BYTES = 64 * 1024 * 1024;
const MAX_STEPS = 5000;

/** O trecho que mudou entre dois textos: o que fica igual no começo e no fim (em UTF-16). */
export function changedSpan(a: string, b: string): { from: number; toA: number; toB: number } {
  const max = Math.min(a.length, b.length);
  let from = 0;
  while (from < max && a.charCodeAt(from) === b.charCodeAt(from)) from++;
  // não corta no meio de um par substituto (emoji)
  if (from > 0 && from < max + 1) {
    const c = a.charCodeAt(from - 1);
    if (c >= 0xd800 && c <= 0xdbff) from--;
  }
  let tail = 0;
  while (tail < max - from && a.charCodeAt(a.length - 1 - tail) === b.charCodeAt(b.length - 1 - tail)) tail++;
  if (tail > 0) {
    const c = a.charCodeAt(a.length - tail);
    if (c >= 0xdc00 && c <= 0xdfff) tail--;
  }
  return { from, toA: a.length - tail, toB: b.length - tail };
}

export class LargeTab {
  info: LargeInfo;
  /** O último estado do editor desta aba (a janela atual), com ou sem o editor mostrando-a. */
  state!: EditorState;
  private view: EditorView | null = null;
  /** Último texto de cada lote que o Rust conhece (para só mandar o que mudou). */
  private sent = new Map<number, string>();
  private chain: Promise<unknown> = Promise.resolve();
  private commitTimer: number | undefined;
  private pollTimer: number | undefined;
  private sliding = false;
  private goToken = 0;
  /** O estado do editor já existe (antes disso, ninguém pode perguntar a posição). */
  private ready = false;
  private onScroll = () => this.scrolled();
  /** Última vez que a pessoa rolou, digitou ou clicou: só então a janela desliza (nunca por conta própria). */
  private lastUser = 0;
  private pointerDown = false;
  private onUser = () => void ((this.lastUser = Date.now()), this.cancelJump());
  private onDown = () => void ((this.pointerDown = true), (this.lastUser = Date.now()), this.cancelJump());
  private onUp = () => void ((this.pointerDown = false), (this.lastUser = Date.now()));
  private raf = 0;
  /**
   * Passos de edição por lote (o texto do arquivo antes e depois de cada envio ao Rust), na ordem em que foram dados.
   * O histórico do CodeMirror só enxerga o que está na janela e se perde quando um lote sai dela: com estes passos
   * o Ctrl+Z volta também às alterações feitas em lotes que já não estão carregados (carrega o lote e desfaz).
   */
  private undoSteps: Step[] = [];
  private redoSteps: Step[] = [];
  private stepBytes = 0;
  /**
   * Linha salva (a partir de 0) a que ainda não se pôde ir porque o índice não chegou lá: a janela abre no começo na hora e quem
   * restaura a posição (`main.ts`) vai até a linha em segundo plano, quando o índice chegar. Qualquer outro `goto`, ou rolar o
   * texto, cancela. Enquanto está pendente, é esta a posição que vale guardar na sessão.
   */
  pendingJump: number | null = null;
  /** Desfazendo ou refazendo um passo: o envio que isso causa não vira um passo novo. */
  private stepping = false;
  dirty: boolean;

  constructor(
    readonly id: string,
    info: LargeInfo,
    private io: LargeIo,
    private hooks: LargeHooks,
  ) {
    this.info = info;
    this.dirty = info.edited_batches > 0;
  }

  // ---- montar a janela -------------------------------------------------------------------

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.chain.then(job, job);
    this.chain = next.catch(() => {});
    return next;
  }

  /** Desiste de ir à linha salva (a pessoa foi para outro lugar). */
  cancelJump() {
    if (this.pendingJump === null) return;
    this.pendingJump = null;
    this.goToken++;
  }

  /** Atualiza o que se sabe do arquivo (índice, total de linhas). */
  async refreshInfo(): Promise<LargeInfo> {
    this.info = await this.io.info(this.id);
    if (this.ready) this.hooks.onChange(); // durante a montagem o app ainda não tem o que mostrar
    return this.info;
  }

  /** Enquanto o índice não terminou, acompanha o progresso (para a barra de status e a de rolagem). */
  startPolling() {
    if (this.pollTimer !== undefined || this.info.done) return;
    this.pollTimer = window.setInterval(() => {
      void this.refreshInfo()
        .then((i) => i.done && this.stopPolling())
        .catch(() => this.stopPolling());
    }, POLL_MS);
  }

  private stopPolling() {
    window.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  /** O lote que contém a linha. Se o índice ainda não chegou lá, espera (avisando do progresso). */
  private async locate(line: number, token = this.goToken): Promise<{ batch: number; start_line: number } | null> {
    for (let tries = 0; ; tries++) {
      try {
        return await this.io.locate(this.id, line);
      } catch (e) {
        if (this.info.done || tries > 6000 || token !== this.goToken) throw e;
        await sleep(POLL_MS);
        await this.refreshInfo();
        if (token !== this.goToken) return null;
      }
    }
  }

  /** Espera o índice ter ao menos um lote (logo depois de abrir). */
  private async firstBatch() {
    for (let i = 0; i < 200 && this.info.batches === 0 && !this.info.done; i++) {
      await sleep(25);
      await this.refreshInfo();
    }
  }

  private async readBatches(lo: number, hi: number): Promise<LargeBatch[]> {
    const idx = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    return Promise.all(idx.map((i) => this.io.batch(this.id, i)));
  }

  private static windowOf(batches: LargeBatch[]): { doc: string; win: WindowState } {
    let doc = "";
    const bounds = [0];
    const vbreaks: number[] = [];
    for (const b of batches) {
      for (const p of b.breaks) vbreaks.push(doc.length + p);
      doc += b.text;
      bounds.push(doc.length);
    }
    return { doc, win: { first: batches[0].index, startLine: batches[0].start_line, bounds, vbreaks, lossy: batches.map((b) => b.lossy) } };
  }

  private remember(batches: LargeBatch[]) {
    this.sent.clear();
    for (const b of batches) this.sent.set(b.index, stripBreaks(b.text, b.breaks));
  }

  /**
   * Monta o estado do editor com a janela em volta de `line` (a partir de 0). `build` cria o estado do
   * app (histórico, tema, atalhos…) a partir do texto, da posição do cursor e das extensões desta aba.
   */
  async createState(line: number, build: (doc: string, cursor: number, extra: Extension) => EditorState): Promise<EditorState> {
    await this.firstBatch();
    let target = Math.max(0, line);
    if (target > 0 && !this.info.done) {
      // o índice ainda não chegou à linha salva (arquivo de GB que só começou a ser indexado agora): abre no começo, sem esperar
      try {
        await this.io.locate(this.id, target);
      } catch {
        this.pendingJump = target;
        target = 0;
      }
    }
    line = target;
    const loc = await this.locate(target);
    const [lo, hi] = windowAround(loc?.batch ?? 0, this.info.batches);
    const batches = await this.readBatches(lo, hi);
    const { doc, win } = LargeTab.windowOf(batches);
    this.remember(batches);
    const cursor = offsetOfLine(doc, Math.max(0, line - win.startLine));
    this.state = build(doc, cursor, [largeExtensions, largeField.init(() => win)]);
    this.ready = true;
    this.startPolling();
    return this.state;
  }

  /** O editor passou a mostrar esta aba (ou deixou de mostrar, com `null`). */
  attach(view: EditorView | null) {
    if (this.view) {
      this.state = this.view.state; // o que a janela tinha ao sair
      const old = this.view.scrollDOM;
      old.removeEventListener("scroll", this.onScroll);
      old.removeEventListener("wheel", this.onUser);
      old.removeEventListener("keydown", this.onUser);
      old.removeEventListener("pointerdown", this.onDown);
      window.removeEventListener("pointerup", this.onUp);
    }
    this.view = view;
    this.pointerDown = false;
    if (view) {
      const el = view.scrollDOM;
      el.addEventListener("scroll", this.onScroll, { passive: true });
      el.addEventListener("wheel", this.onUser, { passive: true });
      el.addEventListener("keydown", this.onUser);
      el.addEventListener("pointerdown", this.onDown);
      window.addEventListener("pointerup", this.onUp);
    }
  }

  /** O estado de agora: o do editor, se ele mostra esta aba, ou o último conhecido. */
  private current(): EditorState | undefined {
    return this.view ? this.view.state : this.state;
  }

  /** Mostra o cursor na tela (ao abrir ou voltar a uma aba): no meio. */
  reveal() {
    const v = this.view;
    if (v) v.dispatch({ effects: EditorView.scrollIntoView(v.state.selection.main.head, { y: "center" }) });
  }

  /** O editor avisou de uma mudança: guarda o estado e, se foi digitação, agenda o envio ao Rust. */
  onUpdate(u: ViewUpdate) {
    this.state = u.state;
    if (!u.docChanged || u.transactions.some((t) => t.annotation(windowLoad))) return;
    if (!this.dirty) {
      this.dirty = true;
      this.hooks.onDirty(true);
    }
    window.clearTimeout(this.commitTimer);
    // uma edição da tabela é um passo só dela (digitar espera a pausa, e agrupa o que foi digitado junto)
    const wait = u.transactions.some((t) => t.isUserEvent("input.csv")) ? 0 : COMMIT_MS;
    this.commitTimer = window.setTimeout(() => void this.commit(), wait);
  }

  // ---- ler a posição ---------------------------------------------------------------------

  /** A linha do arquivo (a partir de 0) do cursor. */
  cursorLine(): number {
    const st = this.current();
    return st ? fileLineAt(st, st.selection.main.head) : 0;
  }

  /** A linha do arquivo que está no topo da tela. */
  topLine(): number {
    const v = this.view;
    if (!v) return this.cursorLine();
    try {
      const h = v.scrollDOM.scrollTop - v.documentPadding.top;
      return fileLineAt(v.state, v.lineBlockAtHeight(Math.max(0, h)).from);
    } catch {
      return this.cursorLine();
    }
  }

  get totalLines(): number {
    return this.info.lines;
  }

  // ---- deslizar a janela -----------------------------------------------------------------

  private scrolled() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.hooks.onChange();
      this.hooks.onScroll?.();
      void this.maybeSlide();
    });
  }

  /** A pessoa está rolando agora (roda, teclas, ou o botão do mouse apertado). */
  private userScrolling(): boolean {
    return this.pointerDown || Date.now() - this.lastUser < 1500;
  }

  private async maybeSlide() {
    const v = this.view;
    if (!v || this.sliding || !this.userScrolling()) return; // rolagem causada por nós mesmos não carrega nada
    const e = v.scrollDOM;
    const edge = nearEdge(e.scrollTop, e.scrollHeight, e.clientHeight);
    if (!edge) return;
    this.sliding = true;
    try {
      await this.enqueue(() => (edge === "bottom" ? this.growDown() : this.growUp()));
    } catch (e) {
      console.error("falha ao carregar o trecho vizinho", e);
    } finally {
      this.sliding = false;
    }
  }

  /** Há um lote vizinho a carregar daquele lado da janela? */
  canSlide(dir: "up" | "down"): boolean {
    const st = this.current();
    if (!st) return false;
    const w = st.field(largeField);
    if (dir === "up") return w.first > 0;
    return w.first + w.bounds.length - 1 < this.info.batches || !this.info.done;
  }

  /** Carrega o lote vizinho (quem rola é a tabela, não o editor): um de cada vez. */
  async slide(dir: "up" | "down"): Promise<boolean> {
    if (this.sliding || !this.view || !this.canSlide(dir)) return false;
    this.sliding = true;
    try {
      return await this.enqueue(() => (dir === "down" ? this.growDown() : this.growUp()));
    } catch (e) {
      console.error("falha ao carregar o trecho vizinho", e);
      return false;
    } finally {
      this.sliding = false;
    }
  }

  /** O texto **do arquivo** da janela (sem os `\n` virtuais) e a linha do arquivo em que ele começa: o que a tabela mostra. */
  fileText(): { text: string; startLine: number } | null {
    const st = this.current();
    if (!st) return null;
    const w = st.field(largeField);
    return { text: stripBreaks(st.doc.toString(), w.vbreaks), startLine: w.startLine };
  }

  /** A janela de lotes de agora (as posições e os cortes virtuais), para traduzir posições da tabela. */
  window(): WindowState | null {
    const st = this.current();
    return st ? st.field(largeField) : null;
  }

  /**
   * Rola o texto até a linha `line` do arquivo (a partir de 0) no topo da tela **sem mexer no cursor** (a tabela ao lado
   * rolou e o texto a acompanha). Fora da janela carrega os lotes em volta dela.
   */
  scrollToLine(line: number): Promise<boolean> {
    return this.enqueue(async () => {
      const v = this.view;
      if (!v) return false;
      const target = Math.max(0, Math.floor(line));
      const w = v.state.field(largeField);
      if (target < w.startLine || target >= w.startLine + v.state.doc.lines) {
        const loc = await this.locate(target);
        if (!loc) return false;
        await this.loadWindow(loc.batch, true, target);
      }
      const w2 = v.state.field(largeField);
      const doc = v.state.doc;
      const ln = doc.line(Math.min(Math.max(1, target - w2.startLine + 1), doc.lines));
      v.dispatch({ effects: EditorView.scrollIntoView(ln.from, { y: "start" }) });
      return true;
    });
  }

  /** Acrescenta o lote seguinte no fim da janela. */
  async growDown(): Promise<boolean> {
    const v = this.view;
    if (!v) return false;
    const w = v.state.field(largeField);
    const idx = w.first + w.bounds.length - 1;
    if (idx >= this.info.batches) {
      await this.refreshInfo();
      if (idx >= this.info.batches) return false;
    }
    const b = await this.io.batch(this.id, idx);
    const now = v.state.field(largeField);
    if (now.first + now.bounds.length - 1 !== idx) return false; // a janela mudou enquanto o lote era lido
    v.dispatch({
      changes: { from: v.state.doc.length, insert: b.text },
      effects: appendBatch.of({ length: b.text.length, breaks: b.breaks, lossy: b.lossy }),
      annotations: loadSpec,
    });
    this.sent.set(idx, stripBreaks(b.text, b.breaks));
    if (v.state.field(largeField).bounds.length - 1 > MAX_WINDOW_BATCHES) await this.trim("first");
    this.hooks.onChange();
    return true;
  }

  /** Acrescenta o lote anterior no começo da janela, sem mexer no que se vê. */
  async growUp(): Promise<boolean> {
    const v = this.view;
    if (!v) return false;
    const w = v.state.field(largeField);
    if (w.first === 0) return false;
    const idx = w.first - 1;
    const b = await this.io.batch(this.id, idx);
    if (v.state.field(largeField).first !== w.first) return false;
    // o `scrollSnapshot` do CodeMirror acompanha o texto que entra acima: o que se vê não se mexe
    v.dispatch({
      changes: { from: 0, insert: b.text },
      effects: [prependBatch.of({ length: b.text.length, breaks: b.breaks, lossy: b.lossy, lines: countNl(b.text) }), v.scrollSnapshot()],
      annotations: loadSpec,
    });
    this.sent.set(idx, stripBreaks(b.text, b.breaks));
    if (v.state.field(largeField).bounds.length - 1 > MAX_WINDOW_BATCHES) await this.trim("last");
    this.hooks.onChange();
    return true;
  }

  /** Tira um lote da ponta oposta à que cresceu, mandando antes ao Rust o que se editou nele. */
  private async trim(side: "first" | "last") {
    const v = this.view;
    if (!v) return;
    await this.doCommit(); // o lote que sai não pode levar uma edição que o Rust não viu
    const w = v.state.field(largeField);
    if (w.bounds.length - 1 <= 1) return;
    if (side === "first") {
      const cut = w.bounds[1];
      const lines = countNl(v.state.sliceDoc(0, cut));
      v.dispatch({ changes: { from: 0, to: cut, insert: "" }, effects: [dropFirst.of({ lines }), v.scrollSnapshot()], annotations: loadSpec });
      this.sent.delete(w.first);
    } else {
      const n = w.bounds.length - 1;
      v.dispatch({ changes: { from: w.bounds[n - 1], to: w.bounds[n], insert: "" }, effects: dropLast.of(null), annotations: loadSpec });
      this.sent.delete(w.first + n - 1);
    }
  }

  // ---- ir para a linha -------------------------------------------------------------------

  /** Troca a janela inteira por outra em volta do lote `batch` (as edições vão ao Rust antes). */
  private async loadWindow(batch: number, commit = true, line?: number, focus?: number): Promise<void> {
    const v = this.view;
    if (commit) await this.doCommit();
    const [lo, hi] = windowAround(batch, this.info.batches);
    const batches = await this.readBatches(lo, hi);
    const { doc, win } = LargeTab.windowOf(batches);
    this.remember(batches);
    if (!v) return;
    // o cursor já nasce na linha pedida: um estado intermediário com o cursor no começo da janela seria
    // gravado na sessão pelo autosave e restauraria a posição errada
    const at = line !== undefined ? offsetOfLine(doc, Math.max(0, line - win.startLine)) : focus !== undefined ? (win.bounds[focus - win.first] ?? 0) : 0;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: doc }, effects: resetWindow.of(win), selection: EditorSelection.cursor(at), annotations: loadSpec });
  }

  /**
   * Leva o cursor à linha (a partir de 0) e a põe no meio da tela; `select` seleciona `len` unidades
   * UTF-16 a partir da coluna `col`. A conta de que lote é a linha é só somar as linhas dos lotes
   * (`large_locate`), sem ler o arquivo.
   */
  goto(line: number, opts: { col?: number; len?: number; focus?: boolean; restore?: boolean } = {}): Promise<boolean> {
    if (!opts.restore) this.pendingJump = null; // a pessoa pediu outro lugar: a linha salva já não vale
    const token = ++this.goToken;
    return this.enqueue(async () => {
      const v = this.view;
      if (!v || token !== this.goToken) return false;
      let target = Math.max(0, Math.floor(line));
      if (this.info.done) target = Math.min(target, Math.max(0, this.info.lines - 1));
      const w = v.state.field(largeField);
      if (target < w.startLine || target >= w.startLine + v.state.doc.lines) {
        const loc = await this.locate(target, token);
        if (!loc || token !== this.goToken) return false;
        await this.loadWindow(loc.batch, true, target);
      }
      const w2 = v.state.field(largeField);
      const doc = v.state.doc;
      const k = Math.min(Math.max(1, target - w2.startLine + 1), doc.lines);
      const ln = doc.line(k);
      const from = Math.min(ln.from + (opts.col ?? 0), ln.to);
      const to = opts.len ? Math.min(from + opts.len, ln.to) : from;
      v.dispatch({ selection: to > from ? EditorSelection.range(from, to) : EditorSelection.cursor(from), effects: EditorView.scrollIntoView(from, { y: "center" }) });
      if (opts.focus !== false) v.focus();
      this.hooks.onChange();
      return true;
    });
  }

  // ---- mandar as edições -----------------------------------------------------------------

  /** Texto do arquivo (sem os cortes virtuais) de cada lote da janela. */
  private windowTexts(): { index: number; text: string }[] {
    const st = this.current();
    const out: { index: number; text: string }[] = [];
    if (!st) return out;
    const w = st.field(largeField);
    let vb = 0;
    for (let i = 0; i < w.bounds.length - 1; i++) {
      const [a, b] = [w.bounds[i], w.bounds[i + 1]];
      const rel: number[] = [];
      while (vb < w.vbreaks.length && w.vbreaks[vb] < a) vb++;
      for (let j = vb; j < w.vbreaks.length && w.vbreaks[j] < b; j++) rel.push(w.vbreaks[j] - a);
      out.push({ index: w.first + i, text: stripBreaks(st.sliceDoc(a, b), rel) });
    }
    return out;
  }

  private async doCommit() {
    window.clearTimeout(this.commitTimer);
    for (const { index, text } of this.windowTexts()) {
      if (this.sent.get(index) === text) continue;
      try {
        const prev = this.sent.get(index);
        const out = await this.io.edit(this.id, index, text);
        this.sent.set(index, text);
        if (prev !== undefined && !this.stepping) this.record(index, prev, text);
        this.info = { ...this.info, lines: out.total_lines, edited_batches: out.dirty ? Math.max(1, this.info.edited_batches) : 0 };
        if (out.dirty !== this.dirty) {
          this.dirty = out.dirty;
          this.hooks.onDirty(out.dirty);
        }
      } catch (e) {
        this.hooks.onError(String(e));
        return;
      }
    }
    // desfez tudo antes de o Rust ver (ou logo depois de salvar): o texto já é o do arquivo e a bolinha de "não salvo" apaga
    if (this.dirty && this.info.edited_batches === 0 && !this.pending) {
      this.dirty = false;
      this.hooks.onDirty(false);
    }
    this.hooks.onChange();
  }

  // ---- desfazer entre lotes ---------------------------------------------------------------

  /** Guarda o passo (só o trecho que mudou) e encerra o refazer: uma edição nova. */
  private record(index: number, before: string, after: string) {
    const span = changedSpan(before, after);
    const step: Step = { index, at: span.from, del: before.slice(span.from, span.toA), ins: after.slice(span.from, span.toB) };
    this.undoSteps.push(step);
    this.stepBytes += step.del.length + step.ins.length;
    this.redoSteps = [];
    while (this.undoSteps.length > MAX_STEPS || this.stepBytes > MAX_STEP_BYTES) {
      const old = this.undoSteps.shift();
      if (!old) break;
      this.stepBytes -= old.del.length + old.ins.length;
    }
  }

  /** Há algo a desfazer? */
  get canUndo(): boolean {
    return this.undoSteps.length > 0;
  }

  get canRedo(): boolean {
    return this.redoSteps.length > 0;
  }

  /**
   * Ctrl+Z. Desfaz o passo mais recente, esteja o lote na janela ou não: se não está, carrega o lote (a tela vai até ele) e
   * desfaz lá. O que foi digitado há menos de um instante vai ao Rust antes, para também ser um passo.
   */
  async undo(): Promise<boolean> {
    await this.commit();
    return this.stepThrough("undo");
  }

  /** Ctrl+Y / Ctrl+Shift+Z: o contrário. */
  async redo(): Promise<boolean> {
    await this.commit();
    return this.stepThrough("redo");
  }

  private stepThrough(dir: "undo" | "redo"): Promise<boolean> {
    const from = dir === "undo" ? this.undoSteps : this.redoSteps;
    const to = dir === "undo" ? this.redoSteps : this.undoSteps;
    return this.enqueue(async () => {
      const v = this.view;
      if (!v) return false;
      while (from.length > 0) {
        const step = from.pop()!;
        this.stepBytes -= step.del.length + step.ins.length;
        const [gone, back] = dir === "undo" ? [step.ins, step.del] : [step.del, step.ins];
        if (!this.inWindow(step.index)) await this.loadWindow(step.index, true, undefined, step.index);
        const cur = this.windowTexts().find((x) => x.index === step.index)?.text;
        // o lote já não está como o passo supõe (outro passo velho, texto trocado): este passo não se aplica
        if (cur === undefined || cur.slice(step.at, step.at + gone.length) !== gone) continue;
        this.replaceBatch(step.index, cur, cur.slice(0, step.at) + back + cur.slice(step.at + gone.length));
        this.stepping = true;
        try {
          await this.doCommit();
        } finally {
          this.stepping = false;
        }
        to.push(step);
        this.stepBytes += step.del.length + step.ins.length;
        this.hooks.onChange();
        return true;
      }
      return false;
    });
  }

  private inWindow(index: number): boolean {
    const st = this.current();
    if (!st) return false;
    const w = st.field(largeField);
    return index >= w.first && index < w.first + w.bounds.length - 1;
  }

  /**
   * Troca, no editor, o texto do lote `index` (texto de arquivo `cur`) por `want`, só no trecho que muda (as divisas dos lotes
   * ficam onde estão) e **fora do histórico do editor**: é o passo de desfazer, não uma edição nova. Põe o cursor no começo do
   * trecho e o mostra no meio da tela.
   */
  private replaceBatch(index: number, cur: string, want: string) {
    const v = this.view;
    if (!v) return;
    const w = v.state.field(largeField);
    const k = index - w.first;
    const [a, b] = [w.bounds[k], w.bounds[k + 1]];
    const rel = w.vbreaks.filter((p) => p >= a && p < b).map((p) => p - a);
    const span = changedSpan(cur, want);
    const from = a + docPos({ vbreaks: rel }, span.from);
    const to = a + docPos({ vbreaks: rel }, span.toA, true);
    v.dispatch({
      changes: { from, to, insert: want.slice(span.from, span.toB) },
      selection: EditorSelection.cursor(from),
      effects: EditorView.scrollIntoView(from, { y: "center" }),
      annotations: Transaction.addToHistory.of(false),
    });
  }

  /** Manda ao Rust os lotes editados (o Rust os guarda no diário em disco; o arquivo do usuário não muda). */
  commit(): Promise<void> {
    return this.enqueue(() => this.doCommit());
  }

  /** Há edição que o Rust ainda não viu. */
  get pending(): boolean {
    return this.windowTexts().some((x) => this.sent.get(x.index) !== x.text);
  }

  // ---- depois de salvar ou recarregar ----------------------------------------------------

  /**
   * Depois de salvar (ou recarregar): o arquivo é outro. Se a numeração dos lotes não mudou, só se
   * registra o texto atual como o salvo (e o Ctrl+Z continua valendo); senão a janela é relida em
   * volta da linha onde se estava.
   */
  async afterWrite(info: LargeInfo, keepWindow: boolean): Promise<void> {
    const before = this.info.batches;
    this.info = info;
    this.dirty = false;
    this.hooks.onDirty(false);
    if (!(keepWindow && info.done && info.batches === before)) {
      // o arquivo é outro (ou os lotes mudaram de numeração): os passos guardados já não valem
      this.undoSteps = [];
      this.redoSteps = [];
      this.stepBytes = 0;
    }
    if (keepWindow && info.done && info.batches === before) {
      for (const x of this.windowTexts()) this.sent.set(x.index, x.text);
      this.hooks.onChange();
      return;
    }
    const line = this.cursorLine();
    window.clearTimeout(this.commitTimer);
    this.startPolling();
    await this.firstBatch();
    const loc = await this.locate(line);
    // os lotes mudaram de numeração: nada do que o Rust não viu pode ir com os índices de antes
    await this.enqueue(() => this.loadWindow(loc?.batch ?? 0, false, line));
    await this.goto(line, { focus: false });
  }

  /** Larga a aba (fechada): para os temporizadores. */
  dispose() {
    window.clearTimeout(this.commitTimer);
    this.stopPolling();
    this.attach(null);
  }
}
