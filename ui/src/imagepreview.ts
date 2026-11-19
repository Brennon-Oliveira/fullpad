import { type EditorView, WidgetType } from "@codemirror/view";
import { api } from "./api";
import { imageHostOf, isRemoteSrc, localSrc, mimeOfSrc } from "./mdimage";

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

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: WidgetType) {
    return other instanceof ImageWidget && other.src === this.src && other.alt === this.alt;
  }
  get estimatedHeight() {
    return 120;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "cm-md-img loading";
    el.textContent = this.alt ? `${this.alt}…` : "imagem…";
    const base = imageHostOf(view)?.base() ?? null;
    void loadImage(base, this.src).then((r) => {
      el.classList.remove("loading");
      el.textContent = "";
      if (r.ok) {
        const img = document.createElement("img");
        img.alt = this.alt;
        img.draggable = false;
        img.src = r.url;
        img.addEventListener("load", () => view.requestMeasure());
        img.addEventListener("error", () => fail("não foi possível desenhar a imagem"));
        el.append(img);
      } else fail(r.error);
      view.requestMeasure(); // a altura mudou: o CodeMirror precisa medir de novo
    });
    const fail = (why: string) => {
      el.classList.add("err");
      el.textContent = `⚠ ${this.alt || "imagem"}`;
      el.title = `${this.src}\n${why}`;
    };
    return el;
  }
  ignoreEvent() {
    return false; // clicar na imagem põe o cursor ali e mostra o código para editar
  }
}
