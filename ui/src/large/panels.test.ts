// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LargeHit, LargeSearchEnd, SearchOptions } from "../api";
import { mountLargeFind, type FindDeps } from "./find";
import { fractionAt, mountLargeScroll, thumbGeometry } from "./scrollbar";

afterEach(() => vi.useRealTimers());

describe("barra de rolagem do arquivo", () => {
  it("o polegar é proporcional ao que cabe na tela, mas nunca some", () => {
    expect(thumbGeometry(1000, 1000, 100, 0).height).toBe(100);
    expect(thumbGeometry(1000, 10_000_000, 50, 0).height).toBe(28);
    expect(thumbGeometry(100, 10, 50, 0).height).toBe(100); // o arquivo cabe na tela: polegar do tamanho da trilha
  });

  it("a posição vai de 0 até o fim da trilha", () => {
    expect(thumbGeometry(1000, 1001, 100, 0).top).toBe(0);
    const g = thumbGeometry(1000, 1001, 100, 1000);
    expect(g.top + g.height).toBeCloseTo(1000);
  });

  it("a fração leva em conta o meio do polegar e fica entre 0 e 1", () => {
    expect(fractionAt(0, 0, 1000, 100)).toBe(0);
    expect(fractionAt(1000, 0, 1000, 100)).toBe(1);
    expect(fractionAt(500, 0, 1000, 100)).toBeCloseTo(0.5);
    expect(fractionAt(-50, 0, 1000, 100)).toBe(0);
    expect(fractionAt(5, 0, 50, 50)).toBe(0); // sem folga
  });

  function rig(total = 1001) {
    const parent = document.createElement("div");
    document.body.append(parent);
    const jumps: number[] = [];
    const sc = mountLargeScroll(parent, { total: () => total, line: () => 0, visible: () => 50, jump: (l) => jumps.push(l) });
    sc.show(true);
    // jsdom não tem layout: uma trilha de 1000 px a partir do alto
    sc.el.getBoundingClientRect = () => ({ top: 0, left: 0, right: 12, bottom: 1000, width: 12, height: 1000, x: 0, y: 0, toJSON() {} });
    const thumb = sc.el.querySelector<HTMLElement>(".lthumb")!;
    Object.defineProperty(thumb, "offsetHeight", { value: 50 });
    return { sc, jumps, parent };
  }
  const ptr = (type: string, y: number) => Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientY: y }), { pointerId: 1 });

  it("clicar na trilha vai para a linha daquela altura", () => {
    const { sc, jumps } = rig(1001);
    sc.el.dispatchEvent(ptr("pointerdown", 500)); // meio da trilha: (500 − 25) / 950 = 0,5
    expect(jumps).toEqual([500]);
  });

  it("arrastar manda um salto por movimento e termina ao soltar", () => {
    const { sc, jumps } = rig(1001);
    sc.el.dispatchEvent(ptr("pointerdown", 25));
    sc.el.dispatchEvent(ptr("pointermove", 975));
    sc.el.dispatchEvent(ptr("pointerup", 975));
    sc.el.dispatchEvent(ptr("pointermove", 500)); // depois de soltar, mover não faz nada
    expect(jumps).toEqual([0, 1000]);
    expect(sc.el.classList.contains("dragging")).toBe(false);
  });

  it("escondida não calcula nada", () => {
    const { sc } = rig();
    sc.show(false);
    expect(sc.el.hidden).toBe(true);
  });
});

