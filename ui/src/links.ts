import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { api } from "./api";
import { showMenuAt } from "./popup";

/**
 * URLs clicáveis no texto (qualquer linguagem; no markdown renderizado vale também para `[texto](url)`):
 * o mouse em cima vira "pointer", um clique não faz nada (seleciona normalmente), duplo clique ou
 * Ctrl+clique abre no navegador do sistema e o botão direito oferece "Copiar link".
 */
const URL_RE = /(?:https?:\/\/|mailto:)[^\s<>"'`\\]+/gi;

/** Tira a pontuação que costuma vir colada no fim da URL em frases (`.`, `,`, `)` sem par…). */
function trim(url: string): string {
  let u = url;
  for (;;) {
    const last = u[u.length - 1];
    if (last && /[.,;:!?*_\]}]/.test(last)) u = u.slice(0, -1);
    else if (last === ")" && (u.match(/\)/g)?.length ?? 0) > (u.match(/\(/g)?.length ?? 0)) u = u.slice(0, -1);
    else return u;
  }
}

/** A URL na posição `pos` do texto, ou `null`. Puro (testável sem DOM). */
export function urlInLine(text: string, offset: number): { from: number; to: number; url: string } | null {
  URL_RE.lastIndex = 0;
  for (let m = URL_RE.exec(text); m; m = URL_RE.exec(text)) {
    const url = trim(m[0]);
    if (offset >= m.index && offset < m.index + url.length) return { from: m.index, to: m.index + url.length, url };
  }
  return null;
}

export function urlRangeAt(state: EditorState, pos: number): { from: number; to: number; url: string } | null {
  // `[texto](url)`: o texto do link vale tanto quanto a URL (que o preview esconde)
  for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === "Link") {
      const u = n.getChild("URL");
      if (u) {
        const raw = state.sliceDoc(u.from, u.to).replace(/^<|>$/g, "");
        if (/^(https?:\/\/|mailto:)/i.test(raw)) return { from: n.from, to: n.to, url: raw };
      }
      break;
    }
  }
  const line = state.doc.lineAt(pos);
  const r = urlInLine(line.text, pos - line.from);
  return r ? { from: line.from + r.from, to: line.from + r.to, url: r.url } : null;
}

export const urlAt = (state: EditorState, pos: number): string | null => urlRangeAt(state, pos)?.url ?? null;

/** Realce da URL sob o mouse (sublinhado e cor de destaque); qualquer edição o apaga. */
const setHover = StateEffect.define<{ from: number; to: number } | null>();
const hoverField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    if (tr.docChanged) value = Decoration.none;
    for (const e of tr.effects) {
      if (!e.is(setHover)) continue;
      value = e.value ? Decoration.set([Decoration.mark({ class: "cm-url-hover" }).range(e.value.from, e.value.to)]) : Decoration.none;
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const hovered = new WeakMap<EditorView, { from: number; to: number } | null>(); // por editor (há vários painéis)
function hover(view: EditorView, r: { from: number; to: number } | null) {
  const h = hovered.get(view) ?? null;
  if (r?.from === h?.from && r?.to === h?.to) return;
  hovered.set(view, r);
  view.dispatch({ effects: setHover.of(r) });
}

const open = (url: string) => void api.openUrl(url).catch(() => {});

export const linkExtension: Extension = [
  hoverField,
  EditorView.domEventHandlers({
  mousemove(e, view) {
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    const r = pos === null ? null : urlRangeAt(view.state, pos);
    const want = r ? "pointer" : "";
    if (view.contentDOM.style.cursor !== want) view.contentDOM.style.cursor = want;
    hover(view, r);
  },
  mouseleave(_e, view) {
    view.contentDOM.style.cursor = "";
    hover(view, null);
  },
  mousedown(e, view) {
    if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return false;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    const url = pos === null ? null : urlAt(view.state, pos);
    if (!url) return false;
    open(url);
    return true; // sem cursor extra nem seleção
  },
  dblclick(e, view) {
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    const url = pos === null ? null : urlAt(view.state, pos);
    if (!url) return false;
    open(url);
    return false; // a seleção da palavra segue normal
  },
  contextmenu(e, view) {
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    const url = pos === null ? null : urlAt(view.state, pos);
    if (!url) return false;
    e.preventDefault();
    e.stopPropagation(); // o painel não abre o menu dele por cima
    showMenuAt(e.clientX, e.clientY, [{ label: "Copiar link", action: () => void navigator.clipboard.writeText(url).catch(() => {}) }]);
    return true;
  },
}),
];
