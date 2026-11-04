import { describe, expect, it } from "vitest";
import { ChangeSet } from "@codemirror/state";
import { activeMarks, blockOf, clearFormat, currentBlock, setBlock, toggleInline, toggleLink, type Outcome } from "./mdformat";

/** Aplica o resultado e mostra o texto com a seleção entre ⟦ ⟧. */
function show(doc: string, o: Outcome): string {
  const out = ChangeSet.of(o.changes, doc.length).apply as unknown;
  void out;
  const next = ChangeSet.of(o.changes, doc.length);
  let text = "";
  let pos = 0;
  const parts: string[] = [];
  next.iterChanges((fa, ta, _fb, _tb, ins) => {
    parts.push(doc.slice(pos, fa), ins.toString());
    pos = ta;
  });
  parts.push(doc.slice(pos));
  text = parts.join("");
  const a = Math.min(o.anchor, o.head);
  const b = Math.max(o.anchor, o.head);
  return text.slice(0, a) + "⟦" + text.slice(a, b) + "⟧" + text.slice(b);
}
const sel = (doc: string, word: string, nth = 0) => {
  let i = -1;
  for (let k = 0; k <= nth; k++) i = doc.indexOf(word, i + 1);
  return [i, i + word.length] as const;
};

describe("toggleInline", () => {
  it("envolve e desfaz o negrito", () => {
    const doc = "uma palavra aqui";
    const [f, t] = sel(doc, "palavra");
    expect(show(doc, toggleInline(doc, f, t, "bold"))).toBe("uma **⟦palavra⟧** aqui");
    const d2 = "uma **palavra** aqui";
    const [f2, t2] = sel(d2, "palavra");
    expect(show(d2, toggleInline(d2, f2, t2, "bold"))).toBe("uma ⟦palavra⟧ aqui");
  });
  it("desfaz quando a seleção já inclui os marcadores", () => {
    const d = "uma **palavra** aqui";
    const [f, t] = sel(d, "**palavra**");
    expect(show(d, toggleInline(d, f, t, "bold"))).toBe("uma ⟦palavra⟧ aqui");
  });
  it("não leva os espaços das pontas", () => {
    const d = "a  palavra  b";
    expect(show(d, toggleInline(d, 1, 12, "italic"))).toBe("a  *⟦palavra⟧*  b");
  });
  it("itálico e negrito convivem", () => {
    const d = "**x**";
    const [f, t] = sel(d, "x");
    expect(show(d, toggleInline(d, f, t, "italic"))).toBe("***⟦x⟧***");
    const d2 = "***x***";
    const [f2, t2] = sel(d2, "x");
    expect(show(d2, toggleInline(d2, f2, t2, "italic"))).toBe("**⟦x⟧**");
    expect(show(d2, toggleInline(d2, f2, t2, "bold"))).toBe("*⟦x⟧*");
  });
  it("tachado e código", () => {
    expect(show("abc", toggleInline("abc", 0, 3, "strike"))).toBe("~~⟦abc⟧~~");
    expect(show("abc", toggleInline("abc", 0, 3, "code"))).toBe("`⟦abc⟧`");
    expect(show("`abc`", toggleInline("`abc`", 1, 4, "code"))).toBe("⟦abc⟧");
  });
  it("cada linha da seleção é formatada à parte, sem tocar na marcação de lista", () => {
    const d = "- um\n- dois";
    expect(show(d, toggleInline(d, 0, d.length, "bold"))).toBe("- **⟦um**\n- **dois⟧**");
  });
  it("sem seleção abre o par com o cursor no meio", () => {
    expect(show("ab", toggleInline("ab", 1, 1, "bold"))).toBe("a****⟦⟧b".replace("****⟦⟧", "**⟦⟧**"));
  });
});

describe("equação ($)", () => {
  it("envolve a seleção em $...$ e desfaz ao repetir", () => {
    const d = "a energia E = mc^2 vale";
    const [f, t] = sel(d, "E = mc^2");
    expect(show(d, toggleInline(d, f, t, "math"))).toBe("a energia $⟦E = mc^2⟧$ vale");
    const d2 = "a energia $E = mc^2$ vale";
    const [f2, t2] = sel(d2, "E = mc^2");
    expect(show(d2, toggleInline(d2, f2, t2, "math"))).toBe("a energia ⟦E = mc^2⟧ vale");
  });

  it("desfaz também com os cifrões dentro da seleção, e a destacada $$ de uma vez", () => {
    const d = "veja $x^2$ aqui";
    const [f, t] = sel(d, "$x^2$");
    expect(show(d, toggleInline(d, f, t, "math"))).toBe("veja ⟦x^2⟧ aqui");
    const d2 = "veja $$x^2$$ aqui";
    const [f2, t2] = sel(d2, "x^2");
    expect(show(d2, toggleInline(d2, f2, t2, "math"))).toBe("veja ⟦x^2⟧ aqui");
  });

  it("sem seleção abre o par, com o cursor no meio", () => {
    expect(show("ab", toggleInline("ab", 1, 1, "math"))).toBe("a$⟦⟧$b");
  });

  it("não leva os espaços das pontas (um $ seguido de espaço não abre equação)", () => {
    const d = "a  x+y  b";
    expect(show(d, toggleInline(d, 1, 8, "math"))).toBe("a  $⟦x+y⟧$  b");
  });

  it("acende o botão só quando a seleção está numa equação", () => {
    const d = "com $x^2$ e y";
    expect(activeMarks(d, ...sel(d, "x^2"))).toMatchObject({ math: true });
    expect(activeMarks(d, ...sel(d, "y"))).toMatchObject({ math: false });
  });
});

