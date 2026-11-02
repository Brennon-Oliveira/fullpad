import type { JNode } from "./tree";

/** Constrói os nós como o Rust os devolve (pré-ordem, UTF-16), para o texto dado. */
export function build(text: string): JNode[] {
  const nodes: JNode[] = [];
  let i = 0;
  const ws = () => {
    while (/\s/.test(text[i] ?? "")) i++;
  };
  const value = (parent: number, key?: string, kfrom?: number): void => {
    ws();
    const id = nodes.length;
    const from = i;
    const n: JNode = { parent, kind: "null", from, to: from, end: id + 1, len: 0, key, kfrom };
    nodes.push(n);
    const c = text[i];
    if (c === "{" || c === "[") {
      n.kind = c === "{" ? "object" : "array";
      i++;
      ws();
      while (text[i] !== (c === "{" ? "}" : "]")) {
        n.len++;
        if (c === "{") {
          ws();
          const kf = i;
          const m = /^"((?:[^"\\]|\\.)*)"/.exec(text.slice(i))!;
          i += m[0].length;
          ws();
          i++; // :
          value(id, JSON.parse(m[0]), kf);
        } else value(id);
        ws();
        if (text[i] === ",") i++;
        ws();
      }
      i++;
    } else if (c === '"') {
      const m = /^"((?:[^"\\]|\\.)*)"/.exec(text.slice(i))!;
      n.kind = "string";
      n.text = JSON.parse(m[0]);
      i += m[0].length;
    } else {
      const m = /^[^,}\]\s]+/.exec(text.slice(i))!;
      n.kind = m[0] === "true" || m[0] === "false" ? "bool" : m[0] === "null" ? "null" : "number";
      n.text = m[0];
      i += m[0].length;
    }
    n.to = i;
    n.end = nodes.length;
  };
  value(-1);
  return nodes;
}
