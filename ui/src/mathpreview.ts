import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { cachedMath, renderMath } from "./latex/render";
import { MASK, scanMath } from "./latex/scan";

/** Nós do markdown onde um `$` não abre equação (código, endereços). */
const NO_MATH = new Set(["InlineCode", "FencedCode", "CodeBlock", "URL", "HTMLBlock", "HTMLTag", "CommentBlock", "Comment"]);

/** O texto com o código e os endereços trocados por `MASK` (as quebras de linha ficam, o tamanho também). */
export function maskedText(state: EditorState): string {
  const text = state.doc.toString();
  const cuts: [number, number][] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (!NO_MATH.has(node.name)) return;
      cuts.push([node.from, node.to]);
      return false;
    },
  });
  if (!cuts.length) return text;
  let out = "";
  let at = 0;
  for (const [from, to] of cuts) {
    if (from < at) continue;
    out += text.slice(at, from) + text.slice(from, to).replace(/[^\n]/g, MASK);
    at = to;
  }
  return out + text.slice(at);
}

class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
    readonly block: boolean,
  ) {
    super();
  }
  eq(other: WidgetType) {
    return other instanceof MathWidget && other.tex === this.tex && other.display === this.display && other.block === this.block;
  }
  get estimatedHeight() {
    return this.block ? 56 : -1;
  }
  toDOM(view: EditorView) {
    const el = document.createElement(this.block ? "div" : "span");
    el.className = "cm-md-math" + (this.block ? " cm-md-math-block" : this.display ? " cm-md-math-display" : "");
    const paint = (r: ReturnType<typeof cachedMath>) => {
      if (!r) return;
      el.classList.remove("loading");
      if (r.ok) {
        el.classList.remove("err");
        el.title = "";
        el.innerHTML = r.html; // saída do KaTeX com `trust: false`
      } else {
        el.classList.add("err");
        el.textContent = this.tex; // o erro aparece só neste trecho, no lugar da equação
        el.title = `Erro na equação: ${r.error}`;
      }
    };
    const hit = cachedMath(this.tex, this.display);
    if (hit) paint(hit);
    else {
      el.classList.add("loading");
      el.textContent = this.tex;
      void renderMath(this.tex, this.display).then((r) => {
        paint(r);
        view.requestMeasure(); // a altura mudou: o CodeMirror precisa medir de novo
      });
    }
    return el;
  }
  ignoreEvent() {
    return false; // clicar na equação põe o cursor ali e mostra o código para editar
  }
}

/**
 * `$...$` e `$$...$$` viram a equação renderizada. Com o cursor tocando a equação (ou o bloco dela), aparece
 * o código, como o resto do live preview; em `fixed` (painel só de leitura) fica sempre renderizada.
 * Campo de estado porque `$$` em bloco troca linhas inteiras e `$$` de várias linhas atravessa quebras
 * (decoração assim não pode vir de um plugin de visão). O documento nunca é alterado.
 */
export function makeMathField(fixed: boolean, maxChars: number) {
  const build = (state: EditorState): DecorationSet => {
    if (state.doc.length > maxChars) return Decoration.none;
    const spans = scanMath(maskedText(state));
    if (!spans.length) return Decoration.none;
    const sel = fixed ? [] : state.selection.ranges;
    const out: Range<Decoration>[] = [];
    for (const m of spans) {
      const from = m.block ? state.doc.lineAt(m.from).from : m.from;
      const to = m.block ? state.doc.lineAt(m.to).to : m.to;
      if (sel.some((r) => r.from <= to && r.to >= from)) continue;
      const widget = new MathWidget(m.tex, m.display, m.block);
      out.push(Decoration.replace({ widget, block: m.block }).range(from, to));
    }
    return Decoration.set(out, true);
  };
  return StateField.define<DecorationSet>({
    create: build,
    update(value, tr) {
      if (tr.docChanged || (!fixed && tr.selection) || tr.reconfigured || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
        return build(tr.state);
      }
      return value;
    },
    provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((v) => v.state.field(f))],
  });
}
