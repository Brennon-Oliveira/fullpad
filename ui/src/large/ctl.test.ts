// @vitest-environment jsdom
import { undo, undoDepth } from "@codemirror/commands";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LargeBatch, LargeEdit, LargeInfo } from "../api";
import { createState, createView } from "../editor";
import { changedSpan, LargeTab, type LargeHooks, type LargeIo } from "./ctl";
import { stripBreaks } from "./model";
import { largeField } from "./state";

beforeAll(() => {
  // o CodeMirror mede texto com Range.getClientRects, que o jsdom não tem
  const r = Range.prototype as unknown as Record<string, unknown>;
  r.getClientRects ??= () => [];
  r.getBoundingClientRect ??= () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
});

const nl = (s: string) => s.split("\n").length - 1;

/** O Rust em memória: lotes de texto de arquivo (sem cortes virtuais), com a mesma conta de linhas do core. */
class FakeRust implements LargeIo {
  batches: { text: string; breaks: number[]; lossy?: boolean }[];
  edits: { index: number; text: string }[] = [];
  failEdit = false;
  done = true;
  batchCalls: number[] = [];
  constructor(batches: { text: string; breaks?: number[]; lossy?: boolean }[]) {
    this.batches = batches.map((b) => ({ text: b.text, breaks: b.breaks ?? [], lossy: b.lossy }));
    this.original = this.batches.map((b) => b.text);
  }
  /** O texto de cada lote no arquivo: o Rust só tem alteração onde o texto difere dele. */
  original: string[];
  /** `n` lotes de 3 linhas: "L<n>" numeradas de 0. */
  static lines(n: number, per = 3): FakeRust {
    return new FakeRust(Array.from({ length: n }, (_, b) => ({ text: Array.from({ length: per }, (_, i) => `L${b * per + i}\n`).join("") })));
  }
  private startOf(i: number) {
    return this.batches.slice(0, i).reduce((a, b) => a + nl(this.display(b)), 0);
  }
  /** O texto de exibição: o de arquivo com os \n virtuais nas posições `breaks` (aqui, fornecidos já embutidos). */
  private display(b: { text: string }) {
    return b.text;
  }
  total() {
    return this.batches.reduce((a, b) => a + nl(b.text), 0) + 1;
  }
  async info(): Promise<LargeInfo> {
    return { size: 1000, encoding: "utf8", eol: "lf", batches: this.batches.length, lines: this.total(), done: this.done, indexed: 1000, edited_batches: this.batches.filter((b, i) => b.text !== this.original[i]).length, orphaned: false, error: null, path: "/x.log", save_done: 0, save_total: 0 };
  }
  async batch(_id: string, index: number): Promise<LargeBatch> {
    this.batchCalls.push(index);
    const b = this.batches[index];
    if (!b) throw new Error("lote inexistente");
    return { index, start_line: this.startOf(index), lines: nl(b.text), text: b.text, breaks: b.breaks, lossy: !!b.lossy, edited: false, count: this.batches.length, done: this.done };
  }
  async locate(_id: string, line: number) {
    let acc = 0;
    for (let i = 0; i < this.batches.length; i++) {
      const n = nl(this.batches[i].text);
      if (line < acc + n || i === this.batches.length - 1) return { batch: i, start_line: acc };
      acc += n;
    }
    throw new Error("sem lotes");
  }
  async edit(_id: string, index: number, text: string): Promise<LargeEdit> {
    if (this.failEdit) throw new Error("O texto tem caracteres que não existem em Windows-1252");
    this.edits.push({ index, text });
    this.batches[index] = { ...this.batches[index], text, breaks: [] };
    return { edited: text !== this.original[index], lines: nl(text), total_lines: this.total(), dirty: this.batches.some((b, i) => b.text !== this.original[i]) };
  }
  whole() {
    return this.batches.map((b) => b.text).join("");
  }
}

interface Rig {
  rust: FakeRust;
  ctl: LargeTab;
  view: EditorView;
  hooks: { dirty: boolean[]; errors: string[]; changes: number };
}

async function rig(rust: FakeRust, line = 0): Promise<Rig> {
  const hooks = { dirty: [] as boolean[], errors: [] as string[], changes: 0 };
  const h: LargeHooks = { onDirty: (d) => hooks.dirty.push(d), onChange: () => hooks.changes++, onError: (m) => hooks.errors.push(m) };
  const info = await rust.info();
  const ctl = new LargeTab("t1", info, rust, h);
  const state = await ctl.createState(line, (doc, cursor, extra) => createState(doc, cursor, (u) => ctl.onUpdate(u), extra));
  const view = createView(document.createElement("div"), state);
  // como o app: cada atualização do editor chega ao controlador pelo ouvinte do estado (já está no createState)
  ctl.attach(view);
  return { rust, ctl, view, hooks };
}

