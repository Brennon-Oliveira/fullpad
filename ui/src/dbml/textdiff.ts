/** Trocas de texto (posições do texto de antes) e o que se faz com elas. Puro. */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/** Trocas linha a linha entre dois textos de mesmo número de linhas (o que um renome produz). */
export function lineChanges(old: string, next: string): TextChange[] {
  const a = old.split("\n");
  const b = next.split("\n");
  if (a.length !== b.length) {
    let from = 0;
    const max = Math.min(old.length, next.length);
    while (from < max && old[from] === next[from]) from++;
    let tail = 0;
    while (tail < max - from && old[old.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
    return from === old.length - tail && from === next.length - tail ? [] : [{ from, to: old.length - tail, insert: next.slice(from, next.length - tail) }];
  }
  const out: TextChange[] = [];
  let pos = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      const x = a[i];
      const y = b[i];
      let p = 0;
      const max = Math.min(x.length, y.length);
      while (p < max && x[p] === y[p]) p++;
      let q = 0;
      while (q < max - p && x[x.length - 1 - q] === y[y.length - 1 - q]) q++;
      out.push({ from: pos + p, to: pos + x.length - q, insert: y.slice(p, y.length - q) });
    }
    pos += a[i].length + 1;
  }
  return out;
}

export function applyChanges(text: string, changes: TextChange[]): string {
  let out = "";
  let at = 0;
  for (const c of [...changes].sort((x, y) => x.from - y.from)) {
    out += text.slice(at, c.from) + c.insert;
    at = c.to;
  }
  return out + text.slice(at);
}

