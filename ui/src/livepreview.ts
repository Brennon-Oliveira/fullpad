import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Range, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { makeMathField } from "./mathpreview";
import { cachedMermaid, isMermaidInfo, renderMermaid } from "./mermaid/render";

/** Acima disso o preview desliga para não pesar. */
export const MAX_PREVIEW_CHARS = 2_000_000;

class BulletWidget extends WidgetType {
  eq(other: WidgetType) {
    return other instanceof BulletWidget;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-md-bullet";
    el.textContent = "•";
    return el;
  }
}

class HrWidget extends WidgetType {
  eq(other: WidgetType) {
    return other instanceof HrWidget;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-md-hr";
    return el;
  }
}

class CheckWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: WidgetType) {
    return other instanceof CheckWidget && other.checked === this.checked;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.className = "cm-md-check";
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("click", (e) => {
      e.preventDefault();
      if (view.state.readOnly) return; // aba só de leitura: a caixa não troca o texto
      const pos = view.posAtDOM(box); // início de `[ ]`
      const inner = view.state.sliceDoc(pos + 1, pos + 2);
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: inner === " " ? "x" : " " } });
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

/** Um bloco ```mermaid fechado: as linhas inteiras dele e o código do diagrama. */
export interface MermaidBlock {
  from: number;
  to: number;
  code: string;
}

/** O bloco de código `node` é um diagrama Mermaid (fechado e com texto)? Bloco ainda aberto fica como código. */
export function mermaidAt(state: EditorState, node: SyntaxNode): MermaidBlock | null {
  if (node.name !== "FencedCode") return null;
  const info = node.getChild("CodeInfo");
  if (!info || !isMermaidInfo(state.sliceDoc(info.from, info.to))) return null;
  if (node.getChildren("CodeMark").length < 2) return null; // sem a cerca de fechar
  const text = node.getChild("CodeText");
  const code = text ? state.sliceDoc(text.from, text.to) : "";
  if (!code.trim()) return null;
  return { from: state.doc.lineAt(node.from).from, to: state.doc.lineAt(node.to).to, code };
}

class MermaidWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly dark: boolean,
  ) {
    super();
  }
  eq(other: WidgetType) {
    return other instanceof MermaidWidget && other.code === this.code && other.dark === this.dark;
  }
  get estimatedHeight() {
    return 160;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "cm-md-mermaid";
    const paint = (r: ReturnType<typeof cachedMermaid>) => {
      if (!r) return;
      el.classList.remove("loading");
      if (r.ok) {
        el.classList.remove("err");
        el.innerHTML = r.svg; // já passou pelo modo estrito do Mermaid (sem scripts nem HTML solto)
      } else {
        el.classList.add("err");
        el.textContent = `Erro no diagrama: ${r.error}`;
        el.title = "Clique para editar o código";
      }
    };
    const hit = cachedMermaid(this.code, this.dark);
    if (hit) paint(hit);
    else {
      el.classList.add("loading");
      el.textContent = "Desenhando o diagrama…";
      void renderMermaid(this.code, this.dark).then((r) => {
        paint(r);
        view.requestMeasure(); // a altura mudou: o CodeMirror precisa medir de novo
      });
    }
    return el;
  }
  ignoreEvent() {
    return false; // clicar no diagrama põe o cursor ali e mostra o código para editar
  }
}

/**
 * Blocos ```mermaid viram o diagrama (widget de bloco). Com o cursor tocando o bloco, aparece o código,
 * como o resto do live preview. Precisa ser um campo de estado: decoração que troca linhas inteiras não
 * pode vir de um plugin de visão. O documento nunca é alterado.
 */