const win = (v: EditorView) => v.state.field(largeField);
const lineText = (s: EditorState, n: number) => s.doc.line(n).text;

afterEach(() => vi.useRealTimers());

describe("abrir em volta de uma linha", () => {
  it("carrega o lote da linha e um vizinho de cada lado", async () => {
    const { view, ctl, rust } = await rig(FakeRust.lines(12), 20); // linha 20: lote 6
    expect(win(view).first).toBe(5);
    expect(win(view).bounds).toHaveLength(4);
    expect(win(view).startLine).toBe(15);
    expect(ctl.cursorLine()).toBe(20);
    expect(rust.batchCalls.sort()).toEqual([5, 6, 7]);
    expect(lineText(view.state, 6)).toBe("L20");
  });

  it("na linha 0 só há vizinho de um lado", async () => {
    const { view } = await rig(FakeRust.lines(12), 0);
    expect(win(view).first).toBe(0);
    expect(win(view).bounds).toHaveLength(3);
  });

  it("espera o índice produzir o primeiro lote", async () => {
    const rust = FakeRust.lines(3);
    const real = rust.info.bind(rust);
    let calls = 0;
    rust.info = async () => ({ ...(await real()), batches: calls++ < 2 ? 0 : 3, done: calls >= 3 });
    const info = await real();
    const ctl = new LargeTab("t1", { ...info, batches: 0, done: false }, rust, { onDirty() {}, onChange() {}, onError() {} });
    const st = await ctl.createState(0, (doc, cursor, extra) => createState(doc, cursor, () => {}, extra));
    expect(st.doc.toString()).toContain("L0");
  });
});

describe("abrir longe, com o índice ainda indo (restaurar a aba depois de reiniciar)", () => {
  it("esperar o índice não pergunta a posição antes de o editor existir", async () => {
    vi.useFakeTimers();
    const rust = FakeRust.lines(50);
    const real = rust.locate.bind(rust);
    let tries = 0;
    rust.done = false; // o índice ainda está indo
    rust.locate = async (id, line) => {
      if (tries++ < 3) throw new Error("o índice ainda não chegou a essa linha");
      rust.done = true;
      return real(id, line);
    };
    const info = { ...(await rust.info()), done: false };
    let asked = 0;
    let ctl!: LargeTab;
    const hooks: LargeHooks = {
      onDirty() {},
      // como o app: a cada avanço do índice a barra de status pergunta onde está o cursor
      onChange: () => void (asked++, ctl.cursorLine(), ctl.topLine()),
      onError() {},
    };
    ctl = new LargeTab("t1", info, rust, hooks);
    const p = ctl.createState(120, (doc, cursor, extra) => createState(doc, cursor, () => {}, extra));
    await vi.advanceTimersByTimeAsync(3000);
    const st = await p;
    expect(st.doc.toString()).toContain("L120");
    expect(ctl.cursorLine()).toBe(120);
    expect(asked).toBeLessThanOrEqual(1); // só depois de o editor existir (o acompanhamento do índice)
  });
});

