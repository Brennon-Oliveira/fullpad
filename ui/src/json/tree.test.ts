import { describe, expect, it } from "vitest";
import { build } from "./test-util";
import { type JNode, ancestors, defaultExpanded, indexInParent, nodeAt, pathKeys, pathOf, spanOf, subtreeContainers, valueLabel, visibleRows } from "./tree";

const T = '{"nome":"x","lista":[{"id":1,"tags":["a","b"]},{"id":2,"tags":[]}],"a b":true,"vazio":{}}';

describe("visibleRows", () => {
  const nodes = build(T);
  it("mostra só a raiz quando está fechada", () => {
    expect(visibleRows(nodes, new Set()).map((r) => r.id)).toEqual([0]);
  });
  it("mostra os filhos de quem está aberto, em ordem, com profundidade e posição", () => {
    const rows = visibleRows(nodes, new Set([0]));
    expect(rows.map((r) => nodes[r.id].key)).toEqual([undefined, "nome", "lista", "a b", "vazio"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 1, 1]);
    expect(rows.map((r) => r.idx)).toEqual([0, 0, 1, 2, 3]);
  });
  it("abre a lista e seus itens", () => {
    const lista = nodes.findIndex((n) => n.key === "lista");
    const rows = visibleRows(nodes, new Set([0, lista, lista + 1]));
    const kinds = rows.map((r) => `${r.depth}${nodes[r.id].key ?? "#" + r.idx}`);
    expect(kinds).toEqual(["0#0", "1nome", "1lista", "2#0", "3id", "3tags", "2#1", "1a b", "1vazio"]);
  });
  it("aninhamento muito fundo não estoura a pilha", () => {
    const n = 20000;
    // nós montados direto (o `build` do teste é recursivo): [[[...[]...]]]
    const deep: JNode[] = Array.from({ length: n }, (_, i) => ({ parent: i - 1, kind: "array", from: i, to: 2 * n - i, end: n, len: i === n - 1 ? 0 : 1 }));
    const all = new Set(subtreeContainers(deep, 0));
    expect(visibleRows(deep, all)).toHaveLength(n);
  });
});

describe("defaultExpanded", () => {
  it("abre dois níveis e ignora coleções vazias", () => {
    const nodes = build(T);
    const open = defaultExpanded(nodes, 2);
    const lista = nodes.findIndex((n) => n.key === "lista");
    expect(open.has(0)).toBe(true);
    expect(open.has(lista)).toBe(true);
    expect(open.has(lista + 1)).toBe(false); // nível 2
    expect(open.has(nodes.findIndex((n) => n.key === "vazio"))).toBe(false);
  });
});

describe("pathOf e vizinhos", () => {
  const nodes = build(T);
  const find = (pred: (n: JNode, i: number) => boolean) => nodes.findIndex(pred);
  it("monta caminhos no estilo JSONPath", () => {
    expect(pathOf(nodes, 0)).toBe("$");
    expect(pathOf(nodes, find((n) => n.key === "nome"))).toBe("$.nome");
    expect(pathOf(nodes, find((n) => n.key === "a b"))).toBe('$["a b"]');
    const tags = find((n) => n.key === "tags");
    expect(pathOf(nodes, tags)).toBe("$.lista[0].tags");
    expect(pathOf(nodes, tags + 2)).toBe("$.lista[0].tags[1]");
    const id2 = nodes.findIndex((n, i) => n.key === "id" && i > tags);
    expect(pathOf(nodes, id2)).toBe("$.lista[1].id");
  });
  it("índice e ancestrais", () => {
    const tags = find((n) => n.key === "tags");
    expect(indexInParent(nodes, tags + 2)).toBe(1);
    expect(ancestors(nodes, tags)).toEqual([0, find((n) => n.key === "lista"), find((n) => n.key === "lista") + 1]);
  });
  it("pathKeys distingue chaves repetidas pela posição", () => {
    const rep = build('{"a":1,"a":2}');
    const keys = pathKeys(rep);
    expect(new Set(keys).size).toBe(3);
  });
});

describe("nodeAt", () => {
  const nodes = build(T);
  it("acha o nó mais fundo sob a posição", () => {
    expect(nodeAt(nodes, T.indexOf("nome") + 1)).toBe(1);
    expect(nodeAt(nodes, T.indexOf('"x"') + 1)).toBe(1); // o valor pertence ao mesmo membro
    const b = T.indexOf('"b"');
    const i = nodeAt(nodes, b + 1);
    expect(nodes[i].text).toBe("b");
    expect(pathOf(nodes, i)).toBe("$.lista[0].tags[1]");
  });
  it("na vírgula ou entre membros fica no contêiner", () => {
    const spaced = build('{ "a": 1 , "b": 2 }');
    expect(nodeAt(spaced, 9)).toBe(0); // no espaço depois do valor 1
    expect(nodeAt(spaced, 10)).toBe(0); // na vírgula
    expect(nodeAt(nodes, T.indexOf("[", T.indexOf("lista")))).toBe(nodes.findIndex((n) => n.key === "lista"));
  });
  it("fora do valor raiz não há nó", () => {
    const padded = build("  [1]  ");
    expect(nodeAt(padded, 0)).toBe(-1);
    expect(nodeAt(padded, 6)).toBe(-1);
    expect(nodeAt(padded, 3)).toBe(1);
  });
  it("trecho do nó inclui a chave", () => {
    const i = nodes.findIndex((n) => n.key === "nome");
    expect(T.slice(spanOf(nodes[i]).from, spanOf(nodes[i]).to)).toBe('"nome":"x"');
  });
});

describe("valueLabel", () => {
  it("resume coleções e põe aspas em strings", () => {
    const nodes = build('{"a":[1,2],"b":{},"c":[],"d":"t","e":3}');
    expect(valueLabel(nodes[1])).toBe("[2]");
    expect(valueLabel(nodes.find((n) => n.key === "b")!)).toBe("{}");
    expect(valueLabel(nodes.find((n) => n.key === "c")!)).toBe("[]");
    expect(valueLabel(nodes.find((n) => n.key === "d")!)).toBe('"t"');
    expect(valueLabel({ ...nodes[0], kind: "string", text: "x", cut: true })).toBe('"x"…');
  });
});
