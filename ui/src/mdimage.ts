import { type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { api } from "./api";

/**
 * Imagens no markdown (issue #9): colar (Ctrl+V) uma imagem da área de transferência, ou soltar um arquivo de
 * imagem no editor, guarda o arquivo (o Rust, `crates/core/src/images.rs`) e escreve `![](destino)` no cursor.
 * Aqui ficam as partes puras (testadas em `mdimage.test.ts`), o registro de "quem é a aba deste editor" e o
 * tratador de colar. O desenho da imagem no preview está em `imagepreview.ts`.
 */

/** O que o editor precisa saber da aba dele (quem sabe é o `main.ts`; o painel renderizado só tem a pasta). */
export interface ImageHost {
  /** O id da aba onde se pode colar imagem; `null` se não pode (leitura, painel, nota de versão, arquivo grande). */
  tabId(): string | null;
  /** A pasta do arquivo da aba, para resolver caminhos relativos; `null` numa nota solta. */
  base(): string | null;
  /** Mostra um aviso curto (colou, reaproveitou, deu erro). */
  notify(text: string): void;
}

const hosts = new WeakMap<EditorView, ImageHost>();
export const registerImageHost = (view: EditorView, host: ImageHost) => void hosts.set(view, host);
export const imageHostOf = (view: EditorView): ImageHost | undefined => hosts.get(view);

/** Endereço que não é de um arquivo local (rede, `data:`): o app não carrega, fica como texto. */
export const isRemoteSrc = (src: string): boolean => /^(?:[a-z][a-z0-9+.-]*:)/i.test(src) && !/^file:/i.test(src) && !/^[a-z]:[\\/]/i.test(src);

/**
 * O caminho que o Rust entende, a partir do que está entre os parênteses: `file://` passa como está (o Rust
 * decodifica); os outros são desfeitos do `%XX` (o texto guarda `%20` no lugar do espaço). Tira o `<…>` de um
 * destino escrito assim.
 */
export function localSrc(src: string): string {
  let s = src.trim();
  if (s.startsWith("<") && s.endsWith(">")) s = s.slice(1, -1);
  if (/^file:/i.test(s)) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s; // `%` solto que não é escape: vale como está
  }
}

/** O tipo MIME pela extensão do endereço (o Rust só devolve os bytes). */
export function mimeOfSrc(src: string): string {
  const ext = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(src)?.[1]?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "avif":
      return "image/avif";
    case "bmp":
      return "image/bmp";
    case "ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

/** `![](destino)` pronto para inserir. */
export const imageMarkdown = (target: string, alt = ""): string => `![${alt}](${target})`;

/** Os bytes como `data:` (base64), para a exportação embutir a imagem no HTML. */
export function toDataUri(bytes: ArrayBuffer, mime: string): string {
  const u8 = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

/** A primeira imagem da área de transferência (um print, uma imagem copiada de um site), ou `null`. */
export function clipboardImage(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) return f;
    }
  }
  for (const f of Array.from(data.files ?? [])) if (f.type.startsWith("image/")) return f;
  return null;
}

const humanSize = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** O aviso depois de guardar: onde ficou e se foi reaproveitada. */
export function savedMessage(s: { name: string; reused: boolean; size: number }): string {
  return s.reused ? `Imagem já existia (${s.name}): reaproveitada, nada gravado.` : `Imagem guardada: ${s.name} (${humanSize(s.size)}).`;
}

/** Escreve a imagem no lugar da seleção, numa transação só (um passo no Ctrl+Z). O arquivo não é apagado ao desfazer. */
export function insertImage(view: EditorView, target: string | readonly string[], at?: { from: number; to?: number }, userEvent = "input.paste") {
  const sel = view.state.selection.main;
  const from = at?.from ?? sel.from;
  const to = at ? (at.to ?? at.from) : sel.to;
  const text = (typeof target === "string" ? [target] : target).map((t) => imageMarkdown(t)).join("\n\n"); // várias: um parágrafo cada
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true,
    userEvent,
  });
  view.focus();
}

/** Guarda os bytes colados e escreve a imagem no editor; erros viram aviso, nunca exceção solta. */
export async function pasteImage(view: EditorView, host: ImageHost, tab: string, file: Blob) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const saved = await api.imageSave(tab, bytes);
    insertImage(view, saved.target);
    host.notify(savedMessage(saved));
  } catch (e) {
    host.notify(`Não foi possível colar a imagem: ${String(e).replace(/^Error: /, "")}`);
  }
}

/**
 * Ctrl+V com uma imagem na área de transferência. Só age num editor com aba que aceita imagem (registrado com
 * `registerImageHost`) e fora de leitura; texto, tabelas e Ctrl+Shift+V seguem o caminho de sempre.
 */
export const imagePaste: Extension = EditorView.domEventHandlers({
  paste(e, view) {
    if (view.state.readOnly) return false;
    const host = hosts.get(view);
    const tab = host?.tabId();
    if (!host || !tab) return false;
    const file = clipboardImage(e.clipboardData);
    if (!file) return false;
    e.preventDefault();
    void pasteImage(view, host, tab, file);
    return true;
  },
});
