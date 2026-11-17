/**
 * Escolhas do usuário para um CSV, guardadas por aba em `TabState.csv` (o Rust as grava sem
 * interpretar; aqui elas são validadas, porque o que veio do disco nunca é de confiança).
 * Sem módulo pesado: pode ser importado na abertura do app.
 */

/** `auto`, um dos quatro comuns ou qualquer outro caractere ASCII digitado pela pessoa (um só). */
export type CsvDelimiter = string;
export type CsvDecimal = "." | ",";

export interface CsvSettings {
  /** `auto`: o app detecta pela estrutura. Qualquer outro valor é escolha manual e nunca é redetectado. */
  delimiter: CsvDelimiter;
  /** A primeira linha é o cabeçalho. */
  header: boolean;
  /** Separador decimal dos números (rodapé de estatísticas, tipo da coluna). */
  decimal: CsvDecimal;
}

export const DEFAULT_CSV: CsvSettings = { delimiter: "auto", header: true, decimal: "." };

export const DELIMITERS: { value: string; label: string }[] = [
  { value: ",", label: "Vírgula ( , )" },
  { value: ";", label: "Ponto e vírgula ( ; )" },
  { value: "\t", label: "Tab" },
  { value: "|", label: "Barra vertical ( | )" },
];

/** Nome do separador para a interface. */
export function delimiterName(d: string): string {
  const known = DELIMITERS.find((x) => x.value === d)?.label;
  if (known) return known;
  return isValidDelimiter(d) ? `Outro ( ${d} )` : "Vírgula ( , )";
}

/** Um único caractere ASCII que não seja aspa, quebra de linha nem controle (o mesmo critério do Rust, `valid_delimiter`). */
export function isValidDelimiter(d: unknown): d is string {
  return typeof d === "string" && d.length === 1 && d.charCodeAt(0) < 128 && d !== '"' && d !== "\n" && d !== "\r" && (d === "\t" || d.charCodeAt(0) >= 32 && d.charCodeAt(0) !== 127);
}

/** Lê o campo da sessão campo a campo: o que for inválido volta ao padrão, sem derrubar o resto. */
export function readCsvSettings(raw: unknown): CsvSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const delimiter = o.delimiter === "auto" || isValidDelimiter(o.delimiter) ? (o.delimiter as CsvDelimiter) : DEFAULT_CSV.delimiter;
  return {
    delimiter,
    header: typeof o.header === "boolean" ? o.header : DEFAULT_CSV.header,
    decimal: o.decimal === "," ? "," : ".",
  };
}

/** O separador em uso: a escolha manual ou, no automático, o que foi detectado. */
export function activeDelimiter(s: CsvSettings, detected: string | undefined): string {
  return s.delimiter !== "auto" ? s.delimiter : isValidDelimiter(detected) ? detected : ",";
}
