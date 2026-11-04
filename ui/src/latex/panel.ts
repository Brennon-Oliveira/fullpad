import { MAX_MATH_CHARS, renderMath } from "./render";
import { scanTex } from "./texscan";

const DEBOUNCE_MS = 300;
/** Acima disso a visão desliga (o texto continua normal), como as outras visões. */
export const MAX_TEX_CHARS = 500_000;
/** Equações mostradas: mais que isso pesa na tela sem ajudar a ninguém. */
const MAX_EQUATIONS = 500;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
}

export interface LatexHooks {
  /** Mouse sobre uma equação (`null`: saiu): `rev` diz de qual versão do texto vêm os trechos. */
  onHover?(spans: { from: number; to: number }[] | null, rev: number): void;
  /** Clique numa equação: leva o cursor do editor ao começo dela (só se `rev` ainda for o do texto). */
  onPick?(offset: number, rev: number): void;
}

/**
 * Visão de um arquivo `.tex` ao lado do código: as **equações soltas** do arquivo, uma por cartão, na
 * ordem (`scanTex`). Não compila o documento LaTeX (títulos, texto, listas ficam de fora). Mesmo contrato
 * dos painéis de diagrama (`show`/`update`/`setCursor`/`hide`): passar o mouse numa equação pinta o trecho
 * no código, o cursor do editor acende a equação em que está, e clicar nela leva o cursor até lá.
 */
export function createLatexPanel(host: HTMLElement, hooks: LatexHooks = {}) {
  const scroll = el("div", "tex-scroll");
  const message = el("div", "dbml-msg");
  host.replaceChildren(scroll, message);

  let lastText: string | null = null;
  let renderedText: string | null = null;
  let latestRev = 0;
  let renderedRev = -1;
  let seq = 0;
  let timer: number | undefined;
  let cards: { from: number; to: number; card: HTMLElement }[] = [];
  let cursor: { offset: number | null; rev: number } = { offset: null, rev: -1 };

  function applyFocus(reveal: boolean) {
    const live = cursor.offset !== null && cursor.rev === renderedRev;
    let hit: HTMLElement | null = null;
    for (const c of cards) {
      const on = live && cursor.offset! >= c.from && cursor.offset! <= c.to;
      c.card.classList.toggle("on", on);
      if (on) hit = c.card;
    }
    if (hit && reveal) hit.scrollIntoView?.({ block: "nearest" });
  }

  async function render(text: string) {
    const my = ++seq;
    if (text.length > MAX_TEX_CHARS) {
      scroll.replaceChildren();
      cards = [];
      message.textContent = "Arquivo grande demais para mostrar as equações. O texto continua normal.";
      return;
    }
    const eqs = scanTex(text);
    if (eqs.length === 0) {
      scroll.replaceChildren();
      cards = [];
      renderedText = text;
      message.textContent = "Nenhuma equação. Escreva, por exemplo: $E = mc^2$ ou \\[ \\int_0^1 x\\,dx \\]";
      return;
    }
    message.textContent = renderedText === null ? "Carregando equações…" : "";
    const shown = eqs.slice(0, MAX_EQUATIONS);
    const results = await Promise.all(shown.map((e) => renderMath(e.tex, e.display)));
    if (my !== seq) return; // chegou texto mais novo
    message.textContent = "";
    const next: typeof cards = [];
    const nodes: HTMLElement[] = [];
    shown.forEach((e, i) => {
      const r = results[i]!;
      const line = text.slice(0, e.from).split("\n").length;
      const card = el("div", "tex-eq" + (r.ok ? "" : " err"));
      card.append(el("div", "tex-eq-line", `linha ${line}`));
      const body = el("div", "tex-eq-body");
      if (r.ok) body.innerHTML = r.html; // saída do KaTeX com `trust: false`
      else {
        body.textContent = e.tex.length > MAX_MATH_CHARS ? e.tex.slice(0, 200) + "…" : e.tex;
        card.append(el("div", "tex-eq-error", r.error));
      }
      card.prepend(body);
      card.addEventListener("mouseenter", () => hooks.onHover?.([{ from: e.from, to: e.to }], renderedRev));
      card.addEventListener("mouseleave", () => hooks.onHover?.(null, renderedRev));
      card.addEventListener("click", () => hooks.onPick?.(e.from, renderedRev));
      nodes.push(card);
      next.push({ from: e.from, to: e.to, card });
    });
    if (eqs.length > shown.length) nodes.push(el("div", "tex-more", `Mostrando as primeiras ${MAX_EQUATIONS} de ${eqs.length} equações.`));
    scroll.replaceChildren(...nodes);
    cards = next;
    renderedText = text;
    if (lastText === text) renderedRev = latestRev;
    applyFocus(false);
  }

  return {
    /** Mostra o painel e desenha já (troca de aba, ligar a visão). */
    show(text: string, _resetView: boolean, rev = 0) {
      host.classList.add("on");
      latestRev = rev;
      if (text === lastText) {
        if (renderedText === text) renderedRev = rev;
        return;
      }
      lastText = text;
      window.clearTimeout(timer);
      void render(text);
    },
    /** Texto mudou: desenha com debounce. */
    update(text: string, rev = 0) {
      latestRev = rev;
      if (text === lastText) {
        if (renderedText === text) renderedRev = rev;
        return;
      }
      lastText = text;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void render(text), DEBOUNCE_MS);
    },
    /** O cursor do editor está em `offset` (versão `rev` do texto): acende a equação em que ele está. */
    setCursor(offset: number | null, rev: number) {
      cursor = { offset, rev };
      applyFocus(true);
    },
    hide() {
      window.clearTimeout(timer);
      seq++;
      renderedText = null;
      renderedRev = -1;
      lastText = null;
      host.classList.remove("on");
    },
  };
}

export type LatexPanel = ReturnType<typeof createLatexPanel>;