describe("busca no arquivo grande", () => {
  const hit = (line: number, col = 0): LargeHit => ({ line, col, len: 3, preview: "abc", preview_start: 0, preview_end: 3 });

  function rig(over: Partial<FindDeps> = {}) {
    const parent = document.createElement("div");
    document.body.append(parent);
    let push: (sid: string, hits: LargeHit[]) => void = () => {};
    const calls: { id: string; query: string; opts: SearchOptions }[] = [];
    const cancelled: string[] = [];
    const revealed: LargeHit[] = [];
    let finish: (e: LargeSearchEnd) => void = () => {};
    let fail: (e: unknown) => void = () => {};
    const deps: FindDeps = {
      search: (id, query, opts) => {
        calls.push({ id, query, opts });
        return new Promise((res, rej) => ((finish = res), (fail = rej)));
      },
      cancel: (id) => void cancelled.push(id),
      listen: (h) => ((push = h), () => {}),
      reveal: (h) => void revealed.push(h),
      cursorLine: () => 0,
      indexed: () => true,
      refocus: () => {},
      ...over,
    };
    const find = mountLargeFind(parent, deps);
    const input = find.el.querySelector<HTMLInputElement>("input")!;
    const count = find.el.querySelector<HTMLElement>(".rd-find-count")!;
    const type = async (q: string) => {
      input.value = q;
      input.dispatchEvent(new Event("input"));
      await vi.advanceTimersByTimeAsync(400);
    };
    const key = (k: string, shift = false) => input.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey: shift, bubbles: true, cancelable: true }));
    return { find, input, count, calls, cancelled, revealed, push: (id: string, h: LargeHit[]) => push(id, h), finish: (e: LargeSearchEnd) => finish(e), fail: (e: unknown) => fail(e), type, key };
  }

  it("busca depois de uma pausa na digitação e mostra os resultados à medida que chegam", async () => {
    vi.useFakeTimers();
    const r = rig();
    r.find.open();
    await r.type("erro");
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].query).toBe("erro");
    expect(r.count.textContent).toBe("Procurando…");
    r.push(r.calls[0].id, [hit(5), hit(9)]);
    expect(r.revealed[0].line).toBe(5); // o primeiro dali em diante vai para a tela sem esperar o fim
    expect(r.count.textContent).toBe("1 de 2+");
    r.push(r.calls[0].id, [hit(20)]);
    r.finish({ total: 3, truncated: false, cancelled: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(r.count.textContent).toBe("1 de 3");
  });

  it("Enter anda para o próximo, Shift+Enter volta, e dá a volta no fim", async () => {
    vi.useFakeTimers();
    const r = rig();
    r.find.open();
    await r.type("x");
    r.push(r.calls[0].id, [hit(1), hit(2), hit(3)]);
    r.finish({ total: 3, truncated: false, cancelled: false });
    await vi.advanceTimersByTimeAsync(0);
    r.key("Enter");
    r.key("Enter");
    r.key("Enter");
    expect(r.revealed.map((h) => h.line)).toEqual([1, 2, 3, 1]);
    r.key("Enter", true);
    expect(r.revealed.at(-1)?.line).toBe(3);
  });

  it("começa pelo primeiro resultado depois do cursor", async () => {
    vi.useFakeTimers();
    const r = rig({ cursorLine: () => 6 });
    r.find.open();
    await r.type("x");
    r.push(r.calls[0].id, [hit(1), hit(5), hit(8), hit(30)]);
    expect(r.revealed[0].line).toBe(8);
    expect(r.count.textContent).toBe("3 de 4+");
  });

  it("sem nenhum resultado depois do cursor, vale o primeiro, mas só quando a busca termina", async () => {
    vi.useFakeTimers();
    const r = rig({ cursorLine: () => 100 });
    r.find.open();
    await r.type("x");
    r.push(r.calls[0].id, [hit(1), hit(5)]);
    expect(r.revealed).toEqual([]); // a busca ainda corre: pode haver um depois do cursor mais adiante
    r.finish({ total: 2, truncated: false, cancelled: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(r.revealed.map((h) => h.line)).toEqual([1]);
    expect(r.count.textContent).toBe("1 de 2");
  });

  it("os resultados do começo do arquivo não tiram a pessoa de onde está: espera o primeiro depois do cursor", async () => {
    vi.useFakeTimers();
    const r = rig({ cursorLine: () => 1_500_000 });
    r.find.open();
    await r.type("x");
    r.push(r.calls[0].id, [hit(2), hit(250_002)]); // chegam primeiro, lá no começo
    expect(r.revealed).toEqual([]);
    r.push(r.calls[0].id, [hit(1_750_002)]); // o primeiro depois do cursor
    expect(r.revealed.map((h) => h.line)).toEqual([1_750_002]);
    expect(r.count.textContent).toBe("3 de 3+");
    r.push(r.calls[0].id, [hit(2_000_002)]);
    expect(r.revealed).toHaveLength(1); // não pula de novo
  });

  it("nenhum resultado e resultado cortado no teto", async () => {
    vi.useFakeTimers();
    const r = rig();
    r.find.open();
    await r.type("x");
    r.finish({ total: 0, truncated: false, cancelled: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(r.count.textContent).toBe("Nenhum resultado");
    await r.type("xy");
    r.push(r.calls[1].id, [hit(1)]);
    r.finish({ total: 1, truncated: true, cancelled: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(r.count.textContent).toBe("1 de 1+");
  });

  it("uma busca nova cancela a anterior e ignora os resultados atrasados dela", async () => {
    vi.useFakeTimers();
    const r = rig();
    r.find.open();
    await r.type("a");
    const first = r.calls[0].id;
    await r.type("ab");
    expect(r.cancelled).toContain(first);
    r.push(first, [hit(99)]); // resultado atrasado da busca velha
    expect(r.revealed).toEqual([]);
    r.push(r.calls[1].id, [hit(2)]);
    expect(r.revealed.map((h) => h.line)).toEqual([2]);
  });

  it("fechar cancela a busca; Esc fecha e devolve o foco", async () => {
    vi.useFakeTimers();
    let refocused = 0;
    const r = rig({ refocus: () => void refocused++ });
    r.find.open();
    await r.type("a");
    r.key("Escape");
    expect(r.cancelled).toContain(r.calls[0].id);
    expect(r.find.isOpen).toBe(false);
    expect(refocused).toBe(1);
  });

  it("expressão inválida mostra a mensagem do Rust", async () => {
    vi.useFakeTimers();
    const r = rig();
    r.find.open();
    await r.type("(");
    r.fail("unclosed group");
    await vi.advanceTimersByTimeAsync(0);
    expect(r.count.textContent).toBe("unclosed group");
  });

  it("os botões Aa, palavra e regex mudam as opções e refazem a busca", async () => {
    vi.useFakeTimers();
    const r = rig();
    r.find.open();
    await r.type("a");
    const [aa, word, re] = [...r.find.el.querySelectorAll<HTMLButtonElement>("button")].slice(0, 3);
    aa.click();
    word.click();
    re.click();
    expect(r.calls.at(-1)?.opts).toEqual({ case_sensitive: true, whole_word: true, regex: true });
    expect(r.calls).toHaveLength(4);
  });

  it("enquanto o índice não terminou, espera e tenta de novo sozinha", async () => {
    vi.useFakeTimers();
    let ready = false;
    const r = rig({ indexed: () => ready });
    r.find.open();
    await r.type("a");
    expect(r.calls).toHaveLength(0);
    expect(r.count.textContent).toContain("Indexando");
    ready = true;
    await vi.advanceTimersByTimeAsync(700);
    expect(r.calls).toHaveLength(1);
  });

  it("depois de uma edição os resultados valem menos: Enter refaz a busca em vez de ir para um lugar velho", async () => {
    vi.useFakeTimers();
    const r = rig();
    r.find.open();
    await r.type("a");
    r.push(r.calls[0].id, [hit(1), hit(2)]);
    r.finish({ total: 2, truncated: false, cancelled: false });
    await vi.advanceTimersByTimeAsync(0);
    r.find.stale();
    r.key("Enter");
    expect(r.calls).toHaveLength(2);
  });

  it("trocar de aba limpa a busca", async () => {
    vi.useFakeTimers();
    const r = rig();
    r.find.open();
    await r.type("a");
    r.find.reset();
    expect(r.find.isOpen).toBe(false);
    expect(r.count.textContent).toBe("");
  });
});