describe("ir para a linha", () => {
  it("dentro da janela só move o cursor, sem ler nada", async () => {
    const { ctl, view, rust } = await rig(FakeRust.lines(12), 20);
    rust.batchCalls = [];
    expect(await ctl.goto(22)).toBe(true);
    expect(ctl.cursorLine()).toBe(22);
    expect(rust.batchCalls).toEqual([]);
    expect(win(view).first).toBe(5);
  });

  it("fora da janela troca a janela pelo lote da linha", async () => {
    const { ctl, view, rust } = await rig(FakeRust.lines(100), 0);
    rust.batchCalls = [];
    await ctl.goto(150); // lote 50
    expect(win(view).first).toBe(49);
    expect(ctl.cursorLine()).toBe(150);
    expect(lineText(view.state, 150 - win(view).startLine + 1)).toBe("L150");
    expect(rust.batchCalls.sort((a, b) => a - b)).toEqual([49, 50, 51]);
  });

  it("a conta do lote é só somar as linhas: pular para a última linha e voltar à primeira", async () => {
    const { ctl, view } = await rig(FakeRust.lines(1000), 0);
    await ctl.goto(2_999_999); // além do fim: vale a última linha
    expect(win(view).first).toBe(998);
    expect(lineText(view.state, view.state.doc.lines - 1)).toBe("L2999");
    await ctl.goto(0);
    expect(win(view).first).toBe(0);
    expect(ctl.cursorLine()).toBe(0);
  });

  it("linha negativa vai para o começo", async () => {
    const { ctl } = await rig(FakeRust.lines(12), 20);
    await ctl.goto(-5);
    expect(ctl.cursorLine()).toBe(0);
  });

  it("seleciona o trecho pedido (busca)", async () => {
    const { ctl, view } = await rig(FakeRust.lines(12), 0);
    await ctl.goto(4, { col: 1, len: 1 });
    const sel = view.state.selection.main;
    expect(view.state.sliceDoc(sel.from, sel.to)).toBe("4");
  });

  it("trocar a janela não entra no histórico: Ctrl+Z não desfaz o salto", async () => {
    const { ctl, view } = await rig(FakeRust.lines(100), 0);
    await ctl.goto(150);
    expect(undoDepth(view.state)).toBe(0);
    const doc = view.state.doc.toString();
    expect(undo(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("saltos em sequência: só vale o último", async () => {
    const { ctl } = await rig(FakeRust.lines(100), 0);
    const a = ctl.goto(50);
    const b = ctl.goto(250);
    await Promise.all([a, b]);
    expect(ctl.cursorLine()).toBe(250);
  });

  it("espera o índice chegar à linha (arquivo ainda sendo indexado)", async () => {
    const rust = FakeRust.lines(10);
    const { ctl } = await rig(rust, 0);
    let tries = 0;
    const real = rust.locate.bind(rust);
    rust.done = false;
    rust.locate = async (id, line) => {
      if (tries++ < 2) throw new Error("o índice ainda não chegou a essa linha");
      return real(id, line);
    };
    ctl.info = { ...ctl.info, done: false };
    vi.useFakeTimers();
    const p = ctl.goto(20);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toBe(true);
    expect(ctl.cursorLine()).toBe(20);
  });
});

describe("o cursor nunca passa por uma posição errada ao trocar a janela", () => {
  it("ao saltar para longe, nenhum estado intermediário tem o cursor fora da linha pedida", async () => {
    const rust = FakeRust.lines(200);
    const info = await rust.info();
    const seen: number[] = [];
    let ctl!: LargeTab;
    ctl = new LargeTab("t1", info, rust, { onDirty() {}, onChange() {}, onError() {} });
    const { EditorView: EV } = await import("@codemirror/view");
    const st = await ctl.createState(0, (doc, cursor, extra) => createState(doc, cursor, (u) => ctl.onUpdate(u), [extra, EV.updateListener.of(() => seen.push(ctl.cursorLine()))]));
    const view = createView(document.createElement("div"), st);
    ctl.attach(view);
    seen.length = 0;
    await ctl.goto(450);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([450])); // o autosave nunca vê o começo da janela
  });

  it("depois de salvar com lotes renumerados também não", async () => {
    const rust = FakeRust.lines(40);
    const info = await rust.info();
    const seen: number[] = [];
    let ctl!: LargeTab;
    ctl = new LargeTab("t1", info, rust, { onDirty() {}, onChange() {}, onError() {} });
    const { EditorView: EV } = await import("@codemirror/view");
    const st = await ctl.createState(60, (doc, cursor, extra) => createState(doc, cursor, (u) => ctl.onUpdate(u), [extra, EV.updateListener.of(() => seen.push(ctl.cursorLine()))]));
    const view = createView(document.createElement("div"), st);
    ctl.attach(view);
    seen.length = 0;
    rust.batches.splice(0, 1); // o salvar emendou linhas: o índice agora tem outra numeração
    await ctl.afterWrite(await rust.info(), true);
    expect(new Set(seen)).toEqual(new Set([60]));
  });
});

describe("deslizar ao rolar", () => {
  it("o lote seguinte entra no fim sem mexer no começo", async () => {
    const { ctl, view } = await rig(FakeRust.lines(12), 0);
    const before = win(view);
    expect(await ctl.growDown()).toBe(true);
    const w = win(view);
    expect(w.first).toBe(before.first);
    expect(w.startLine).toBe(before.startLine);
    expect(w.bounds).toHaveLength(before.bounds.length + 1);
    expect(w.bounds[w.bounds.length - 1]).toBe(view.state.doc.length);
  });

  it("o lote anterior entra no começo e a janela recua", async () => {
    const { ctl, view } = await rig(FakeRust.lines(12), 30); // lote 10
    const before = win(view);
    expect(await ctl.growUp()).toBe(true);
    const w = win(view);
    expect(w.first).toBe(before.first - 1);
    expect(w.startLine).toBe(before.startLine - 3);
    expect(lineText(view.state, 1)).toBe(`L${w.startLine}`);
  });

  it("no fim do arquivo não há o que acrescentar", async () => {
    const { ctl } = await rig(FakeRust.lines(2), 0);
    expect(await ctl.growDown()).toBe(false);
    expect(await ctl.growUp()).toBe(false);
  });

  it("passando de 4 lotes, o da ponta oposta sai e o início avança", async () => {
    const { ctl, view } = await rig(FakeRust.lines(20), 0); // lotes 0 e 1
    for (let i = 0; i < 6; i++) await ctl.growDown();
    const w = win(view);
    expect(w.bounds.length - 1).toBe(4);
    expect(w.first).toBe(4); // lotes 4 a 7
    expect(w.startLine).toBe(12);
    expect(lineText(view.state, 1)).toBe("L12");
  });

  it("a janela que sai leva antes ao Rust a edição que tinha", async () => {
    const { ctl, view, rust } = await rig(FakeRust.lines(20), 0);
    view.dispatch({ changes: { from: 0, insert: "EDITADO " } }); // no lote 0
    for (let i = 0; i < 4; i++) await ctl.growDown();
    expect(win(view).first).toBeGreaterThan(0);
    expect(rust.edits.map((e) => e.index)).toContain(0);
    expect(rust.batches[0].text.startsWith("EDITADO L0")).toBe(true);
  });

  it("subir passando de 4 lotes tira o último", async () => {
    const { ctl, view } = await rig(FakeRust.lines(20), 57); // lote 19
    for (let i = 0; i < 6; i++) await ctl.growUp();
    const w = win(view);
    expect(w.bounds.length - 1).toBe(4);
    expect(w.first).toBe(12); // começou em [18, 19]; cada subida acrescenta um e, passando de 4, tira o último: 12 a 15
  });

  it("deslizar não conta como edição", async () => {
    const { ctl, hooks } = await rig(FakeRust.lines(20), 0);
    await ctl.growDown();
    await ctl.growDown();
    expect(hooks.dirty).toEqual([]);
    expect(ctl.dirty).toBe(false);
  });
});

describe("deslizar só quando a pessoa rola", () => {
  const nearBottom = (view: EditorView) => {
    const el = view.scrollDOM;
    Object.defineProperty(el, "clientHeight", { configurable: true, value: 800 });
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: 100_000 });
    Object.defineProperty(el, "scrollTop", { configurable: true, writable: true, value: 99_000 });
  };
  const frames = () => new Promise((r) => setTimeout(r, 80));

  it("rolagem causada pelo próprio app (salto, restauração) não carrega o lote vizinho", async () => {
    const { view, rust } = await rig(FakeRust.lines(40), 60);
    nearBottom(view);
    rust.batchCalls = [];
    view.scrollDOM.dispatchEvent(new Event("scroll"));
    await frames();
    expect(rust.batchCalls).toEqual([]);
    expect(win(view).bounds.length - 1).toBe(3);
  });

  it("depois de a pessoa girar a roda, a rolagem perto da borda carrega o próximo lote", async () => {
    const { view, rust } = await rig(FakeRust.lines(40), 60);
    nearBottom(view);
    rust.batchCalls = [];
    view.scrollDOM.dispatchEvent(new Event("wheel"));
    view.scrollDOM.dispatchEvent(new Event("scroll"));
    await frames();
    expect(rust.batchCalls).toEqual([22]); // a janela ia de 19 a 21 (linha 60 = lote 20): vem o 22
  });

  it("segurar o botão do mouse (arrastar a seleção) também vale como rolagem da pessoa", async () => {
    const { view, rust } = await rig(FakeRust.lines(40), 60);
    nearBottom(view);
    rust.batchCalls = [];
    view.scrollDOM.dispatchEvent(new Event("pointerdown"));
    view.scrollDOM.dispatchEvent(new Event("scroll"));
    await frames();
    expect(rust.batchCalls.length).toBe(1);
  });
});

describe("edição", () => {
  it("só os lotes mudados vão ao Rust, com o texto do arquivo", async () => {
    const { ctl, view, rust } = await rig(FakeRust.lines(12), 20);
    const pos = view.state.doc.line(6).from; // "L20"
    view.dispatch({ changes: { from: pos, to: pos + 3, insert: "vinte" } });
    await ctl.commit();
    expect(rust.edits).toHaveLength(1);
    expect(rust.edits[0].index).toBe(6); // o lote 6 tem as linhas L18 a L20
    expect(rust.edits[0].text).toBe("L18\nL19\nvinte\n");
  });

  it("sem alteração nada é enviado", async () => {
    const { ctl, rust } = await rig(FakeRust.lines(12), 20);
    await ctl.commit();
    expect(rust.edits).toEqual([]);
  });

  it("digitar e desfazer antes de enviar não manda nada", async () => {
    const { ctl, view, rust } = await rig(FakeRust.lines(12), 20);
    view.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input.type" });
    undo(view);
    await ctl.commit();
    expect(rust.edits).toEqual([]);
  });

  it("editar e desfazer antes de enviar apaga o \"não salvo\" (o texto voltou ao do arquivo)", async () => {
    const { ctl, view, hooks } = await rig(FakeRust.lines(12), 20);
    view.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input.csv" });
    expect(hooks.dirty.at(-1)).toBe(true);
    undo(view);
    await ctl.commit();
    expect(hooks.dirty.at(-1)).toBe(false);
  });

  it("depois de salvar, editar e desfazer também volta a \"salvo\"", async () => {
    const { ctl, view, rust, hooks } = await rig(FakeRust.lines(12), 20);
    view.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input.csv" });
    await ctl.commit();
    rust.original = rust.batches.map((b) => b.text); // salvar: o texto de agora passa a ser o do arquivo
    await ctl.afterWrite(await rust.info(), true);
    expect(hooks.dirty.at(-1)).toBe(false);
    view.dispatch({ changes: { from: 0, insert: "y" }, userEvent: "input.csv" });
    expect(hooks.dirty.at(-1)).toBe(true);
    undo(view);
    await ctl.commit();
    expect(hooks.dirty.at(-1)).toBe(false);
  });

  it("desfazer tudo depois de enviar também apaga o \"não salvo\"", async () => {
    const { ctl, view, hooks } = await rig(FakeRust.lines(12), 20);
    view.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input.csv" });
    await ctl.commit();
    expect(hooks.dirty.at(-1)).toBe(true);
    undo(view);
    await ctl.commit();
    expect(hooks.dirty.at(-1)).toBe(false);
  });

  it("desfazer uma edição enquanto outro lote segue editado mantém o \"não salvo\"", async () => {
    const { ctl, view, hooks } = await rig(FakeRust.lines(12), 20);
    view.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input.csv" });
    await ctl.commit();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "y" }, userEvent: "input.csv" });
    undo(view); // desfaz só a última
    await ctl.commit();
    expect(hooks.dirty.at(-1)).toBe(true);
  });

  it("desfazer depois de enviar manda o texto original de volta", async () => {
    const { ctl, view, rust } = await rig(FakeRust.lines(12), 20);
    view.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input.type" });
    await ctl.commit();
    undo(view);
    await ctl.commit();
    expect(rust.edits.map((e) => e.text.startsWith("x"))).toEqual([true, false]);
  });

  it("uma edição que atravessa a divisa de dois lotes edita os dois", async () => {
    const { ctl, view, rust } = await rig(FakeRust.lines(12), 20);
    // o lote 6 termina em "L20\n" e o 7 começa em "L21": troca "\nL" (o fim de um e o começo do outro) por "+"
    const b = win(view).bounds;
    view.dispatch({ changes: { from: b[2] - 1, to: b[2] + 1, insert: "+" } });
    await ctl.commit();
    const sent = new Map(rust.edits.map((e) => [e.index, e.text]));
    // o texto trocado fica no lote de depois; o de antes perde o \n do fim: os dois mudam
    expect(sent.get(6)).toBe("L18\nL19\nL20");
    expect(sent.get(7)).toBe("+21\nL22\nL23\n");
    // o arquivo continua o mesmo, só com a emenda
    expect(rust.whole()).toContain("L20+21\nL22");
    // e o total de linhas ficou menor em uma
    expect((await rust.info()).lines).toBe(12 * 3 + 1 - 1);
  });

  it("colar em cima da divisa mantém cada pedaço no seu lote", async () => {
    const { ctl, view, rust } = await rig(FakeRust.lines(12), 20);
    const b = win(view).bounds;
    view.dispatch({ changes: { from: b[2] - 4, to: b[2] + 4, insert: "A\nB\nC\n" } });
    await ctl.commit();
    const joined = [5, 6, 7].map((i) => rust.batches[i].text).join("");
    expect(joined).toBe(view.state.doc.toString());
  });

  it("edição dentro de um trecho cortado em segmentos: o \\n virtual não vai ao arquivo", async () => {
    const seg = "abcdefgh";
    const rust = new FakeRust([{ text: `${seg}${seg}${seg}\nfim\n`, breaks: [8, 17] }]);
    // o texto de exibição que o Rust devolve tem os \n virtuais embutidos
    const real = rust.batch.bind(rust);
    rust.batch = async (id, i) => {
      const b = await real(id, i);
      return { ...b, text: `${seg}\n${seg}\n${seg}\nfim\n`, lines: 5 };
    };
    const { ctl, view } = await rig(rust, 0);
    expect(view.state.doc.lines).toBe(5);
    view.dispatch({ changes: { from: 0, insert: "X" } });
    await ctl.commit();
    expect(rust.edits[0].text).toBe(`X${seg}${seg}${seg}\nfim\n`);
  });

  it("apagar o \\n virtual junta os segmentos sem criar nem apagar quebra real", async () => {
    const seg = "abcdefgh";
    const rust = new FakeRust([{ text: `${seg}${seg}\nfim\n`, breaks: [8] }]);
    const real = rust.batch.bind(rust);
    rust.batch = async (id, i) => ({ ...(await real(id, i)), text: `${seg}\n${seg}\nfim\n`, lines: 3 });
    const { ctl, view } = await rig(rust, 0);
    view.dispatch({ changes: { from: 8, to: 9 } }); // Backspace na quebra visual
    await ctl.commit();
    expect(win(view).vbreaks).toEqual([]);
    expect(rust.edits[0]?.text ?? `${seg}${seg}\nfim\n`).toBe(`${seg}${seg}\nfim\n`);
  });

  it("o aviso de alteração sai uma vez, na primeira digitação", async () => {
    const { view, hooks } = await rig(FakeRust.lines(12), 20);
    view.dispatch({ changes: { from: 0, insert: "a" }, userEvent: "input.type" });
    view.dispatch({ changes: { from: 0, insert: "b" }, userEvent: "input.type" });
    expect(hooks.dirty).toEqual([true]);
  });

  it("o envio é agendado sozinho depois de uma pausa na digitação", async () => {
    vi.useFakeTimers();
    const { view, rust } = await rig(FakeRust.lines(12), 20);
    view.dispatch({ changes: { from: 0, insert: "a" }, userEvent: "input.type" });
    await vi.advanceTimersByTimeAsync(100);
    expect(rust.edits).toEqual([]);
    await vi.advanceTimersByTimeAsync(600);
    expect(rust.edits).toHaveLength(1);
  });

  it("falha ao guardar (texto que a codificação não comporta) avisa e tenta de novo na próxima", async () => {
    const { ctl, view, rust, hooks } = await rig(FakeRust.lines(12), 20);
    view.dispatch({ changes: { from: 0, insert: "日本" } });
    rust.failEdit = true;
    await ctl.commit();
    expect(hooks.errors[0]).toContain("Windows-1252");
    expect(ctl.pending).toBe(true);
    rust.failEdit = false;
    await ctl.commit();
    expect(ctl.pending).toBe(false);
  });

  it("lote com bytes inválidos: o editor não deixa mexer nele", async () => {
    const rust = FakeRust.lines(3);
    rust.batches[1].lossy = true;
    const { view } = await rig(rust, 4);
    const b = win(view).bounds;
    const before = view.state.doc.toString();
    view.dispatch({ changes: { from: b[1] + 1, insert: "x" } });
    expect(view.state.doc.toString()).toBe(before);
    view.dispatch({ changes: { from: 0, insert: "ok" } });
    expect(view.state.doc.toString()).not.toBe(before);
  });
});

