// Mensagens de erro do leitor em português. O pdf.js só fala inglês; aqui cada erro conhecido
// vira uma frase que diz o que houve. O que não for conhecido mantém o texto original, por baixo.

/** Erro do próprio leitor, que já vem em português: sai como está. */
export class ReaderError extends Error {
  override name = "ReaderError";
}

const text = (e: unknown) => (e instanceof Error ? e.message : String(e));
const name = (e: unknown) => (e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "");

export function friendlyError(e: unknown): string {
  if (e instanceof ReaderError) return e.message;
  const msg = text(e);
  const n = name(e);
  if (n === "PasswordException") return "O PDF é protegido por senha. Ainda não dá para abrir PDFs com senha.";
  if (n === "MissingPDFException" || /missing pdf/i.test(msg)) return "O arquivo está vazio ou não é um PDF.";
  if (/circular reference/i.test(msg)) return "A estrutura de páginas do PDF é inválida (referência circular). O arquivo está corrompido ou foi feito para travar leitores.";
  if (n === "InvalidPDFException" || /invalid pdf/i.test(msg)) return "O arquivo não é um PDF válido ou está corrompido (talvez incompleto, por exemplo um download que não terminou).";
  if (/worker was terminated|loading aborted/i.test(msg)) return "A leitura foi interrompida.";
  if (n === "UnexpectedResponseException" || n === "ResponseException") return "Não foi possível ler o arquivo.";
  return `Erro ao ler o PDF: ${msg}`;
}