function makeMermaidField(fixed: boolean) {
  const build = (state: EditorState): DecorationSet => {
    if (state.doc.length > MAX_PREVIEW_CHARS) return Decoration.none;
    const sel = fixed ? [] : state.selection.ranges;
    const dark = state.facet(EditorView.darkTheme);
    const out: Range<Decoration>[] = [];
    syntaxTree(state).iterate({
      enter(node) {
        if (node.name !== "FencedCode") return;
        const b = mermaidAt(state, node.node);
        if (b && !sel.some((r) => r.from <= b.to && r.to >= b.from)) {
          out.push(Decoration.replace({ widget: new MermaidWidget(b.code, dark), block: true }).range(b.from, b.to));
        }
        return false;
      },
    });
    return Decoration.set(out, true);
  };
  const field = StateField.define<DecorationSet>({
    create: build,
    update(value, tr) {
      if (tr.docChanged || (!fixed && tr.selection) || tr.reconfigured || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
        return build(tr.state);
      }
      return value;
    },
    provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((v) => v.state.field(f))],
  });
  return field;
}

const mermaidField = makeMermaidField(false);
const fixedMermaidField = makeMermaidField(true);
const mathField = makeMathField(false, MAX_PREVIEW_CHARS);
const fixedMathField = makeMathField(true, MAX_PREVIEW_CHARS);

export interface Built {
  all: DecorationSet;
  /** Só os trechos escondidos: o cursor pula por cima deles. */
  atomic: DecorationSet;
}

/**
 * Regra de revelação:
 *  - inline (`**x**`, `` `x` ``, `[a](b)`): sintaxe aparece quando a seleção toca o nó;
 *  - marcadores de bloco (`#`, `>`, `-`, `---`): aparecem quando a seleção toca a linha;
 *  - checkbox: vira widget, exceto se o cursor estiver dentro de `[ ]`.
 * O documento nunca é alterado; tudo aqui é só decoração.
 */