describe("depois de salvar", () => {
  it("com a mesma numeração de lotes a janela fica e o texto atual passa a ser o salvo", async () => {
    const { ctl, view, rust } = await rig(FakeRust.lines(12), 20);
    view.dispatch({ changes: { from: 0, insert: "z" } });
    await ctl.commit();
    rust.batchCalls = [];
    await ctl.afterWrite(await rust.info(), true);
    expect(ctl.dirty).toBe(false);
    expect(rust.batchCalls).toEqual([]);
    expect(ctl.pending).toBe(false);
  });

  it("com lotes renumerados a janela é lida de novo em volta da mesma linha, sem mandar nada com índice velho", async () => {
    const { ctl, view, rust } = await rig(FakeRust.lines(12), 20);
    const edits = rust.edits.length;
    // o salvar emendou linhas: o índice agora tem 11 lotes
    rust.batches.splice(0, 1);
    rust.done = true;
    await ctl.afterWrite(await rust.info(), true);
    expect(rust.edits.length).toBe(edits);
    expect(ctl.cursorLine()).toBe(20 - 0);
    expect(view.state.doc.toString()).toContain("L20");
  });
});

describe("posição", () => {
  it("a aba que sai guarda o estado e depois pode voltar", async () => {
    const { ctl, view } = await rig(FakeRust.lines(12), 20);
    view.dispatch({ changes: { from: 0, insert: "q" } });
    ctl.attach(null);
    expect(ctl.cursorLine()).toBe(20);
    expect(ctl.state.doc.toString()).toContain("qL");
  });
});

