// @vitest-environment jsdom
import { EditorState, Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { createState, createView, tabEffects } from "../editor";
import { appendBatch, docPos, dropFirst, dropLast, fileLineAt, filePos, largeExtensions, largeField, lineNumberFormat, loadSpec, prependBatch, resetWindow, windowLoad, type WindowState } from "./state";

/** Três lotes: "a1\na2\n" | "b1\nb2\n" | "c1\n", começando na linha 100. */
function make(win?: Partial<WindowState>) {
  const doc = "a1\na2\nb1\nb2\nc1\n";
  const w: WindowState = { first: 7, startLine: 100, bounds: [0, 6, 12, 15], vbreaks: [], lossy: [false, false, false], ...win };
  return EditorState.create({ doc, extensions: [largeExtensions, largeField.init(() => w)] });
}
const win = (s: EditorState) => s.field(largeField);

describe("divisas dos lotes", () => {
  it("digitar no meio de um lote só empurra as divisas seguintes", () => {
    const s = make().update({ changes: { from: 1, insert: "XYZ" } }).state;
    expect(win(s).bounds).toEqual([0, 9, 15, 18]);
  });

  it("digitar no começo de um lote fica nele (a divisa fica antes do texto novo)", () => {
    const s = make().update({ changes: { from: 6, insert: "NOVO" } }).state; // começo do 2º lote
    expect(win(s).bounds).toEqual([0, 6, 16, 19]);
    expect(s.sliceDoc(win(s).bounds[1], win(s).bounds[2])).toBe("NOVOb1\nb2\n");
  });

  it("digitar no fim do documento fica no último lote", () => {
    const s = make().update({ changes: { from: 15, insert: "fim" } }).state;
    expect(win(s).bounds).toEqual([0, 6, 12, 18]);
  });

  it("apagar a quebra de linha entre dois lotes emenda a linha e mexe nos dois", () => {
    // apaga o "\n" que fecha o 1º lote (posição 5): "a2" + "b1" viram uma linha
    const s = make().update({ changes: { from: 5, to: 6 } }).state;
    expect(win(s).bounds).toEqual([0, 5, 11, 14]);
    expect(s.sliceDoc(0, 5)).toBe("a1\na2");
    expect(s.sliceDoc(5, 11)).toBe("b1\nb2\n");
    expect(s.doc.lines).toBe(5);
  });

  it("apagar um trecho que atravessa a divisa leva a divisa para o começo do trecho", () => {
    const s = make().update({ changes: { from: 4, to: 8 } }).state; // "2\nb1" → mexe nos dois lotes
    expect(win(s).bounds).toEqual([0, 4, 8, 11]);
  });

  it("colar várias linhas em cima da divisa mantém a ordem", () => {
    const s = make().update({ changes: { from: 4, to: 8, insert: "x\ny\nz\n" } }).state;
    const b = win(s).bounds;
    expect(b.every((v, i) => i === 0 || v >= b[i - 1])).toBe(true);
    expect(b[b.length - 1]).toBe(s.doc.length);
  });

  it("apagar um lote inteiro deixa uma divisa repetida, sem quebrar", () => {
    const s = make().update({ changes: { from: 6, to: 12 } }).state;
    expect(win(s).bounds).toEqual([0, 6, 6, 9]);
  });
});

describe("cortes virtuais", () => {
  const withBreaks = () => make({ vbreaks: [2, 9] }); // "a1⏎a2…": o \n da posição 2 e o da 9 são virtuais

  it("acompanham o texto digitado antes deles", () => {
    const s = withBreaks().update({ changes: { from: 0, insert: "XX" } }).state;
    expect(win(s).vbreaks).toEqual([4, 11]);
  });

  it("digitar logo antes do corte fica no segmento (o corte vai para depois)", () => {
    const s = withBreaks().update({ changes: { from: 2, insert: "++" } }).state;
    expect(win(s).vbreaks).toEqual([4, 11]);
  });

  it("apagar o \\n virtual o desfaz (juntar dois segmentos)", () => {
    const s = withBreaks().update({ changes: { from: 2, to: 3 } }).state;
    expect(win(s).vbreaks).toEqual([8]);
  });

  it("apagar um trecho que o contém também o desfaz", () => {
    const s = withBreaks().update({ changes: { from: 1, to: 4 } }).state;
    expect(win(s).vbreaks).toEqual([6]);
  });

  it("apagar depois dele não o move", () => {
    const s = withBreaks().update({ changes: { from: 3, to: 5 } }).state;
    expect(win(s).vbreaks).toEqual([2, 7]);
  });
});

describe("número de linha da margem", () => {
  it("é o da linha do arquivo, não o da janela", () => {
    const s = make();
    // a janela começa na linha de índice 100 (a 101ª): a margem mostra de 1 em diante, como o resto do app
    expect([1, 2, 5].map((n) => lineNumberFormat(n, s))).toEqual(["101", "102", "105"]);
    expect(fileLineAt(s, 0)).toBe(100); // o índice (a partir de 0) é o que o Rust usa
    expect(fileLineAt(s, 12)).toBe(104);
  });

  it("a linha depois de um corte virtual mostra ↳", () => {
    const s = make({ vbreaks: [2] }); // a linha 2 do editor começa depois do \n virtual
    expect(lineNumberFormat(1, s)).toBe("101");
    expect(lineNumberFormat(2, s)).toBe("↳");
    expect(lineNumberFormat(3, s)).toBe("103");
  });

  it("o CodeMirror mede a margem com números além das linhas do documento: não pode lançar erro", () => {
    const s = make();
    expect(() => lineNumberFormat(9999, s)).not.toThrow();
    expect(lineNumberFormat(9999, s)).toBe(String(100 + 9999));
  });

  it("a margem aparece de verdade no editor, com os números do arquivo", () => {
    const parent = document.createElement("div");
    const view = createView(parent, createState("a\nb\nc", 0, () => {}, [largeExtensions, largeField.init(() => ({ first: 3, startLine: 100, bounds: [0, 5], vbreaks: [], lossy: [false] }))]));
    view.dispatch({ effects: tabEffects({ markdown: false, dbml: false, json: false, dark: true, preview: false, wrap: false, overwrite: false, mdFormat: false, lineNumbers: true, lineNumberFormat }) });
    const nums = [...parent.querySelectorAll(".cm-lineNumbers .cm-gutterElement")].map((e) => e.textContent);
    expect(nums).toEqual(expect.arrayContaining(["101", "102", "103"]));
  });

  it("estado sem janela mostra o número do editor", () => {
    expect(lineNumberFormat(3, EditorState.create({ doc: "a\nb\nc" }))).toBe("3");
  });
});

describe("deslizar a janela", () => {
  it("acrescentar um lote no fim", () => {
    const s = make().update({
      changes: { from: 15, insert: "d1\nd2\n" },
      effects: appendBatch.of({ length: 6, breaks: [2], lossy: false }),
      annotations: loadSpec,
    }).state;
    expect(win(s).bounds).toEqual([0, 6, 12, 15, 21]);
    expect(win(s).vbreaks).toEqual([17]);
    expect(win(s).first).toBe(7);
    expect(win(s).lossy).toHaveLength(4);
  });

  it("acrescentar um lote no começo move o início da janela para trás", () => {
    const s = make().update({
      changes: { from: 0, insert: "z1\nz2\nz3\n" },
      effects: prependBatch.of({ length: 9, breaks: [], lossy: false, lines: 3 }),
      annotations: loadSpec,
    }).state;
    expect(win(s).bounds).toEqual([0, 9, 15, 21, 24]);
    expect(win(s).first).toBe(6);
    expect(win(s).startLine).toBe(97);
  });

  it("tirar o primeiro lote avança o início da janela", () => {
    const s = make({ vbreaks: [2, 9] }).update({ changes: { from: 0, to: 6, insert: "" }, effects: dropFirst.of({ lines: 2 }), annotations: loadSpec }).state;
    expect(win(s).bounds).toEqual([0, 6, 9]);
    expect(win(s).first).toBe(8);
    expect(win(s).startLine).toBe(102);
    expect(win(s).vbreaks).toEqual([3]); // o corte do lote tirado some; o outro anda junto
    expect(win(s).lossy).toHaveLength(2);
  });

  it("tirar o último lote", () => {
    const s = make().update({ changes: { from: 12, to: 15, insert: "" }, effects: dropLast.of(null), annotations: loadSpec }).state;
    expect(win(s).bounds).toEqual([0, 6, 12]);
    expect(win(s).first).toBe(7);
  });

  it("trocar a janela inteira", () => {
    const next: WindowState = { first: 40, startLine: 5000, bounds: [0, 3], vbreaks: [], lossy: [false] };
    const s = make().update({ changes: { from: 0, to: 15, insert: "x\ny\n" }, effects: resetWindow.of(next), annotations: loadSpec }).state;
    expect(win(s)).toEqual(next);
  });

  it("não entra no histórico do desfazer", () => {
    const tr = make().update({ changes: { from: 15, insert: "d\n" }, effects: appendBatch.of({ length: 2, breaks: [], lossy: false }), annotations: loadSpec });
    expect(tr.annotation(Transaction.addToHistory)).toBe(false);
    expect(tr.annotation(windowLoad)).toBe(true);
  });
});

describe("lote com bytes inválidos é só leitura", () => {
  const lossy = () => make({ lossy: [false, true, false] });

  it("recusa digitar, apagar e colar dentro dele", () => {
    const s = lossy();
    expect(s.update({ changes: { from: 8, insert: "x" } }).state.doc.toString()).toBe(s.doc.toString());
    expect(s.update({ changes: { from: 7, to: 9 } }).state.doc.toString()).toBe(s.doc.toString());
    expect(s.update({ changes: { from: 4, to: 8 } }).state.doc.toString()).toBe(s.doc.toString()); // atravessa a divisa
  });

  it("deixa editar os outros lotes", () => {
    expect(lossy().update({ changes: { from: 1, insert: "x" } }).state.doc.toString()).toContain("ax1");
    expect(lossy().update({ changes: { from: 13, insert: "x" } }).state.doc.toString()).toContain("cx1");
  });

  it("carregar a janela (não é edição) passa", () => {
    const s = lossy().update({ changes: { from: 15, insert: "d\n" }, effects: appendBatch.of({ length: 2, breaks: [], lossy: false }), annotations: loadSpec }).state;
    expect(s.doc.toString().endsWith("d\n")).toBe(true);
  });
});

describe("texto colado", () => {
  it("o arquivo só quebra linha em \\n: um \\r solto é caractere", () => {
    const s = EditorState.create({ doc: "a\rb\nc", extensions: [largeExtensions] });
    expect(s.doc.lines).toBe(2);
    expect(s.doc.line(1).text).toBe("a\rb");
  });
});

describe("posições do texto do arquivo (sem os cortes virtuais) e do documento", () => {
  // documento "ab⏎cd⏎ef" (⏎ = corte virtual nas posições 2 e 5): o texto do arquivo é "abcdef"
  const w = { vbreaks: [2, 5] };

  it("o começo de um trecho pula o corte que vem antes dele", () => {
    expect([0, 1, 2, 3, 4, 5].map((p) => docPos(w, p))).toEqual([0, 1, 3, 4, 6, 7]);
  });

  it("o fim de um trecho não leva o corte que vem logo depois, mas leva o que ele atravessa", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((p) => docPos(w, p, true))).toEqual([0, 1, 2, 4, 5, 7, 8]);
    // trocar de "b" até "d" (arquivo [1, 4)) apaga o corte do meio no documento: [1, 5)
    expect([docPos(w, 1), docPos(w, 4, true)]).toEqual([1, 5]);
  });

  it("é o inverso de filePos", () => {
    for (let f = 0; f <= 6; f++) expect(filePos(w, docPos(w, f))).toBe(f);
  });

  it("sem cortes as posições são as mesmas", () => {
    expect([docPos({ vbreaks: [] }, 7), docPos({ vbreaks: [] }, 7, true), filePos({ vbreaks: [] }, 7)]).toEqual([7, 7, 7]);
  });

  it("uma troca pela tabela aplicada ao documento deixa o texto do arquivo como a tabela espera", () => {
    const doc = "ab\ncd\nef";
    const [from, to] = [1, 4]; // "bcd" no texto do arquivo
    const next = doc.slice(0, docPos(w, from)) + "XY" + doc.slice(docPos(w, to, true));
    expect(next).toBe("aXY\nef"); // o corte de dentro do trecho some; o de fora (depois do "d") fica
  });
});
