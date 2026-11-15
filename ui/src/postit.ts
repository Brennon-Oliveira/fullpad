// Barra do post-it (nota rápida): faixa fina e amarela no topo da janela sem moldura do sistema, com
// o alfinete (fixa/desafixa o "sempre no topo", com um aviso curto) e o botão de fechar. O resto da
// faixa arrasta a janela (`data-tauri-drag-region`).

export interface PostitBar {
  el: HTMLElement;
  /** Atualiza o alfinete (aceso = fixado) sem mostrar aviso. */
  setPinned(v: boolean): void;
  /** Título da nota na barra (o nome da aba). */
  setTitle(t: string): void;
}

export interface PostitOptions {
  pinned: boolean;
  /** Pede a troca do "sempre no topo"; devolve o valor que ficou valendo. */
  onPin(next: boolean): Promise<boolean>;
  onClose(): void;
}

const PIN_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9.8 1.2 14.8 6.2l-1.1 1.1-1.2-.4-2.6 2.6.3 3-1.1 1.1-2.9-2.9-3.4 3.4-.7-.7 3.4-3.4L2.6 7.1 3.7 6l3 .3 2.6-2.6-.4-1.2z"/></svg>';
const CLOSE_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M3.5 3.5l9 9m0-9l-9 9"/></svg>';

export const TOAST_MS = 1400;

export function mountPostitBar(host: HTMLElement, opts: PostitOptions): PostitBar {
  const el = document.createElement("div");
  el.className = "postit-bar";
  el.setAttribute("data-tauri-drag-region", "");

  const pin = document.createElement("button");
  pin.type = "button";
  pin.className = "postit-btn postit-pin";
  pin.innerHTML = PIN_SVG;

  const title = document.createElement("span");
  title.className = "postit-title";
  title.setAttribute("data-tauri-drag-region", "");

  const toast = document.createElement("span");
  toast.className = "postit-toast";
  toast.setAttribute("data-tauri-drag-region", "");
  toast.setAttribute("role", "status");

  const close = document.createElement("button");
  close.type = "button";
  close.className = "postit-btn postit-close";
  close.title = "Fechar (Esc)";
  close.setAttribute("aria-label", "Fechar");
  close.innerHTML = CLOSE_SVG;

  el.append(pin, title, toast, close);
  host.prepend(el);

  let pinned = opts.pinned;
  let timer: number | undefined;
  const paint = () => {
    pin.classList.toggle("on", pinned);
    pin.setAttribute("aria-pressed", String(pinned));
    pin.title = pinned ? "Fixado no topo (clique para desafixar)" : "Fixar no topo";
    pin.setAttribute("aria-label", pin.title);
  };
  paint();

  pin.addEventListener("click", () => {
    void opts.onPin(!pinned).then((now) => {
      pinned = now;
      paint();
      toast.textContent = pinned ? "Fixado" : "Desafixado";
      window.clearTimeout(timer);
      timer = window.setTimeout(() => (toast.textContent = ""), TOAST_MS);
    });
  });
  close.addEventListener("click", () => opts.onClose());

  return {
    el,
    setTitle(t) {
      title.textContent = t;
      title.title = t;
    },
    setPinned(v) {
      pinned = v;
      paint();
    },
  };
}
