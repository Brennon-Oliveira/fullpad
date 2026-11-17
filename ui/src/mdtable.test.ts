import { describe, expect, it } from "vitest";
import {
  cellToText,
  csvToTable,
  deleteCol,
  deleteRow,
  detectDelimiter,
  formatTable,
  hasExcess,
  insertCol,
  insertRow,
  moveCol,
  parseTable,
  setAlign,
  setCell,
  splitRow,
  tableFromSelection,
  tableToCsv,
  textToCell,
} from "./mdtable";

const T = "| Nome | Qtd |\n| --- | ---: |\n| Maçã | 3 |\n| Pera | 12 |";

describe("leitura", () => {
  it("quebra a linha respeitando \\| e as barras das pontas", () => {
    expect(splitRow("| a | b \\| c | d |")).toEqual(["a", "b \\| c", "d"]);
    expect(splitRow("a | b")).toEqual(["a", "b"]);
    expect(splitRow("| a | |")).toEqual(["a", ""]);
  });
  it("lê cabeçalho, alinhamentos e corpo", () => {
    const t = parseTable(T)!;
    expect(t.header).toEqual(["Nome", "Qtd"]);
    expect(t.aligns).toEqual(["none", "right"]);
    expect(t.rows).toEqual([["Maçã", "3"], ["Pera", "12"]]);
  });
  it("recusa o que não é tabela", () => {
    expect(parseTable("| a | b |\n| x | y |")).toBeNull();
    expect(parseTable("| a | b |\n| --- |")).toBeNull();
  });
  it("detecta linha com mais células que o cabeçalho", () => {
    expect(hasExcess(parseTable("| a |\n| - |\n| 1 | 2 |")!)).toBe(true);
    expect(hasExcess(parseTable(T)!)).toBe(false);
  });
});

describe("formatação alinhada", () => {
  it("alinha as colunas e respeita o alinhamento", () => {
    expect(formatTable(parseTable(T)!)).toBe(
      "| Nome | Qtd |\n| ---- | --: |\n| Maçã |   3 |\n| Pera |  12 |",
    );
  });
  it("centro e esquerda", () => {
    const t = setAlign(setAlign(parseTable(T)!, 0, "left"), 1, "center");
    expect(formatTable(t).split("\n")[1]).toBe("| :--- | :-: |");
  });
  it("é estável: formatar de novo não muda", () => {
    const once = formatTable(parseTable(T)!);
    expect(formatTable(parseTable(once)!)).toBe(once);
  });
  it("conta caracteres, não unidades UTF-16", () => {
    const t = parseTable("| a |\n| - |\n| 😀 |")!;
    expect(formatTable(t)).toBe("| a   |\n| --- |\n| 😀   |");
  });
});

describe("células", () => {
  it("escapa barra e vira <br> na quebra de linha", () => {
    expect(textToCell("a|b")).toBe("a\\|b");
    expect(textToCell("a||b")).toBe("a\\|\\|b");
    expect(textToCell("linha 1\nlinha 2")).toBe("linha 1<br>linha 2");
    expect(cellToText("x\\|y<br>z<BR/>w")).toBe("x|y\nz\nw");
  });
  it("trocar uma célula não mexe nas outras", () => {
    const t = setCell(parseTable(T)!, 1, 0, "Uva");
    expect(t.rows).toEqual([["Maçã", "3"], ["Uva", "12"]]);
    expect(setCell(t, -1, 1, "Total").header).toEqual(["Nome", "Total"]);
  });
});

describe("linhas e colunas", () => {
  const t = parseTable(T)!;
  it("insere e apaga linha", () => {
    expect(insertRow(t, 1).rows).toEqual([["Maçã", "3"], ["", ""], ["Pera", "12"]]);
    expect(insertRow(t, 99).rows.length).toBe(3);
    expect(deleteRow(t, 0).rows).toEqual([["Pera", "12"]]);
  });
  it("insere coluna com a linha curta completada", () => {
    const o = insertCol(parseTable("| a | b |\n| - | - |\n| 1 |")!, 1);
    expect(o.header).toEqual(["a", "", "b"]);
    expect(o.rows[0]).toEqual(["1", "", ""]);
    expect(o.aligns).toEqual(["none", "none", "none"]);
  });
  it("apaga coluna, menos a última", () => {
    expect(deleteCol(t, 0)!.header).toEqual(["Qtd"]);
    expect(deleteCol(deleteCol(t, 0)!, 0)).toBeNull();
  });
  it("move coluna levando alinhamento e células", () => {
    const o = moveCol(t, 0, 1)!;
    expect(o.header).toEqual(["Qtd", "Nome"]);
    expect(o.aligns).toEqual(["right", "none"]);
    expect(o.rows[0]).toEqual(["3", "Maçã"]);
    expect(moveCol(t, 0, -1)).toBeNull();
    expect(moveCol(t, 1, 1)).toBeNull();
  });
});

