import { type EditorView, WidgetType } from "@codemirror/view";
import { api } from "./api";
import { imageHostOf, isRemoteSrc, localSrc, mimeOfSrc, spinner } from "./mdimage";
import { showMenuAt } from "./popup";

/**
 * `![alt](caminho)` desenhado no live preview e no painel renderizado. Só imagem **local** (o app não usa
 * rede): relativa à pasta do arquivo da aba, absoluta ou `file:///`, pelas mesmas regras do JSON (só extensões
 * de imagem, até 8 MB; `json_preview_image`). Endereço remoto, `data:` ou o que não carrega fica como o texto.
 * O texto do documento nunca é alterado.
 */

type Loaded = { ok: true; url: string } | { ok: false; error: string };

const TTL = 60_000; // o arquivo pode mudar por fora: relê depois de um minuto (o nome pelo hash nunca muda)
const MAX_ENTRIES = 60;
const cache = new Map<string, { at: number; p: Promise<Loaded> }>();

/** Carrega a imagem como `blob:`; o resultado fica em cache por (pasta, caminho). Nunca rejeita. */
export function loadImage(base: string | null, src: string): Promise<Loaded> {
  const key = `${base ?? ""}\u0000${src}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = api
    .imageRead(localSrc(src), base)
    .then((bytes): Loaded => ({ ok: true, url: URL.createObjectURL(new Blob([bytes], { type: mimeOfSrc(src) })) }))
    .catch((e): Loaded => ({ ok: false, error: String(e).replace(/^Error: /, "") }));
  cache.set(key, { at: Date.now(), p });
  if (hit) void hit.p.then((r) => r.ok && setTimeout(() => URL.revokeObjectURL(r.url), 5000)); // a que saiu do cache
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string;
    const gone = cache.get(oldest);
    cache.delete(oldest);
    void gone?.p.then((r) => r.ok && setTimeout(() => URL.revokeObjectURL(r.url), 5000));
  }
  return p;
}

/** Para os testes: esquece o que foi carregado. */
export const clearImageCache = () => cache.clear();

/** Esta imagem vira widget? (`false` para endereço remoto, `data:` e destino vazio) */
export const drawable = (src: string): boolean => {
  const s = localSrc(src);
  return s.length > 0 && !isRemoteSrc(s);
};

/** A imagem desenhada como PNG na área de transferência (o único formato de imagem que ela aceita em todo lugar). */
export async function copyImageEl(img: HTMLImageElement): Promise<void> {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error("a imagem não tem tamanho para copiar");
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("não foi possível preparar a imagem");
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("não foi possível converter a imagem");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

/**
 * Tira o `![](…)` do texto (o arquivo da imagem fica no disco). Se a imagem está sozinha na linha, a linha some
 * junto. Confere que o texto ali ainda é uma imagem (a posição vem da tela, que pode ter ficado para trás).
 */
export function removeImageAt(view: EditorView, from: number, len: number): boolean {
  const doc = view.state.doc;
  if (view.state.readOnly || from < 0 || from + len > doc.length || !doc.sliceString(from, from + 2).startsWith("![")) return false;
  const line = doc.lineAt(from);
  let a = from;
  let b = from + len;
  if (line.from === from && line.to === b) {
    // sozinha na linha: leva a quebra junto (a de trás; na última linha, a da frente)
    if (b < doc.length) b += 1;
    else if (a > 0) a -= 1;
  }
  view.dispatch({ changes: { from: a, to: b }, selection: { anchor: a }, userEvent: "delete" });
  return true;
}

const ICON_COPY = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3v5.5A1.5 1.5 0 0 0 3.5 10H4"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    /** Tamanho do `![alt](src)` no texto (para removê-lo). */
    readonly len: number,
  ) {
    super();
  }
  eq(other: WidgetType) {
    return other instanceof ImageWidget && other.src === this.src && other.alt === this.alt && other.len === this.len;
  }
  get estimatedHeight() {
    return 120;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "cm-md-img loading";
    el.append(spinner());
    const host = imageHostOf(view);
    const base = host?.base() ?? null;
    let img: HTMLImageElement | null = null;

    const copy = async (btn?: HTMLElement) => {
      try {
        if (!img) throw new Error("a imagem ainda não carregou");
        await copyImageEl(img);
        host?.notify("Imagem copiada.");
        if (btn) {
          btn.innerHTML = ICON_CHECK;
          setTimeout(() => (btn.innerHTML = ICON_COPY), 1200);
        }
      } catch (e) {
        host?.notify(`Não foi possível copiar a imagem: ${String(e).replace(/^Error: /, "")}`);
      }
    };
    const remove = () => {
      removeImageAt(view, view.posAtDOM(el), this.len);
      view.focus();
    };

    const button = (title: string, html: string, run: (b: HTMLElement) => void, cls = "") => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `cm-md-img-btn ${cls}`.trim();
      b.title = title;
      b.setAttribute("aria-label", title);
      b.innerHTML = html;
      // o botão não leva o cursor nem seleciona: só age
      b.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        run(b);
      });
      return b;
    };

    const fail = (why: string) => {
      el.classList.add("err");
      el.textContent = `⚠ ${this.alt || "imagem"}`;
      el.title = `${this.src}\n${why}`;
    };

    void loadImage(base, this.src).then((r) => {
      el.classList.remove("loading");
      el.textContent = "";
      if (r.ok) {
        const image = document.createElement("img");
        img = image;
        image.alt = this.alt;
        image.draggable = false;
        image.src = r.url;
        image.addEventListener("load", () => view.requestMeasure());
        image.addEventListener("error", () => fail("não foi possível desenhar a imagem"));
        const tools = document.createElement("span");
        tools.className = "cm-md-img-tools";
        tools.append(button("Copiar imagem", ICON_COPY, (b) => void copy(b)));
        if (!view.state.readOnly) tools.append(button("Remover imagem do texto", ICON_CLOSE, remove, "danger"));
        el.append(image, tools);
        el.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation(); // o menu do painel não abre por cima
          showMenuAt(e.clientX, e.clientY, [
            { label: "Copiar imagem", action: () => void copy() },
            "sep",
            { label: "Remover imagem do texto", disabled: view.state.readOnly, action: remove },
          ]);
        });
      } else fail(r.error);
      view.requestMeasure(); // a altura mudou: o CodeMirror precisa medir de novo
    });
    return el;
  }
  /** Os botões são do widget; o resto da imagem leva o cursor até ali e mostra o código. */
  ignoreEvent(e: Event) {
    return e.target instanceof Element && !!e.target.closest(".cm-md-img-tools");
  }
}
