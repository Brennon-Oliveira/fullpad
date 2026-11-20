import { describe, expect, it } from "vitest";
import * as dagre from "@dagrejs/dagre";
import { type Box, type DagreLike, groupKey, layoutDiagram } from "./layout";
import { parseDbml } from "./model";
import { interpret } from "./test-util";

const D = dagre as unknown as DagreLike;
const parse = (src: string) => parseDbml(interpret, src).diagram!;

/** `n` grupos com `per` tabelas cada: a primeira de cada grupo aponta para `base`, as outras para a primeira. */
function schoolSource(n: number, per: number): string {
  let src = "Table base { id int [pk] }\n";
  for (let g = 0; g < n; g++) {
    for (let i = 0; i < per; i++) {
      const target = i === 0 ? "base" : `g${g}_t0`;
      src += `Table g${g}_t${i} { id int [pk]\n  ref_id int [ref: > ${target}.id] }\n`;
    }
    src += `TableGroup grupo${g} { ${Array.from({ length: per }, (_, i) => `g${g}_t${i}`).join("\n")} }\n`;
  }
  return src;
}

const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const extent = (boxes: Iterable<Box>) => {
  let x1 = 0, y1 = 0;
  for (const b of boxes) {
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { w: x1, h: y1 };
};

describe("layout automático compacto", () => {
  it("muitas tabelas ligadas à mesma raiz não viram uma coluna só", () => {
    let src = "Table schools { id int [pk] }\n";
    for (let i = 0; i < 40; i++) src += `Table t${i} { id int [pk]\n  school_id int [ref: > schools.id] }\n`;
    const l = layoutDiagram(parse(src), D);
    const { w, h } = extent(l.boxes.values());
    expect(w / h).toBeGreaterThan(0.8);
    expect(w / h).toBeLessThan(2.6);
  });

  it("grupos se distribuem em largura e altura, sem se sobrepor", () => {
    const d = parse(schoolSource(8, 7));
    const l = layoutDiagram(d, D);
    const { w, h } = extent(l.boxes.values());
    expect(w / h).toBeGreaterThan(0.8);
    expect(w / h).toBeLessThan(2.6);
    const frames = d.groups.map((g) => l.boxes.get(groupKey(g.name))!);
    expect(frames).toHaveLength(8);
    for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) expect(overlap(frames[i], frames[j])).toBe(false);
  });

  it("nenhuma tabela, enum ou moldura de grupo cobre outra caixa", () => {
    const src = schoolSource(4, 5) + "Enum status { A\n B }\nTable avulsa1 { id int }\nTable avulsa2 { id int\n s status }\nTable x { id int }\nTable y { id int\n x_id int [ref: > x.id] }\n";
    const d = parse(src);
    const l = layoutDiagram(d, D);
    const keys = [...l.boxes.keys()].filter((k) => !k.startsWith("group:"));
    expect(keys.length).toBe(d.tables.length + d.enums.length);
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) expect(overlap(l.boxes.get(keys[i])!, l.boxes.get(keys[j])!)).toBe(false);
    // cada tabela do grupo fica dentro da moldura dele
    for (const g of d.groups) {
      const f = l.boxes.get(groupKey(g.name))!;
      for (const id of g.tables) {
        const b = l.boxes.get(id)!;
        expect(b.x).toBeGreaterThanOrEqual(f.x);
        expect(b.y).toBeGreaterThanOrEqual(f.y);
        expect(b.x + b.w).toBeLessThanOrEqual(f.x + f.w);
        expect(b.y + b.h).toBeLessThanOrEqual(f.y + f.h);
      }
    }
    // uma tabela fora de qualquer grupo não cai dentro da moldura de um grupo
    for (const g of d.groups) expect(overlap(l.boxes.get("avulsa1")!, l.boxes.get(groupKey(g.name))!)).toBe(false);
  });

  it("a área do desenho cobre todas as caixas e é determinística", () => {
    const d = parse(schoolSource(5, 6));
    const a = layoutDiagram(d, D);
    const b = layoutDiagram(d, D);
    expect([...b.boxes]).toEqual([...a.boxes]);
    const { w, h } = extent(a.boxes.values());
    expect(a.width).toBeGreaterThanOrEqual(w);
    expect(a.height).toBeGreaterThanOrEqual(h);
  });

  it("diagrama vazio e de uma tabela só funcionam", () => {
    expect(layoutDiagram(parse(""), D).boxes.size).toBe(0);
    const l = layoutDiagram(parse("Table a { id int }"), D);
    expect(l.boxes.get("a")).toMatchObject({ x: 24, y: 24 });
  });
});