describe("activeMarks", () => {
  it("acende o que vale para a seleção", () => {
    const d = "uma **palavra** e *outra*";
    const [f, t] = sel(d, "palavra");
    expect(activeMarks(d, f, t)).toMatchObject({ bold: true, italic: false });
    const [f2, t2] = sel(d, "outra");
    expect(activeMarks(d, f2, t2)).toMatchObject({ bold: false, italic: true });
  });
});

describe("link", () => {
  it("texto vira link com a url marcada", () => {
    expect(show("veja aqui", toggleLink("veja aqui", 5, 9))).toBe("veja [aqui](⟦url⟧)");
  });
  it("uma URL vira link dela mesma", () => {
    const d = "https://exemplo.dev";
    expect(show(d, toggleLink(d, 0, d.length))).toBe("[⟦https://exemplo.dev⟧](https://exemplo.dev)");
  });
  it("link selecionado volta a texto", () => {
    const d = "[aqui](https://x.y)";
    expect(show(d, toggleLink(d, 0, d.length))).toBe("⟦aqui⟧");
  });
  it("selecionando o texto dentro do link, desfaz", () => {
    const d = "ver [aqui](https://x.y) já";
    const [f, t] = sel(d, "aqui");
    expect(show(d, toggleLink(d, f, t))).toBe("ver ⟦aqui⟧ já");
  });
});

describe("clearFormat", () => {
  it("limpa tudo da seleção", () => {
    const d = "a **b *c* `d`** e";
    const r = clearFormat(d, 2, 15)!;
    expect(show(d, r)).toBe("a ⟦b c d⟧ e");
  });
  it("limpa quem envolve a seleção", () => {
    const d = "um ~~**x**~~ dois";
    const [f, t] = sel(d, "x");
    expect(show(d, clearFormat(d, f, t)!)).toBe("um ⟦x⟧ dois");
  });
  it("link vira só o texto; nada a limpar devolve null", () => {
    const d = "[a](u)";
    expect(show(d, clearFormat(d, 0, 6)!)).toBe("⟦a⟧");
    expect(clearFormat("simples", 0, 7)).toBeNull();
  });
});

describe("blocos", () => {
  it("reconhece o tipo da linha", () => {
    expect(blockOf("# a")).toBe("h1");
    expect(blockOf("### a")).toBe("h3");
    expect(blockOf("#### a")).toBe("paragraph");
    expect(blockOf("- [ ] a")).toBe("todo");
    expect(blockOf("  - a")).toBe("ul");
    expect(blockOf("12. a")).toBe("ol");
    expect(blockOf("> a")).toBe("quote");
    expect(blockOf("a")).toBe("paragraph");
  });
  it("título, e repetir volta a texto normal", () => {
    expect(show("texto", setBlock("texto", 0, 5, "h2"))).toBe("## ⟦texto⟧");
    expect(show("## texto", setBlock("## texto", 3, 8, "h2"))).toBe("⟦texto⟧");
    expect(show("# a", setBlock("# a", 2, 3, "h3"))).toBe("### ⟦a⟧");
  });
  it("lista numerada conta só as linhas com texto e troca o tipo anterior", () => {
    const d = "- a\n\nb\n> c";
    expect(show(d, setBlock(d, 0, d.length, "ol"))).toBe("⟦1. a\n\n2. b\n3. c⟧");
  });
  it("lista de tarefas e citação", () => {
    expect(show("a\nb", setBlock("a\nb", 0, 3, "todo"))).toBe("- [ ] ⟦a\n- [ ] b⟧");
    expect(show("a", setBlock("a", 0, 1, "quote"))).toBe("> ⟦a⟧");
  });
  it("mantém o recuo das listas e tira nos demais tipos", () => {
    expect(show("  - a", setBlock("  - a", 4, 5, "ol"))).toBe("  1. ⟦a⟧");
    expect(show("  - a", setBlock("  - a", 4, 5, "h1"))).toBe("# ⟦a⟧");
  });
  it("seleção que termina no começo da linha seguinte não a inclui", () => {
    const d = "a\nb";
    expect(show(d, setBlock(d, 0, 2, "ul"))).toBe("- ⟦a\n⟧b");
  });
  it("bloco de código cerca as linhas e repetir tira a cerca", () => {
    const d = "x\ny";
    const r = setBlock(d, 0, 3, "code");
    expect(show(d, r)).toBe("```\n⟦x\ny⟧\n```");
    const fenced = "```\nx\ny\n```";
    expect(show(fenced, setBlock(fenced, 4, 7, "code"))).toBe("⟦x\ny⟧");
  });
  it("currentBlock vê o código cercado", () => {
    const d = "```\nx\n```\n# t";
    expect(currentBlock(d, 4)).toBe("fence");
    expect(currentBlock(d, d.length)).toBe("h1");
  });
});