export function buildPreview(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  selection: readonly { from: number; to: number }[] = state.selection.ranges,
): Built {
  const all: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const doc = state.doc;
  const sel = selection;
  const touches = (from: number, to: number) => sel.some((r) => r.from <= to && r.to >= from);
  const inside = (from: number, to: number) => sel.some((r) => r.from < to && r.to > from);
  const lineTouched = (pos: number) => {
    const l = doc.lineAt(pos);
    return touches(l.from, l.to);
  };
  const spaceEnd = (pos: number) => (doc.sliceString(pos, pos + 1) === " " ? pos + 1 : pos);
  const hiddenAt = new Set<number>();
  const hide = (from: number, to: number, widget?: WidgetType) => {
    if (to <= from || hiddenAt.has(from)) return;
    if (doc.lineAt(from).number !== doc.lineAt(to).number) return;
    hiddenAt.add(from);
    const deco = Decoration.replace(widget ? { widget } : {});
    all.push(deco.range(from, to));
    atomic.push(deco.range(from, to));
  };
  const lineDeco = (pos: number, cls: string) => {
    all.push(Decoration.line({ class: cls }).range(doc.lineAt(pos).from));
  };
  const quoteLines = new Set<number>();

  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        const name = node.name;
        const h = /^ATXHeading([1-6])$/.exec(name);
        if (h) {
          lineDeco(node.from, `cm-md-h cm-md-h${h[1]}`);
          return;
        }
        switch (name) {
          case "HeaderMark":
            if (/^ATXHeading/.test(node.node.parent?.name ?? "") && !lineTouched(node.from)) {
              hide(node.from, spaceEnd(node.to));
            }
            return;
          case "InlineCode": {
            all.push(Decoration.mark({ class: "cm-md-code" }).range(node.from, node.to));
            if (!touches(node.from, node.to)) {
              for (const m of node.node.getChildren("CodeMark")) hide(m.from, m.to);
            }
            return false;
          }
          case "EmphasisMark":
          case "StrikethroughMark": {
            const p = node.node.parent;
            if (p && !touches(p.from, p.to)) hide(node.from, node.to);
            return;
          }
          case "Link": {
            all.push(Decoration.mark({ class: "cm-md-link" }).range(node.from, node.to));
            if (node.node.getChild("URL") && !touches(node.from, node.to)) {
              const marks = node.node.getChildren("LinkMark");
              if (marks.length >= 2) {
                hide(marks[0].from, marks[0].to);
                hide(marks[1].from, node.to);
              }
            }
            return;
          }
          case "QuoteMark": {
            const line = doc.lineAt(node.from);
            if (!quoteLines.has(line.from)) {
              quoteLines.add(line.from);
              lineDeco(node.from, "cm-md-quote");
            }
            if (!lineTouched(node.from)) hide(node.from, spaceEnd(node.to));
            return;
          }
          case "ListMark": {
            const item = node.node.parent;
            const kind = item?.parent?.name;
            if (kind === "BulletList") {
              if (!lineTouched(node.from)) {
                if (item?.getChild("Task")) hide(node.from, spaceEnd(node.to));
                else hide(node.from, node.to, new BulletWidget());
              }
            } else {
              all.push(Decoration.mark({ class: "cm-md-olmark" }).range(node.from, node.to));
            }
            return;
          }
          case "TaskMarker": {
            const checked = doc.sliceString(node.from + 1, node.from + 2) !== " ";
            if (checked) lineDeco(node.from, "cm-md-done");
            if (!inside(node.from, node.to)) hide(node.from, node.to, new CheckWidget(checked));
            return;
          }
          case "HorizontalRule":
            if (!lineTouched(node.from)) hide(node.from, node.to, new HrWidget());
            return;
          case "FencedCode":
          case "CodeBlock": {
            const mb = mermaidAt(state, node.node);
            if (mb && !touches(mb.from, mb.to)) return false; // o campo de estado troca o bloco pelo diagrama
            const first = doc.lineAt(node.from).number;
            const last = doc.lineAt(node.to).number;
            for (let n = first; n <= last; n++) {
              const cls =
                "cm-md-codeblock" + (n === first ? " cm-md-codefirst" : "") + (n === last ? " cm-md-codelast" : "");
              all.push(Decoration.line({ class: cls }).range(doc.line(n).from));
            }
            if (name === "FencedCode") {
              for (const m of [...node.node.getChildren("CodeMark"), ...node.node.getChildren("CodeInfo")]) {
                all.push(Decoration.mark({ class: "cm-md-fence" }).range(m.from, m.to));
              }
            }
            return false;
          }
        }
      },
    });
  }
  return { all: Decoration.set(all, true), atomic: Decoration.set(atomic, true) };
}

/**
 * `fixed`: visão só de leitura (painel ao lado do código). Não há cursor para revelar a sintaxe, então
 * tudo fica renderizado o tempo todo.
 */
function makePlugin(fixed: boolean) {
  return ViewPlugin.fromClass(
  class {
    all: DecorationSet = Decoration.none;
    atomic: DecorationSet = Decoration.none;
    constructor(view: EditorView) {
      this.rebuild(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        (u.selectionSet && !fixed) ||
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        this.rebuild(u.view);
      }
    }
    rebuild(view: EditorView) {
      if (view.state.doc.length > MAX_PREVIEW_CHARS) {
        this.all = this.atomic = Decoration.none;
        return;
      }
      const b = buildPreview(view.state, view.visibleRanges, fixed ? [] : undefined);
      this.all = b.all;
      this.atomic = b.atomic;
    }
  },
  {
    decorations: (v) => v.all,
    provide: (p) =>
      EditorView.atomicRanges.of((view) => view.plugin(p)?.atomic ?? Decoration.none),
  },
  );
}

const previewPlugin = makePlugin(false);
const fixedPlugin = makePlugin(true);

export function livePreview(opts: { fixed?: boolean } = {}): Extension {
  return [
    opts.fixed ? fixedPlugin : previewPlugin,
    opts.fixed ? fixedMermaidField : mermaidField,
    opts.fixed ? fixedMathField : mathField,
    EditorView.editorAttributes.of({ class: "cm-preview" }),
  ];
}