// a conta de linhas do arquivo inteiro (a barra de status e a de rolagem usam)
describe("total de linhas", () => {
  it("segue as edições que o Rust confirmou", async () => {
    const { ctl, view } = await rig(FakeRust.lines(12), 20);
    expect(ctl.totalLines).toBe(37);
    view.dispatch({ changes: { from: 0, insert: "a\nb\nc\n" } });
    await ctl.commit();
    expect(ctl.totalLines).toBe(40);
  });
});

void stripBreaks;

describe("desfazer uma edição da tabela (antes de salvar)", () => {
  const tableEdit = (v: EditorView, from: number, to: number, insert: string) => v.dispatch({ changes: { from, to, insert }, userEvent: "input.csv" });

  it("depois de confirmar o lote no Rust, Ctrl+Z ainda desfaz", async () => {
    const { ctl, view } = await rig(FakeRust.lines(12), 20);
    const before = view.state.doc.toString();
    tableEdit(view, 0, 1, "ZZ");
    await ctl.commit();
    expect(undoDepth(view.state)).toBeGreaterThan(0);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(before);
  });

  it("depois de a janela deslizar para baixo e para cima, Ctrl+Z ainda desfaz", async () => {
    const { ctl, view } = await rig(FakeRust.lines(12), 20);
    const before = view.state.doc.toString();
    tableEdit(view, 0, 1, "ZZ");
    await ctl.slide("down");
    await ctl.slide("up");
    await ctl.commit();
    expect(undoDepth(view.state)).toBeGreaterThan(0);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toContain("L");
    expect(view.state.doc.toString()).not.toContain("ZZ");
    expect(before.length).toBeGreaterThan(0);
  });

  it("uma edição no começo da janela sobrevive a carregar o lote de cima (o texto entra na posição 0)", async () => {
    const { ctl, view } = await rig(FakeRust.lines(12), 20);
    tableEdit(view, 0, 1, "ZZ");
    await ctl.slide("up");
    expect(undoDepth(view.state)).toBeGreaterThan(0);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).not.toContain("ZZ");
  });

  it("depois de salvar com a janela mantida, Ctrl+Z ainda desfaz e o lote volta a ficar alterado", async () => {
    const { ctl, view, rust } = await rig(FakeRust.lines(12), 20);
    tableEdit(view, 0, 1, "ZZ");
    await ctl.commit();
    await ctl.afterWrite(await rust.info(), true);
    expect(undoDepth(view.state)).toBeGreaterThan(0);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).not.toContain("ZZ");
  });
});

