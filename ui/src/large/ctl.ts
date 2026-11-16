// Uma aba de arquivo grande (`crates/core/src/large.rs`). O arquivo fica no disco; o editor tem só uma
// **janela** de lotes seguidos (`state.ts`). Aqui estão as operações sobre ela: carregar em volta de uma
// linha, deslizar ao rolar, ir para a linha, mandar as edições de cada lote ao Rust e refazer a janela
// depois de salvar. Nada aqui lê o arquivo inteiro nem toca na nota da aba (`notes/` é só um marcador).
import { EditorSelection, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import type { LargeBatch, LargeEdit, LargeInfo } from "../api";
import { MAX_WINDOW_BATCHES, nearEdge, stripBreaks, windowAround } from "./model";
import { appendBatch, dropFirst, dropLast, fileLineAt, largeExtensions, largeField, loadSpec, prependBatch, resetWindow, windowLoad, type WindowState } from "./state";

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
  private onUser = () => void (this.lastUser = Date.now());
  private onDown = () => void ((this.pointerDown = true), (this.lastUser = Date.now()));
  private onUp = () => void ((this.pointerDown = false), (this.lastUser = Date.now()));
  private raf = 0;
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
        if (this.info.done || tries > 600 || token !== this.goToken) throw e;
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
    const loc = await this.locate(Math.max(0, line));
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
    this.commitTimer = window.setTimeout(() => void this.commit(), COMMIT_MS);
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
  private async loadWindow(batch: number, commit = true, line?: number): Promise<void> {
    const v = this.view;
    if (commit) await this.doCommit();
    const [lo, hi] = windowAround(batch, this.info.batches);
    const batches = await this.readBatches(lo, hi);
    const { doc, win } = LargeTab.windowOf(batches);
    this.remember(batches);
    if (!v) return;
    // o cursor já nasce na linha pedida: um estado intermediário com o cursor no começo da janela seria
    // gravado na sessão pelo autosave e restauraria a posição errada
    const at = line === undefined ? 0 : offsetOfLine(doc, Math.max(0, line - win.startLine));
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: doc }, effects: resetWindow.of(win), selection: EditorSelection.cursor(at), annotations: loadSpec });
  }

  /**
   * Leva o cursor à linha (a partir de 0) e a põe no meio da tela; `select` seleciona `len` unidades
   * UTF-16 a partir da coluna `col`. A conta de que lote é a linha é só somar as linhas dos lotes
   * (`large_locate`), sem ler o arquivo.
   */
  goto(line: number, opts: { col?: number; len?: number; focus?: boolean } = {}): Promise<boolean> {
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
        const out = await this.io.edit(this.id, index, text);
        this.sent.set(index, text);
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
    this.hooks.onChange();
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
