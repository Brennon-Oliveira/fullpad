import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { buildPreview } from "./livepreview";

function hidden(doc: string, cursor: number, to = cursor): string[] {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor, head: to },
    extensions: [markdown({ base: markdownLanguage })],
  });
  const out: string[] = [];
  const it = buildPreview(state, [{ from: 0, to: doc.length }]).atomic.iter();
  for (; it.value; it.next()) out.push(doc.slice(it.from, it.to));
  return out;
}

describe("buildPreview", () => {
  const doc = "# Título\n\ntexto **negrito** e `cod`\n\n- item\n- [ ] tarefa\n\n---\n";

  it("esconde marcadores fora do cursor", () => {
    const h = hidden(doc, doc.indexOf("texto") + 2);
    expect(h).toContain("# "); // título renderizado
    expect(h.filter((s) => s === "**")).toHaveLength(2);
    expect(h.filter((s) => s === "`")).toHaveLength(2);
    expect(h).toContain("- "); // checkbox: marcador da lista some
    expect(h).toContain("[ ]");
    expect(h).toContain("---");
  });

  it("revela a sintaxe do nó em que o cursor está", () => {
    const h = hidden(doc, doc.indexOf("negrito") + 2);
    expect(h).not.toContain("**");
    expect(h.filter((s) => s === "`")).toHaveLength(2); // outro nó segue renderizado
  });

  it("revela marcador de bloco na linha do cursor", () => {
    expect(hidden(doc, 3)).not.toContain("# ");
    expect(hidden(doc, doc.indexOf("---") + 1)).not.toContain("---");
  });

  it("seleção cobrindo várias linhas revela tudo que ela toca", () => {
    const h = hidden(doc, 0, doc.length);
    expect(h).toEqual([]);
  });

  it("esconde link fora do cursor", () => {
    const d = "veja [site](http://x.com) agora";
    expect(hidden(d, 0).join("")).toBe("[](http://x.com)");
    expect(hidden(d, 8)).toEqual([]);
  });
});