describe("desfazer em lotes que saíram da janela", () => {
  const edit = (v: EditorView, from: number, to: number, insert: string) => v.dispatch({ changes: { from, to, insert }, userEvent: "input.csv" });
  /** Edita o primeiro lote da janela e depois a empurra para longe (salto), deixando o lote editado fora dela. */
  async function editThenLeave() {
    const r = await rig(FakeRust.lines(40), 6);
    const firstBatch = win(r.view).first;
    const original = r.rust.batches[firstBatch].text;
    edit(r.view, 0, 1, "ZZ");
    await r.ctl.commit();
    await r.ctl.goto(110); // outra região do arquivo: o lote editado sai da janela
    expect(win(r.view).first).toBeGreaterThan(firstBatch + 1);
    return { ...r, firstBatch, original };
  }

  it("o Ctrl+Z leva ao lote que saiu da janela e desfaz a edição de lá", async () => {
    const { ctl, view, rust, firstBatch, original } = await editThenLeave();
    expect(rust.batches[firstBatch].text).not.toBe(original);
    expect(await ctl.undo()).toBe(true);
    expect(rust.batches[firstBatch].text).toBe(original);
    expect(win(view).first).toBeLessThanOrEqual(firstBatch);
    expect(view.state.doc.toString()).not.toContain("ZZ");
    expect(ctl.dirty).toBe(false);
  });

  it("depois de desfazer lá fora, Ctrl+Y refaz", async () => {
    const { ctl, view, rust, firstBatch } = await editThenLeave();
    await ctl.undo();
    await ctl.goto(110);
    expect(await ctl.redo()).toBe(true);
    expect(rust.batches[firstBatch].text.startsWith("ZZ")).toBe(true);
    expect(view.state.doc.toString()).toContain("ZZ");
    expect(ctl.dirty).toBe(true);
  });

  it("a ordem é a das edições: a mais nova primeiro, mesmo em outro lote", async () => {
    const { ctl, view, rust, firstBatch, original } = await editThenLeave();
    edit(view, 0, 1, "YY"); // na janela de agora (outro lote)
    await ctl.commit();
    const here = win(view).first;
    const hereOriginal = rust.original[here];
    await ctl.undo(); // a mais nova: o YY
    expect(rust.batches[here].text).toBe(hereOriginal);
    expect(rust.batches[firstBatch].text).not.toBe(original); // o ZZ ainda está lá
    await ctl.undo(); // agora o ZZ, que está fora da janela
    expect(rust.batches[firstBatch].text).toBe(original);
    expect(ctl.dirty).toBe(false);
  });

  it("uma edição nova depois de desfazer encerra o refazer", async () => {
    const { ctl, view } = await editThenLeave();
    await ctl.undo();
    edit(view, 0, 1, "WW");
    await ctl.commit();
    await ctl.goto(110);
    expect(await ctl.redo()).toBe(false);
  });

  it("sem nada a desfazer devolve falso", async () => {
    const { ctl } = await rig(FakeRust.lines(12), 6);
    expect(await ctl.undo()).toBe(false);
    expect(await ctl.redo()).toBe(false);
  });

  it("depois de salvar com os lotes renumerados os passos antigos somem", async () => {
    const { ctl, rust } = await editThenLeave();
    const info = await rust.info();
    await ctl.afterWrite({ ...info, batches: info.batches + 1 }, true);
    expect(await ctl.undo()).toBe(false);
  });
});

