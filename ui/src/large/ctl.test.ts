// @vitest-environment jsdom
import { undo, undoDepth } from "@codemirror/commands";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LargeBatch, LargeEdit, LargeInfo } from "../api";
import { createState, createView } from "../editor";
import { LargeTab, type LargeHooks, type LargeIo } from "./ctl";
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
  }
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
    return { size: 1000, encoding: "utf8", eol: "lf", batches: this.batches.length, lines: this.total(), done: this.done, indexed: 1000, edited_batches: this.edits.length ? 1 : 0, orphaned: false, error: null, path: "/x.log" };
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
    return { edited: true, lines: nl(text), total_lines: this.total(), dirty: true };
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