describe("CSV", () => {
  it("detecta o separador", () => {
    expect(detectDelimiter("a,b\n1,2")).toBe(",");
    expect(detectDelimiter("a;b\n1;2")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(detectDelimiter('a,b\n"x,y",2')).toBe(",");
  });
  it("vira tabela, com aspas, barra e quebra de linha na célula", () => {
    const t = csvToTable('nome,nota\n"Silva, Ana","a|b"\n"duas\nlinhas",7')!;
    expect(t.header).toEqual(["nome", "nota"]);
    expect(t.rows[0]).toEqual(["Silva, Ana", "a\\|b"]);
    expect(t.rows[1]).toEqual(["duas<br>linhas", "7"]);
  });
  it("uma coluna só não é tabela", () => {
    expect(csvToTable("a\nb")).toBeNull();
  });
  it("linhas curtas são completadas e cabeçalho vazio ganha nome", () => {
    const t = csvToTable("a,\n1")!;
    expect(t.header).toEqual(["a", "Coluna 2"]);
    expect(t.rows[0]).toEqual(["1", ""]);
  });
  it("tabela volta a CSV com aspas onde precisa", () => {
    const t = parseTable("| a | b |\n| - | - |\n| x, y | \"q\" |\n| l1<br>l2 | a\\|b |")!;
    expect(tableToCsv(t)).toBe('a,b\n"x, y","""q"""\n"l1\nl2",a|b');
  });
  it("ida e volta preserva o conteúdo", () => {
    const csv = 'a,b\n"x, y",2\n"l1\nl2",3';
    expect(tableToCsv(csvToTable(csv)!)).toBe(csv);
  });
});

describe("tableFromSelection", () => {
  const apply = (doc: string, from: number, to: number) => {
    const o = tableFromSelection(doc, from, to);
    const c = o.changes[0];
    return doc.slice(0, c.from) + c.insert + doc.slice(c.to);
  };
  it("converte linhas de CSV selecionadas", () => {
    const doc = "antes\n\na,b\n1,2\n\ndepois";
    const from = doc.indexOf("a,b");
    expect(apply(doc, from, doc.indexOf("\n\ndepois"))).toBe("antes\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\ndepois");
  });
  it("linha em branco recebe uma tabela nova", () => {
    expect(apply("x\n\ny", 2, 2)).toContain("| Coluna 1 | Coluna 2 |");
  });
  it("linha com texto ganha a tabela abaixo, sem tocar no texto", () => {
    const out = apply("titulo\nresto", 0, 0);
    expect(out.startsWith("titulo\n\n| Coluna 1")).toBe(true);
    expect(out.endsWith("\nresto")).toBe(true);
  });
  it("tabela existente é realinhada", () => {
    expect(apply("| a | b |\n|-|-|\n| longo | 1 |", 0, 5)).toBe("| a     | b   |\n| ----- | --- |\n| longo | 1   |");
  });
});

import { pasteGrid, pastedTable, tabularDelimiter } from "./mdtable";

describe("colar grade", () => {
  it("reconhece tab, ; e , só quando as linhas batem", () => {
    expect(tabularDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(tabularDelimiter("a;b\n1;2")).toBe(";");
    expect(tabularDelimiter("a,b\n1,2")).toBe(",");
    expect(tabularDelimiter("Olá, tudo bem?\nSim, e você, como vai?")).toBeNull();
    expect(tabularDelimiter("uma linha só, com vírgula")).toBeNull();
  });
  it("não converte o que já é tabela do markdown", () => {
    expect(pastedTable("| a | b |\n| - | - |\n| 1 | 2 |")).toBeNull();
    expect(pastedTable("a\tb\n1\t2")?.rows).toEqual([["1", "2"]]);
  });
  it("cola uma grade criando linhas e colunas", () => {
    const t = parseTable("| a | b |\n| - | - |\n| 1 | 2 |")!;
    const o = pasteGrid(t, 0, 1, [["x", "y"], ["z", "w"]]);
    expect(o.header).toEqual(["a", "b", "Coluna"].slice(0, 2).concat([""]));
    expect(o.rows).toEqual([["1", "x", "y"], ["", "z", "w"]]);
  });
});