describe("changedSpan", () => {
  it("acha só o miolo que mudou", () => {
    expect(changedSpan("abcdef", "abXYef")).toEqual({ from: 2, toA: 4, toB: 4 });
    expect(changedSpan("abc", "abc")).toEqual({ from: 3, toA: 3, toB: 3 });
    expect(changedSpan("abc", "abXc")).toEqual({ from: 2, toA: 2, toB: 3 });
    expect(changedSpan("", "ab")).toEqual({ from: 0, toA: 0, toB: 2 });
  });

  it("não corta no meio de um emoji", () => {
    const a = "x😀y";
    const b = "x😁y"; // os dois emojis dividem o primeiro substituto
    const s = changedSpan(a, b);
    expect(s.from).toBe(1);
    expect(s.toA).toBe(3);
    expect(s.toB).toBe(3);
  });
});

describe("desfazer não aplica um passo velho num lugar errado", () => {
  it("depois de a janela trocar, o Ctrl+Z do app leva ao lote certo e não mexe no texto de agora", async () => {
    const { ctl, view, rust } = await rig(FakeRust.lines(40), 6);
    const first = win(view).first;
    const original = rust.batches[first].text;
    view.dispatch({ changes: { from: 0, to: 1, insert: "ZZ" }, userEvent: "input.csv" });
    await ctl.commit();
    await ctl.goto(110);
    const here = view.state.doc.toString();
    await ctl.undo();
    expect(rust.batches[first].text).toBe(original);
    // o texto do outro trecho (onde se estava) não foi tocado: era a corrupção do histórico do CodeMirror
    await ctl.goto(110);
    expect(view.state.doc.toString()).toBe(here);
  });

  it("cada edição da tabela vale um passo, mesmo duas seguidas no mesmo lote", async () => {
    const { ctl, view, rust } = await rig(FakeRust.lines(12), 6);
    const first = win(view).first;
    const original = rust.batches[first].text;
    view.dispatch({ changes: { from: 0, to: 1, insert: "AA" }, userEvent: "input.csv" });
    await vi.waitFor(() => expect(rust.edits).toHaveLength(1)); // a edição da tabela vai ao Rust na hora, não espera a pausa
    view.dispatch({ changes: { from: 3, to: 4, insert: "BB" }, userEvent: "input.csv" });
    await vi.waitFor(() => expect(rust.edits).toHaveLength(2));
    await ctl.undo();
    expect(rust.batches[first].text).not.toBe(original); // sobrou um dos dois
    await ctl.undo();
    expect(rust.batches[first].text).toBe(original);
    expect(await ctl.undo()).toBe(false);
  });

  it("desfazer e refazer em sequência volta exatamente ao mesmo texto", async () => {
    const { ctl, view, rust } = await rig(FakeRust.lines(12), 6);
    const first = win(view).first;
    const original = rust.batches[first].text;
    view.dispatch({ changes: { from: 0, to: 1, insert: "AA" }, userEvent: "input.csv" });
    await ctl.commit();
    const edited = rust.batches[first].text;
    await ctl.undo();
    expect(rust.batches[first].text).toBe(original);
    await ctl.redo();
    expect(rust.batches[first].text).toBe(edited);
    await ctl.undo();
    expect(rust.batches[first].text).toBe(original);
  });
});
