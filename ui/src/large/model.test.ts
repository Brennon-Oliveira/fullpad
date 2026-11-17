import { describe, expect, it } from "vitest";
import { firstRecord, humanSize, indexProgress, lineAtFraction, lineFraction, nearEdge, saveProgress, statusText, stripBreaks, windowAround } from "./model";

describe("stripBreaks", () => {
  it("tira só os \\n virtuais e deixa os reais", () => {
    // "aaa⏎bbb\nccc": o primeiro \n (posição 3) é virtual, o segundo (7) é real
    expect(stripBreaks("aaa\nbbb\nccc", [3])).toBe("aaabbb\nccc");
    expect(stripBreaks("aaa\nbbb\nccc", [3, 7])).toBe("aaabbbccc");
  });
  it("sem cortes devolve o texto como está", () => {
    expect(stripBreaks("a\nb", [])).toBe("a\nb");
  });
  it("posições em UTF-16: o emoji vale 2", () => {
    const text = "😀😀\n😀"; // o \n virtual está na posição 4
    expect(stripBreaks(text, [4])).toBe("😀😀😀");
  });
  it("corte no começo e no fim do texto", () => {
    expect(stripBreaks("\nabc", [0])).toBe("abc");
    expect(stripBreaks("abc\n", [3])).toBe("abc");
  });
});

describe("windowAround", () => {
  it("o lote e um vizinho de cada lado", () => {
    expect(windowAround(5, 10)).toEqual([4, 6]);
  });
  it("nas pontas não passa do arquivo", () => {
    expect(windowAround(0, 10)).toEqual([0, 1]);
    expect(windowAround(9, 10)).toEqual([8, 9]);
    expect(windowAround(99, 10)).toEqual([8, 9]);
    expect(windowAround(-3, 10)).toEqual([0, 1]);
  });
  it("arquivo de um lote só", () => {
    expect(windowAround(0, 1)).toEqual([0, 0]);
    expect(windowAround(0, 0)).toEqual([0, 0]);
  });
});

describe("nearEdge", () => {
  it("avisa quando falta menos de 1,5 tela para a borda", () => {
    expect(nearEdge(100, 100000, 800)).toBe("top");
    expect(nearEdge(50000, 100000, 800)).toBeNull();
    expect(nearEdge(98500, 100000, 800)).toBe("bottom");
  });
  it("sem altura de tela não decide nada", () => {
    expect(nearEdge(0, 0, 0)).toBeNull();
  });
});

describe("posição na barra de rolagem do arquivo", () => {
  it("a linha vira fração e a fração volta para a linha", () => {
    expect(lineFraction(0, 1001)).toBe(0);
    expect(lineFraction(1000, 1001)).toBe(1);
    expect(lineFraction(500, 1001)).toBe(0.5);
    for (const line of [0, 1, 17, 500, 999, 1000]) expect(lineAtFraction(lineFraction(line, 1001), 1001)).toBe(line);
  });
  it("fora do intervalo e arquivo de uma linha", () => {
    expect(lineAtFraction(2, 100)).toBe(99);
    expect(lineAtFraction(-1, 100)).toBe(0);
    expect(lineAtFraction(0.5, 1)).toBe(0);
    expect(lineFraction(5, 1)).toBe(0);
  });
});

describe("textos", () => {
  it("progresso do índice", () => {
    expect(indexProgress({ done: true, indexed: 10, size: 10 })).toBeNull();
    expect(indexProgress({ done: false, indexed: 43, size: 100 })).toBe("indexando 43%");
    expect(indexProgress({ done: false, indexed: 100, size: 100 })).toBe("indexando 99%");
  });
  it("barra de status: linha (a partir de 1), total e progresso", () => {
    expect(statusText(0, { lines: 4000005, done: true, indexed: 1, size: 1 })).toBe("Arquivo grande · linha 1 de 4.000.005");
    expect(statusText(41, { lines: 100, done: false, indexed: 50, size: 100 })).toBe("Arquivo grande · linha 42 de 100+ · indexando 50%");
  });
  it("tamanho legível", () => {
    expect(humanSize(512)).toBe("512 B");
    expect(humanSize(290 * 1024 * 1024)).toBe("290 MB");
    expect(humanSize(1536)).toBe("1,5 KB");
    expect(humanSize(3 * 1024 ** 3)).toBe("3,0 GB");
  });
});

describe("firstRecord (o cabeçalho de um CSV)", () => {
  it("vai até o fim da primeira linha", () => {
    expect(firstRecord("id,nome\n1,Ana\n", ",")).toBe("id,nome");
    expect(firstRecord("id,nome\r\n1,Ana", ",")).toBe("id,nome");
    expect(firstRecord("id,nome", ",")).toBe("id,nome");
    expect(firstRecord("", ",")).toBe("");
  });
  it("quebra de linha entre aspas não termina o registro", () => {
    expect(firstRecord('"a\nb",c\n1,2', ",")).toBe('"a\nb",c');
    expect(firstRecord('"diz ""oi""\nx",c\n1,2', ",")).toBe('"diz ""oi""\nx",c');
  });
  it("aspa no meio de um campo sem aspas é texto (como no Rust)", () => {
    expect(firstRecord('5" cano,b\n1,2', ",")).toBe('5" cano,b');
  });
  it("respeita o separador", () => {
    expect(firstRecord('a;"b;c"\n1', ";")).toBe('a;"b;c"');
  });
});

describe("andamento do salvar", () => {
  it("mostra o que já foi gravado e a porcentagem, sem chegar a 100% antes de terminar", () => {
    expect(saveProgress(0, 1000)).toContain("(0%)");
    expect(saveProgress(500, 1000)).toContain("(50%)");
    expect(saveProgress(1000, 1000)).toContain("(99%)");
    expect(saveProgress(5, 0)).toContain("(0%)");
  });
});
