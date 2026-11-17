// Contas do modo de arquivo grande (`crates/core/src/large.rs`), sem DOM nem CodeMirror: o que se faz com
// os lotes que o Rust devolve. O texto de um lote vem com `\n` virtuais (cortes de linha gigante, em
// `breaks`, UTF-16); o texto do arquivo é o mesmo sem eles (`stripBreaks`).

/** Quantos lotes ficam carregados no editor, no máximo (o resto fica no disco). */
export const MAX_WINDOW_BATCHES = 4;
/** Ao saltar para um lote, quantos lotes de cada lado vêm junto. */
export const WINDOW_AROUND = 1;
/** Quando faltam menos de tantas alturas de tela para a borda da janela, carrega o lote vizinho. */
export const NEAR_EDGE = 1.5;

/** Tira do texto de exibição os `\n` virtuais (`breaks`: posição de cada um, em UTF-16): sobra o texto do arquivo. */
export function stripBreaks(text: string, breaks: readonly number[]): string {
  if (breaks.length === 0) return text;
  let out = "";
  let prev = 0;
  for (const b of breaks) {
    out += text.slice(prev, b);
    prev = b + 1;
  }
  return out + text.slice(prev);
}

/**
 * O primeiro registro do CSV em `text` (sem o terminador), com as mesmas regras do Rust (`csv::scan_record`): uma aspa só
 * abre um campo logo depois do separador ou do começo, e quebra de linha entre aspas não termina o registro.
 */
export function firstRecord(text: string, delim: string): string {
  let inQuotes = false;
  let atStart = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') i++;
        else inQuotes = false;
      }
    } else if (c === delim) atStart = true;
    else if (c === '"' && atStart) {
      inQuotes = true;
      atStart = false;
    } else if (c === "\n" || c === "\r") return text.slice(0, i);
    else atStart = false;
  }
  return text;
}

/** Os lotes que vêm juntos ao ir para `batch`: ele e `around` vizinhos de cada lado, dentro de `count`. */
export function windowAround(batch: number, count: number, around = WINDOW_AROUND): [number, number] {
  const last = Math.max(0, count - 1);
  const b = Math.min(Math.max(0, batch), last);
  return [Math.max(0, b - around), Math.min(last, b + around)];
}

/** Perto da borda de cima ou de baixo da janela carregada? (medidas em px do rolo do editor) */
export function nearEdge(scrollTop: number, scrollHeight: number, clientHeight: number, factor = NEAR_EDGE): "top" | "bottom" | null {
  if (clientHeight <= 0) return null;
  const reach = clientHeight * factor;
  if (scrollTop < reach) return "top";
  if (scrollHeight - scrollTop - clientHeight < reach) return "bottom";
  return null;
}

/** Posição (0 a 1) de uma linha no arquivo, para o polegar da barra de rolagem do arquivo. */
export function lineFraction(line: number, totalLines: number): number {
  if (totalLines <= 1) return 0;
  return Math.min(1, Math.max(0, line / (totalLines - 1)));
}

/** A linha (a partir de 0) em que uma fração da barra cai. */
export function lineAtFraction(fraction: number, totalLines: number): number {
  if (totalLines <= 1) return 0;
  return Math.min(totalLines - 1, Math.max(0, Math.round(fraction * (totalLines - 1))));
}

const nf = new Intl.NumberFormat("pt-BR");

/** "indexando 43%" enquanto o índice não terminou, ou `null`. */
export function indexProgress(info: { done: boolean; indexed: number; size: number }): string | null {
  if (info.done) return null;
  const pct = info.size > 0 ? Math.min(99, Math.floor((info.indexed / info.size) * 100)) : 0;
  return `indexando ${pct}%`;
}

/** O texto da barra de status de uma aba grande: onde está e quanto falta indexar. */
export function statusText(line: number, info: { lines: number; done: boolean; indexed: number; size: number }): string {
  const total = info.done ? nf.format(info.lines) : `${nf.format(info.lines)}+`;
  const progress = indexProgress(info);
  return `Arquivo grande · linha ${nf.format(line + 1)} de ${total}${progress ? ` · ${progress}` : ""}`;
}

/** "Salvando… 3,2 GB de 15 GB (21%)". */
export function saveProgress(done: number, total: number): string {
  const pct = total > 0 ? Math.min(99, Math.floor((done / total) * 100)) : 0;
  return `Salvando… ${humanSize(done)} de ${humanSize(total)} (${pct}%)`;
}

/** Tamanho legível ("290 MB"). */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(".", ",")} ${units[i]}`;
}
